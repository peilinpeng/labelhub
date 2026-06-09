# Schema 领域服务：schema draft 自动保存（schema_draft_revision 递增、并发冲突检测）、
# schema 结构校验（节点类型、FieldNode.name 唯一性、JsonPath 命名空间、
# Expression 字段引用、LLM output binding、ValidationRule 合法性）、
# schema 版本发布（冻结为不可变 PublishedLabelHubSchema 快照、生成 schemaVersionId/schemaVersionNo）、
# AI 辅助生成 schema draft（调用 LLM、写入 llm_call_logs，purpose=SCHEMA_GENERATION）。
import hashlib
import json
import time
import uuid
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.models.schema import SchemaDraft, SchemaVersion
from app.models.task import Task
from app.models.audit import AuditLog
from app.models.llm import LLMCallLog
from app.middleware.error_handler import (
    ResourceNotFoundException,
    SchemaDraftConflictException,
    SchemaInvalidException,
    LLMAssistFailedException,
)
from app.services.audit_domain import write_audit_log
from app.utils.hashing import hash_canonical_json


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

    # 入口节点：契约 canonical 形状用 root（ContainerNode 树）；兼容历史扁平 nodes 形状
    if isinstance(schema_json.get("root"), dict):
        entry_nodes = [schema_json["root"]]
    elif "nodes" in schema_json:
        entry_nodes = schema_json["nodes"]
    else:
        errors.append("缺少必填字段 root（或兼容的 nodes）")
        return {"valid": False, "errors": errors}

    field_names: list[str] = []
    _collect_nodes(entry_nodes, errors, field_names)

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


def list_schema_versions(
    db: Session,
    task_id: str,
    actor,
) -> list[SchemaVersion]:
    """
    列出某任务的全部已发布 Schema 版本，按版本号倒序（最新在前）。
    用于版本历史 / 版本对比 / 回滚的前端显化；只读，不写 audit log。
    """
    return (
        db.query(SchemaVersion)
        .filter_by(task_id=task_id)
        .order_by(SchemaVersion.schema_version_no.desc())
        .all()
    )


# ---------------------------------------------------------------------------
# generate_schema_draft：AI 生成 Schema 草稿（不落库，仅返回供前端预览/保存）
# ---------------------------------------------------------------------------

# 引导模型仅输出 LabelHubSchema JSON 的系统提示词
_SCHEMA_GEN_SYSTEM_PROMPT = (
    "你是 LabelHub 的数据标注 Schema 设计助手。"
    "请根据任务描述设计一个 LabelHubSchema，并且只输出一个 JSON 对象，"
    "形如 {\"nodes\": [...]}，不要输出任何解释性文字或 Markdown 代码块标记。"
    "每个 FieldNode 必须包含唯一的 name 字段；合法 node type 包括 "
    "input.text / input.textarea / choice.radio / choice.checkbox / choice.select / "
    "show.text / llm.assist 等。"
)


def generate_schema_draft(
    db: Session,
    task_id: str,
    actor,
    req,
) -> dict:
    """
    调用 LLM 根据任务描述生成 LabelHubSchema 草稿（契约 GenerateSchemaResponse）。
    - 仅生成并返回草稿，不写入 SchemaDraft（用户拿到后另行调 saveSchemaDraft 保存）
    - 写一条 LLMCallLog（purpose=SCHEMA_GENERATION）确保可追溯（TC-AI-07）
    - 设置 30s 超时；调用失败或返回非 JSON 时标记 LLMCallLog=FAILED 并抛 LLMAssistFailedException
    - 复用 assignment_domain.llm_assist 的同步调用范式
    """
    # 1. 确认 Task 存在
    task = db.query(Task).filter_by(id=task_id).first()
    if task is None:
        raise ResourceNotFoundException(f"任务 {task_id!r} 不存在")

    # 2. 构造 prompt 与 hash
    user_parts = [f"任务描述：{req.taskDescription}"]
    if getattr(req, "sampleItems", None):
        user_parts.append("样例数据：" + json.dumps(req.sampleItems, ensure_ascii=False))
    if getattr(req, "preferredNodeTypes", None):
        user_parts.append("优先使用节点类型：" + ", ".join(req.preferredNodeTypes))
    user_prompt = "\n".join(user_parts)
    rendered_prompt = f"{_SCHEMA_GEN_SYSTEM_PROMPT}\n\n{user_prompt}"

    model_policy_id = settings.DOUBAO_MODEL
    prompt_hash = hashlib.sha256(_SCHEMA_GEN_SYSTEM_PROMPT.encode()).hexdigest()
    input_hash = hashlib.sha256(rendered_prompt.encode()).hexdigest()

    # 3. 建 LLMCallLog（purpose=SCHEMA_GENERATION，无 assignment/submission/node 关联）
    call_id = "llm_" + uuid.uuid4().hex
    llm_log = LLMCallLog(
        id=call_id,
        purpose="SCHEMA_GENERATION",
        actor_id=actor.id,
        model_policy_id=model_policy_id,
        prompt_snapshot_hash=prompt_hash,
        input_hash=input_hash,
        status="RUNNING",
    )
    db.add(llm_log)
    db.flush()

    # 4. 调用 LLM（同 llm_assist：timeout=30，失败兜底）
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
            messages=[
                {"role": "system", "content": _SCHEMA_GEN_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
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
            f"AI 生成 Schema 调用失败（{latency_ms}ms）：{str(exc)[:200]}"
        )

    latency_ms = int((time.monotonic() - started) * 1000)

    # 5. 解析模型输出为 JSON；解析失败按 LLM 失败处理
    try:
        schema_draft = json.loads(output_text)
        if not isinstance(schema_draft, dict):
            raise ValueError("模型输出不是 JSON 对象")
    except (json.JSONDecodeError, ValueError) as exc:
        llm_log.status = "FAILED"
        llm_log.error_message = f"模型返回内容无法解析为 Schema JSON：{str(exc)[:300]}"
        llm_log.latency_ms = latency_ms
        llm_log.finished_at = datetime.now(timezone.utc)
        db.commit()
        raise LLMAssistFailedException("AI 生成 Schema 失败：模型未返回合法的 Schema JSON")

    # 6. 校验生成的 schema（不阻断返回，校验结果透传给前端）
    validation = validate_schema(schema_draft)
    output_hash = hash_canonical_json(schema_draft)

    # 7. 落 LLMCallLog 成功状态 + token/耗时
    llm_log.status = "SUCCEEDED"
    llm_log.output_hash = output_hash
    llm_log.latency_ms = latency_ms
    _usage = getattr(response, "usage", None)
    if _usage is not None:
        llm_log.prompt_tokens = getattr(_usage, "prompt_tokens", None)
        llm_log.completion_tokens = getattr(_usage, "completion_tokens", None)
        llm_log.total_tokens = getattr(_usage, "total_tokens", None)
    llm_log.finished_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "schema_draft": schema_draft,
        "validation": validation,
        "warnings": [],
        "model_policy_id": model_policy_id,
        "prompt_snapshot_hash": prompt_hash,
        "call_id": call_id,
    }
