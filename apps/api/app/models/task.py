# tasks 表 ORM 模型，对应契约 §6.1 Task 领域模型与 §24 存储契约。
# status 合法值（契约 §6.1 TaskStatus）：DRAFT / PUBLISHED / PAUSED / ENDED / ARCHIVED
# 状态迁移由 app/state_machines/task_sm.py 管控，此文件不包含任何业务逻辑。
from sqlalchemy import Column, String, Text, DateTime, JSON, ForeignKey, func
from sqlalchemy.orm import relationship

from app.database import Base


class Task(Base):
    __tablename__ = "tasks"

    # ID 由应用层生成，前缀 task_，不使用数据库自增
    id = Column(String(64), primary_key=True, nullable=False)

    # 契约 Task.title
    title = Column(String(255), nullable=False)

    # 契约 Task.description
    description = Column(Text, nullable=False, default="")

    # 契约 Task.instructionRichText（RichTextDocument JSON AST），可空
    instruction_rich_text_json = Column(JSON, nullable=True)

    # 契约 Task.tags（string[]）
    tags_json = Column(JSON, nullable=False, default=list)

    # 契约 Task.rewardRule，可空
    reward_rule_json = Column(JSON, nullable=True)

    # 契约 Task.quota {total, perLabeler?}
    quota_json = Column(JSON, nullable=False)

    # 契约 Task.deadlineAt，可空
    deadline_at = Column(DateTime, nullable=True)

    # 契约 Task.distributionStrategy（discriminated union JSON）
    distribution_strategy_json = Column(JSON, nullable=False)

    # 契约 Task.reviewPolicy（SINGLE_REVIEW / DOUBLE_REVIEW JSON）
    review_policy_json = Column(JSON, nullable=False)

    # 契约 TaskStatus：DRAFT / PUBLISHED / PAUSED / ENDED / ARCHIVED
    status = Column(String(20), nullable=False, default="DRAFT")

    # 契约 Task.activeSchemaVersionId，任务未发布时为 NULL
    active_schema_version_id = Column(
        String(64),
        ForeignKey("schema_versions.id"),
        nullable=True,
    )

    # 任务创建者，FK → users.id
    owner_id = Column(String(64), ForeignKey("users.id"), nullable=False)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # 关联关系，通过 foreign_keys 明确指定（owner_id 为唯一 FK）
    owner = relationship("User", foreign_keys=[owner_id])
