# idempotency_records 表 ORM 模型，对应契约 §3 幂等规则与 §24 存储契约。
# 本表无独立 id 字段，scope_key 即为主键。
# scope_key 格式：actorId:method:path:idempotency-key（由应用层拼接）。
# 记录默认保留 24 小时（expires_at = created_at + 24h），由应用层在写入时计算并显式传入。
# 过期记录由定时任务（Celery Beat）清理，数据库不自动删除。
# 无 updated_at：幂等记录创建后不修改。
from sqlalchemy import Column, String, DateTime, JSON, func

from app.database import Base


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"

    # 幂等作用域键：actorId:method:path:idempotency-key
    # 契约 §3 幂等作用域为 actorId + method + path + Idempotency-Key
    scope_key = Column(String(500), primary_key=True, nullable=False)

    # 请求体哈希（SHA-256），用于检测同 key 不同 body 冲突
    # 契约 §3：相同 key 与不同 request body 必须返回 IDEMPOTENCY_CONFLICT
    request_hash = Column(String(255), nullable=False)

    # 契约 §3：缓存的 response snapshot，供重复请求直接返回，可空（异步任务完成前可能为 NULL）
    response_snapshot_json = Column(JSON, nullable=True)

    # 契约 §3：创建或操作的资源 ID，用于快照回放，可空
    resource_id = Column(String(64), nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())

    # 契约 §3："幂等记录默认保留 24 小时"
    # 由应用层在创建时计算 created_at + 24h 后显式传入，不加 server_default
    expires_at = Column(DateTime, nullable=False)
