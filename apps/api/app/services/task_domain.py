# Task 领域服务：任务状态机迁移（createTask/publishTask/pauseTask/resumeTask/endTask）、
# 配额管理（quota.total/quota.perLabeler）、分发策略解析、截止时间校验。
# 每次成功状态迁移必须调用 audit_domain 写入 audit log，不得静默迁移。
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.task import Task
from app.models.audit import AuditLog
from app.models.schema import SchemaVersion
from app.state_machines.task_sm import apply_transition
from app.services.audit_domain import write_audit_log
from app.middleware.error_handler import (
    ResourceNotFoundException,
    InvalidStateTransitionException,
    PermissionDeniedException,
    ValidationFailedException,
)
from app.middleware.auth import Actor
from app.schemas.task import (
    CreateTaskRequest,
    UpdateTaskRequest,
    PublishTaskRequest,
    PauseTaskRequest,
    EndTaskRequest,
    ArchiveTaskRequest,
)


# ─── 工具函数 ─────────────────────────────────────────────────────────────────

def _get_task_or_404(db: Session, task_id: str) -> Task:
    """按 ID 查询 Task，不存在则抛 404。"""
    task = db.get(Task, task_id)
    if task is None:
        raise ResourceNotFoundException(f"任务 {task_id!r} 不存在")
    return task


def _assert_owner(task: Task, actor: Actor) -> None:
    """校验 actor 是该任务的 owner，否则抛 403。"""
    if task.owner_id != actor.id:
        raise PermissionDeniedException("只有任务创建者（Owner）可以修改此任务")


# ─── createTask ───────────────────────────────────────────────────────────────

def create_task(
    db: Session,
    actor: Actor,
    req: CreateTaskRequest,
) -> tuple[Task, AuditLog]:
    """
    createTask 命令（契约 §18.1）：
    - 创建 DRAFT 状态的 Task
    - 写入 TASK_CREATED audit log
    - 事务内提交
    """
    task = Task(
        id=f"task_{uuid.uuid4().hex}",
        title=req.title,
        description=req.description,
        instruction_rich_text_json=req.instructionRichText,
        tags_json=req.tags,
        reward_rule_json=req.rewardRule.model_dump() if req.rewardRule else None,
        quota_json=req.quota.model_dump(),
        deadline_at=req.deadlineAt,
        distribution_strategy_json=req.distributionStrategy.model_dump(),
        review_policy_json=req.reviewPolicy.model_dump(),
        status="DRAFT",
        owner_id=actor.id,
    )
    db.add(task)

    log = write_audit_log(
        db,
        entity_type="TASK",
        entity_id=task.id,
        action="TASK_CREATED",
        actor_id=actor.id,
        before=None,
        after={"status": "DRAFT", "title": task.title},
    )
    db.commit()
    db.refresh(task)
    return task, log


# ─── getTask ──────────────────────────────────────────────────────────────────

def get_task(db: Session, task_id: str, actor: Actor) -> Task:
    """查询任务详情（契约 §23.1：OWNER/REVIEWER/LABELER 均可查看）。"""
    return _get_task_or_404(db, task_id)


# ─── updateTask ───────────────────────────────────────────────────────────────

def update_task(
    db: Session,
    task_id: str,
    actor: Actor,
    req: UpdateTaskRequest,
) -> Task:
    """
    updateTask（契约 §23.1 PATCH /tasks/:taskId）：
    - 仅允许在 DRAFT 状态修改（非 DRAFT 抛 InvalidStateTransitionException）
    - 仅 Owner 可修改
    - 只更新传入的非 None 字段
    """
    task = _get_task_or_404(db, task_id)
    _assert_owner(task, actor)

    if task.status != "DRAFT":
        raise InvalidStateTransitionException(
            f"只能在 DRAFT 状态修改任务，当前状态为 {task.status!r}"
        )

    if req.title is not None:
        task.title = req.title
    if req.description is not None:
        task.description = req.description
    if req.instructionRichText is not None:
        task.instruction_rich_text_json = req.instructionRichText
    if req.tags is not None:
        task.tags_json = req.tags
    if req.rewardRule is not None:
        task.reward_rule_json = req.rewardRule.model_dump()
    if req.quota is not None:
        task.quota_json = req.quota.model_dump()
    if "deadlineAt" in req.model_fields_set:
        task.deadline_at = req.deadlineAt
    if req.distributionStrategy is not None:
        task.distribution_strategy_json = req.distributionStrategy.model_dump()
    if req.reviewPolicy is not None:
        task.review_policy_json = req.reviewPolicy.model_dump()

    task.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(task)
    return task


# ─── publishTask ──────────────────────────────────────────────────────────────

def publish_task(
    db: Session,
    task_id: str,
    actor: Actor,
    req: PublishTaskRequest,
) -> tuple[Task, AuditLog]:
    """
    publishTask 命令（契约 §16 / §18.1）：
    - DRAFT → PUBLISHED
    - 校验 schemaVersionId 属于当前 task
    - 校验 dataset 已导入（至少 1 条可领取题目）
    - 校验 reviewConfig 已配置 或 显式禁用（reviewDisabledExplicitly=true）
    - 设置 Task.activeSchemaVersionId
    """
    from app.models.dataset import DatasetItem
    from app.models.review import ReviewConfig

    task = _get_task_or_404(db, task_id)
    _assert_owner(task, actor)

    before_status = task.status
    apply_transition(before_status, "publishTask")

    # 校验 schemaVersionId 属于此任务
    sv = db.get(SchemaVersion, req.schemaVersionId)
    if sv is None or sv.task_id != task_id:
        raise ResourceNotFoundException(
            f"SchemaVersion {req.schemaVersionId!r} 不属于任务 {task_id!r}"
        )

    # 校验数据集已导入：至少 1 条可领取（AVAILABLE）题目，避免发布空任务
    available_items = (
        db.query(DatasetItem)
        .filter(DatasetItem.task_id == task_id, DatasetItem.status == "AVAILABLE")
        .count()
    )
    if available_items == 0:
        raise ValidationFailedException(
            "发布前必须导入数据集（至少 1 条可领取题目）"
        )

    # 校验 AI 审核配置：已配置 ReviewConfig 或显式声明禁用
    review_config = db.query(ReviewConfig).filter_by(task_id=task_id).first()
    if review_config is None and not req.reviewDisabledExplicitly:
        raise ValidationFailedException(
            "发布前必须配置 AI 审核（ReviewConfig），或显式设置 reviewDisabledExplicitly=true"
        )

    task.status = "PUBLISHED"
    task.active_schema_version_id = req.schemaVersionId
    task.updated_at = datetime.now(timezone.utc)

    log = write_audit_log(
        db,
        entity_type="TASK",
        entity_id=task.id,
        action="TASK_PUBLISHED",
        actor_id=actor.id,
        before={"status": before_status},
        after={"status": "PUBLISHED", "activeSchemaVersionId": req.schemaVersionId},
    )
    db.commit()
    db.refresh(task)
    return task, log


# ─── pauseTask ────────────────────────────────────────────────────────────────

def pause_task(
    db: Session,
    task_id: str,
    actor: Actor,
    req: PauseTaskRequest,
) -> tuple[Task, AuditLog]:
    """pauseTask 命令（契约 §18.1）：PUBLISHED → PAUSED"""
    task = _get_task_or_404(db, task_id)
    _assert_owner(task, actor)
    before_status = task.status
    apply_transition(before_status, "pauseTask")

    task.status = "PAUSED"
    task.updated_at = datetime.now(timezone.utc)
    log = write_audit_log(
        db,
        entity_type="TASK", entity_id=task.id, action="TASK_PAUSED",
        actor_id=actor.id,
        before={"status": before_status}, after={"status": "PAUSED"},
        reason=req.reason,
    )
    db.commit()
    db.refresh(task)
    return task, log


# ─── resumeTask ───────────────────────────────────────────────────────────────

def resume_task(
    db: Session,
    task_id: str,
    actor: Actor,
) -> tuple[Task, AuditLog]:
    """resumeTask 命令（契约 §18.1）：PAUSED → PUBLISHED"""
    task = _get_task_or_404(db, task_id)
    _assert_owner(task, actor)
    before_status = task.status
    apply_transition(before_status, "resumeTask")

    task.status = "PUBLISHED"
    task.updated_at = datetime.now(timezone.utc)
    log = write_audit_log(
        db,
        entity_type="TASK", entity_id=task.id, action="TASK_RESUMED",
        actor_id=actor.id,
        before={"status": before_status}, after={"status": "PUBLISHED"},
    )
    db.commit()
    db.refresh(task)
    return task, log


# ─── endTask ──────────────────────────────────────────────────────────────────

def end_task(
    db: Session,
    task_id: str,
    actor: Actor,
    req: EndTaskRequest,
) -> tuple[Task, AuditLog]:
    """endTask 命令（契约 §18.1）：PUBLISHED/PAUSED → ENDED"""
    task = _get_task_or_404(db, task_id)
    _assert_owner(task, actor)
    before_status = task.status
    apply_transition(before_status, "endTask")

    task.status = "ENDED"
    task.updated_at = datetime.now(timezone.utc)
    log = write_audit_log(
        db,
        entity_type="TASK", entity_id=task.id, action="TASK_ENDED",
        actor_id=actor.id,
        before={"status": before_status}, after={"status": "ENDED"},
        reason=req.reason,
    )
    db.commit()
    db.refresh(task)
    return task, log


# ─── archiveTask ──────────────────────────────────────────────────────────────

def archive_task(
    db: Session,
    task_id: str,
    actor: Actor,
    req: ArchiveTaskRequest,
) -> tuple[Task, AuditLog]:
    """
    archiveTask 命令（契约 §18.1）：ENDED → ARCHIVED（终态）。
    不得从 DRAFT/PUBLISHED/PAUSED 直接归档（由状态机保证）。
    """
    task = _get_task_or_404(db, task_id)
    _assert_owner(task, actor)
    before_status = task.status
    apply_transition(before_status, "archiveTask")

    task.status = "ARCHIVED"
    task.updated_at = datetime.now(timezone.utc)
    log = write_audit_log(
        db,
        entity_type="TASK", entity_id=task.id, action="TASK_ARCHIVED",
        actor_id=actor.id,
        before={"status": before_status}, after={"status": "ARCHIVED"},
        reason=req.reason,
    )
    db.commit()
    db.refresh(task)
    return task, log


def delete_draft_task(db: Session, task_id: str, actor: Actor) -> None:
    """
    删除草稿任务（仅 DRAFT）。

    DRAFT 任务从未发布、无标注/审核/导出数据，硬删除是安全的。
    非 DRAFT 任务（PUBLISHED/PAUSED/ENDED/ARCHIVED）禁止删除 → 409，
    应改用结束（endTask）/ 归档（archiveTask）以保留审计与标注记录。

    级联清理（FK 安全顺序，子表先于父表）：
      dataset_items → schema_versions → schema_drafts → audit_logs(本任务+其 schema) → tasks
    DRAFT 任务 active_schema_version_id 必为 NULL，无 task↔version 循环 FK 问题。
    """
    from app.models.dataset import DatasetItem
    from app.models.schema import SchemaDraft

    task = _get_task_or_404(db, task_id)
    _assert_owner(task, actor)

    if task.status != "DRAFT":
        raise InvalidStateTransitionException(
            f"任务当前状态 {task.status!r} 不支持删除；仅草稿任务可删除。"
            "已发布任务请使用结束 / 归档以保留标注与审计记录。"
        )

    # 收集本任务的 schema 实体 id，用于清理对应 audit_logs（entity_id 无 FK，需显式删）
    draft_ids = [d.id for d in db.query(SchemaDraft.id).filter_by(task_id=task_id).all()]
    version_ids = [v.id for v in db.query(SchemaVersion.id).filter_by(task_id=task_id).all()]
    schema_entity_ids = draft_ids + version_ids

    # 子表先行
    db.query(DatasetItem).filter_by(task_id=task_id).delete(synchronize_session=False)
    db.query(SchemaVersion).filter_by(task_id=task_id).delete(synchronize_session=False)
    db.query(SchemaDraft).filter_by(task_id=task_id).delete(synchronize_session=False)

    # 审计日志：本任务（entity_type=TASK）+ 其 schema 实体（entity_type=SCHEMA）
    db.query(AuditLog).filter(
        AuditLog.entity_type == "TASK", AuditLog.entity_id == task_id
    ).delete(synchronize_session=False)
    if schema_entity_ids:
        db.query(AuditLog).filter(
            AuditLog.entity_type == "SCHEMA",
            AuditLog.entity_id.in_(schema_entity_ids),
        ).delete(synchronize_session=False)

    db.delete(task)
    db.commit()


def get_task_stats(db: Session, task_id: str, actor: Actor) -> dict:
    """任务概览统计：数据集进度、各状态计数、剩余配额（契约 §23.1 OWNER 看板）。"""
    from app.models.dataset import DatasetItem
    from app.models.assignment import Assignment
    from app.models.submission import Submission

    task = _get_task_or_404(db, task_id)
    _assert_owner(task, actor)

    def _count(model, *conds) -> int:
        return db.query(model).filter(model.task_id == task_id, *conds).count()

    dataset_total = _count(DatasetItem)
    dataset_available = _count(DatasetItem, DatasetItem.status == "AVAILABLE")

    in_progress = _count(
        Assignment, Assignment.status.in_(("CLAIMED", "DRAFTING"))
    )
    # 占用配额的领取：未取消 / 未过期
    quota_used = _count(
        Assignment, ~Assignment.status.in_(("CANCELED", "EXPIRED"))
    )

    review_pipeline = (
        "SUBMITTED", "AI_REVIEWING", "AI_PASSED",
        "NEEDS_HUMAN_REVIEW", "HUMAN_REVIEWING", "FINAL_REVIEWING",
    )
    in_review = _count(Submission, Submission.status.in_(review_pipeline))
    accepted = _count(Submission, Submission.status == "ACCEPTED")
    returned = _count(Submission, Submission.status == "RETURNED")
    rejected = _count(Submission, Submission.status == "REJECTED")
    submitted_total = in_review + accepted + returned + rejected

    quota = task.quota_json or {}
    quota_total = quota.get("total")
    quota_remaining = (
        max(quota_total - quota_used, 0) if isinstance(quota_total, int) else None
    )
    progress_percent = (
        min(round(100 * submitted_total / dataset_total), 100)
        if dataset_total > 0 else 0
    )

    return {
        "taskId": task_id,
        "datasetTotal": dataset_total,
        "datasetAvailable": dataset_available,
        "inProgress": in_progress,
        "inReview": in_review,
        "accepted": accepted,
        "returned": returned,
        "rejected": rejected,
        "submittedTotal": submitted_total,
        "quotaTotal": quota_total,
        "quotaRemaining": quota_remaining,
        "progressPercent": progress_percent,
    }
