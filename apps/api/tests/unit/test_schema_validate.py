"""单元测试：schema_domain.validate_schema（TC-QA-02，纯函数）。"""
from app.services.schema_domain import validate_schema


def test_valid_minimal_schema():
    schema = {"nodes": [
        {"id": "n1", "type": "input.text", "name": "field1", "label": "字段1"}
    ]}
    result = validate_schema(schema)
    assert result["valid"] is True
    assert result["errors"] == []


def test_missing_nodes_key():
    result = validate_schema({})
    assert result["valid"] is False
    assert any("nodes" in e for e in result["errors"])


def test_non_dict_schema():
    result = validate_schema("not a dict")  # type: ignore[arg-type]
    assert result["valid"] is False


def test_unknown_node_type():
    schema = {"nodes": [{"id": "n1", "type": "input.bogus", "name": "x"}]}
    result = validate_schema(schema)
    assert result["valid"] is False
    assert any("NodeType" in e for e in result["errors"])


def test_field_node_missing_name():
    schema = {"nodes": [{"id": "n1", "type": "input.text", "label": "无 name"}]}
    result = validate_schema(schema)
    assert result["valid"] is False
    assert any("name" in e for e in result["errors"])


def test_show_node_does_not_require_name():
    # show.* / llm.assist / container.* 不产生答案值，不要求 name
    schema = {"nodes": [{"id": "n1", "type": "show.text", "label": "只读展示"}]}
    result = validate_schema(schema)
    assert result["valid"] is True


def test_duplicate_field_names():
    schema = {"nodes": [
        {"id": "n1", "type": "input.text", "name": "dup", "label": "A"},
        {"id": "n2", "type": "input.textarea", "name": "dup", "label": "B"},
    ]}
    result = validate_schema(schema)
    assert result["valid"] is False
    assert any("重复" in e for e in result["errors"])


def test_container_children_recursion():
    schema = {"nodes": [
        {"id": "c1", "type": "container.group", "children": [
            {"id": "n1", "type": "input.text", "name": "inner", "label": "嵌套字段"}
        ]}
    ]}
    result = validate_schema(schema)
    assert result["valid"] is True


def test_container_child_invalid_propagates():
    schema = {"nodes": [
        {"id": "c1", "type": "container.group", "children": [
            {"id": "n1", "type": "input.text", "label": "缺 name"}
        ]}
    ]}
    result = validate_schema(schema)
    assert result["valid"] is False


# —— canonical root 树形（契约权威形状）——

def test_valid_canonical_root_schema():
    """契约 canonical：root 为 ContainerNode 树，递归校验通过。"""
    schema = {
        "contractVersion": "1.1", "schemaId": "s1", "status": "DRAFT",
        "meta": {"name": "t", "taskId": "task_1", "authorId": "u1"},
        "root": {"id": "root", "kind": "CONTAINER", "type": "container.section", "title": "根",
                 "children": [
                     {"id": "s", "kind": "SHOW_ITEM", "type": "show.text", "title": "展示",
                      "sourcePath": "$.item.sourcePayload.x"},
                     {"id": "f", "kind": "FIELD", "type": "input.text", "name": "field1", "title": "字段1"},
                 ]},
    }
    result = validate_schema(schema)
    assert result["valid"] is True
    assert result["errors"] == []


def test_canonical_root_field_missing_name_invalid():
    """canonical 树下的 FieldNode 缺 name 仍应报错。"""
    schema = {
        "root": {"id": "root", "kind": "CONTAINER", "type": "container.section", "title": "根",
                 "children": [
                     {"id": "f", "kind": "FIELD", "type": "input.text", "title": "缺 name"},
                 ]},
    }
    result = validate_schema(schema)
    assert result["valid"] is False
    assert any("name" in e for e in result["errors"])
