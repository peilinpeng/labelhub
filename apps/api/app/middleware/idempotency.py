"""写接口幂等门禁。

作用域为 actorId + method + path + Idempotency-Key。请求先通过主键原子插入取得
执行权；并发请求只能回放已完成快照或收到“处理中”冲突，绝不会再次执行业务。

快照策略：
- 2xx / 3xx / 4xx 都缓存，包括确定性的业务校验失败；
- 5xx 或未捕获异常不缓存，并释放占位记录，允许客户端安全重试；
- 二进制上传端点不读取 request.body()，避免破坏流式上传。
"""

from __future__ import annotations

import base64
import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.exc import IntegrityError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response as StarletteResponse

from app.database import SessionLocal
from app.models.idempotency import IdempotencyRecord

_IDEMPOTENT_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_MAX_IDEMPOTENCY_KEY_LENGTH = 255
_REPLAYABLE_HEADERS = frozenset({"content-type", "location", "etag"})


def _utc_now() -> datetime:
    # MySQL DATETIME 不保留时区；统一写入 / 比较无时区 UTC，避免 aware/naive 混用。
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _error_response(
    status_code: int,
    code: str,
    message: str,
    *,
    details: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        headers=headers,
        content={
            "code": code,
            "message": message,
            "details": details,
            "traceId": uuid.uuid4().hex,
        },
    )


def _is_binary_upload(request: Request) -> bool:
    path = request.url.path.rstrip("/")
    return path.startswith("/api/v1/files/") and path.endswith("/upload")


def _replay_response(record: IdempotencyRecord) -> StarletteResponse:
    snapshot = record.response_snapshot_json or {}

    # 兼容 OPT-05 之前写入的 JSON 快照。
    if "status_code" in snapshot:
        return JSONResponse(
            content=snapshot["body"],
            status_code=int(snapshot["status_code"]),
            headers={"X-Idempotent-Replayed": "true"},
        )

    body = base64.b64decode(snapshot.get("bodyBase64", ""))
    headers = {
        str(key): str(value)
        for key, value in snapshot.get("headers", {}).items()
        if str(key).lower() in _REPLAYABLE_HEADERS
    }
    headers["X-Idempotent-Replayed"] = "true"
    return StarletteResponse(
        content=body,
        status_code=int(snapshot["statusCode"]),
        headers=headers,
    )


def _release_reservation(scope_key: str, request_hash: str) -> None:
    db = SessionLocal()
    try:
        (
            db.query(IdempotencyRecord)
            .filter(
                IdempotencyRecord.scope_key == scope_key,
                IdempotencyRecord.request_hash == request_hash,
            )
            .delete(synchronize_session=False)
        )
        db.commit()
    finally:
        db.close()


class IdempotencyMiddleware(BaseHTTPMiddleware):
    """依赖 AuthMiddleware 已将 actor 注入 request.state。"""

    async def dispatch(self, request: Request, call_next) -> StarletteResponse:
        if (
            request.method not in _IDEMPOTENT_METHODS
            or _is_binary_upload(request)
        ):
            return await call_next(request)

        idempotency_key = request.headers.get("Idempotency-Key", "").strip()
        if not idempotency_key:
            return await call_next(request)
        if len(idempotency_key) > _MAX_IDEMPOTENCY_KEY_LENGTH:
            return _error_response(
                422,
                "VALIDATION_FAILED",
                f"Idempotency-Key 最长 {_MAX_IDEMPOTENCY_KEY_LENGTH} 个字符",
            )

        actor = getattr(request.state, "actor", None)
        if actor is None:
            return await call_next(request)

        scope_key = (
            f"{actor.id}:{request.method}:{request.url.path}:{idempotency_key}"
        )
        body_bytes = await request.body()
        request_hash = hashlib.sha256(body_bytes).hexdigest()

        body_replayed = False

        async def _replay_receive() -> dict[str, Any]:
            nonlocal body_replayed
            if body_replayed:
                return {
                    "type": "http.request",
                    "body": b"",
                    "more_body": False,
                }
            body_replayed = True
            return {
                "type": "http.request",
                "body": body_bytes,
                "more_body": False,
            }

        request = Request(request.scope, _replay_receive)

        existing = self._reserve_or_get(scope_key, request_hash)
        if existing is not None:
            if existing.request_hash != request_hash:
                return _error_response(
                    409,
                    "IDEMPOTENCY_CONFLICT",
                    "相同的 Idempotency-Key 已与不同的请求体关联",
                )
            if existing.response_snapshot_json is not None:
                return _replay_response(existing)
            return _error_response(
                409,
                "IDEMPOTENCY_CONFLICT",
                "相同的幂等请求正在处理中，请稍后重试",
                details={"state": "PROCESSING", "retryable": True},
                headers={"Retry-After": "1"},
            )

        try:
            response = await call_next(request)
        except Exception:
            _release_reservation(scope_key, request_hash)
            raise

        if response.status_code >= 500:
            _release_reservation(scope_key, request_hash)
            return response

        body_chunks: list[bytes] = []
        async for chunk in response.body_iterator:
            body_chunks.append(
                chunk if isinstance(chunk, bytes) else chunk.encode()
            )
        response_body = b"".join(body_chunks)
        snapshot_headers = {
            key: value
            for key, value in response.headers.items()
            if key.lower() in _REPLAYABLE_HEADERS
        }

        db = SessionLocal()
        try:
            record = db.get(IdempotencyRecord, scope_key)
            if (
                record is not None
                and record.request_hash == request_hash
                and record.response_snapshot_json is None
            ):
                record.response_snapshot_json = {
                    "version": 2,
                    "statusCode": response.status_code,
                    "bodyBase64": base64.b64encode(response_body).decode("ascii"),
                    "headers": snapshot_headers,
                }
                db.commit()
        finally:
            db.close()

        return StarletteResponse(
            content=response_body,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.media_type,
        )

    @staticmethod
    def _reserve_or_get(
        scope_key: str,
        request_hash: str,
    ) -> IdempotencyRecord | None:
        """返回 None 表示本请求取得执行权；返回记录表示其他请求已占用。"""
        now = _utc_now()
        db = SessionLocal()
        try:
            # 同一作用域的过期记录可立即复用。删除与后续 INSERT 即使发生竞争，
            # 仍由 scope_key 主键保证只有一个请求能取得执行权。
            (
                db.query(IdempotencyRecord)
                .filter(
                    IdempotencyRecord.scope_key == scope_key,
                    IdempotencyRecord.expires_at <= now,
                )
                .delete(synchronize_session=False)
            )
            db.commit()

            db.add(
                IdempotencyRecord(
                    scope_key=scope_key,
                    request_hash=request_hash,
                    response_snapshot_json=None,
                    resource_id=None,
                    expires_at=now + timedelta(hours=24),
                )
            )
            try:
                db.commit()
                return None
            except IntegrityError:
                db.rollback()
                existing = db.get(IdempotencyRecord, scope_key)
                if existing is None:
                    # 极窄竞态：对方事务回滚后记录消失。下一次客户端重试即可，
                    # 当前请求不冒险执行第二次业务逻辑。
                    return IdempotencyRecord(
                        scope_key=scope_key,
                        request_hash=request_hash,
                        response_snapshot_json=None,
                        expires_at=now + timedelta(hours=24),
                    )
                db.expunge(existing)
                return existing
        finally:
            db.close()
