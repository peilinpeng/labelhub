import os
from datetime import datetime, timezone, timedelta
from uuid import uuid4
from typing import Any

from sqlalchemy.orm import Session

from app.config import settings
from app.middleware.error_handler import (
    ResourceNotFoundException,
    ValidationFailedException,
    InvalidStateTransitionException,
    FilePermissionDeniedException,
)
from app.models.file import FileObject
from app.services.audit_domain import write_audit_log
from app.schemas.file import CreateUploadUrlRequest, ConfirmUploadRequest


_VALID_PURPOSES = {"DATASET_IMPORT", "ANSWER_ATTACHMENT", "EXPORT_RESULT"}
_VALID_OWNER_TYPES = {"USER", "ASSIGNMENT", "EXPORT_JOB"}


def _check_file_access(db: Session, file_obj: FileObject, actor: Any) -> None:
    if actor.role == "ADMIN":
        return
    if file_obj.owner_type == "USER" and file_obj.owner_id == actor.id:
        return
    if file_obj.owner_type == "ASSIGNMENT":
        from app.models.assignment import Assignment
        asn = db.query(Assignment).filter_by(id=file_obj.owner_id).first()
        if asn and asn.labeler_id == actor.id:
            return
    if file_obj.owner_type == "EXPORT_JOB":
        from app.models.export import ExportJob
        job = db.query(ExportJob).filter_by(id=file_obj.owner_id).first()
        if job and job.created_by == actor.id:
            return
    raise FilePermissionDeniedException("无文件访问权限")


def create_upload_url(
    db: Session,
    actor: Any,
    req: CreateUploadUrlRequest,
    base_url: str,
) -> tuple[FileObject, str, datetime]:
    if req.purpose not in _VALID_PURPOSES:
        raise ValidationFailedException(f"不支持的 purpose: {req.purpose!r}")
    if req.ownerType not in _VALID_OWNER_TYPES:
        raise ValidationFailedException(f"不支持的 ownerType: {req.ownerType!r}")

    file_id = "file_" + uuid4().hex
    safe_name = os.path.basename(req.fileName) or "upload"
    storage_key = f"uploads/{req.ownerId}/{file_id}/{safe_name}"

    full_dir = os.path.join(settings.LOCAL_STORAGE_DIR, "uploads", req.ownerId, file_id)
    os.makedirs(full_dir, exist_ok=True)

    file_obj = FileObject(
        id=file_id,
        owner_id=req.ownerId,
        owner_type=req.ownerType,
        purpose=req.purpose,
        mime_type=req.mimeType,
        size=req.size,
        storage_key=storage_key,
        status="PENDING",
    )
    db.add(file_obj)

    write_audit_log(
        db,
        entity_type="FILE",
        entity_id=file_id,
        action="FILE_UPLOAD_URL_CREATED",
        actor_id=actor.id,
        after={
            "purpose": req.purpose,
            "ownerType": req.ownerType,
            "ownerId": req.ownerId,
            "mimeType": req.mimeType,
            "size": req.size,
        },
    )
    db.commit()
    db.refresh(file_obj)

    upload_url = base_url.rstrip("/") + f"/api/v1/files/{file_id}/upload"
    expires_at = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=1)
    return file_obj, upload_url, expires_at


def confirm_upload(
    db: Session,
    file_id: str,
    actor: Any,
    req: ConfirmUploadRequest,
) -> FileObject:
    file_obj = db.query(FileObject).filter_by(id=file_id).with_for_update().first()
    if not file_obj:
        raise ResourceNotFoundException(f"File {file_id!r} 不存在")

    _check_file_access(db, file_obj, actor)

    if file_obj.status not in ("PENDING", "UPLOADING"):
        raise InvalidStateTransitionException(
            f"File 当前状态 {file_obj.status!r} 不支持 confirm 操作"
        )

    file_obj.status = "READY"
    file_obj.confirmed_at = datetime.now(timezone.utc)

    write_audit_log(
        db,
        entity_type="FILE",
        entity_id=file_id,
        action="FILE_CONFIRMED",
        actor_id=actor.id,
        after={"status": "READY", "storageKey": file_obj.storage_key},
    )
    db.commit()
    db.refresh(file_obj)
    return file_obj


def receive_upload(
    db: Session,
    file_id: str,
    actor: Any,
    content: bytes,
) -> FileObject:
    file_obj = db.query(FileObject).filter_by(id=file_id).with_for_update().first()
    if not file_obj:
        raise ResourceNotFoundException(f"File {file_id!r} 不存在")

    _check_file_access(db, file_obj, actor)

    if file_obj.status not in ("PENDING", "UPLOADING"):
        raise InvalidStateTransitionException(
            f"File 当前状态 {file_obj.status!r} 不支持上传操作"
        )

    file_path = os.path.join(settings.LOCAL_STORAGE_DIR, file_obj.storage_key)
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "wb") as f:
        f.write(content)

    file_obj.status = "UPLOADING"
    db.commit()
    db.refresh(file_obj)
    return file_obj


def get_file(db: Session, file_id: str, actor: Any) -> FileObject:
    file_obj = db.query(FileObject).filter_by(id=file_id).first()
    if not file_obj:
        raise ResourceNotFoundException(f"File {file_id!r} 不存在")
    _check_file_access(db, file_obj, actor)
    return file_obj


def delete_file(db: Session, file_id: str, actor: Any) -> None:
    file_obj = db.query(FileObject).filter_by(id=file_id).with_for_update().first()
    if not file_obj:
        raise ResourceNotFoundException(f"File {file_id!r} 不存在")
    _check_file_access(db, file_obj, actor)
    if file_obj.status == "DELETED":
        return  # 幂等
    file_obj.status = "DELETED"
    db.commit()
