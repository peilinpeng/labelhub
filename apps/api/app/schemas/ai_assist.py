"""AI Assist 动作 Schema，镜像 contracts ai-assist.ts。"""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

AiAssistActionType = Literal["accept", "edit_accept", "dismiss"]
AiAssistSuggestionStatus = Literal[
    "PENDING", "ACCEPTED", "EDIT_ACCEPTED", "DISMISSED", "APPLY_FAILED"
]
AiAssistSeverity = Literal["LOW", "MEDIUM", "HIGH"]


class AiAssistPatchOperation(BaseModel):
    fieldName: str
    previousValue: Any | None = None
    nextValue: Any | None = None


class AiAssistSuggestionModel(BaseModel):
    id: str
    submissionId: str
    taskId: str | None = None
    itemId: str | None = None
    schemaVersionId: str | None = None
    nodeId: str | None = None
    fieldName: str | None = None
    assistType: str | None = None
    severity: AiAssistSeverity
    confidence: float | None = None
    summary: str
    structuredPatch: list[AiAssistPatchOperation] = Field(default_factory=list)
    status: AiAssistSuggestionStatus
    createdAt: datetime
    resolvedAt: datetime | None = None


class AiAssistActionRecordModel(BaseModel):
    id: str
    suggestionId: str
    submissionId: str
    action: AiAssistActionType
    resultingStatus: AiAssistSuggestionStatus
    appliedPatchFieldNames: list[str] | None = None
    patchApplied: bool | None = None
    patchFailureReason: str | None = None
    comment: str | None = None
    actor: dict
    createdAt: datetime

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_orm(cls, a: Any) -> "AiAssistActionRecordModel":
        return cls(
            id=a.id,
            suggestionId=a.suggestion_id,
            submissionId=a.submission_id,
            action=a.action,
            resultingStatus=a.resulting_status,
            appliedPatchFieldNames=a.applied_patch_field_names_json,
            patchApplied=a.patch_applied,
            patchFailureReason=a.patch_failure_reason,
            comment=a.comment,
            actor=a.actor_json,
            createdAt=a.created_at,
        )


class AiAssistActionRequest(BaseModel):
    action: AiAssistActionType
    editedPatch: list[AiAssistPatchOperation] | None = None
    comment: str | None = None


class AiAssistActionResponse(BaseModel):
    suggestion: AiAssistSuggestionModel
    action: AiAssistActionRecordModel
    auditEventType: str


class ListAiAssistSuggestionsResponse(BaseModel):
    suggestions: list[AiAssistSuggestionModel] = Field(default_factory=list)
