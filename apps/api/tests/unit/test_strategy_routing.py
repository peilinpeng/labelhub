"""单元测试：AI 预审审核策略门控 _route_by_strategy。

只验证纯函数的策略判定，不依赖 DB / LLM。核心不变量：仅 AUTO_PASS_RETURN 允许
AI 自动通过/打回，其余策略下 PASS/RETURN 一律降级为转人工，绝不无人工自动流转。
"""
from app.worker.ai_review_worker import _route_by_strategy


def test_auto_mode_pass_stays_pass():
    decision, downgraded = _route_by_strategy("PASS", "AUTO_PASS_RETURN")
    assert decision == "PASS"
    assert downgraded is False


def test_auto_mode_return_stays_return():
    decision, downgraded = _route_by_strategy("RETURN", "AUTO_PASS_RETURN")
    assert decision == "RETURN"
    assert downgraded is False


def test_advisory_mode_pass_downgrades_to_human():
    decision, downgraded = _route_by_strategy("PASS", "AI_THEN_HUMAN")
    assert decision == "NEED_HUMAN_REVIEW"
    assert downgraded is True


def test_advisory_mode_return_downgrades_to_human():
    decision, downgraded = _route_by_strategy("RETURN", "AI_THEN_HUMAN")
    assert decision == "NEED_HUMAN_REVIEW"
    assert downgraded is True


def test_hints_only_mode_pass_downgrades_to_human():
    decision, downgraded = _route_by_strategy("PASS", "HUMAN_REVIEW_ONLY")
    assert decision == "NEED_HUMAN_REVIEW"
    assert downgraded is True


def test_need_human_is_untouched_in_any_mode():
    for mode in ("AUTO_PASS_RETURN", "AI_THEN_HUMAN", "HUMAN_REVIEW_ONLY"):
        decision, downgraded = _route_by_strategy("NEED_HUMAN_REVIEW", mode)
        assert decision == "NEED_HUMAN_REVIEW"
        assert downgraded is False


def test_unknown_mode_defaults_to_safe_human_review():
    # 未知/缺省 mode 按最安全口径处理：不允许自动流转。
    decision, downgraded = _route_by_strategy("PASS", "")
    assert decision == "NEED_HUMAN_REVIEW"
    assert downgraded is True
