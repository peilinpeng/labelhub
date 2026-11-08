"""评测清单与统计口径不能把缺失结果或转人工包装成通过。"""
import importlib.util
from pathlib import Path

spec=importlib.util.spec_from_file_location("quality_eval",Path(__file__).parents[2]/"scripts"/"evaluate_ai_quality.py")
evaluation=importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


def test_corpus_contains_paired_semantics_and_no_group_leakage():
    cases=evaluation.load_cases()
    assert len(cases)==24
    qa=[c for c in cases if c["group"]=="arithmetic"]
    assert len(qa)==4
    assert {c["expectedReview"] for c in qa}=={"PASS","RETURN"}
    assert sum(c["expectedReview"]=="NEED_HUMAN_REVIEW" for c in cases)==4


def test_metric_denominators_and_empty_population():
    cases=[{"id":"good","expectedReview":"PASS"},{"id":"bad","expectedReview":"RETURN"}]
    rows=[{"caseId":"good","decision":"RETURN","latencyMs":10}, {"caseId":"bad","decision":"PASS","latencyMs":30}]
    metrics=evaluation.summarize(rows,cases)
    assert metrics["wrongAnnotationAutoPass"]["rate"]==1
    assert metrics["correctAnnotationAutoReturn"]["rate"]==1
    assert metrics["autoPassError"]["denominator"]==1
    assert evaluation.rate(0,0)["rate"] is None
    assert evaluation.rate(0,10)["wilson95"][1]>0


def test_transport_failures_are_not_quality_measurements():
    metrics=evaluation.summarize([{"caseId":"good","decision":"NEED_HUMAN_REVIEW","latencyMs":10,"error":"TRANSPORT_ERROR"}], [{"id":"good","expectedReview":"PASS"}])
    assert metrics["qualityEligibleTrials"]==0
    assert metrics["decisionAgreement"]["rate"] is None
    assert metrics["transportFailures"]==1
