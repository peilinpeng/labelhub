"""迁移任务、不可变产物和可撤销的任务授权；原始提交保持不变。"""
from sqlalchemy import Column, String, DateTime, JSON, Integer, ForeignKey, UniqueConstraint, Index, func
from app.database import Base


class TaskPermissionGrant(Base):
    __tablename__ = "task_permission_grants"
    id = Column(String(64), primary_key=True)
    task_id = Column(String(64), ForeignKey("tasks.id"), nullable=False)
    user_id = Column(String(64), ForeignKey("users.id"), nullable=False)
    action = Column(String(40), nullable=False)
    effect = Column(String(10), nullable=False)
    expires_at = Column(DateTime)
    revoked_at = Column(DateTime)
    created_by = Column(String(64), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    __table_args__ = (Index("ix_grants_task_user", "task_id", "user_id"),)


class MigrationJob(Base):
    __tablename__ = "migration_jobs"
    id = Column(String(64), primary_key=True)
    task_id = Column(String(64), ForeignKey("tasks.id"), nullable=False)
    from_schema_version_id = Column(String(64), ForeignKey("schema_versions.id"), nullable=False)
    to_schema_version_id = Column(String(64), ForeignKey("schema_versions.id"), nullable=False)
    created_by = Column(String(64), ForeignKey("users.id"), nullable=False)
    status = Column(String(24), nullable=False, default="DRAFT")
    request_json = Column(JSON, nullable=False)
    snapshot_json = Column(JSON)
    preview_json = Column(JSON)
    checksum = Column(String(64))
    approved_checksum = Column(String(64))
    approved_by = Column(String(64), ForeignKey("users.id"))
    approved_at = Column(DateTime)
    decision_reason = Column(String(500))
    executed_by = Column(String(64), ForeignKey("users.id"))
    completed_count = Column(Integer, nullable=False, default=0)
    conflict_count = Column(Integer, nullable=False, default=0)
    error = Column(String(255))
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
    __table_args__ = (Index("ix_migration_task_created", "task_id", "created_at"), Index("ix_migration_status", "status"))


class MigrationRecord(Base):
    __tablename__ = "migration_records"
    id = Column(String(64), primary_key=True)
    job_id = Column(String(64), ForeignKey("migration_jobs.id"), nullable=False)
    submission_id = Column(String(64), ForeignKey("submissions.id"), nullable=False)
    from_schema_version_id = Column(String(64), ForeignKey("schema_versions.id"), nullable=False)
    to_schema_version_id = Column(String(64), ForeignKey("schema_versions.id"), nullable=False)
    status = Column(String(16), nullable=False)
    source_hash = Column(String(64), nullable=False)
    result_hash = Column(String(64))
    answers_json = Column(JSON)
    archived_answers_json = Column(JSON)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    __table_args__ = (UniqueConstraint("job_id", "submission_id", name="uq_migration_record_job_submission"),)
