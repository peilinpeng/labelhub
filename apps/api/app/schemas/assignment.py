from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field, ConfigDict
from app.schemas.task import AuditLogSummaryResponse, TaskResponse
from app.schemas.dataset import DatasetItemResponse


class AssignmentResponse(BaseModel):
    id: str
    # assignmentId 与 id 同值，便于把本响应当作「assignment 形状」消费的前端
    # （如 GET /me/submissions 的「我的提交」列表）按任一字段定位 assignment。
    assignmentId: str
    taskId: str
    itemId: str
    labelerId: str
    schemaVersionId: str
    status: str
    lockedUntil: datetime | None
    latestSubmissionId: str | None
    createdAt: datetime
    updatedAt: datetime

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_orm(cls, a: Any) -> "AssignmentResponse":
        return cls(
            id=a.id, assignmentId=a.id, taskId=a.task_id, itemId=a.item_id,
            labelerId=a.labeler_id, schemaVersionId=a.schema_version_id,
            status=a.status, lockedUntil=a.locked_until,
            latestSubmissionId=a.latest_submission_id,
            createdAt=a.created_at, updatedAt=a.updated_at,
        )


class DraftResponse(BaseModel):
    assignmentId: str
    schemaVersionId: str
    answers: dict
    clientRevision: int
    serverRevision: int
    validationErrors: list | None
    savedAt: datetime

    @classmethod
    def from_orm(cls, d: Any) -> "DraftResponse":
        return cls(
            assignmentId=d.assignment_id, schemaVersionId=d.schema_version_id,
            answers=d.answers_json, clientRevision=d.client_revision,
            serverRevision=d.server_revision,
            validationErrors=d.validation_errors_json, savedAt=d.saved_at,
        )


class ValidationResultResponse(BaseModel):
    valid: bool
    errors: list[str]


class AssignmentContextResponse(BaseModel):
    assignment: AssignmentResponse
    task: TaskResponse
    item: DatasetItemResponse
    schemaVersionId: str
    schema: dict
    draft: DraftResponse | None
    lastReturnReason: str | None


class ClaimTaskRequest(BaseModel):
    preferredItemId: str | None = Field(None, description="优先领取的题目 ID，不可用时自动回退")


class ClaimTaskResponse(BaseModel):
    context: AssignmentContextResponse
    auditLog: AuditLogSummaryResponse


class SaveDraftRequest(BaseModel):
    answers: dict
    clientRevision: int = Field(
        ..., description="必须等于当前 draft.serverRevision；首次保存传 0"
    )


class SaveDraftResponse(BaseModel):
    draft: DraftResponse
    assignment: AssignmentResponse
    validation: ValidationResultResponse
    auditLog: AuditLogSummaryResponse


class ListAssignmentsResponse(BaseModel):
    items: list[AssignmentResponse]
    page: int
    pageSize: int
    total: int


class MarketplaceTaskItem(BaseModel):
    id: str
    title: str
    description: str
    status: str
    quota: dict
    distributionStrategy: dict
    reviewPolicy: dict
    deadlineAt: datetime | None
    createdAt: datetime

    @classmethod
    def from_orm(cls, t: Any) -> "MarketplaceTaskItem":
        return cls(
            id=t.id, title=t.title, description=t.description, status=t.status,
            quota=t.quota_json, distributionStrategy=t.distribution_strategy_json,
            reviewPolicy=t.review_policy_json,
            deadlineAt=t.deadline_at, createdAt=t.created_at,
        )


class MarketplaceResponse(BaseModel):
    items: list[MarketplaceTaskItem]
    page: int
    pageSize: int
    total: int


class LLMAssistRequest(BaseModel):
    """契约 LLMRuntimeRequest：标注作答时触发 llm.assist 节点。"""
    nodeId: str
    answers: dict = Field(default_factory=dict)
    assistType: str | None = None  # 可选，前端可指定；缺省由节点/后端兜底


class LLMAssistResponse(BaseModel):
    """契约 LLMRuntimeResponse + Quality Layer 元数据（hash 由后端生成）。"""
    output: Any
    suggestedPatch: dict | None = None
    callId: str
    latencyMs: int
    promptVersionId: str | None = None
    modelId: str
    assistType: str
    promptSnapshotHash: str
    outputHash: str
