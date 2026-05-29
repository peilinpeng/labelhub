# dataset_items 表 ORM 模型，对应契约 §6.2 DatasetItem 与 §24 存储契约。
# status 合法值（契约 §6.2 DatasetItemStatus）：AVAILABLE / LOCKED / COMPLETED / DISABLED
# current_assignment_id 为循环外键，使用 use_alter=True 避免建表顺序死锁。
from sqlalchemy import Column, String, DateTime, JSON, ForeignKey, Index, func

from app.database import Base


class DatasetItem(Base):
    __tablename__ = "dataset_items"

    # ID 由应用层生成，前缀 item_，不使用数据库自增
    id = Column(String(64), primary_key=True, nullable=False)

    # FK → tasks.id
    task_id = Column(String(64), ForeignKey("tasks.id"), nullable=False)

    # 数据集导入时的外部唯一标识，契约 DatasetItem.externalKey，可空
    external_key = Column(String(255), nullable=True)

    # 题目原始数据，契约 DatasetItem.sourcePayload：Record<string, unknown>
    source_payload = Column(JSON, nullable=False)

    # 契约 DatasetItemStatus：AVAILABLE / LOCKED / COMPLETED / DISABLED
    status = Column(String(20), nullable=False, default="AVAILABLE")

    # 契约 DatasetItem.currentAssignmentId，循环 FK 使用 use_alter=True
    current_assignment_id = Column(
        String(64),
        ForeignKey(
            "assignments.id",
            use_alter=True,
            name="fk_dataset_items_current_assignment_id",
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

    __table_args__ = (
        Index("ix_dataset_items_task_id", "task_id"),
        Index("ix_dataset_items_external_key", "task_id", "external_key"),
    )
