# audit_logs 表 ORM 模型，对应契约 §25 AuditLog 与 §24 存储契约。
# ⚠️ 本表禁止物理删除，应用层必须拒绝所有 DELETE 操作（契约 §24 / §25 明确规定）。
# 本表为追加只写的不可变审计记录，无 updated_at 字段。
# action 合法值（契约 §25 AuditAction，最长值 AI_REVIEW_FAILED_TO_HUMAN = 25 字符，使用 String(40)）：
#   TASK_CREATED / TASK_PUBLISHED / TASK_PAUSED / TASK_RESUMED / TASK_ENDED / TASK_ARCHIVED /
#   SCHEMA_DRAFT_SAVED / SCHEMA_VERSION_PUBLISHED / DATASET_IMPORTED /
#   ASSIGNMENT_CLAIMED / ASSIGNMENT_EXPIRED / DRAFT_SAVED / SUBMISSION_CREATED /
#   AI_REVIEW_ENQUEUED / AI_REVIEW_STARTED / AI_REVIEW_SUCCEEDED /
#   AI_REVIEW_FAILED / AI_REVIEW_FAILED_TO_HUMAN /
#   REVIEW_CLAIMED / FINAL_REVIEW_REQUESTED / REVIEW_RETURNED / REVIEW_ACCEPTED / REVIEW_REJECTED /
#   EXPORT_CREATED / EXPORT_STARTED / EXPORT_SUCCEEDED / EXPORT_FAILED / EXPORT_CANCELED /
#   FILE_UPLOAD_URL_CREATED / FILE_UPLOAD_STARTED / FILE_UPLOAD_FAILED /
#   FILE_UPLOADED / FILE_CONFIRMED
# ⚠️ FILE_UPLOADED 语义：专指存储层确认字节已上传，禁止用于表示"upload url 已创建"。
# ⚠️ AI_REVIEW_STARTED 语义：Job PENDING→RUNNING 时使用，禁止复用 AI_REVIEW_ENQUEUED。
# ⚠️ FINAL_REVIEW_REQUESTED：DOUBLE_REVIEW 策略下人工审核通过时使用，非 REVIEW_ACCEPTED。
from sqlalchemy import Column, String, Text, DateTime, JSON, ForeignKey, func

from app.database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    # ID 由应用层生成，前缀 audit_，不使用数据库自增
    id = Column(String(64), primary_key=True, nullable=False)

    # 契约 AuditLog.entityType（最长 AI_REVIEW_JOB = 13 字符）：
    #   TASK / SCHEMA / ITEM / ASSIGNMENT / SUBMISSION / REVIEW / AI_REVIEW_JOB / EXPORT / FILE
    entity_type = Column(String(20), nullable=False)

    # 被审计的实体 ID
    entity_id = Column(String(64), nullable=False)

    # 契约 AuditAction，使用 String(40) 留有余量（最长值 25 字符）
    action = Column(String(40), nullable=False)

    # 契约 AuditLog.actor 中的 actor.id，FK → users.id
    actor_id = Column(String(64), ForeignKey("users.id"), nullable=False)

    # 契约 AuditLog.before?: unknown，操作前状态快照，可空
    before_json = Column(JSON, nullable=True)

    # 契约 AuditLog.after?: unknown，操作后状态快照，可空
    after_json = Column(JSON, nullable=True)

    # 契约 AuditLog.reason?: string，如打回原因、人工备注，可能较长使用 Text
    reason = Column(Text, nullable=True)

    # 契约 AuditLog.requestId?: string，请求追踪 ID
    request_id = Column(String(255), nullable=True)

    # 契约 AuditLog.createdAt；无 updated_at，本表记录写入后不可修改
    created_at = Column(DateTime, nullable=False, server_default=func.now())
