from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, field_validator


class ReviewPatch(BaseModel):
    fieldName: str
    previousValue: Any
    nextValue: Any
    reason: str


class ReviewComment(BaseModel):
    fieldName: str | None = None
    message: str
    severity: str | None = None  # "INFO" | "WARNING" | "BLOCKER"


class ReviewDecisionRequest(BaseModel):
    stage: str          # "HUMAN_REVIEW" | "FINAL_REVIEW"
    decision: str       # "PASS" | "RETURN" | "REJECT"
    reason: str | None = None
    comments: list[ReviewComment] = []
    patches: list[ReviewPatch] = []

    @field_validator("stage")
    @classmethod
    def validate_stage(cls, v: str) -> str:
        if v not in ("HUMAN_REVIEW", "FINAL_REVIEW"):
            raise ValueError("stage 必须为 HUMAN_REVIEW 或 FINAL_REVIEW")
        return v

    @field_validator("decision")
    @classmethod
    def validate_decision(cls, v: str) -> str:
        if v not in ("PASS", "RETURN", "REJECT"):
            raise ValueError("decision 必须为 PASS、RETURN 或 REJECT，人工 Reviewer 不允许提交 NEED_HUMAN_REVIEW")
        return v


class BatchReviewItem(BaseModel):
    submissionId: str
    stage: str
    decision: str
    reason: str | None = None
    comments: list[ReviewComment] = []
    patches: list[ReviewPatch] = []


class BatchReviewRequest(BaseModel):
    items: list[BatchReviewItem]


# ---------- Response ----------

class ReviewResultResponse(BaseModel):
    id: str
    submissionId: str
    schemaVersionId: str
    stage: str
    decision: str
    resultJson: dict
    actorId: str
    createdAt: datetime

    @classmethod
    def from_orm(cls, r) -> "ReviewResultResponse":
        return cls(
            id=r.id,
            submissionId=r.submission_id,
            schemaVersionId=r.schema_version_id,
            stage=r.stage,
            decision=r.decision,
            resultJson=r.result_json,
            actorId=r.actor_id,
            createdAt=r.created_at,
        )


class SubmissionSummary(BaseModel):
    id: str
    assignmentId: str
    taskId: str
    itemId: str
    labelerId: str
    schemaVersionId: str
    attemptNo: int
    status: str
    createdAt: datetime
    updatedAt: datetime

    @classmethod
    def from_orm(cls, s) -> "SubmissionSummary":
        return cls(
            id=s.id,
            assignmentId=s.assignment_id,
            taskId=s.task_id,
            itemId=s.item_id,
            labelerId=s.labeler_id,
            schemaVersionId=s.schema_version_id,
            attemptNo=s.attempt_no,
            status=s.status,
            createdAt=s.created_at,
            updatedAt=s.updated_at,
        )


class AuditLogSummary(BaseModel):
    id: str
    action: str
    actorId: str
    createdAt: datetime

    @classmethod
    def from_orm(cls, log) -> "AuditLogSummary":
        return cls(
            id=log.id,
            action=log.action,
            actorId=log.actor_id,
            createdAt=log.created_at,
        )


class ClaimReviewResponse(BaseModel):
    submission: SubmissionSummary
    auditLog: AuditLogSummary


class ReviewDecisionResponse(BaseModel):
    submission: SubmissionSummary
    reviewResult: ReviewResultResponse
    auditLog: AuditLogSummary


class BatchReviewResultItem(BaseModel):
    submissionId: str
    success: bool
    submission: SubmissionSummary | None = None
    reviewResult: ReviewResultResponse | None = None
    error: dict | None = None  # {"code": ..., "message": ...}


class BatchReviewResponse(BaseModel):
    results: list[BatchReviewResultItem]


class ReviewQueueItem(BaseModel):
    submission: SubmissionSummary
    taskId: str
    taskTitle: str
    itemId: str
    aiDecision: str | None = None


class ReviewQueueResponse(BaseModel):
    items: list[ReviewQueueItem]
    total: int
    page: int
    pageSize: int


class ReviewDetailResponse(BaseModel):
    submission: SubmissionSummary
    taskId: str
    taskTitle: str
    itemId: str
    schemaVersionId: str
    schemaJson: dict
    aiResult: ReviewResultResponse | None = None
    history: list[ReviewResultResponse]
    auditLogs: list[AuditLogSummary]


# ---------------------------------------------------------------------------
# ReviewConfig Schemas（追加，不修改上方现有 schema）
# ---------------------------------------------------------------------------

class ReviewConfigResponse(BaseModel):
    id: str
    taskId: str
    enabled: bool
    modelPolicyId: str
    promptTemplate: str
    dimensions: list
    thresholds: dict
    conclusionMapping: dict
    maxRetries: int
    createdAt: datetime
    updatedAt: datetime

    @classmethod
    def from_orm(cls, config) -> "ReviewConfigResponse":
        return cls(
            id=config.id,
            taskId=config.task_id,
            enabled=config.enabled,
            modelPolicyId=config.model_policy_id,
            promptTemplate=config.prompt_template,
            dimensions=config.dimensions_json,
            thresholds=config.thresholds_json,
            conclusionMapping=config.conclusion_mapping_json,
            maxRetries=config.max_retries,
            createdAt=config.created_at,
            updatedAt=config.updated_at,
        )


class CreateReviewConfigResponse(BaseModel):
    reviewConfig: ReviewConfigResponse


class GetReviewConfigResponse(BaseModel):
    reviewConfig: ReviewConfigResponse


class UpdateReviewConfigResponse(BaseModel):
    reviewConfig: ReviewConfigResponse
