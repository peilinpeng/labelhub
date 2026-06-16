"""
export_records 表 ORM 模型，对应 contracts `ExportRecord`（含 DataQualityPassport）。

每条导出记录对应一条 submission：data_json 为导出行，passport_json 为该条的数据质量护照。
由 export_worker 在导出完成时批量写入；GET /exports/{id}/records 读取。
追加只写，无 updated_at。
"""
from sqlalchemy import Column, String, Integer, DateTime, JSON, ForeignKey, func

from app.database import Base


class ExportRecord(Base):
    __tablename__ = "export_records"

    id = Column(String(64), primary_key=True, nullable=False)
    export_job_id = Column(String(64), ForeignKey("export_jobs.id"), nullable=False)
    submission_id = Column(String(64), ForeignKey("submissions.id"), nullable=False)
    schema_version_id = Column(String(64), nullable=False)
    record_index = Column(Integer, nullable=False)
    data_json = Column(JSON, nullable=False)          # 导出行内容
    metadata_json = Column(JSON, nullable=True)       # contracts ExportRecordMetadata
    passport_json = Column(JSON, nullable=True)       # contracts DataQualityPassport
    created_at = Column(DateTime, nullable=False, server_default=func.now())
