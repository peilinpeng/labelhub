import uuid
from datetime import datetime, timezone, timedelta

from sqlalchemy.orm import Session

from app.middleware.error_handler import (
    InvalidStateTransitionException,
    PermissionDeniedException,
    ResourceNotFoundException,
    RevisionConflictException,
    ValidationFailedException,
)
from app.models.assignment import Assignment, Draft
from app.models.dataset import DatasetItem
from app.models.schema import SchemaVersion
from app.models.task import Task
from app.schemas.assignment import (
    MarketplaceResponse,
    MarketplaceTaskItem,
)
from app.services.audit_domain import write_audit_log

_NON_FIELD_TYPES = {
    "show.text", "show.richtext", "show.image", "show.file", "show.json",
    "llm.assist", "container.group", "container.tabs", "container.section",
}


def _collect_field_names(nodes: list, result: set) -> None:
    for node in nodes:
        node_type = node.get("type", "")
        if node_type not in _NON_FIELD_TYPES:
            name = node.get("name")
            if name:
                result.add(name)
        children = node.get("children", [])
        if children:
            _collect_field_names(children, result)


def _validate_answers(schema_json: dict, answers: dict) -> dict:
    nodes = schema_json.get("nodes", [])
    valid_field_names: set[str] = set()
    _collect_field_names(nodes, valid_field_names)
    errors: list[str] = []
    for key in answers:
        if key not in valid_field_names:
            errors.append(f"答案字段 {key!r} 不在 Schema 中")
    return {"valid": len(errors) == 0, "errors": errors}


def get_marketplace_tasks(db: Session, actor: object, page: int, page_size: int) -> MarketplaceResponse:
    base_q = db.query(Task).filter(Task.status == "PUBLISHED")
    total = base_q.count()
    items = (
        base_q.order_by(Task.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return MarketplaceResponse(
        items=[MarketplaceTaskItem.from_orm(t) for t in items],
        page=page,
        pageSize=page_size,
        total=total,
    )


def claim_item(db: Session, task_id: str, actor: object, req: object) -> tuple:
    task = db.query(Task).filter_by(id=task_id).first()
    if not task:
        raise ResourceNotFoundException(f"任务 {task_id!r} 不存在")

    if task.status != "PUBLISHED":
        raise ValidationFailedException("任务未发布，无法领取")

    if task.active_schema_version_id is None:
        raise ValidationFailedException("任务未配置 Schema 版本")

    strategy = task.distribution_strategy_json
    if strategy["type"] == "ASSIGNMENT" and actor.id not in strategy.get("assigneeIds", []):
        raise PermissionDeniedException("当前用户未被指定为该任务的标注员")

    active = db.query(Assignment).filter(
        Assignment.task_id == task_id,
        Assignment.labeler_id == actor.id,
        Assignment.status.in_(["CLAIMED", "DRAFTING", "SUBMITTED", "RETURNED"]),
    ).first()
    if active:
        raise ValidationFailedException("您已领取该任务，请完成当前作答后再领取")

    q = db.query(DatasetItem).filter(
        DatasetItem.task_id == task_id,
        DatasetItem.status == "AVAILABLE",
    ).with_for_update(skip_locked=True)

    item = None
    if req.preferredItemId:
        item = q.filter(DatasetItem.id == req.preferredItemId).first()
    if not item:
        item = q.order_by(DatasetItem.created_at.asc()).first()
    if not item:
        raise ValidationFailedException("暂无可领取的题目")

    locked_until = datetime.now(timezone.utc) + timedelta(hours=24)
    assignment = Assignment(
        id="asn_" + uuid.uuid4().hex,
        task_id=task_id,
        item_id=item.id,
        labeler_id=actor.id,
        schema_version_id=task.active_schema_version_id,
        status="CLAIMED",
        locked_until=locked_until,
    )
    db.add(assignment)
    db.flush()

    item.status = "LOCKED"
    item.current_assignment_id = assignment.id

    log = write_audit_log(
        db,
        entity_type="ASSIGNMENT",
        entity_id=assignment.id,
        action="ASSIGNMENT_CLAIMED",
        actor_id=actor.id,
        after={"taskId": task_id, "itemId": item.id},
    )

    db.commit()
    db.refresh(assignment)
    db.refresh(log)
    return (assignment, log)


def get_assignment_context(db: Session, assignment_id: str, actor: object) -> dict:
    assignment = db.query(Assignment).filter_by(id=assignment_id).first()
    if not assignment:
        raise ResourceNotFoundException(f"Assignment {assignment_id!r} 不存在")

    if actor.role == "LABELER" and assignment.labeler_id != actor.id:
        raise PermissionDeniedException("无权访问该作答")

    task = db.query(Task).filter_by(id=assignment.task_id).first()
    item = db.query(DatasetItem).filter_by(id=assignment.item_id).first()
    schema_version = db.query(SchemaVersion).filter_by(id=assignment.schema_version_id).first()
    draft = db.query(Draft).filter_by(assignment_id=assignment_id).first()

    return {
        "assignment": assignment,
        "task": task,
        "item": item,
        "schema_version_id": schema_version.id,
        "schema_json": schema_version.schema_json,
        "draft": draft,
        "last_return_reason": None,
    }


def save_draft(db: Session, assignment_id: str, actor: object, req: object) -> tuple:
    assignment = db.query(Assignment).filter_by(id=assignment_id).first()
    if not assignment:
        raise ResourceNotFoundException(f"Assignment {assignment_id!r} 不存在")

    if assignment.labeler_id != actor.id:
        raise PermissionDeniedException("无权保存该草稿")

    if assignment.status not in ("CLAIMED", "DRAFTING", "RETURNED"):
        raise InvalidStateTransitionException(
            f"Assignment 当前状态 {assignment.status!r} 不允许保存草稿"
        )

    draft = db.query(Draft).filter_by(assignment_id=assignment_id).first()

    if draft and req.clientRevision != draft.server_revision:
        raise RevisionConflictException(
            f"草稿并发冲突：服务端版本为 {draft.server_revision}，"
            f"客户端传入 {req.clientRevision}，请刷新后重试"
        )

    now = datetime.now(timezone.utc)
    if draft is None:
        draft = Draft(
            assignment_id=assignment_id,
            schema_version_id=assignment.schema_version_id,
            answers_json=req.answers,
            client_revision=req.clientRevision,
            server_revision=1,
            saved_at=now,
        )
        db.add(draft)
    else:
        draft.answers_json = req.answers
        draft.client_revision = req.clientRevision
        draft.server_revision += 1
        draft.saved_at = now

    assignment.status = "DRAFTING"

    schema_version = db.query(SchemaVersion).filter_by(id=assignment.schema_version_id).first()
    validation = _validate_answers(schema_version.schema_json, req.answers)
    draft.validation_errors_json = validation["errors"] or None

    log = write_audit_log(
        db,
        entity_type="ASSIGNMENT",
        entity_id=assignment_id,
        action="DRAFT_SAVED",
        actor_id=actor.id,
        after={"serverRevision": draft.server_revision},
    )

    db.commit()
    db.refresh(draft)
    db.refresh(assignment)
    db.refresh(log)
    return (draft, assignment, log)
