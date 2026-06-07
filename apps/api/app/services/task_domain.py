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
    if req.deadlineAt is not None:
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
