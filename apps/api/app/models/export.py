# export_jobs 表 ORM 模型，对应契约 §21 ExportJob 与 §24 存储契约。
# ⚠️ ID 前缀偏差说明：契约 §3 对 ExportJob 使用 job_ 前缀，
# 但 ai_review_jobs 已占用 job_ 前缀，两类 Job 共享前缀在日志和调试中难以区分，
# 实现层改用 exp_ 前缀以提高可观测性。
# status 合法值（契约 §21 ExportJobStatus）：PENDING / RUNNING / SUCCEEDED / FAILED / CANCELED
# 状态迁移由 app/state_machines/export_sm.py 管控，此文件不包含业务逻辑。
from sqlalchemy import Column, String, Integer, Text, DateTime, JSON, ForeignKey, func

from app.database import Base


class ExportJob(Base):
    __tablename__ = "export_jobs"

    # ID 由应用层生成，前缀 exp_（见顶部偏差说明），不使用数据库自增
    id = Column(String(64), primary_key=True, nullable=False)

    # FK → tasks.id
    task_id = Column(String(64), ForeignKey("tasks.id"), nullable=False)

    # 契约 ExportJob.schemaVersionId，FK → schema_versions.id
    schema_version_id = Column(
        String(64), ForeignKey("schema_versions.id"), nullable=False
    )

    # 契约 ExportJobStatus：PENDING / RUNNING / SUCCEEDED / FAILED / CANCELED
    status = Column(String(20), nullable=False, default="PENDING")

    # 契约 ExportJob.mapping：完整 ExportMapping 结构
    # 含 schemaVersionId / format / answerSource / includeReviewRecords / columns / filters
    mapping_json = Column(JSON, nullable=False)

    # 契约 ExportJob.progress.total，导出任务总条数，独立 Integer 列便于 SQL 查询
    progress_total = Column(Integer, nullable=False, default=0)

    # 契约 ExportJob.progress.done，已完成条数，独立 Integer 列便于 SQL 查询
    progress_done = Column(Integer, nullable=False, default=0)

    # 契约 ExportJob.fileId，导出完成后关联的文件，可空
    # FK → files.id
    file_id = Column(String(64), ForeignKey("files.id"), nullable=True)

    # 契约 ExportJob.errorMessage，失败原因，可能较长使用 Text
    error_message = Column(Text, nullable=True)

    # 契约 ExportJob.createdBy，FK → users.id
    created_by = Column(String(64), ForeignKey("users.id"), nullable=False)

    created_at = Column(DateTime, nullable=False, server_default=func.now())

    # 契约 ExportJob.finishedAt，完成或失败时由应用层显式写入
    finished_at = Column(DateTime, nullable=True)

    # contracts ExportArtifactSummary：passportCount / passportBatchHash / warningCount 等
    # 导出完成时由 worker 写入（Quality Layer）
    artifact_summary_json = Column(JSON, nullable=True)
