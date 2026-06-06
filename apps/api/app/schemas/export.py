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


# ---------------------------------------------------------------------------
# Data Quality Passport / Export Records（Quality Layer，镜像 contracts export.ts）
# ---------------------------------------------------------------------------

class DataQualityPassportResponse(BaseModel):
    submissionId: str
    schemaVersionId: str
    finalAnswerHash: str | None = None
    answerHashAlgorithm: str | None = None
    reviewStatus: str
    reviewerPatchCount: int | None = None
    changedFieldNames: list[str] | None = None
    aiAssistUsed: bool | None = None
    aiAssistCallCount: int | None = None
    qualityLedgerRef: dict | None = None


class ExportRecordResponse(BaseModel):
    exportId: str
    submissionId: str
    schemaVersionId: str
    recordIndex: int
    data: dict
    metadata: dict | None = None
    passport: DataQualityPassportResponse | None = None

    @classmethod
    def from_orm(cls, r: Any) -> "ExportRecordResponse":
        return cls(
            exportId=r.export_job_id,
            submissionId=r.submission_id,
            schemaVersionId=r.schema_version_id,
            recordIndex=r.record_index,
            data=r.data_json,
            metadata=r.metadata_json,
            passport=DataQualityPassportResponse(**r.passport_json) if r.passport_json else None,
        )


class ExportArtifactSummaryResponse(BaseModel):
    exportId: str
    taskId: str | None = None
    format: str | None = None
    schemaVersionId: str | None = None
    recordCount: int | None = None
    warningCount: int | None = None
    passportCount: int | None = None
    passportBatchHash: str | None = None


class GetExportRecordsResponse(BaseModel):
    exportId: str
    records: list[ExportRecordResponse]
    artifactSummary: ExportArtifactSummaryResponse | None = None
