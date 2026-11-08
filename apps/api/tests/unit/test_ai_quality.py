"""覆盖错误自动流转、评分复算、严格输出及固定输入的故障边界。"""
from copy import deepcopy
from types import SimpleNamespace
import pytest
from app.services.ai_quality import validate_review_result, route_by_strategy, route_with_confidence, decide_by_threshold, extract_result

DIMS = [{"key": "correctness", "weight": 0.75, "scoreRange": [0, 5]},
        {"key": "evidence", "weight": 0.25, "scoreRange": [0, 1]}]
THRESHOLDS = {"passScore": 0.8, "returnScore": 0.45}


def result():
    return {"decision": "PASS", "totalScore": 85, "confidence": 0.9, "summary": "标注与证据一致",
            "dimensionScores": [{"key": "correctness", "score": 4, "reason": "评分合理"},
                                {"key": "evidence", "score": 1, "reason": "引用完整"}], "fieldIssues": []}


def test_weighted_score_recomputed_and_disagreement_cannot_auto_pass():
    original = result()
    checked = validate_review_result(original, DIMS, THRESHOLDS, {"score"})
    assert checked["totalScore"] == 85
    original["totalScore"] = 100
    checked = validate_review_result(original, DIMS, THRESHOLDS, {"score"})
    assert checked["totalScore"] == 85
    assert checked["decision"] == "NEED_HUMAN_REVIEW"
    assert original["totalScore"] == 100


@pytest.mark.parametrize("value", [None, True, "0.9", -0.1, 1.1, float("nan"), float("inf")])
def test_invalid_confidence_never_auto_passes_or_returns(value):
    for decision in ["PASS", "RETURN"]:
        assert route_with_confidence(decision, value, 0.6)[0] == "NEED_HUMAN_REVIEW"
    candidate = result(); candidate["confidence"] = value
    with pytest.raises(ValueError):
        validate_review_result(candidate, DIMS, THRESHOLDS, set())


@pytest.mark.parametrize("score", [0, 0.85, 1, 1.1, 44.99])
def test_small_percent_scores_never_become_full_marks(score):
    assert decide_by_threshold(score, THRESHOLDS) == "RETURN"


@pytest.mark.parametrize("score", [-1, 101, 150, float("nan"), float("inf"), True, "90", None])
def test_invalid_score_goes_human(score):
    assert decide_by_threshold(score, THRESHOLDS) == "NEED_HUMAN_REVIEW"


@pytest.mark.parametrize("decision,score,expected", [("PASS", 90, "PASS"), ("RETURN", 20, "RETURN"),
    ("NEED_HUMAN_REVIEW", 99, "NEED_HUMAN_REVIEW"), ("RETURN", 99, "NEED_HUMAN_REVIEW"),
    ("PASS", 20, "NEED_HUMAN_REVIEW")])
def test_explicit_abstention_and_disagreement_are_respected(decision, score, expected):
    assert route_by_strategy(decision, "AUTO_PASS_RETURN", score, THRESHOLDS)[0] == expected


@pytest.mark.parametrize("mutation", [
    lambda r: r.pop("summary"), lambda r: r.update(extra=True),
    lambda r: r["dimensionScores"].pop(),
    lambda r: r["dimensionScores"][0].update(key="other"),
    lambda r: r["dimensionScores"][0].update(key="evidence"),
    lambda r: r["dimensionScores"][0].update(score=6),
    lambda r: r["dimensionScores"][0].update(score=True),
    lambda r: r["dimensionScores"][0].update(reason=""),
    lambda r: r.update(fieldIssues=[{"severity":"HIGH","message":"错误","fieldName":"unknown"}]),
])
def test_review_shape_and_dimension_invariants(mutation):
    candidate = result(); mutation(candidate)
    with pytest.raises(ValueError):
        validate_review_result(candidate, DIMS, THRESHOLDS, {"score"})


def test_high_severity_issue_cannot_be_hidden_by_high_score():
    candidate = result(); candidate["fieldIssues"] = [{"severity":"HIGH","message":"关键错误","fieldName":"score"}]
    assert validate_review_result(candidate, DIMS, THRESHOLDS, {"score"})["decision"] == "NEED_HUMAN_REVIEW"


@pytest.mark.parametrize("thresholds", [{"passScore":80,"returnScore":45}, {"passScore":0.4,"returnScore":0.8}, {}])
def test_bad_thresholds_never_route(thresholds):
    assert decide_by_threshold(95, thresholds) == "NEED_HUMAN_REVIEW"


def test_truncated_or_wrong_tool_result_rejected():
    call = SimpleNamespace(function=SimpleNamespace(name="wrong", arguments='{}'))
    message = SimpleNamespace(tool_calls=[call])
    response = SimpleNamespace(choices=[SimpleNamespace(message=message, finish_reason="stop")])
    with pytest.raises(ValueError): extract_result(response, "submit_ai_review_result")
    response.choices[0].finish_reason = "length"
    with pytest.raises(ValueError): extract_result(response, "submit_ai_review_result")
