"""受保护的低基数指标、就绪检查和不含业务内容的请求日志。"""
import hmac
import json
import logging
import time
import uuid
from pathlib import Path
from fastapi import APIRouter, Request
from fastapi.responses import Response, JSONResponse
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from redis import Redis
from sqlalchemy import text, func
from starlette.requests import Request as StarletteRequest
from app.config import settings
from app.database import SessionLocal
from app.models.governance import MigrationJob
from app.models.export import ExportJob
from app.models.review import AIReviewJob
from app.middleware.task_permissions import resolve_route

logger = logging.getLogger("labelhub.requests")
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
REQUESTS = Counter("labelhub_http_requests_total", "HTTP 请求数", ["method", "route", "status"])
LATENCY = Histogram("labelhub_http_request_duration_seconds", "HTTP 请求耗时", ["method", "route"], buckets=(.01, .05, .1, .25, .5, 1, 2, 5, 10, 30, 60))
DEPENDENCIES = Gauge("labelhub_dependency_up", "依赖是否可用", ["dependency"])
JOBS = Gauge("labelhub_jobs", "持久化后台任务数量", ["kind", "status"])
OLDEST = Gauge("labelhub_oldest_pending_job_age_seconds", "最早等待任务年龄", ["kind"])
router = APIRouter(tags=["operations"])


def probe_dependencies():
    states = {}
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        states["database"] = True
    except Exception:
        states["database"] = False
    try:
        with Redis.from_url(settings.REDIS_URL, socket_connect_timeout=1, socket_timeout=1) as redis:
            states["redis"] = bool(redis.ping())
    except Exception:
        states["redis"] = False
    for name, up in states.items():
        DEPENDENCIES.labels(name).set(int(up))
    return states


@router.get("/ready")
def ready():
    states = probe_dependencies()
    return JSONResponse({"status": "ok" if all(states.values()) else "unavailable", "dependencies": states}, status_code=200 if all(states.values()) else 503)


def metrics_authorized(request):
    actor = getattr(request.state, "actor", None)
    if actor and actor.role == "ADMIN":
        return True
    expected = settings.METRICS_TOKEN
    if settings.METRICS_TOKEN_FILE:
        try:
            expected = Path(settings.METRICS_TOKEN_FILE).read_text().strip()
        except OSError:
            return False
    provided = request.headers.get("Authorization", "").removeprefix("Bearer ")
    return bool(expected) and hmac.compare_digest(provided, expected)


def refresh_job_metrics():
    states = ("DRAFT", "READY", "BLOCKED", "PENDING_APPROVAL", "APPROVED", "REJECTED", "QUEUED", "PENDING", "RUNNING", "SUCCEEDED", "PARTIAL", "FAILED", "CANCELED")
    with SessionLocal() as db:
        for kind, model in [("migration", MigrationJob), ("export", ExportJob), ("ai_review", AIReviewJob)]:
            counts = dict(db.query(model.status, func.count(model.id)).group_by(model.status).all())
            for status in states:
                JOBS.labels(kind, status).set(counts.get(status, 0))
            oldest = db.query(func.min(model.created_at)).filter(model.status.in_(["QUEUED", "PENDING"])).scalar()
            if oldest:
                from datetime import timezone
                age = max(0, time.time() - oldest.replace(tzinfo=timezone.utc).timestamp())
            else:
                age = 0
            OLDEST.labels(kind).set(age)


@router.get("/metrics", include_in_schema=True)
def metrics(request: Request):
    if not metrics_authorized(request):
        return JSONResponse({"code": "PERMISSION_DENIED", "message": "指标接口需要监控凭据或管理员身份", "traceId": "metrics"}, status_code=403)
    states = probe_dependencies()
    if states["database"]:
        try:
            refresh_job_metrics()
        except Exception:
            DEPENDENCIES.labels("database").set(0)
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


class ObservabilityMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request = StarletteRequest(scope)
        route, _ = resolve_route(request)
        route = route or "unmatched"
        method = scope["method"] if scope["method"] in ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS") else "OTHER"
        request_id, started, status = uuid.uuid4().hex, time.monotonic(), 500
        async def tracked_send(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                message["headers"] = [*message.get("headers", []), (b"x-request-id", request_id.encode())]
            await send(message)
        try:
            await self.app(scope, receive, tracked_send)
        finally:
            elapsed = time.monotonic() - started
            REQUESTS.labels(method, route, str(status)).inc()
            LATENCY.labels(method, route).observe(elapsed)
            if route not in ("/api/v1/health", "/api/v1/metrics", "/api/v1/ready"):
                logger.info(json.dumps({"requestId": request_id, "method": method, "route": route, "status": status, "durationMs": round(elapsed * 1000)}, ensure_ascii=False))
