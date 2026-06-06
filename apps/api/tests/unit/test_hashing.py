"""单元测试：canonical-json hash 工具，与前端 stableStringify 测试向量对拍。"""
from app.utils.hashing import stable_stringify, hash_canonical_json, ANSWER_HASH_ALGORITHM


# 以下期望值直接取自前端 packages/schema-core/src/__tests__/stable-hash.test.ts
def test_object_key_sorted():
    assert stable_stringify({"b": 2, "a": 1}) == '{"a":1,"b":2}'


def test_key_order_independent():
    assert stable_stringify({"b": 2, "a": 1}) == stable_stringify({"a": 1, "b": 2})


def test_nested_object_sorted():
    assert stable_stringify({"outer": {"z": 1, "a": 2}, "b": 3}) == '{"b":3,"outer":{"a":2,"z":1}}'


def test_array_order_preserved():
    assert stable_stringify([3, 1, 2]) == "[3,1,2]"


def test_non_ascii_not_escaped():
    # 前端 JSON.stringify 不转义中文；Python 需 ensure_ascii=False
    assert stable_stringify({"标题": "新闻"}) == '{"标题":"新闻"}'


def test_hash_deterministic_and_order_independent():
    h1 = hash_canonical_json({"a": 1, "b": [1, 2], "c": {"x": True}})
    h2 = hash_canonical_json({"c": {"x": True}, "b": [1, 2], "a": 1})
    assert h1 == h2
    assert len(h1) == 64  # SHA-256 hex
    assert h1 == h1.lower()


def test_hash_changes_with_value():
    assert hash_canonical_json({"a": 1}) != hash_canonical_json({"a": 2})


def test_algorithm_constant():
    assert ANSWER_HASH_ALGORITHM == "canonical-json-v1+SHA-256"
