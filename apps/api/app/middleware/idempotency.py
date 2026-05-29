# 幂等中间件：拦截所有写接口（POST/PUT/PATCH/DELETE），读取 Idempotency-Key 请求头，
# 以 actorId+method+path+key 为 scope，查询 idempotency_records 表：
#   - 命中且 request body hash 相同：返回缓存的 response snapshot，不重复执行业务逻辑。
#   - 命中且 request body hash 不同：返回 409 IDEMPOTENCY_CONFLICT。
#   - 未命中：执行业务逻辑，记录 response snapshot，expires_at 设为 24 小时后。
import hashlib
import json
from datetime import datetime, timedelta, timezone

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response as StarletteResponse

from app.database import SessionLocal
from app.models.idempotency import IdempotencyRecord
from app.middleware.error_handler import IdempotencyConflictException

# 拦截的 HTTP 方法集合（契约 §3：幂等适用于写操作）
_IDEMPOTENT_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class IdempotencyMiddleware(BaseHTTPMiddleware):
    """
    幂等中间件，依赖 AuthMiddleware 已注入 request.state.actor。
    跳过条件：
      1. 请求方法不在写操作集合中
      2. 请求头缺失 Idempotency-Key
      3. request.state.actor 为 None（未认证请求，由鉴权层处理）
    """

    async def dispatch(self, request: Request, call_next) -> StarletteResponse:
        # ----------------------------------------------------------------
        # 跳过条件检查
        # ----------------------------------------------------------------
        if request.method not in _IDEMPOTENT_METHODS:
            return await call_next(request)

        idempotency_key: str = request.headers.get("Idempotency-Key", "")
        if not idempotency_key:
            return await call_next(request)

        actor = getattr(request.state, "actor", None)
        if actor is None:
            return await call_next(request)

        # ----------------------------------------------------------------
        # 构造 scope_key（契约 §3：actorId + method + path + Idempotency-Key）
        # ----------------------------------------------------------------
        scope_key = f"{actor.id}:{request.method}:{request.url.path}:{idempotency_key}"

        # ----------------------------------------------------------------
        # 读取并缓存请求体（body 流只能消费一次，需重建 receive 供后续使用）
        # ----------------------------------------------------------------
        body_bytes: bytes = await request.body()
        request_hash = hashlib.sha256(body_bytes).hexdigest()

        # 重建可被 call_next 再次消费的接收器
        async def _replay_receive():
            return {"type": "http.request", "body": body_bytes, "more_body": False}

        request = Request(request.scope, _replay_receive)

        # ----------------------------------------------------------------
        # 查询幂等记录
        # ----------------------------------------------------------------
        db = SessionLocal()
        try:
            record: IdempotencyRecord | None = db.get(IdempotencyRecord, scope_key)

            if record is not None:
                # 同 key 不同 body → 409 冲突
                if record.request_hash != request_hash:
                    raise IdempotencyConflictException(
                        "相同的 Idempotency-Key 已与不同的请求体关联"
                    )

                # 同 key 相同 body，快照已存在 → 返回缓存响应
                if record.response_snapshot_json is not None:
                    snapshot: dict = record.response_snapshot_json
                    return JSONResponse(
                        content=snapshot["body"],
                        status_code=snapshot["status_code"],
                        headers={"X-Idempotent-Replayed": "true"},
                    )

                # 快照为 None（异步任务进行中）→ 透传，不干预
            else:
                # 未命中：先写占位记录（无 response_snapshot_json），再执行业务
                new_record = IdempotencyRecord(
                    scope_key=scope_key,
                    request_hash=request_hash,
                    response_snapshot_json=None,
                    resource_id=None,
                    expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
                )
                db.add(new_record)
                db.commit()
        finally:
            db.close()

        # ----------------------------------------------------------------
        # 执行业务逻辑，捕获响应并回填快照
        # ----------------------------------------------------------------
        response = await call_next(request)

        # 只缓存成功响应（2xx / 3xx），不缓存服务端错误（5xx）
        if response.status_code < 500:
            # 读取 streaming response body（消费后需重建）
            body_chunks = []
            async for chunk in response.body_iterator:
                body_chunks.append(chunk)
            response_body_bytes = b"".join(body_chunks)

            # 尝试解析为 JSON，解析成功才写入快照
            try:
                response_body_dict = json.loads(response_body_bytes)
            except Exception:
                response_body_dict = None

            if response_body_dict is not None:
                # 回填快照（仅当 scope_key 记录仍存在时更新）
                db2 = SessionLocal()
                try:
                    rec: IdempotencyRecord | None = db2.get(
                        IdempotencyRecord, scope_key
                    )
                    if rec is not None:
                        rec.response_snapshot_json = {
                            "status_code": response.status_code,
                            "body": response_body_dict,
                        }
                        db2.commit()
                finally:
                    db2.close()

            # body 已被消费，必须重新构造 Response 对象返回
            return StarletteResponse(
                content=response_body_bytes,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type,
            )

        return response
