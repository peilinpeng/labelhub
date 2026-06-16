"""单元测试：AI 预审审核策略门控 _route_by_strategy 与硬阈值闸门 _decide_by_threshold。

只验证纯函数的策略判定，不依赖 DB / LLM。核心不变量：
- AUTO_PASS_RETURN 用 totalScore 与阈值硬比较决定 PASS/RETURN，而非只信 LLM 的 decision；
- 其余策略下 PASS/RETURN 一律降级为转人工，绝不无人工自动流转。
"""
from app.worker.ai_review_worker import _decide_by_threshold, _route_by_strategy

# passScore=0.8 / returnScore=0.45（0-1 量纲），与前端默认一致。
THRESHOLDS = {"passScore": 0.8, "returnScore": 0.45}


def test_auto_mode_high_score_passes():
    # 高分（百分制 90）→ 归一化 0.9 ≥ 0.8 → PASS。
    decision, changed = _route_by_strategy("RETURN", "AUTO_PASS_RETURN", 90, THRESHOLDS)
    assert decision == "PASS"
    assert changed is True  # 硬闸改写了 LLM 的 RETURN


def test_auto_mode_low_score_returns():
    decision, changed = _route_by_strategy("PASS", "AUTO_PASS_RETURN", 30, THRESHOLDS)
    assert decision == "RETURN"
    assert changed is True


def test_auto_mode_mid_score_goes_human():
    # 中间分（0.6）落在 returnScore 与 passScore 之间 → 转人工。
    decision, _ = _route_by_strategy("PASS", "AUTO_PASS_RETURN", 60, THRESHOLDS)
    assert decision == "NEED_HUMAN_REVIEW"


def test_auto_mode_missing_score_goes_human():
    decision, _ = _route_by_strategy("PASS", "AUTO_PASS_RETURN", None, THRESHOLDS)
    assert decision == "NEED_HUMAN_REVIEW"


def test_decide_by_threshold_accepts_fraction_scale():
    # totalScore 已是 0-1 量纲时也能正确比较。
    assert _decide_by_threshold(0.85, THRESHOLDS) == "PASS"
    assert _decide_by_threshold(0.40, THRESHOLDS) == "RETURN"
    assert _decide_by_threshold(0.60, THRESHOLDS) == "NEED_HUMAN_REVIEW"


def test_decide_by_threshold_accepts_autopass_keys():
    # 兼容 seed_competition 的 autoPass/autoReturn 键名（老配置量纲）。
    legacy = {"autoPass": 0.85, "autoReturn": 0.5}
    assert _decide_by_threshold(90, legacy) == "PASS"
    assert _decide_by_threshold(40, legacy) == "RETURN"
    assert _decide_by_threshold(70, legacy) == "NEED_HUMAN_REVIEW"


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
