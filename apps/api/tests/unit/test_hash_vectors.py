"""前后端 canonical-json-v1 + SHA-256 一致性 test vectors（T1-A）。

这组向量同时被前端 node:test 断言
（packages/schema-core/src/__tests__/canonical-hash-vectors.test.ts）。
两边必须产出**逐字节一致**的 canonical string 与 SHA-256，否则
finalAnswerHash / beforeAnswerHash / outputHash / promptSnapshotHash /
passportBatchHash 在前后端对不上。

修改本文件向量时必须同步修改前端测试，保持两侧一致。

注意：向量刻意避开浮点数（Python json.dumps(1.0)="1.0" 但 JS JSON.stringify(1.0)="1"，
二者不一致），只用整数 / 字符串 / 布尔 / null / 嵌套 / BMP 中文。
"""
import pytest

from app.utils.hashing import stable_stringify, hash_canonical_json

# (name, input, expected_canonical, expected_sha256)
# 与 packages/schema-core/src/__tests__/canonical-hash-vectors.test.ts 严格同步
VECTORS = [
    (
        "key 乱序 + 嵌套",
        {"b": 2, "a": 1, "nested": {"z": "last", "m": "middle"}},
        '{"a":1,"b":2,"nested":{"m":"middle","z":"last"}}',
        "888dd66f76e420014cf5dea559f3b7b3a30ea5bdd39ef566c0261bdebb334770",
    ),
    (
        "中文 key + 数组保序 + bool + null",
        {"中文": "值", "arr": [3, 1, 2], "flag": True, "empty": None},
        '{"arr":[3,1,2],"empty":null,"flag":true,"中文":"值"}',
        "10fe9686d53911d72c80e73b1f80ba8c1f2dd5ac1c249e3095e1c0d9b416efa3",
    ),
    (
        "顶层数组含嵌套对象",
        ["x", {"k2": "v2", "k1": "v1"}, 10],
        '["x",{"k1":"v1","k2":"v2"},10]',
        "c04a8660d09b5f89f826ff7e0c6306b31488c09ff3fb8b922b4b553a4d408c83",
    ),
    (
        "深层嵌套",
        {"a": {"d": 4, "c": 3}, "b": [{"y": 2, "x": 1}]},
        '{"a":{"c":3,"d":4},"b":[{"x":1,"y":2}]}',
        "be7c4247ec8669c74f18acccfe25972754e64977ed6562dace8c61960205b2c3",
    ),
    (
        "真实 answers 形态",
        {"summary": "摘要内容", "relevance": "5", "tags": ["标签a", "标签b"]},
        '{"relevance":"5","summary":"摘要内容","tags":["标签a","标签b"]}',
        "9535426da7405d29cdaa07402cc42712edda0863bcb4cc9bab36ba0876d41ed7",
    ),
]


@pytest.mark.parametrize("name,value,canonical,_sha", VECTORS, ids=[v[0] for v in VECTORS])
def test_canonical_string_matches_vector(name, value, canonical, _sha):
    assert stable_stringify(value) == canonical


@pytest.mark.parametrize("name,value,_canonical,sha", VECTORS, ids=[v[0] for v in VECTORS])
def test_sha256_matches_vector(name, value, _canonical, sha):
    assert hash_canonical_json(value) == sha


def test_key_order_independent():
    """不同 key 顺序的等价对象，hash 必须一致。"""
    assert hash_canonical_json({"b": 2, "a": 1}) == hash_canonical_json({"a": 1, "b": 2})
