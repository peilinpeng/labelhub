from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class FileObjectResponse(BaseModel):
    id: str
    ownerId: str
    ownerType: str
    purpose: str
    mimeType: str
    size: int
    storageKey: str
    status: str
    createdAt: datetime
    confirmedAt: datetime | None

    @classmethod
    def from_orm(cls, f) -> "FileObjectResponse":
        return cls(
            id=f.id, ownerId=f.owner_id, ownerType=f.owner_type,
            purpose=f.purpose, mimeType=f.mime_type, size=f.size,
            storageKey=f.storage_key, status=f.status,
            createdAt=f.created_at, confirmedAt=f.confirmed_at,
        )


class CreateUploadUrlRequest(BaseModel):
    fileName: str
    mimeType: str
    size: int
    purpose: str        # DATASET_IMPORT / ANSWER_ATTACHMENT / EXPORT_RESULT
    ownerType: str      # USER / ASSIGNMENT / EXPORT_JOB
    ownerId: str


class CreateUploadUrlResponse(BaseModel):
    file: FileObjectResponse
    uploadUrl: str
    headers: dict | None = None
    expiresAt: datetime


class ConfirmUploadRequest(BaseModel):
    storageKey: str | None = None
    checksum: str | None = None


class ConfirmUploadResponse(BaseModel):
    file: FileObjectResponse
