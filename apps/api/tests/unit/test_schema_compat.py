"""单元测试：detect_breaking_changes（发布向后兼容性闸门，后端权威）。

锁定后端发布闸门契约（与 schema-core checkBackwardCompatibility 字段级 BREAKING 子集对齐）：
- 删除字段 → FIELD_REMOVED（BREAKING）；
- 不兼容类型变化 → FIELD_TYPE_CHANGED_INCOMPATIBLE；可迁移类型对不算 BREAKING；
- 删除 choice 选项值 → OPTION_VALUE_REMOVED；
- 新增字段 / 改 title / 加选项 等非破坏性变更不阻断；
- 首次发布（无旧 schema）不阻断；canonical root 与历史 nodes 形态都支持。
"""
from app.utils.schema_compat import detect_breaking_changes


def _root(*children: dict) -> dict:
    return {"root": {"id": "root", "type": "container.group", "children": list(children)}}


def _field(name: str, ftype: str = "input.text", options=None) -> dict:
    node = {"id": f"n_{name}", "type": ftype, "name": name}
    if options is not None:
        node["options"] = [{"label": v, "value": v} for v in options]
    return node


def test_field_removed_is_breaking():
    old = _root(_field("summary"), _field("category", "choice.radio", ["a", "b"]))
    new = _root(_field("summary"))
    changes = detect_breaking_changes(old, new)
    assert [c["code"] for c in changes] == ["FIELD_REMOVED"]
    assert changes[0]["fieldName"] == "category"


def test_incompatible_type_change_is_breaking():
    old = _root(_field("score", "input.text"))
    new = _root(_field("score", "choice.radio", ["1", "2"]))
    changes = detect_breaking_changes(old, new)
    assert any(c["code"] == "FIELD_TYPE_CHANGED_INCOMPATIBLE" for c in changes)


def test_migratable_type_casts_are_not_breaking():
    # input.text → input.textarea 与 choice.radio → choice.checkbox 属可迁移，不阻断
    old = _root(_field("note", "input.text"), _field("tags", "choice.radio", ["x", "y"]))
    new = _root(_field("note", "input.textarea"), _field("tags", "choice.checkbox", ["x", "y"]))
    assert detect_breaking_changes(old, new) == []


def test_option_value_removed_is_breaking():
    old = _root(_field("category", "choice.select", ["a", "b", "c"]))
    new = _root(_field("category", "choice.select", ["a", "b"]))
    changes = detect_breaking_changes(old, new)
    assert [c["code"] for c in changes] == ["OPTION_VALUE_REMOVED"]
    assert "'c'" in changes[0]["message"]


def test_adding_field_or_option_is_not_breaking():
    old = _root(_field("category", "choice.radio", ["a"]))
    new = _root(_field("category", "choice.radio", ["a", "b"]), _field("extra"))
    assert detect_breaking_changes(old, new) == []


def test_first_publish_no_old_schema_not_breaking():
    new = _root(_field("summary"))
    assert detect_breaking_changes({}, new) == []


def test_legacy_nodes_shape_supported():
    old = {"nodes": [_field("summary"), _field("category", "choice.radio", ["a", "b"])]}
    new = {"nodes": [_field("summary")]}
    changes = detect_breaking_changes(old, new)
    assert [c["code"] for c in changes] == ["FIELD_REMOVED"]


def test_nested_container_fields_traversed():
    old = _root({
        "id": "sec", "type": "container.section",
        "children": [_field("inner", "choice.radio", ["a", "b"])],
    })
    new = _root({
        "id": "sec", "type": "container.section",
        "children": [_field("inner", "choice.radio", ["a"])],
    })
    changes = detect_breaking_changes(old, new)
    assert [c["code"] for c in changes] == ["OPTION_VALUE_REMOVED"]
