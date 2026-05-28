# Schema 领域服务：schema draft 自动保存（schema_draft_revision 递增、并发冲突检测）、
# schema 结构校验（节点类型、FieldNode.name 唯一性、JsonPath 命名空间、
# Expression 字段引用、LLM output binding、ValidationRule 合法性）、
# schema 版本发布（冻结为不可变 PublishedLabelHubSchema 快照、生成 schemaVersionId/schemaVersionNo）、
# AI 辅助生成 schema draft（调用 LLM、写入 llm_call_logs，purpose=SCHEMA_GENERATION）。
import uuid
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.schema import SchemaDraft, SchemaVersion
from app.models.task import Task
from app.models.audit import AuditLog
from app.middleware.error_handler import (
    ResourceNotFoundException,
    SchemaDraftConflictException,
    SchemaInvalidException,
)
from app.services.audit_domain import write_audit_log


# ---------------------------------------------------------------------------
# 合法 NodeType 集合（契约 §8 全部 19 种）
# ---------------------------------------------------------------------------

_VALID_NODE_TYPES: set[str] = {
    # 输入类
    "input.text", "input.textarea", "input.richtext",
    # 选择类
    "choice.radio", "choice.checkbox", "choice.select", "choice.tags",
    # 上传类
    "upload.file", "upload.image",
    # 结构化数据
    "data.json",
    # 展示类（SHOW）—— 不产生答案值
    "show.text", "show.richtext", "show.image", "show.file", "show.json",
    # AI 辅助
    "llm.assist",
    # 布局容器（LAYOUT）
    "container.group", "container.tabs", "container.section",
}

# 不产生答案值的 NodeType（对应 valueKind=NONE），这些节点不要求 name 字段
_NON_FIELD_TYPES: set[str] = {
    "show.text", "show.richtext", "show.image", "show.file", "show.json",
    "llm.assist",
    "container.group", "container.tabs", "container.section",
}

# container 类型（拥有 children）
_CONTAINER_TYPES: set[str] = {
    "container.group", "container.tabs", "container.section",
}


# ---------------------------------------------------------------------------
# 内部辅助：递归收集校验信息
# ---------------------------------------------------------------------------

def _collect_nodes(nodes: list, errors: list[str], field_names: list[str]) -> None:
    """递归遍历 nodes 列表，校验节点类型与 FieldNode name，收集重复 name。"""
    if not isinstance(nodes, list):
        errors.append("nodes 必须是数组类型")
        return

    for node in nodes:
        if not isinstance(node, dict):
            errors.append(f"节点必须是对象类型，实际得到 {type(node).__name__}")
            continue

        node_type = node.get("type", "")

        # 校验 NodeType 合法性
        if node_type not in _VALID_NODE_TYPES:
            errors.append(f"未知 NodeType: {node_type!r}")
        else:
            # FieldNode 必须有非空 name
            if node_type not in _NON_FIELD_TYPES:
                name = node.get("name")
                if not name:
                    errors.append(f"节点 {node_type!r} 缺少 name 字段")
                else:
                    field_names.append(name)

        # 递归处理 container 的 children
        if node_type in _CONTAINER_TYPES:
            children = node.get("children", [])
            _collect_nodes(children, errors, field_names)


# ---------------------------------------------------------------------------
# validate_schema：纯内存校验，不抛异常，返回 dict
# ---------------------------------------------------------------------------

def validate_schema(schema_json: dict) -> dict:
    """
    校验 LabelHubSchema 结构合法性（基础 MVP 校验）。
    返回 {"valid": bool, "errors": list[str]}，不抛异常。
    调用方根据需要决定是否抛 SchemaInvalidException。
    """
    errors: list[str] = []

    if not isinstance(schema_json, dict):
        errors.append("schema 必须是对象类型")
        return {"valid": False, "errors": errors}

    # 顶层 nodes 字段必须存在
    if "nodes" not in schema_json:
        errors.append("缺少必填字段 nodes")
        return {"valid": False, "errors": errors}

    field_names: list[str] = []
    _collect_nodes(schema_json["nodes"], errors, field_names)

    # FieldNode name 唯一性检查
    seen: set[str] = set()
    for name in field_names:
        if name in seen:
            errors.append(f"FieldNode name 重复: {name!r}")
        seen.add(name)

    return {"valid": len(errors) == 0, "errors": errors}


# ---------------------------------------------------------------------------
# save_schema_draft
# ---------------------------------------------------------------------------

def save_schema_draft(
    db: Session,
    task_id: str,
    actor,
    req,
) -> tuple[SchemaDraft, AuditLog]:
    """
    保存（创建或更新）Schema 草稿，递增 schema_draft_revision。
    若传入 baseSchemaDraftRevision 且与当前修订号不一致，抛 SchemaDraftConflictException。
    验证失败时仍保存草稿（不阻止保存），校验结果由调用方透传给客户端。
    不在此处 commit 之外提交，保证与 audit log 同一事务。
    """
    # 1. 确认 Task 存在
    task = db.query(Task).filter_by(id=task_id).first()
    if task is None:
        raise ResourceNotFoundException(f"任务 {task_id!r} 不存在")

    # 2. 查询当前草稿
    draft = db.query(SchemaDraft).filter_by(task_id=task_id).first()

    if draft is None:
        # 首次保存：创建新草稿，revision 从 1 开始
        draft = SchemaDraft(
            id=f"schema_{uuid.uuid4().hex}",
            task_id=task_id,
            schema_json=req.schema,
            schema_draft_revision=1,
            updated_by=actor.id,
        )
        db.add(draft)
    else:
        # 并发控制：传入 baseSchemaDraftRevision 时校验是否一致
        if (
            req.baseSchemaDraftRevision is not None
            and req.baseSchemaDraftRevision != draft.schema_draft_revision
        ):
            raise SchemaDraftConflictException(
                f"schemaDraftRevision 冲突：当前版本为 {draft.schema_draft_revision}，"
                f"传入基准版本为 {req.baseSchemaDraftRevision}，请重新获取草稿后再保存"
            )
        # 更新草稿
        draft.schema_json = req.schema
        draft.schema_draft_revision += 1
        draft.updated_by = actor.id

    # 3. 刷新到会话（获取自动字段，但尚未 commit）
    db.flush()

    # 4. 写 audit log（不 commit，与业务操作同一事务）
    log = write_audit_log(
        db,
        entity_type="SCHEMA",
        entity_id=draft.id,
        action="SCHEMA_DRAFT_SAVED",
        actor_id=actor.id,
    )

    # 5. 提交事务
    db.commit()
    db.refresh(draft)
    db.refresh(log)

    return draft, log


# ---------------------------------------------------------------------------
# get_schema_draft
# ---------------------------------------------------------------------------

def get_schema_draft(
    db: Session,
    task_id: str,
    actor,
) -> SchemaDraft:
    """
    获取任务当前 Schema 草稿。草稿或任务不存在时抛 ResourceNotFoundException。
    """
    task = db.query(Task).filter_by(id=task_id).first()
    if task is None:
        raise ResourceNotFoundException(f"任务 {task_id!r} 不存在")

    draft = db.query(SchemaDraft).filter_by(task_id=task_id).first()
    if draft is None:
        raise ResourceNotFoundException(f"任务 {task_id!r} 尚未创建 Schema 草稿")

    return draft


# ---------------------------------------------------------------------------
# publish_schema_version
# ---------------------------------------------------------------------------

def publish_schema_version(
    db: Session,
    task_id: str,
    actor,
    req,
) -> tuple[SchemaVersion, AuditLog]:
    """
    将当前 Schema 草稿发布为不可变 SchemaVersion 快照。
    - 校验 schemaDraftRevision 一致性（不一致 → SchemaDraftConflictException）
    - 校验 schema 结构合法性（不合法 → SchemaInvalidException）
    - schema_version_no 按 task 维度递增（MAX+1，无版本则从 1 开始）
    - 写 SCHEMA_VERSION_PUBLISHED audit log，与业务操作同一事务提交
    """
    # 1. 确认 Task 存在
    task = db.query(Task).filter_by(id=task_id).first()
    if task is None:
        raise ResourceNotFoundException(f"任务 {task_id!r} 不存在")

    # 2. 获取当前草稿
    draft = db.query(SchemaDraft).filter_by(task_id=task_id).first()
    if draft is None:
        raise ResourceNotFoundException(f"任务 {task_id!r} 尚未创建 Schema 草稿，无法发布")

    # 3. 并发控制：schemaDraftRevision 必须与当前草稿一致
    if req.schemaDraftRevision != draft.schema_draft_revision:
        raise SchemaDraftConflictException(
            f"schemaDraftRevision 冲突：当前草稿修订号为 {draft.schema_draft_revision}，"
            f"传入值为 {req.schemaDraftRevision}，请重新获取草稿后再发布"
        )

    # 4. Schema 结构必须合法才能发布
    validation = validate_schema(draft.schema_json)
    if not validation["valid"]:
        raise SchemaInvalidException(
            f"Schema 校验失败，无法发布。错误：{'; '.join(validation['errors'])}"
        )

    # 5. 计算下一个版本号（按 task 维度递增）
    max_no = (
        db.query(func.max(SchemaVersion.schema_version_no))
        .filter(SchemaVersion.task_id == task_id)
        .scalar()
    )
    version_no = (max_no or 0) + 1

    # 6. 创建 SchemaVersion 快照（schema_json 为不可变副本）
    version = SchemaVersion(
        id=f"sv_{uuid.uuid4().hex}",
        task_id=task_id,
        schema_id=draft.id,
        schema_version_no=version_no,
        contract_version="1.1",
        schema_json=dict(draft.schema_json),  # 显式复制，防止引用共享
        published_at=datetime.now(timezone.utc),
    )
    db.add(version)
    db.flush()

    # 7. 写 audit log（不 commit，与业务操作同一事务）
    log = write_audit_log(
        db,
        entity_type="SCHEMA",
        entity_id=version.id,
        action="SCHEMA_VERSION_PUBLISHED",
        actor_id=actor.id,
    )

    # 8. 提交事务
    db.commit()
    db.refresh(version)
    db.refresh(log)

    return version, log


# ---------------------------------------------------------------------------
# get_schema_version
# ---------------------------------------------------------------------------

def get_schema_version(
    db: Session,
    schema_version_id: str,
    actor,
) -> SchemaVersion:
    """
    获取不可变 SchemaVersion 快照。不存在时抛 ResourceNotFoundException。
    """
    version = db.query(SchemaVersion).filter_by(id=schema_version_id).first()
    if version is None:
        raise ResourceNotFoundException(f"SchemaVersion {schema_version_id!r} 不存在")
    return version
