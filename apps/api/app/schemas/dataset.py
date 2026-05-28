from datetime import datetime
from typing import Literal, Any
from pydantic import BaseModel, Field, ConfigDict
from app.schemas.task import AuditLogSummaryResponse


class DatasetItemResponse(BaseModel):
    id: str
    taskId: str
    externalKey: str | None
    sourcePayload: dict
    status: str  # AVAILABLE / LOCKED / COMPLETED / DISABLED
    currentAssignmentId: str | None
    createdAt: datetime
    updatedAt: datetime

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_orm(cls, item: Any) -> "DatasetItemResponse":
        return cls(
            id=item.id, taskId=item.task_id, externalKey=item.external_key,
            sourcePayload=item.source_payload, status=item.status,
            currentAssignmentId=item.current_assignment_id,
            createdAt=item.created_at, updatedAt=item.updated_at,
        )


class ImportDatasetRequest(BaseModel):
    fileId: str
    format: Literal["JSON", "JSONL", "EXCEL"]
    externalKeyPath: str | None = Field(None, description="点分路径，如 'id' 或 'meta.id'")


class ImportError(BaseModel):
    row: int | None = None
    message: str


class ImportDatasetResponse(BaseModel):
    taskId: str
    importedCount: int
    skippedCount: int
    failedCount: int
    previewItems: list[DatasetItemResponse]
    errors: list[ImportError] | None = None
    auditLog: AuditLogSummaryResponse


class ListItemsResponse(BaseModel):
    items: list[DatasetItemResponse]
    page: int
    pageSize: int
    total: int


class UpdateDatasetItemRequest(BaseModel):
    sourcePayload: dict | None = None
    status: Literal["AVAILABLE", "DISABLED"] | None = Field(
        None, description="仅允许手动设置 AVAILABLE/DISABLED；LOCKED/COMPLETED 由分配系统管理"
    )
