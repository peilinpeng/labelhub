"""单元测试：AI 预审置信度感知路由 _route_with_confidence（P0-A）。

只验证纯函数的路由判定，不依赖 DB / LLM。核心不变量：仅收紧、不放宽。
"""
from app.worker.ai_review_worker import _route_with_confidence

THRESHOLD = 0.6


def test_high_confidence_pass_stays_pass():
    decision, downgraded = _route_with_confidence("PASS", 0.9, THRESHOLD)
    assert decision == "PASS"
    assert downgraded is False


def test_low_confidence_pass_downgrades_to_human():
    decision, downgraded = _route_with_confidence("PASS", 0.4, THRESHOLD)
    assert decision == "NEED_HUMAN_REVIEW"
    assert downgraded is True


def test_pass_at_threshold_is_not_downgraded():
    # 边界：等于阈值不降级（< 才降级）。
    decision, downgraded = _route_with_confidence("PASS", THRESHOLD, THRESHOLD)
    assert decision == "PASS"
    assert downgraded is False


def test_low_confidence_return_is_untouched():
    # 仅收紧不放宽：RETURN 不受置信度影响。
    decision, downgraded = _route_with_confidence("RETURN", 0.1, THRESHOLD)
    assert decision == "RETURN"
    assert downgraded is False


def test_need_human_is_untouched():
    decision, downgraded = _route_with_confidence("NEED_HUMAN_REVIEW", 0.1, THRESHOLD)
    assert decision == "NEED_HUMAN_REVIEW"
    assert downgraded is False


def test_missing_confidence_does_not_downgrade():
    # confidence 缺失（None）时不臆断，保持原决策。
    decision, downgraded = _route_with_confidence("PASS", None, THRESHOLD)
    assert decision == "PASS"
    assert downgraded is False
