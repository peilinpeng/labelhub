import hashlib
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.middleware.error_handler import ResourceNotFoundException, ValidationFailedException
from app.models.review import AIReviewJob, ReviewConfig


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
