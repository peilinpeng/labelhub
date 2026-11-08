"""模型结果不再修复截断数据或从自由文本猜测 JSON。"""
import pytest
from app.worker.ai_review_worker import _loads_lenient


def test_complete_json():
    assert _loads_lenient('{"decision":"PASS","totalScore":90}')["totalScore"] == 90


@pytest.mark.parametrize("raw", ["", "not json", '```json\n{"decision":"PASS"}\n```',
    '说明：{"decision":"PASS"}', '{"decision":"PASS",', '{"x":NaN}', '{"x":1,"x":2}', '[]'])
def test_invalid_or_ambiguous_json_rejected(raw):
    with pytest.raises(ValueError):
        _loads_lenient(raw)
