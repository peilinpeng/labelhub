"""文件上传领域服务：所有权校验、流式写入、内容校验和状态迁移。"""

from __future__ import annotations

import hashlib
import os
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from anyio import to_thread
from sqlalchemy.orm import Session

from app.config import settings
from app.middleware.error_handler import (
    FilePermissionDeniedException,
    InvalidStateTransitionException,
    ResourceNotFoundException,
    ValidationFailedException,
)
from app.models.file import FileObject
from app.schemas.file import ConfirmUploadRequest, CreateUploadUrlRequest
from app.services.audit_domain import write_audit_log
from app.services.file_storage import (
    create_upload_sink,
    local_file_exists,
    remove_local_file,
)

_VALID_PURPOSES = {"DATASET_IMPORT", "ANSWER_ATTACHMENT", "EXPORT_RESULT"}
_VALID_OWNER_TYPES = {"USER", "ASSIGNMENT", "EXPORT_JOB"}
_PURPOSE_OWNER_TYPES = {
    "DATASET_IMPORT": "USER",
    "ANSWER_ATTACHMENT": "ASSIGNMENT",
    "EXPORT_RESULT": "EXPORT_JOB",
}
_EXTENSION_MIME_TYPES = {
    ".csv": {"text/csv", "text/plain"},
    ".json": {"application/json"},
    ".jsonl": {"application/x-ndjson", "application/json", "text/plain"},
    ".txt": {"text/plain"},
    ".pdf": {"application/pdf"},
    ".png": {"image/png"},
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".webp": {"image/webp"},
    ".xlsx": {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    },
    ".xls": {"application/vnd.ms-excel"},
}
_SAMPLE_SIZE = 8192


def _normalize_mime_type(value: str) -> str:
    return value.split(";", 1)[0].strip().lower()


def _check_owner_access(
    db: Session,
    owner_type: str,
    owner_id: str,
    actor: Any,
) -> None:
    if owner_type == "USER":
        from app.models.user import User

        owner = db.get(User, owner_id)
        if owner is None:
            raise ResourceNotFoundException(f"User {owner_id!r} 不存在")
        if actor.role != "ADMIN" and owner.id != actor.id:
            raise FilePermissionDeniedException("不能为其他用户创建文件")
        return

    if owner_type == "ASSIGNMENT":
        from app.models.assignment import Assignment

        assignment = db.get(Assignment, owner_id)
        if assignment is None:
            raise ResourceNotFoundException(f"Assignment {owner_id!r} 不存在")
        if actor.role != "ADMIN" and assignment.labeler_id != actor.id:
            raise FilePermissionDeniedException("不能为不属于自己的标注创建附件")
        return

    if owner_type == "EXPORT_JOB":
        from app.models.export import ExportJob

        export_job = db.get(ExportJob, owner_id)
        if export_job is None:
            raise ResourceNotFoundException(f"ExportJob {owner_id!r} 不存在")
        if actor.role != "ADMIN" and export_job.created_by != actor.id:
            raise FilePermissionDeniedException("不能为他人的导出任务创建文件")
        return

    raise ValidationFailedException(f"不支持的 ownerType: {owner_type!r}")


def _check_file_access(db: Session, file_obj: FileObject, actor: Any) -> None:
    _check_owner_access(db, file_obj.owner_type, file_obj.owner_id, actor)


def _validate_file_metadata(req: CreateUploadUrlRequest, actor: Any) -> str:
    if req.purpose not in _VALID_PURPOSES:
        raise ValidationFailedException(f"不支持的 purpose: {req.purpose!r}")
    if req.ownerType not in _VALID_OWNER_TYPES:
        raise ValidationFailedException(f"不支持的 ownerType: {req.ownerType!r}")
    expected_owner_type = _PURPOSE_OWNER_TYPES[req.purpose]
    if req.ownerType != expected_owner_type:
        raise ValidationFailedException(
            f"{req.purpose} 必须使用 ownerType={expected_owner_type}"
        )
    if req.purpose == "DATASET_IMPORT" and actor.role not in ("OWNER", "ADMIN"):
        raise FilePermissionDeniedException("只有 Owner 可以上传数据集")
    if req.size > settings.MAX_UPLOAD_SIZE_BYTES:
        raise ValidationFailedException(
            f"文件超过最大限制 {settings.MAX_UPLOAD_SIZE_BYTES} 字节"
        )

    safe_name = os.path.basename(req.fileName)
    extension = Path(safe_name).suffix.lower()
    mime_type = _normalize_mime_type(req.mimeType)
    if extension not in settings.allowed_file_extensions:
        raise ValidationFailedException(f"不允许的文件扩展名：{extension or '<空>'}")
    if mime_type not in settings.allowed_file_mime_types:
        raise ValidationFailedException(f"不允许的 MIME 类型：{mime_type}")
    if mime_type not in _EXTENSION_MIME_TYPES.get(extension, set()):
        raise ValidationFailedException(
            f"扩展名 {extension} 与 MIME 类型 {mime_type} 不匹配"
        )
    return safe_name


def create_upload_url(
    db: Session,
    actor: Any,
    req: CreateUploadUrlRequest,
    base_url: str,
) -> tuple[FileObject, str, datetime]:
    safe_name = _validate_file_metadata(req, actor)
    _check_owner_access(db, req.ownerType, req.ownerId, actor)

    file_id = "file_" + uuid4().hex
    storage_key = f"uploads/{req.ownerId}/{file_id}/{safe_name}"
    file_obj = FileObject(
        id=file_id,
        owner_id=req.ownerId,
        owner_type=req.ownerType,
        purpose=req.purpose,
        mime_type=_normalize_mime_type(req.mimeType),
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
            "mimeType": file_obj.mime_type,
            "size": req.size,
        },
    )
    db.commit()
    db.refresh(file_obj)

    upload_url = base_url.rstrip("/") + f"/api/v1/files/{file_id}/upload"
    expires_at = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(
        hours=1
    )
    return file_obj, upload_url, expires_at


def _validate_content_sample(mime_type: str, sample: bytes) -> None:
    if not sample:
        raise ValidationFailedException("上传内容为空")
    if mime_type == "image/png" and not sample.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValidationFailedException("PNG 文件签名无效")
    if mime_type == "image/jpeg" and not sample.startswith(b"\xff\xd8\xff"):
        raise ValidationFailedException("JPEG 文件签名无效")
    if mime_type == "application/pdf" and not sample.startswith(b"%PDF-"):
        raise ValidationFailedException("PDF 文件签名无效")
    if (
        mime_type
        == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        and not sample.startswith(b"PK\x03\x04")
    ):
        raise ValidationFailedException("XLSX 文件签名无效")
    if mime_type == "application/vnd.ms-excel" and not sample.startswith(
        b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
    ):
        raise ValidationFailedException("XLS 文件签名无效")
    if mime_type == "image/webp" and not (
        sample.startswith(b"RIFF") and sample[8:12] == b"WEBP"
    ):
        raise ValidationFailedException("WebP 文件签名无效")
    if mime_type.startswith("text/") or mime_type in {
        "application/json",
        "application/x-ndjson",
    }:
        if b"\x00" in sample:
            raise ValidationFailedException("文本文件包含二进制 NUL 字节")
    if mime_type == "application/json":
        first = sample.lstrip()[:1]
        if first not in (b"{", b"["):
            raise ValidationFailedException("JSON 内容必须以对象或数组开头")


def _mark_upload_failed(
    db: Session,
    file_obj: FileObject,
    actor: Any,
    message: str,
) -> None:
    file_obj.status = "FAILED"
    file_obj.failure_reason = message[:1000]
    file_obj.uploaded_size = None
    file_obj.checksum_sha256 = None
    write_audit_log(
        db,
        entity_type="FILE",
        entity_id=file_obj.id,
        action="FILE_UPLOAD_FAILED",
        actor_id=actor.id,
        after={"status": "FAILED", "reason": file_obj.failure_reason},
    )
    db.commit()


async def receive_upload_stream(
    db: Session,
    file_id: str,
    actor: Any,
    chunks: AsyncIterator[bytes],
    *,
    content_type: str | None,
    content_length: int | None,
) -> FileObject:
    file_obj = (
        db.query(FileObject).filter_by(id=file_id).with_for_update().first()
    )
    if file_obj is None:
        raise ResourceNotFoundException(f"File {file_id!r} 不存在")
    _check_file_access(db, file_obj, actor)
    if file_obj.status != "PENDING":
        raise InvalidStateTransitionException(
            f"File 当前状态 {file_obj.status!r} 不支持上传操作"
        )

    try:
        actual_content_type = _normalize_mime_type(content_type or "")
        if actual_content_type != file_obj.mime_type:
            raise ValidationFailedException(
                f"上传 Content-Type {actual_content_type or '<空>'} "
                f"与声明 {file_obj.mime_type} 不一致"
            )
        if content_length is not None and content_length != file_obj.size:
            raise ValidationFailedException(
                f"Content-Length {content_length} 与声明大小 {file_obj.size} 不一致"
            )

        sink = create_upload_sink(file_obj.storage_key)
        hasher = hashlib.sha256()
        uploaded_size = 0
        sample = bytearray()
        try:
            async for chunk in chunks:
                if not chunk:
                    continue
                uploaded_size += len(chunk)
                if (
                    uploaded_size > file_obj.size
                    or uploaded_size > settings.MAX_UPLOAD_SIZE_BYTES
                ):
                    raise ValidationFailedException("实际上传大小超过声明或配置上限")
                hasher.update(chunk)
                if len(sample) < _SAMPLE_SIZE:
                    sample.extend(chunk[: _SAMPLE_SIZE - len(sample)])
                await to_thread.run_sync(sink.write, chunk)

            if uploaded_size != file_obj.size:
                raise ValidationFailedException(
                    f"实际上传大小 {uploaded_size} 与声明大小 {file_obj.size} 不一致"
                )
            _validate_content_sample(file_obj.mime_type, bytes(sample))
            await to_thread.run_sync(sink.finalize)
        except Exception:
            await to_thread.run_sync(sink.abort)
            raise

        file_obj.status = "UPLOADING"
        file_obj.uploaded_size = uploaded_size
        file_obj.checksum_sha256 = hasher.hexdigest()
        file_obj.failure_reason = None
        write_audit_log(
            db,
            entity_type="FILE",
            entity_id=file_id,
            action="FILE_UPLOADED",
            actor_id=actor.id,
            after={
                "status": "UPLOADING",
                "uploadedSize": uploaded_size,
                "checksumSha256": file_obj.checksum_sha256,
            },
        )
        try:
            db.commit()
        except Exception:
            db.rollback()
            remove_local_file(file_obj.storage_key)
            raise
        db.refresh(file_obj)
        return file_obj
    except Exception as exc:
        remove_local_file(file_obj.storage_key)
        try:
            _mark_upload_failed(db, file_obj, actor, str(exc))
        except Exception:
            db.rollback()
            raise
        if isinstance(exc, ValidationFailedException):
            raise
        raise ValidationFailedException(
            "上传失败，临时文件已清理"
        ) from exc


def confirm_upload(
    db: Session,
    file_id: str,
    actor: Any,
    req: ConfirmUploadRequest,
) -> FileObject:
    file_obj = (
        db.query(FileObject).filter_by(id=file_id).with_for_update().first()
    )
    if file_obj is None:
        raise ResourceNotFoundException(f"File {file_id!r} 不存在")
    _check_file_access(db, file_obj, actor)
    if file_obj.status != "UPLOADING":
        raise InvalidStateTransitionException(
            f"File 当前状态 {file_obj.status!r} 不支持 confirm 操作"
        )
    if file_obj.uploaded_size != file_obj.size:
        raise ValidationFailedException("实际上传大小与声明大小不一致")
    if not file_obj.checksum_sha256:
        raise ValidationFailedException("上传校验和缺失")
    if req.storageKey is not None and req.storageKey != file_obj.storage_key:
        raise ValidationFailedException("storageKey 与文件记录不匹配")
    if req.checksum is not None:
        expected_checksum = req.checksum.lower().removeprefix("sha256:")
        if expected_checksum != file_obj.checksum_sha256:
            raise ValidationFailedException("SHA-256 校验和不匹配")
    if settings.FILE_STORAGE_DRIVER == "local" and not local_file_exists(
        file_obj.storage_key
    ):
        raise ValidationFailedException("上传文件不存在或已被清理")

    file_obj.status = "READY"
    file_obj.confirmed_at = datetime.now(timezone.utc)
    write_audit_log(
        db,
        entity_type="FILE",
        entity_id=file_id,
        action="FILE_CONFIRMED",
        actor_id=actor.id,
        after={
            "status": "READY",
            "storageKey": file_obj.storage_key,
            "uploadedSize": file_obj.uploaded_size,
            "checksumSha256": file_obj.checksum_sha256,
        },
    )
    db.commit()
    db.refresh(file_obj)
    return file_obj


def get_file(db: Session, file_id: str, actor: Any) -> FileObject:
    file_obj = db.query(FileObject).filter_by(id=file_id).first()
    if file_obj is None:
        raise ResourceNotFoundException(f"File {file_id!r} 不存在")
    _check_file_access(db, file_obj, actor)
    return file_obj


def delete_file(db: Session, file_id: str, actor: Any) -> None:
    file_obj = (
        db.query(FileObject).filter_by(id=file_id).with_for_update().first()
    )
    if file_obj is None:
        raise ResourceNotFoundException(f"File {file_id!r} 不存在")
    _check_file_access(db, file_obj, actor)
    if file_obj.status == "DELETED":
        return
    remove_local_file(file_obj.storage_key)
    file_obj.status = "DELETED"
    db.commit()
