from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import Actor, require_roles
from app.services import review_domain
from app.schemas.review import (
    ClaimReviewResponse,
    ReviewDecisionRequest,
    ReviewDecisionResponse,
    BatchReviewRequest,
    BatchReviewResponse,
    BatchReviewResultItem,
    ReviewQueueResponse,
    ReviewQueueItem,
    ReviewDetailResponse,
    SubmissionSummary,
    ReviewResultResponse,
    AuditLogSummary,
)

router = APIRouter(tags=["review"])


@router.get(
    "/review/queue",
    response_model=ReviewQueueResponse,
    summary="审核队列：获取待审核/审核中的 Submission 列表",
)
def get_review_queue(
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("REVIEWER", "OWNER", "ADMIN")),
) -> ReviewQueueResponse:
    submissions, total = review_domain.get_review_queue(db, actor, page, pageSize)
    items = []
    for sub in submissions:
        from app.models.task import Task
        from app.models.review import ReviewResult
        task = db.query(Task).filter_by(id=sub.task_id).first()
        ai_result = (
            db.query(ReviewResult)
            .filter_by(submission_id=sub.id, stage="AI_PRECHECK")
            .first()
        )
        items.append(ReviewQueueItem(
            submission=SubmissionSummary.from_orm(sub),
            taskId=sub.task_id,
            taskTitle=task.title if task else "",
            itemId=sub.item_id,
            aiDecision=ai_result.decision if ai_result else None,
        ))
    return ReviewQueueResponse(items=items, total=total, page=page, pageSize=pageSize)


@router.get(
    "/review/submissions/{submission_id}",
    response_model=ReviewDetailResponse,
    summary="审核详情：获取指定 Submission 的完整审核信息",
)
def get_review_detail(
    submission_id: str,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("REVIEWER", "OWNER", "ADMIN")),
) -> ReviewDetailResponse:
    detail = review_domain.get_review_detail(db, submission_id, actor)
    return ReviewDetailResponse(
        submission=SubmissionSummary.from_orm(detail["submission"]),
        taskId=detail["task"].id if detail["task"] else "",
        taskTitle=detail["task"].title if detail["task"] else "",
        itemId=detail["submission"].item_id,
        schemaVersionId=detail["submission"].schema_version_id,
        schemaJson=detail["schema_version"].schema_json if detail["schema_version"] else {},
        aiResult=ReviewResultResponse.from_orm(detail["ai_result"]) if detail["ai_result"] else None,
        history=[ReviewResultResponse.from_orm(r) for r in detail["history"]],
        auditLogs=[AuditLogSummary.from_orm(log) for log in detail["audit_logs"]],
    )


@router.post(
    "/review/submissions/{submission_id}/claim",
    response_model=ClaimReviewResponse,
    summary="领取审核：将 AI_PASSED/NEEDS_HUMAN_REVIEW 的 Submission 迁移为 HUMAN_REVIEWING",
)
def claim_review(
    submission_id: str,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("REVIEWER", "OWNER", "ADMIN")),
) -> ClaimReviewResponse:
    submission, log = review_domain.claim_review(db, submission_id, actor)
    return ClaimReviewResponse(
        submission=SubmissionSummary.from_orm(submission),
        auditLog=AuditLogSummary.from_orm(log),
    )


@router.post(
    "/review/submissions/{submission_id}/decision",
    response_model=ReviewDecisionResponse,
    summary="审核决策：对 HUMAN_REVIEWING 或 FINAL_REVIEWING 提交 PASS/RETURN/REJECT",
)
def submit_review_decision(
    submission_id: str,
    req: ReviewDecisionRequest,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("REVIEWER", "OWNER", "ADMIN")),
) -> ReviewDecisionResponse:
    submission, review_result, log = review_domain.submit_review_decision(
        db, submission_id, actor, req
    )
    return ReviewDecisionResponse(
        submission=SubmissionSummary.from_orm(submission),
        reviewResult=ReviewResultResponse.from_orm(review_result),
        auditLog=AuditLogSummary.from_orm(log),
    )


@router.post(
    "/review/batch-decision",
    response_model=BatchReviewResponse,
    summary="批量审核：逐条处理，单条失败不阻断整体，每条独立写 audit log",
)
def batch_decision(
    req: BatchReviewRequest,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("REVIEWER", "OWNER", "ADMIN")),
) -> BatchReviewResponse:
    raw_results = review_domain.batch_decision(db, actor, req)
    results = []
    for r in raw_results:
        if r["success"]:
            results.append(BatchReviewResultItem(
                submissionId=r["submissionId"],
                success=True,
                submission=SubmissionSummary.from_orm(r["submission"]),
                reviewResult=ReviewResultResponse.from_orm(r["reviewResult"]),
            ))
        else:
            results.append(BatchReviewResultItem(
                submissionId=r["submissionId"],
                success=False,
                error=r["error"],
            ))
    return BatchReviewResponse(results=results)
