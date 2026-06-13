import hashlib
import json
import time
import uuid
from datetime import datetime, timezone, timedelta

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import settings
from app.middleware.error_handler import (
    InvalidStateTransitionException,
    LLMAssistFailedException,
    PermissionDeniedException,
    ResourceNotFoundException,
    RevisionConflictException,
    ValidationFailedException,
)
from app.models.assignment import Assignment, Draft
from app.models.dataset import DatasetItem
from app.models.llm import LLMCallLog
from app.models.review import ReviewResult
from app.models.schema import SchemaVersion
from app.models.submission import Submission
from app.models.task import Task
from app.utils.hashing import hash_canonical_json
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


def _schema_entry_nodes(schema_json: dict) -> list:
    """返回供递归遍历的入口节点列表。

    契约 canonical 形状用 root（ContainerNode 树）；兼容历史扁平 nodes 形状。
    """
    if isinstance(schema_json, dict) and isinstance(schema_json.get("root"), dict):
        return [schema_json["root"]]
    return (schema_json or {}).get("nodes", [])


def _find_node_by_id(nodes: list, node_id: str) -> dict | None:
    """在 schema nodes（可能嵌套 children）中递归查找指定 id 的节点。"""
    for node in nodes:
        if node.get("id") == node_id:
            return node
        children = node.get("children", [])
        if children:
            found = _find_node_by_id(children, node_id)
            if found:
                return found
    return None


def _validate_answers(schema_json: dict, answers: dict) -> dict:
    nodes = _schema_entry_nodes(schema_json)
    valid_field_names: set[str] = set()
    _collect_field_names(nodes, valid_field_names)
    errors: list[str] = []
    for key in answers:
        if key not in valid_field_names:
            errors.append(f"答案字段 {key!r} 不在 Schema 中")
    return {"valid": len(errors) == 0, "errors": errors}


def get_marketplace_tasks(
    db: Session,
    actor: object,
    page: int,
    page_size: int,
    keyword: str | None = None,
    status: str | None = None,
) -> MarketplaceResponse:
    # 任务广场默认只展示 PUBLISHED；status 传入时进一步收窄（仅 PUBLISHED 在广场可见）
    base_q = db.query(Task).filter(Task.status == "PUBLISHED")
    if status:
        base_q = base_q.filter(Task.status == status)
    if keyword:
        like = f"%{keyword}%"
        base_q = base_q.filter(
            or_(Task.title.ilike(like), Task.description.ilike(like))
        )
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

    # 打回意见：仅当当前 assignment 处于「已打回」状态时，回传最近一次
    # RETURN/REJECT 的审核结果，供 Labeler 看到审核员意见后修改重提；
    # 重新提交后状态流转，旧意见自动不再展示，避免误导。
    # 序列化为契约 ReviewResult（HumanReviewResultRecord）形状：comments/patches/reason
    # 提升到顶层，与前端 AssignmentPage 读取的 review.comments 对齐。
    last_return_reason = None
    if assignment.status == "RETURNED":
        rr = (
            db.query(ReviewResult)
            .join(Submission, Submission.id == ReviewResult.submission_id)
            .filter(Submission.assignment_id == assignment_id)
            .filter(ReviewResult.decision.in_(["RETURN", "REJECT"]))
            .order_by(ReviewResult.created_at.desc())
            .first()
        )
        if rr is not None:
            result_json = rr.result_json or {}
            last_return_reason = {
                "id": rr.id,
                "submissionId": rr.submission_id,
                "schemaVersionId": rr.schema_version_id,
                "stage": rr.stage,
                "decision": rr.decision,
                "comments": result_json.get("comments", []),
                "patches": result_json.get("patches", []),
                "reason": result_json.get("reason"),
                "actorId": rr.actor_id,
                "createdAt": rr.created_at,
            }

    return {
        "assignment": assignment,
        "task": task,
        "item": item,
        "schema_version_id": schema_version.id,
        # schema_id / schema_version_no 仅用于响应层把快照归一化为 canonical
        # PublishedLabelHubSchema（补 schemaId / schemaVersionNo），不参与业务判定。
        "schema_id": schema_version.schema_id,
        "schema_version_no": schema_version.schema_version_no,
        "schema_json": schema_version.schema_json,
        "draft": draft,
        "last_return_reason": last_return_reason,
    }


def list_assignment_items(db: Session, assignment_id: str, actor: object) -> dict:
    """返回 assignment 所属任务的全部题目（供工作台左侧导航），并标出当前题目下标。"""
    assignment = db.query(Assignment).filter_by(id=assignment_id).first()
    if not assignment:
        raise ResourceNotFoundException(f"Assignment {assignment_id!r} 不存在")

    if actor.role == "LABELER" and assignment.labeler_id != actor.id:
        raise PermissionDeniedException("无权访问该作答的题目列表")

    items = (
        db.query(DatasetItem)
        .filter(DatasetItem.task_id == assignment.task_id)
        .order_by(DatasetItem.created_at.asc())
        .all()
    )
    current_index = next(
        (idx for idx, it in enumerate(items) if it.id == assignment.item_id), -1
    )
    return {"items": items, "total": len(items), "current_index": current_index}


def llm_assist(db: Session, assignment_id: str, actor: object, req: object) -> dict:
    """
    标注作答时调用 llm.assist 节点辅助生成内容（TC-ANS-05 / TC-DES-06）。
    - 设置 30s 超时，避免前端长时间挂起
    - 记录 LLMCallLog（purpose=ASSIST）并返回 latency_ms
    - 返回契约 LLMRuntimeResponse 结构（output / suggestedPatch / callId）
    """
    assignment = db.query(Assignment).filter_by(id=assignment_id).first()
    if not assignment:
        raise ResourceNotFoundException(f"Assignment {assignment_id!r} 不存在")
    if assignment.labeler_id != actor.id:
        raise PermissionDeniedException("无权在该作答上调用 LLM 辅助")

    schema_version = db.query(SchemaVersion).filter_by(id=assignment.schema_version_id).first()
    nodes = _schema_entry_nodes(schema_version.schema_json or {})
    node = _find_node_by_id(nodes, req.nodeId)
    if not node:
        raise ValidationFailedException(f"节点 {req.nodeId!r} 不在当前 Schema 中")
    if node.get("type") != "llm.assist":
        raise ValidationFailedException(f"节点 {req.nodeId!r} 不是 llm.assist 类型")

    prompt_template = node.get("promptTemplate") or "请根据以下标注上下文给出辅助建议。"
    answers_str = json.dumps(req.answers, ensure_ascii=False)
    rendered_prompt = f"{prompt_template}\n\n当前答案：{answers_str}"
    model_policy_id = node.get("modelPolicyId") or settings.DOUBAO_MODEL
    input_hash = hashlib.sha256(rendered_prompt.encode()).hexdigest()
    prompt_hash = hashlib.sha256(prompt_template.encode()).hexdigest()
    # 元数据（契约 LLMAssistResponse）：assistType / promptVersionId 由 node 或请求给出
    assist_type = getattr(req, "assistType", None) or node.get("assistType") or "QUALITY_CHECK"
    prompt_version_id = node.get("promptTemplateId")

    call_id = "llm_" + uuid.uuid4().hex
    llm_log = LLMCallLog(
        id=call_id,
        purpose="LLM_ASSIST",  # 契约 §12 LLMCallLog.purpose 合法值
        actor_id=actor.id,
        assignment_id=assignment_id,
        node_id=req.nodeId,
        model_policy_id=model_policy_id,
        prompt_snapshot_hash=prompt_hash,
        input_hash=input_hash,
        status="RUNNING",
    )
    db.add(llm_log)
    db.flush()

    started = time.monotonic()
    try:
        from openai import OpenAI

        client = OpenAI(
            api_key=settings.DOUBAO_API_KEY,
            base_url=settings.DOUBAO_BASE_URL,
            timeout=30,
        )
        response = client.chat.completions.create(
            model=settings.DOUBAO_MODEL,
            messages=[{"role": "user", "content": rendered_prompt}],
        )
        output_text = response.choices[0].message.content or ""
    except Exception as exc:
        latency_ms = int((time.monotonic() - started) * 1000)
        llm_log.status = "FAILED"
        llm_log.error_message = str(exc)[:500]
        llm_log.latency_ms = latency_ms
        llm_log.finished_at = datetime.now(timezone.utc)
        db.commit()
        raise LLMAssistFailedException(
            f"LLM 辅助调用失败（{latency_ms}ms）：{str(exc)[:200]}"
        )

    latency_ms = int((time.monotonic() - started) * 1000)

    # 依据 llm.assist 节点的 outputBindings 构造可一键应用的草稿补丁（best-effort）
    suggested_patch: dict | None = None
    bindings = node.get("outputBindings") or []
    if bindings:
        suggested_patch = {
            b["toFieldName"]: output_text
            for b in bindings
            if b.get("toFieldName")
        } or None

    # outputHash 由后端生成（前端不二次计算），用 canonical-json 保证前后端一致
    output_hash = hash_canonical_json({"output": output_text, "suggestedPatch": suggested_patch})

    llm_log.status = "SUCCEEDED"
    llm_log.output_hash = output_hash
    llm_log.latency_ms = latency_ms
    # Token 用量（TC-AI-07 可追溯）；部分网关可能不返回 usage，做容错
    _usage = getattr(response, "usage", None)
    if _usage is not None:
        llm_log.prompt_tokens = getattr(_usage, "prompt_tokens", None)
        llm_log.completion_tokens = getattr(_usage, "completion_tokens", None)
        llm_log.total_tokens = getattr(_usage, "total_tokens", None)
    llm_log.finished_at = datetime.now(timezone.utc)

    db.commit()
    return {
        "output": output_text,
        "suggested_patch": suggested_patch,
        "call_id": call_id,
        "latency_ms": latency_ms,
        "prompt_version_id": prompt_version_id,
        "model_id": model_policy_id,
        "assist_type": assist_type,
        "prompt_snapshot_hash": prompt_hash,
        "output_hash": output_hash,
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
