# files 表 ORM 模型，对应契约 §22 FileObject 与 §24 存储契约。
# owner_id 采用多态引用设计：根据 owner_type 指向 users / assignments / export_jobs 三张不同的表，
# 因此不加数据库级 ForeignKey 约束，由应用层负责维护引用一致性。
# status 合法值（契约 §22 FileStatus）：PENDING / UPLOADING / READY / FAILED / DELETED
# owner_type 合法值（契约 §22）：USER / ASSIGNMENT / EXPORT_JOB
# purpose 合法值（契约 §22）：DATASET_IMPORT / ANSWER_ATTACHMENT / EXPORT_RESULT
from sqlalchemy import Column, String, BigInteger, DateTime, ForeignKey, func

from app.database import Base


class FileObject(Base):
    __tablename__ = "files"

    # ID 由应用层生成，前缀 file_，不使用数据库自增
    id = Column(String(64), primary_key=True, nullable=False)

    # 契约 FileObject.ownerId，多态引用：不加 FK 约束，由应用层根据 owner_type 维护一致性
    owner_id = Column(String(64), nullable=False)

    # 契约 FileObject.ownerType：USER / ASSIGNMENT / EXPORT_JOB
    owner_type = Column(String(20), nullable=False)

    # 契约 FileObject.purpose：DATASET_IMPORT / ANSWER_ATTACHMENT / EXPORT_RESULT
    purpose = Column(String(30), nullable=False)

    # 契约 FileObject.mimeType
    mime_type = Column(String(255), nullable=False)

    # 契约 FileObject.size（字节数），使用 BigInteger 支持超过 2GB 的大文件
    size = Column(BigInteger, nullable=False)

    # 契约 FileObject.storageKey，对象存储路径可能较长，使用 String(500)
    storage_key = Column(String(500), nullable=False)

    # 契约 FileStatus：PENDING / UPLOADING / READY / FAILED / DELETED
    status = Column(String(20), nullable=False, default="PENDING")

    created_at = Column(DateTime, nullable=False, server_default=func.now())

    # 契约 FileObject.confirmedAt，上传确认时间，由应用层在 confirm_upload 时写入
    confirmed_at = Column(DateTime, nullable=True)

    # 实现补充字段，用于追踪 status 变更时间（如 UPLOADING → READY / FAILED）
    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
