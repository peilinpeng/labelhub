# Schema payload 形态归一化（read-time normalization）。
#
# 背景：schema_drafts / schema_versions 表的 schema_json 是 passthrough 存储——
# 客户端存什么形态就读出什么形态。历史/AI/E2E 数据保存的是简化形态
# {"nodes": [...]}（扁平字段数组，无 meta/root/contractVersion），而契约 §7
# canonical LabelHubSchema 是 {"contractVersion","meta":{"taskId"},"root":{children}}。
# 简化形态被前端按 canonical 读取时会触发 `schema.meta.taskId` 等崩溃。
#
# 本模块在所有「返回 schema」的接口边界把任意形态补齐/转换为 canonical 形态：
# 完整 schema 原样保留（仅补缺失的信封字段，不丢弃 linkageRules 等额外字段）；
# 简化 {nodes} 形态转成 {root:{children:[...]}}；空/非法输入退化为安全空 schema。
# 纯函数、无 app 依赖，供 Pydantic 响应模型与路由复用。
from __future__ import annotations

from typing import Any

_CONTRACT_VERSION = "1.1"

# container 类型（kind=CONTAINER，拥有 children 子树）
_CONTAINER_TYPES = {"container.group", "container.tabs", "container.section"}
# 展示类（kind=SHOW_ITEM，不产生答案值）
_SHOW_PREFIX = "show."
# AI 辅助（kind=LLM_ASSIST）
_LLM_TYPE = "llm.assist"


def _kind_for_type(node_type: str) -> str:
    """由 NodeType 推导 canonical kind（契约 §8）。无法识别时按 FIELD 处理。"""
    if node_type in _CONTAINER_TYPES:
        return "CONTAINER"
    if node_type.startswith(_SHOW_PREFIX):
        return "SHOW_ITEM"
    if node_type == _LLM_TYPE:
        return "LLM_ASSIST"
    return "FIELD"


def _normalize_node(node: Any) -> Any:
    """补齐单个节点的 canonical 必填字段（kind/title），保留全部原始字段。

    - kind：缺失时由 type 推导；
    - title：缺失时回退 label → name → type；
    - validations：仅当存在旧字段 validationRules 且无 validations 时补一份别名；
    - container 子节点递归归一化。
    原始 label / validationRules 等字段一律保留，不删除、不臆造业务内容。
    """
    if not isinstance(node, dict):
        return node
    result = dict(node)
    node_type = result.get("type", "")
    result.setdefault("kind", _kind_for_type(node_type))
    if not result.get("title"):
        result["title"] = result.get("label") or result.get("name") or node_type or "未命名组件"
    if "validationRules" in result and "validations" not in result:
        result["validations"] = result["validationRules"]
    if result.get("kind") == "CONTAINER" and isinstance(result.get("children"), list):
        result["children"] = [_normalize_node(child) for child in result["children"]]
    return result


def normalize_schema_payload(
    raw_schema: Any,
    task_id: str,
    schema_id: str | None = None,
    *,
    published: bool = False,
    schema_version_id: str | None = None,
    schema_version_no: int | None = None,
) -> dict:
    """把任意形态的 schema_json 归一化为 canonical LabelHubSchema（契约 §7）。

    Args:
        raw_schema: 数据库存储的 schema_json（canonical / 简化 {nodes} / 空 / 非法）。
        task_id: 所属任务 id，用于补齐 meta.taskId（前端崩溃根因字段）。
        schema_id: 来源草稿 id，用于补齐 schemaId（缺省按 task 生成兜底值）。
        published: 为 True 时按 PublishedLabelHubSchema 处理（status=PUBLISHED + 版本字段）。
        schema_version_id / schema_version_no: 发布快照的版本标识，published 时写入。

    Returns:
        canonical dict：始终含 contractVersion / schemaId / status / meta.taskId / root。
    """
    schema = dict(raw_schema) if isinstance(raw_schema, dict) else {}

    # ── 信封字段 ────────────────────────────────────────────────────────────
    schema.setdefault("contractVersion", _CONTRACT_VERSION)
    schema.setdefault("schemaId", schema_id or f"schema_{task_id}")
    schema.setdefault("status", "PUBLISHED" if published else "DRAFT")

    meta = dict(schema.get("meta") or {})
    meta.setdefault("name", "标注模板")
    # meta.taskId 是前端崩溃根因：缺失或为空时一律补齐为当前任务
    meta["taskId"] = meta.get("taskId") or task_id
    meta.setdefault("authorId", "usr_owner")
    schema["meta"] = meta

    # ── root 入口：canonical 原样保留；简化 {nodes} 转成 root.children ──────────
    root = schema.get("root")
    if isinstance(root, dict):
        root = dict(root)
        root.setdefault("id", "root")
        root.setdefault("kind", "CONTAINER")
        root.setdefault("type", "container.section")
        root.setdefault("title", meta["name"])
        children = root.get("children")
        root["children"] = [_normalize_node(c) for c in children] if isinstance(children, list) else []
        schema["root"] = root
    else:
        legacy_nodes = schema.get("nodes")
        children = (
            [_normalize_node(n) for n in legacy_nodes] if isinstance(legacy_nodes, list) else []
        )
        schema["root"] = {
            "id": "root",
            "kind": "CONTAINER",
            "type": "container.section",
            "title": meta["name"],
            "children": children,
        }
        # 转换后移除旧的扁平 nodes 键，输出纯 canonical 形态
        schema.pop("nodes", None)

    # ── 发布快照附加字段（PublishedLabelHubSchema，契约 §7）──────────────────
    if published:
        if schema_version_id is not None:
            schema["schemaVersionId"] = schema_version_id
        if schema_version_no is not None:
            schema["schemaVersionNo"] = schema_version_no

    return schema
