from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field, ConfigDict
from app.schemas.task import AuditLogSummaryResponse
from app.schemas.assignment import AssignmentResponse, ValidationResultResponse


class SubmissionResponse(BaseModel):
    id: str
    assignmentId: str
    taskId: str
    itemId: str
    labelerId: str
    schemaVersionId: str
    attemptNo: int
    answers: dict
    status: str
    validationSnapshot: dict
    createdAt: datetime
    updatedAt: datetime

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_orm(cls, s: Any) -> "SubmissionResponse":
        return cls(
            id=s.id, assignmentId=s.assignment_id, taskId=s.task_id,
            itemId=s.item_id, labelerId=s.labeler_id,
            schemaVersionId=s.schema_version_id, attemptNo=s.attempt_no,
            answers=s.answers_json, status=s.status,
            validationSnapshot=s.validation_json,
            createdAt=s.created_at, updatedAt=s.updated_at,
        )


class SubmitAssignmentRequest(BaseModel):
    answers: dict
    clientRevision: int | None = None


class SubmitAssignmentResponse(BaseModel):
    submission: SubmissionResponse
    assignment: AssignmentResponse
    validation: ValidationResultResponse
    nextStatus: str
    auditLog: AuditLogSummaryResponse
