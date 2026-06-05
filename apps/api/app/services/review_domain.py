import hashlib
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.middleware.error_handler import (
    ResourceNotFoundException,
    ValidationFailedException,
    InvalidStateTransitionException,
    ReviewReasonRequiredException,
)
from app.models.review import AIReviewJob, ReviewConfig, ReviewResult
from app.models.submission import Submission
from app.models.assignment import Assignment
from app.models.audit import AuditLog
from app.services.audit_domain import write_audit_log
from app.state_machines.submission_sm import apply_transition as sub_apply_transition
from app.state_machines.assignment_sm import apply_transition as asn_apply_transition


class ReviewDimensionInput(BaseModel):
    key: str
    label: str
    description: str
    weight: float = Field(..., ge=0, le=1)
    scoreRange: list[float] = Field(..., min_length=2, max_length=2)


class ThresholdsInput(BaseModel):
    passScore: float
    returnScore: float


class ConclusionMappingInput(BaseModel):
    passWhen: str = ""
    returnWhen: str = ""
    humanReviewOtherwise: bool = True


class CreateReviewConfigRequest(BaseModel):
    enabled: bool = True
    modelPolicyId: str
    promptTemplate: str
    dimensions: list[ReviewDimensionInput]
    thresholds: ThresholdsInput
    conclusionMapping: ConclusionMappingInput
    maxRetries: int = Field(3, ge=1, le=10)


class UpdateReviewConfigRequest(BaseModel):
    enabled: bool | None = None
    modelPolicyId: str | None = None
    promptTemplate: str | None = None
    dimensions: list[ReviewDimensionInput] | None = None
    thresholds: ThresholdsInput | None = None
    conclusionMapping: ConclusionMappingInput | None = None
    maxRetries: int | None = Field(None, ge=1, le=10)


def create_review_config(db: Session, task_id: str, actor: Any, req: CreateReviewConfigRequest) -> ReviewConfig:
    from app.models.task import Task
    task = db.query(Task).filter_by(id=task_id).first()
    if not task:
        raise ResourceNotFoundException(f"Task {task_id!r} 不存在")

    existing = db.query(ReviewConfig).filter_by(task_id=task_id).first()
    if existing:
        raise ValidationFailedException("该任务已有 ReviewConfig，请使用 update 接口")

    config = ReviewConfig(
        id="cfg_" + uuid4().hex,
        task_id=task_id,
        enabled=req.enabled,
        model_policy_id=req.modelPolicyId,
        prompt_template=req.promptTemplate,
        dimensions_json=[d.model_dump() for d in req.dimensions],
        thresholds_json=req.thresholds.model_dump(),
        conclusion_mapping_json=req.conclusionMapping.model_dump(),
        max_retries=req.maxRetries,
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


def get_review_config(db: Session, task_id: str, actor: Any) -> ReviewConfig:
    config = db.query(ReviewConfig).filter_by(task_id=task_id).first()
    if not config:
        raise ResourceNotFoundException(f"任务 {task_id!r} 尚未配置 ReviewConfig")
    return config


def update_review_config(db: Session, task_id: str, actor: Any, req: UpdateReviewConfigRequest) -> ReviewConfig:
    config = get_review_config(db, task_id, actor)

    if req.enabled is not None:
        config.enabled = req.enabled
    if req.modelPolicyId:
        config.model_policy_id = req.modelPolicyId
    if req.promptTemplate:
        config.prompt_template = req.promptTemplate
    if req.dimensions:
        config.dimensions_json = [d.model_dump() for d in req.dimensions]
    if req.thresholds:
        config.thresholds_json = req.thresholds.model_dump()
    if req.conclusionMapping:
        config.conclusion_mapping_json = req.conclusionMapping.model_dump()
    if req.maxRetries:
        config.max_retries = req.maxRetries

    db.commit()
    db.refresh(config)
    return config


def create_ai_review_job(db: Session, submission: Any, review_config: ReviewConfig) -> AIReviewJob:
    idempotency_key = f"{submission.id}:{submission.attempt_no}"
    existing_job = db.query(AIReviewJob).filter_by(idempotency_key=idempotency_key).first()
    if existing_job:
        return existing_job

    prompt_hash = hashlib.sha256(review_config.prompt_template.encode()).hexdigest()
    model_snapshot = {
        "provider": "doubao",
        "model": settings.DOUBAO_MODEL,
        "temperature": None,
        "responseFormat": "FUNCTION_CALLING",
    }

    job = AIReviewJob(
        id="job_" + uuid4().hex,
        submission_id=submission.id,
        attempt_no=submission.attempt_no,
        schema_version_id=submission.schema_version_id,
        status="PENDING",
        retry_count=0,
        max_retries=review_config.max_retries,
        idempotency_key=idempotency_key,
        prompt_snapshot_hash=prompt_hash,
        model_snapshot_json=model_snapshot,
    )
    db.add(job)
    return job


# ---------------------------------------------------------------------------
# 人工审核函数
# ---------------------------------------------------------------------------

def claim_review(db: Session, submission_id: str, actor: Any) -> tuple[Submission, AuditLog]:
    submission = db.query(Submission).filter_by(id=submission_id).with_for_update().first()
    if not submission:
        raise ResourceNotFoundException(f"Submission {submission_id!r} 不存在")

    new_status = sub_apply_transition(submission.status, "claimReview")
    submission.status = new_status

    log = write_audit_log(
        db,
        entity_type="SUBMISSION",
        entity_id=submission.id,
        action="REVIEW_CLAIMED",
        actor_id=actor.id,
        after={"reviewerId": actor.id},
    )

    db.commit()
    db.refresh(submission)
    return submission, log


def submit_review_decision(
    db: Session,
    submission_id: str,
    actor: Any,
    req: Any,
) -> tuple[Submission, ReviewResult, AuditLog]:
    if req.decision in ("RETURN", "REJECT") and not req.reason:
        raise ReviewReasonRequiredException(f"{req.decision} 操作必须填写 reason")

    submission = db.query(Submission).filter_by(id=submission_id).with_for_update().first()
    if not submission:
        raise ResourceNotFoundException(f"Submission {submission_id!r} 不存在")

    assignment = db.query(Assignment).filter_by(id=submission.assignment_id).first()
    if not assignment:
        raise ResourceNotFoundException(f"Assignment {submission.assignment_id!r} 不存在")

    from app.models.task import Task
    from app.models.dataset import DatasetItem

    task = db.query(Task).filter_by(id=submission.task_id).first()
    item = db.query(DatasetItem).filter_by(id=submission.item_id).with_for_update().first()

    # 根据 stage + decision 确定状态机命令和目标状态
    if req.stage == "HUMAN_REVIEW":
        if req.decision == "PASS":
            review_policy = task.review_policy_json or {} if task else {}
            if review_policy.get("type") == "DOUBLE_REVIEW":
                sub_command = "humanReviewPassDouble"
                asn_command = None
                item_new_status = None
                audit_action = "FINAL_REVIEW_REQUESTED"
            else:
                sub_command = "humanReviewPassSingle"
                asn_command = "humanReviewPass"
                item_new_status = "COMPLETED"
                audit_action = "REVIEW_ACCEPTED"
        elif req.decision == "RETURN":
            sub_command = "humanReviewReturn"
            asn_command = "humanReviewReturn"
            item_new_status = None
            audit_action = "REVIEW_RETURNED"
        else:  # REJECT
            sub_command = "humanReviewReject"
            asn_command = "humanReviewReject"
            item_new_status = "AVAILABLE"
            audit_action = "REVIEW_REJECTED"
    else:  # FINAL_REVIEW
        if req.decision == "PASS":
            sub_command = "finalReviewPass"
            asn_command = "finalReviewPass"
            item_new_status = "COMPLETED"
            audit_action = "REVIEW_ACCEPTED"
        elif req.decision == "RETURN":
            sub_command = "finalReviewReturn"
            asn_command = "finalReviewReturn"
            item_new_status = None
            audit_action = "REVIEW_RETURNED"
        else:  # REJECT
            sub_command = "finalReviewReject"
            asn_command = "finalReviewReject"
            item_new_status = "AVAILABLE"
            audit_action = "REVIEW_REJECTED"

    new_sub_status = sub_apply_transition(submission.status, sub_command)
    submission.status = new_sub_status

    if asn_command:
        new_asn_status = asn_apply_transition(assignment.status, asn_command)
        assignment.status = new_asn_status

    if item is not None:
        if item_new_status == "COMPLETED":
            item.status = "COMPLETED"
        elif item_new_status == "AVAILABLE":
            item.status = "AVAILABLE"
            item.current_assignment_id = None

    result_json_payload = {
        "decision": req.decision,
        "reason": req.reason,
        "patches": [p.model_dump() for p in req.patches],
        "comments": [c.model_dump() for c in req.comments],
    }
    review_result = ReviewResult(
        id="rev_" + uuid4().hex,
        submission_id=submission.id,
        schema_version_id=submission.schema_version_id,
        stage=req.stage,
        decision=req.decision,
        result_json=result_json_payload,
        actor_id=actor.id,
    )
    db.add(review_result)

    log = write_audit_log(
        db,
        entity_type="SUBMISSION",
        entity_id=submission.id,
        action=audit_action,
        actor_id=actor.id,
        reason=req.reason,
        after={
            "decision": req.decision,
            "stage": req.stage,
            "nextStatus": new_sub_status,
            "reviewResultId": review_result.id,
            "patchCount": len(req.patches),
        },
    )

    db.commit()
    db.refresh(submission)
    db.refresh(review_result)
    return submission, review_result, log


def batch_decision(db: Session, actor: Any, req: Any) -> list[dict]:
    results = []
    for item in req.items:
        try:
            from app.schemas.review import ReviewDecisionRequest
            single_req = ReviewDecisionRequest(
                stage=item.stage,
                decision=item.decision,
                reason=item.reason,
                comments=item.comments,
                patches=item.patches,
            )
            submission, review_result, log = submit_review_decision(
                db, item.submissionId, actor, single_req
            )
            results.append({
                "submissionId": item.submissionId,
                "success": True,
                "submission": submission,
                "reviewResult": review_result,
            })
        except Exception as e:
            results.append({
                "submissionId": item.submissionId,
                "success": False,
                "error": {
                    "code": getattr(e, "code", "UNKNOWN"),
                    "message": str(e),
                },
            })
    return results


# 审核队列默认展示的待处理状态（无 status 过滤时）
_REVIEW_QUEUE_DEFAULT_STATUSES = ["AI_PASSED", "NEEDS_HUMAN_REVIEW", "HUMAN_REVIEWING", "FINAL_REVIEWING"]
# 允许前端 Tab 精确筛选的全部 Submission 状态（含已通过/已打回历史）
_REVIEW_QUEUE_FILTERABLE_STATUSES = _REVIEW_QUEUE_DEFAULT_STATUSES + ["ACCEPTED", "RETURNED", "REJECTED"]


def get_review_queue(
    db: Session, actor: Any, page: int, page_size: int, status: str | None = None
) -> tuple[list, int]:
    if status:
        # 前端 Tab 精确筛选：支持 AI 通过 / 需人工 / 已通过 / 已打回 等
        if status not in _REVIEW_QUEUE_FILTERABLE_STATUSES:
            raise ValidationFailedException(
                f"status 取值非法：{status!r}，仅支持 {_REVIEW_QUEUE_FILTERABLE_STATUSES}"
            )
        query = db.query(Submission).filter(Submission.status == status)
    else:
        query = db.query(Submission).filter(
            Submission.status.in_(_REVIEW_QUEUE_DEFAULT_STATUSES)
        )
    total = query.count()
    offset = (page - 1) * page_size
    submissions = (
        query.order_by(Submission.created_at.asc())
        .offset(offset)
        .limit(page_size)
        .all()
    )
    return submissions, total


def get_review_detail(db: Session, submission_id: str, actor: Any) -> dict:
    submission = db.query(Submission).filter_by(id=submission_id).first()
    if not submission:
        raise ResourceNotFoundException(f"Submission {submission_id!r} 不存在")

    from app.models.task import Task
    from app.models.schema import SchemaVersion

    task = db.query(Task).filter_by(id=submission.task_id).first()
    schema_version = db.query(SchemaVersion).filter_by(id=submission.schema_version_id).first()
    all_results = (
        db.query(ReviewResult)
        .filter_by(submission_id=submission.id)
        .order_by(ReviewResult.created_at.asc())
        .all()
    )
    ai_result = next((r for r in all_results if r.stage == "AI_PRECHECK"), None)
    history = [r for r in all_results if r.stage != "AI_PRECHECK"]
    audit_logs = (
        db.query(AuditLog)
        .filter_by(entity_type="SUBMISSION", entity_id=submission.id)
        .order_by(AuditLog.created_at.asc())
        .all()
    )
    # AI 预审可追溯日志（TC-AI-07）：最近一次该 submission 的 AI_REVIEW 调用
    from app.models.llm import LLMCallLog
    ai_trace = (
        db.query(LLMCallLog)
        .filter_by(submission_id=submission.id, purpose="AI_REVIEW")
        .order_by(LLMCallLog.created_at.desc())
        .first()
    )
    return {
        "submission": submission,
        "task": task,
        "schema_version": schema_version,
        "ai_result": ai_result,
        "ai_trace": ai_trace,
        "history": history,
        "audit_logs": audit_logs,
    }
