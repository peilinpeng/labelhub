from __future__ import annotations
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class TransformSpec(BaseModel):
    type: str  # TEXT / MARKDOWN / JSON_STRINGIFY / DATE / FILE_URLS / IMAGE_PREVIEW
    fallback: str | None = None
    space: int | None = None
    format: str | None = None


class ExportColumn(BaseModel):
    header: str
    sourcePath: str
    transform: TransformSpec | None = None
    defaultValue: Any = None


class ExportFilters(BaseModel):
    submissionStatus: list[str] | None = None
    acceptedOnly: bool | None = None


class ExportMapping(BaseModel):
    schemaVersionId: str
    format: str             # JSON / JSONL / CSV / EXCEL
    answerSource: str       # ORIGINAL_ANSWERS / PATCHED_ANSWERS
    allowPatchedAnswers: bool | None = None
    includeReviewRecords: bool = False
    columns: list[ExportColumn]
    filters: ExportFilters | None = None


class CreateExportJobRequest(BaseModel):
    mapping: ExportMapping


# ---------- Response ----------

class ExportProgressResponse(BaseModel):
    total: int
    done: int


class ExportJobResponse(BaseModel):
    id: str
    taskId: str
    schemaVersionId: str
    status: str
    mapping: dict
    progress: ExportProgressResponse
    fileId: str | None
    errorMessage: str | None
    createdBy: str
    createdAt: datetime
    finishedAt: datetime | None

    @classmethod
    def from_orm(cls, job) -> "ExportJobResponse":
        return cls(
            id=job.id,
            taskId=job.task_id,
            schemaVersionId=job.schema_version_id,
            status=job.status,
            mapping=job.mapping_json,
            progress=ExportProgressResponse(total=job.progress_total, done=job.progress_done),
            fileId=job.file_id,
            errorMessage=job.error_message,
            createdBy=job.created_by,
            createdAt=job.created_at,
            finishedAt=job.finished_at,
        )


class AuditLogSummary(BaseModel):
    id: str
    action: str
    actorId: str
    createdAt: datetime

    @classmethod
    def from_orm(cls, log) -> "AuditLogSummary":
        return cls(id=log.id, action=log.action, actorId=log.actor_id, createdAt=log.created_at)


class CreateExportJobResponse(BaseModel):
    exportJob: ExportJobResponse
    auditLog: AuditLogSummary


class GetExportJobResponse(BaseModel):
    exportJob: ExportJobResponse


class ListExportJobsResponse(BaseModel):
    exportJobs: list[ExportJobResponse]
    total: int
    page: int
    pageSize: int


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


class DownloadExportResponse(BaseModel):
    exportJob: ExportJobResponse
    file: FileObjectResponse
    downloadUrl: str
    expiresAt: datetime
