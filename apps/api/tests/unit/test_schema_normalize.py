"""单元测试：normalize_schema_payload（schema 形态归一化）。

锁定后端 read-time normalization 契约：
- 简化 {nodes} → canonical {root.children}，补齐 meta.taskId / contractVersion；
- 完整 canonical 原样保留（含 linkageRules 等额外字段，幂等）；
- 空 / 非法输入退化为安全空 schema，绝不返回缺 meta.taskId 的半成品。
"""
from app.utils.schema_normalize import normalize_schema_payload


def test_legacy_nodes_converted_to_canonical_root():
    legacy = {
        "nodes": [
            {"id": "n1", "type": "input.text", "name": "summary", "label": "摘要", "validationRules": []},
        ]
    }
    out = normalize_schema_payload(legacy, "task_x", "schema_x")

    # 信封补齐
    assert out["contractVersion"] == "1.1"
    assert out["schemaId"] == "schema_x"
    assert out["status"] == "DRAFT"
    assert out["meta"]["taskId"] == "task_x"  # 前端崩溃根因字段已补齐
    # 扁平 nodes 转成 root.children，且不再保留顶层 nodes 键
    assert "nodes" not in out
    child = out["root"]["children"][0]
    assert child["name"] == "summary"
    assert child["kind"] == "FIELD"          # 由 type 推导
    assert child["title"] == "摘要"           # 回退自 label
    assert child["validations"] == []         # validationRules 别名


def test_canonical_schema_preserved_idempotent():
    canonical = {
        "contractVersion": "1.1",
        "schemaId": "schema_keep",
        "status": "DRAFT",
        "meta": {"name": "联动", "taskId": "task_keep", "authorId": "u"},
        "root": {
            "id": "root", "kind": "CONTAINER", "type": "container.section", "title": "根",
            "children": [
                {"id": "f1", "kind": "FIELD", "type": "input.textarea", "name": "reason",
                 "title": "理由", "linkageRules": [{"id": "R1"}]},
            ],
        },
    }
    out = normalize_schema_payload(canonical, "task_keep", "schema_keep")
    # 额外字段（linkageRules）不丢失，结构幂等
    assert out["root"]["children"][0]["linkageRules"] == [{"id": "R1"}]
    assert out["meta"]["taskId"] == "task_keep"
    # 二次归一化结果稳定
    assert normalize_schema_payload(out, "task_keep", "schema_keep") == out


def test_published_flag_adds_version_fields():
    out = normalize_schema_payload(
        {"nodes": []}, "task_p", "schema_p",
        published=True, schema_version_id="sv_1", schema_version_no=3,
    )
    assert out["status"] == "PUBLISHED"
    assert out["schemaVersionId"] == "sv_1"
    assert out["schemaVersionNo"] == 3
    assert out["meta"]["taskId"] == "task_p"


def test_empty_or_invalid_input_returns_safe_canonical():
    for bad in (None, {}, [], "garbage", 123):
        out = normalize_schema_payload(bad, "task_safe")
        assert out["meta"]["taskId"] == "task_safe"  # 永不缺 taskId
        assert out["root"]["children"] == []
        assert out["contractVersion"] == "1.1"
