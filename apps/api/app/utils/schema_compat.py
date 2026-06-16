# Schema 发布向后兼容性检查（后端权威闸门）。
#
# 背景：前端 PublishPreviewDialog 用 @labelhub/schema-core 的
# checkBackwardCompatibility 在客户端算 publishAllowed 并禁用确认按钮，
# 但后端 publish_schema_version 此前只校验结构合法性，不基于破坏性变更阻断
# → "发布前检查阻断破坏性变更" 只在前端成立。本模块把该闸门下沉到后端：
# 发布时把当前草稿与任务当前绑定版本（activeSchemaVersionId）做纯比较，
# 若存在 BREAKING 级变更则阻断发布（由调用方抛 SCHEMA_INVALID / 422）。
#
# 与前端口径对齐：
# - 前端 OwnerSchemaPage 发布预检调用 checkBackwardCompatibility(oldSchema, schema)
#   **不传 renameMap / archiveRemovedFields**（纯比较），本模块同样不做 rename 映射，
#   字段被删一律视作 FIELD_REMOVED（BREAKING）。
# - 仅覆盖 schema-core 中字段级 BREAKING 子集（删除字段 / 不兼容类型变化 /
#   删除选项值），这是会破坏历史答案数据的核心场景。表达式 JsonPath / LLM
#   outputBinding / conditional validation 等 BREAKING 由结构校验与前端兜底，
#   本模块**不会比前端更严格**（严格子集），因此不会误伤正常发布。
from __future__ import annotations

# 不产生答案值的 NodeType（与 schema_domain._NON_FIELD_TYPES 对齐，契约 §8）。
# 内联定义以避免与 schema_domain 形成循环导入；契约 NodeType 为固定枚举。
NON_FIELD_TYPES: set[str] = {
    "show.text", "show.richtext", "show.image", "show.file", "show.json",
    "llm.assist",
    "container.group", "container.tabs", "container.section",
}

# 拥有 children 的容器 NodeType（与 schema_domain._CONTAINER_TYPES 对齐）。
CONTAINER_TYPES: set[str] = {
    "container.group", "container.tabs", "container.section",
}

# choice 类节点：拥有 options 列表，需检查 option value 是否被删除
_CHOICE_TYPES: set[str] = {
    "choice.radio", "choice.checkbox", "choice.select", "choice.tags",
}

# 可迁移（MIGRATION_REQUIRED）而非 BREAKING 的类型变化对，与 schema-core
# detectFieldTypeChanges 保持一致。
_MIGRATABLE_TYPE_CASTS: set[tuple[str, str]] = {
    ("choice.radio", "choice.checkbox"),
    ("input.text", "input.textarea"),
}


def _collect_field_map(schema_json: dict) -> dict[str, dict]:
    """
    遍历 schema（canonical root 树，兼容历史扁平 nodes），收集 FieldNode。
    返回 {name: {"type": str, "option_values": set[str] | None, "node_id": str}}。
    与 schema_domain._collect_nodes 同一套遍历规则。
    """
    if not isinstance(schema_json, dict):
        return {}

    if isinstance(schema_json.get("root"), dict):
        entry_nodes = [schema_json["root"]]
    elif isinstance(schema_json.get("nodes"), list):
        entry_nodes = schema_json["nodes"]
    else:
        return {}

    field_map: dict[str, dict] = {}
    _walk(entry_nodes, field_map)
    return field_map


def _walk(nodes, field_map: dict[str, dict]) -> None:
    if not isinstance(nodes, list):
        return
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_type = node.get("type", "")

        if node_type not in NON_FIELD_TYPES:
            name = node.get("name")
            # 首次出现为准（与 schema-core mapFieldsByName 一致：保留第一个）
            if name and name not in field_map:
                option_values = None
                if node_type in _CHOICE_TYPES:
                    option_values = {
                        opt.get("value")
                        for opt in (node.get("options") or [])
                        if isinstance(opt, dict) and opt.get("value") is not None
                    }
                field_map[name] = {
                    "type": node_type,
                    "option_values": option_values,
                    "node_id": node.get("id"),
                }

        if node_type in CONTAINER_TYPES:
            _walk(node.get("children", []), field_map)


def detect_breaking_changes(old_schema: dict, new_schema: dict) -> list[dict]:
    """
    检测从 old_schema → new_schema 的 BREAKING 级变更（字段级子集）。
    返回 [{"code", "fieldName", "message"}, ...]，空列表表示可安全发布。
    """
    old_map = _collect_field_map(old_schema)
    new_map = _collect_field_map(new_schema)
    changes: list[dict] = []

    for name, old_field in old_map.items():
        new_field = new_map.get(name)

        # 1. 字段被删除（纯比较，不做 rename 映射）→ BREAKING
        if new_field is None:
            changes.append({
                "code": "FIELD_REMOVED",
                "fieldName": name,
                "message": f"字段 {name} 被删除，会丢失历史答案。请先 deprecate 或提供迁移策略。",
            })
            continue

        # 2. 类型变化：排除可迁移的类型转换对，其余视作不兼容 → BREAKING
        old_type = old_field["type"]
        new_type = new_field["type"]
        if old_type != new_type and (old_type, new_type) not in _MIGRATABLE_TYPE_CASTS:
            changes.append({
                "code": "FIELD_TYPE_CHANGED_INCOMPATIBLE",
                "fieldName": name,
                "message": f"字段 {name} 的类型从 {old_type} 变为 {new_type}，与历史答案不兼容。",
            })
            # 类型不兼容时不再比较选项值（语义已变）
            continue

        # 3. choice 选项值被删除 → BREAKING
        old_values = old_field["option_values"]
        new_values = new_field["option_values"]
        if old_values is not None and new_values is not None:
            for removed in sorted(old_values - new_values):
                changes.append({
                    "code": "OPTION_VALUE_REMOVED",
                    "fieldName": name,
                    "message": f"字段 {name} 删除了选项值 {removed!r}，历史答案将无法回放。",
                })

    return changes
