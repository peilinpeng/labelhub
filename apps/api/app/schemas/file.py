from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class FileObjectResponse(BaseModel):
    id: str
    ownerId: str
    ownerType: str
    purpose: str
    mimeType: str
    size: int
    uploadedSize: int | None
    checksumSha256: str | None
    storageKey: str
    status: str
    createdAt: datetime
    confirmedAt: datetime | None

    @classmethod
    def from_orm(cls, f) -> "FileObjectResponse":
        return cls(
            id=f.id, ownerId=f.owner_id, ownerType=f.owner_type,
            purpose=f.purpose, mimeType=f.mime_type, size=f.size,
            uploadedSize=f.uploaded_size,
            checksumSha256=f.checksum_sha256,
            storageKey=f.storage_key, status=f.status,
            createdAt=f.created_at, confirmedAt=f.confirmed_at,
        )


class CreateUploadUrlRequest(BaseModel):
    fileName: str = Field(min_length=1, max_length=255)
    mimeType: str = Field(min_length=1, max_length=255)
    size: int = Field(gt=0)
    purpose: str        # DATASET_IMPORT / ANSWER_ATTACHMENT / EXPORT_RESULT
    ownerType: str      # USER / ASSIGNMENT / EXPORT_JOB
    ownerId: str


class CreateUploadUrlResponse(BaseModel):
    file: FileObjectResponse
    uploadUrl: str
    headers: dict | None = None
    expiresAt: datetime


class ConfirmUploadRequest(BaseModel):
    storageKey: str | None = Field(default=None, max_length=500)
    checksum: str | None = Field(default=None, max_length=80)


class ConfirmUploadResponse(BaseModel):
    file: FileObjectResponse
