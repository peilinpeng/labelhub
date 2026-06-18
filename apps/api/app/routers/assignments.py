from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.schema import SchemaVersion
from app.middleware.auth import Actor, require_roles
from app.services import assignment_domain, submission_domain
from app.schemas.task import AuditLogSummaryResponse, TaskResponse
from app.schemas.dataset import DatasetItemResponse
from app.schemas.assignment import (
    ClaimTaskRequest, ClaimTaskResponse, AssignmentContextResponse,
    AssignmentResponse, DraftResponse, SaveDraftRequest, SaveDraftResponse,
    ValidationResultResponse, ListAssignmentsResponse,
)
from app.schemas.submission import (
    SubmitAssignmentRequest, SubmitAssignmentResponse, SubmissionResponse,
)

router = APIRouter(tags=["assignments"])


@router.post(
    "/tasks/{task_id}/claim",
    response_model=ClaimTaskResponse,
    status_code=201,
    summary="领取题目（Labeler）",
)
def claim_item(
    task_id: str,
    body: ClaimTaskRequest,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("LABELER")),
) -> ClaimTaskResponse:
    assignment, log = assignment_domain.claim_item(db, task_id, actor, body)
    ctx = assignment_domain.get_assignment_context(db, assignment.id, actor)
    return ClaimTaskResponse(
        context=AssignmentContextResponse(
            assignment=AssignmentResponse.from_orm(ctx["assignment"]),
            task=TaskResponse.from_orm(ctx["task"]),
            item=DatasetItemResponse.from_orm(ctx["item"]),
            schemaVersionId=ctx["schema_version_id"],
            schema=ctx["schema_json"],
            draft=None,
            lastReturnReason=None,
        ),
        auditLog=AuditLogSummaryResponse.from_orm_obj(log),
    )


@router.get(
    "/assignments/{assignment_id}",
    response_model=AssignmentContextResponse,
    summary="获取作答上下文（Assignment + Task + Item + Schema + Draft）",
)
def get_assignment(
    assignment_id: str,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("LABELER", "OWNER", "REVIEWER")),
) -> AssignmentContextResponse:
    ctx = assignment_domain.get_assignment_context(db, assignment_id, actor)
    return AssignmentContextResponse(
        assignment=AssignmentResponse.from_orm(ctx["assignment"]),
        task=TaskResponse.from_orm(ctx["task"]),
        item=DatasetItemResponse.from_orm(ctx["item"]),
        schemaVersionId=ctx["schema_version_id"],
        schema=ctx["schema_json"],
        draft=DraftResponse.from_orm(ctx["draft"]) if ctx["draft"] else None,
        lastReturnReason=ctx["last_return_reason"],
    )


@router.put(
    "/assignments/{assignment_id}/draft",
    response_model=SaveDraftResponse,
    summary="保存草稿",
)
def save_draft(
    assignment_id: str,
    body: SaveDraftRequest,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("LABELER")),
) -> SaveDraftResponse:
    """clientRevision 必须等于当前 serverRevision，不一致返回 409 REVISION_CONFLICT。"""
    draft, assignment, log = assignment_domain.save_draft(db, assignment_id, actor, body)
    schema_version = db.query(SchemaVersion).filter_by(id=assignment.schema_version_id).first()
    validation = assignment_domain._validate_answers(schema_version.schema_json, draft.answers_json)
    return SaveDraftResponse(
        draft=DraftResponse.from_orm(draft),
        assignment=AssignmentResponse.from_orm(assignment),
        validation=ValidationResultResponse(**validation),
        auditLog=AuditLogSummaryResponse.from_orm_obj(log),
    )


@router.post(
    "/assignments/{assignment_id}/submit",
    response_model=SubmitAssignmentResponse,
    status_code=201,
    summary="提交答案",
)
def submit_assignment(
    assignment_id: str,
    body: SubmitAssignmentRequest,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("LABELER")),
) -> SubmitAssignmentResponse:
    """答案存为不可变快照；自动触发 AI 审核入队（契约 §18.2 submitAssignment）。"""
    submission, assignment, log = submission_domain.submit_assignment(db, assignment_id, actor, body)
    return SubmitAssignmentResponse(
        submission=SubmissionResponse.from_orm(submission),
        assignment=AssignmentResponse.from_orm(assignment),
        validation=ValidationResultResponse(**submission.validation_json),
        nextStatus=submission.status,
        auditLog=AuditLogSummaryResponse.from_orm_obj(log),
    )


@router.get(
    "/me/submissions",
    response_model=ListAssignmentsResponse,
    summary="我的作答记录（分页）",
)
def get_my_assignments(
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("LABELER")),
) -> ListAssignmentsResponse:
    result = submission_domain.get_my_assignments(db, actor, page, pageSize)
    return ListAssignmentsResponse(
        items=[AssignmentResponse.from_orm(a) for a in result["items"]],
        page=result["page"],
        pageSize=result["page_size"],
        total=result["total"],
    )
