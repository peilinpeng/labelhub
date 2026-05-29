# schema_drafts 和 schema_versions 两张表的 ORM 模型，对应契约 §7 动态 Schema 契约与 §24 存储契约。
# schema_versions.schema_json 一旦发布不可修改，由应用层强制执行。
# (task_id, schema_version_no) 在 schema_versions 上唯一，对应契约 §24 存储约束。
from sqlalchemy import (
    Column,
    String,
    Integer,
    DateTime,
    JSON,
    ForeignKey,
    UniqueConstraint,
    func,
)

from app.database import Base


class SchemaDraft(Base):
    __tablename__ = "schema_drafts"

    # ID 由应用层生成，前缀 schema_，不使用数据库自增
    id = Column(String(64), primary_key=True, nullable=False)

    # FK → tasks.id
    task_id = Column(String(64), ForeignKey("tasks.id"), nullable=False)

    # 完整 LabelHubSchema JSON（DRAFT 状态），契约 §7 LabelHubSchema
    schema_json = Column(JSON, nullable=False)

    # 并发控制修订号，每次 save_draft 递增，契约 §4 schemaDraftRevision
    schema_draft_revision = Column(Integer, nullable=False, default=0)

    # 最后修改人，FK → users.id
    updated_by = Column(String(64), ForeignKey("users.id"), nullable=False)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class SchemaVersion(Base):
    __tablename__ = "schema_versions"

    # ID 由应用层生成，前缀 sv_，不使用数据库自增
    id = Column(String(64), primary_key=True, nullable=False)

    # FK → tasks.id
    task_id = Column(String(64), ForeignKey("tasks.id"), nullable=False)

    # 来源草稿，FK → schema_drafts.id
    schema_id = Column(String(64), ForeignKey("schema_drafts.id"), nullable=False)

    # 发布版本号，按 task 维度递增，契约 §4 schemaVersionNo
    schema_version_no = Column(Integer, nullable=False)

    # 契约协议版本，固定值 "1.1"，契约 §4 ContractVersion
    contract_version = Column(String(10), nullable=False)

    # 不可变 PublishedLabelHubSchema 快照，发布后禁止修改，契约 §7 SchemaVersion.snapshot
    schema_json = Column(JSON, nullable=False)

    # 发布时间，由应用层写入（非 server_default）
    published_at = Column(DateTime, nullable=False)

    __table_args__ = (
        # 契约 §24：schema_versions 在 (task_id, schema_version_no) 上必须唯一
        UniqueConstraint(
            "task_id",
            "schema_version_no",
            name="uq_schema_versions_task_version",
        ),
    )
