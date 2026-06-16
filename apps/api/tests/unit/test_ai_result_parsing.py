"""单元测试：AI 预审结果容错解析（鲁棒性）。"""
import pytest

from app.worker.ai_review_worker import _loads_lenient


def test_plain_json():
    assert _loads_lenient('{"decision":"PASS","totalScore":90}') == {"decision": "PASS", "totalScore": 90}


def test_markdown_fenced():
    raw = '```json\n{"decision":"RETURN","totalScore":40}\n```'
    assert _loads_lenient(raw)["decision"] == "RETURN"


def test_prose_around_json():
    raw = '好的，结果如下：{"decision":"PASS","totalScore":88} 以上。'
    assert _loads_lenient(raw)["totalScore"] == 88


def test_truncated_json_repaired():
    # 模拟被 max_tokens 截断：缺少闭合括号/引号
    raw = '{"decision":"NEED_HUMAN_REVIEW","dimensionScores":[{"key":"relevance","score":70,"reason":"内容相关但'
    parsed = _loads_lenient(raw)
    assert parsed["decision"] == "NEED_HUMAN_REVIEW"
    assert isinstance(parsed["dimensionScores"], list)


def test_empty_raises():
    with pytest.raises(ValueError):
        _loads_lenient("")


def test_unparseable_raises():
    with pytest.raises(ValueError):
        _loads_lenient("这不是 JSON 也没有大括号")
