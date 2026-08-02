"""
audit_events 表 ORM 模型，对应 contracts `AuditEventRecord`（Quality Layer 富审计事件）。

与旧的 audit_logs（AuditLog）并存：
- audit_logs：领域状态迁移的内部审计（write_audit_log 写入）。
- audit_events：前端 fire-and-forget 上报的富事件（type/severity/source/actor/target/payload）。

`type` 存自由字符串：contracts AuditEventType 是开放超集（含 REVIEW_DIFF_GENERATED /
DATA_QUALITY_PASSPORT_GENERATED 等），禁止在后端硬编码白名单。
actor / target / payload 均以 JSON 原样存储，避免与前端联合类型强耦合。
本表为追加只写，无 updated_at。
"""
from sqlalchemy import Column, String, DateTime, JSON, Index, func

from app.database import Base


class AuditEvent(Base):
    __tablename__ = "audit_events"

    # ID 由应用层生成，前缀 ae_
    id = Column(String(64), primary_key=True, nullable=False)

    # contracts AuditEventType（自由字符串）
    type = Column(String(64), nullable=False)

    # contracts AuditSeverity：INFO / WARNING / ERROR ... 缺省 INFO
    severity = Column(String(20), nullable=False, default="INFO")

    # contracts AuditSource：如 WEB_FRONTEND / BACKEND / WORKER
    source = Column(String(40), nullable=False)

    # contracts AuditActor（{id, role, displayName?, ...}）原样 JSON
    actor_json = Column(JSON, nullable=False)

    # contracts AuditTarget（{entityType, entityId, taskId?, submissionId?, ...}）原样 JSON
    target_json = Column(JSON, nullable=False)

    # 常用 JSON 过滤键的物化列。保留原始 JSON 作为权威事件快照，同时让筛选、
    # 排序与分页完全在数据库中执行并可使用普通 B-Tree 索引。
    actor_id = Column(String(64), nullable=True)
    entity_type = Column(String(40), nullable=True)
    entity_id = Column(String(64), nullable=True)
    task_id = Column(String(64), nullable=True)
    schema_version_id = Column(String(64), nullable=True)
    assignment_id = Column(String(64), nullable=True)
    submission_id = Column(String(64), nullable=True)
    review_id = Column(String(64), nullable=True)
    export_id = Column(String(64), nullable=True)
    migration_plan_id = Column(String(64), nullable=True)

    # contracts AuditEventPayload（按 type 不同的结构化负载）原样 JSON
    payload_json = Column(JSON, nullable=True)

    # 请求追踪 / 幂等 / 完整性校验
    request_id = Column(String(255), nullable=True)
    idempotency_key = Column(String(255), nullable=True, unique=True)
    checksum = Column(String(255), nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        Index("ix_audit_events_task_created", "task_id", "created_at"),
        Index(
            "ix_audit_events_entity_created",
            "entity_type",
            "entity_id",
            "created_at",
        ),
        Index(
            "ix_audit_events_submission_created",
            "submission_id",
            "created_at",
        ),
        Index("ix_audit_events_type_created", "type", "created_at"),
        Index("ix_audit_events_actor_created", "actor_id", "created_at"),
    )
