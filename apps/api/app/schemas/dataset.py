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


class AssignmentItemsResponse(BaseModel):
    """Labeler 作答工作台左侧题目导航：返回该任务全部题目 + 当前题目下标。"""
    items: list[DatasetItemResponse]
    total: int
    currentIndex: int  # 当前 assignment 绑定 item 在列表中的下标；找不到为 -1


class UpdateDatasetItemRequest(BaseModel):
    sourcePayload: dict | None = None
    status: Literal["AVAILABLE", "DISABLED"] | None = Field(
        None, description="仅允许手动设置 AVAILABLE/DISABLED；LOCKED/COMPLETED 由分配系统管理"
    )


class BatchUpdateItemsRequest(BaseModel):
    """批量编辑题目（§4.1 数据集管理·批量编辑）：对选中题目应用同一 patch。"""
    itemIds: list[str] = Field(..., min_length=1, description="待批量更新的题目 ID 列表")
    status: Literal["AVAILABLE", "DISABLED"] | None = Field(
        None, description="批量设置状态；仅允许 AVAILABLE/DISABLED"
    )
    sourcePayload: dict | None = Field(None, description="批量覆盖 sourcePayload（按需）")


class BatchUpdateItemsResponse(BaseModel):
    updatedCount: int
    items: list[DatasetItemResponse]
