# assignments 与 drafts 两张表的 ORM 模型，对应契约 §6.3 Assignment/Draft 与 §24 存储契约。
# Assignment.status 合法值（契约 §6.3 AssignmentStatus）：
#   CLAIMED / DRAFTING / SUBMITTED / RETURNED / ACCEPTED / CANCELED / EXPIRED
# latest_submission_id 为循环外键，使用 use_alter=True 避免建表顺序死锁。
# Draft 无独立 ID，assignment_id 即为主键（一个 Assignment 对应一份活跃草稿）。
# Draft.saved_at 由应用层在每次 save_draft 时显式写入，不使用 server_default。
from sqlalchemy import Column, String, Integer, DateTime, JSON, ForeignKey, func

from app.database import Base


class Assignment(Base):
    __tablename__ = "assignments"

    # ID 由应用层生成，前缀 asn_，不使用数据库自增
    id = Column(String(64), primary_key=True, nullable=False)

    # FK → tasks.id
    task_id = Column(String(64), ForeignKey("tasks.id"), nullable=False)

    # FK → dataset_items.id（正向指针，不加 use_alter）
    item_id = Column(String(64), ForeignKey("dataset_items.id"), nullable=False)

    # FK → users.id，标注员
    labeler_id = Column(String(64), ForeignKey("users.id"), nullable=False)

    # FK → schema_versions.id，标注时使用的不可变版本，契约 Assignment.schemaVersionId
    schema_version_id = Column(
        String(64), ForeignKey("schema_versions.id"), nullable=False
    )

    # 契约 AssignmentStatus：CLAIMED / DRAFTING / SUBMITTED / RETURNED / ACCEPTED / CANCELED / EXPIRED
    status = Column(String(20), nullable=False, default="CLAIMED")

    # 契约 Assignment.lockedUntil，领取锁过期时间，可空
    locked_until = Column(DateTime, nullable=True)

    # 契约 Assignment.latestSubmissionId，循环 FK 使用 use_alter=True
    latest_submission_id = Column(
        String(64),
        ForeignKey(
            "submissions.id",
            use_alter=True,
            name="fk_assignments_latest_submission_id",
        ),
        nullable=True,
    )

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class Draft(Base):
    __tablename__ = "drafts"

    # Draft 无独立 ID，assignment_id 即为主键，一个 Assignment 对应一份活跃草稿
    # FK → assignments.id
    assignment_id = Column(
        String(64), ForeignKey("assignments.id"), primary_key=True, nullable=False
    )

    # FK → schema_versions.id，契约 Draft.schemaVersionId
    schema_version_id = Column(
        String(64), ForeignKey("schema_versions.id"), nullable=False
    )

    # 契约 Draft.answers：AnswerPayload = Record<string, unknown>
    answers_json = Column(JSON, nullable=False)

    # 契约 Draft.clientRevision，前端提交的修订号，用于并发冲突检测
    client_revision = Column(Integer, nullable=False, default=0)

    # 契约 Draft.serverRevision，后端累计保存次数
    server_revision = Column(Integer, nullable=False, default=0)

    # 契约 Draft.validationErrors?: ValidationError[]，自动保存时写入的非阻塞校验结果，可空
    validation_errors_json = Column(JSON, nullable=True)

    # 契约 Draft.savedAt，由应用层在每次 save_draft 时显式写入
    saved_at = Column(DateTime, nullable=False)
