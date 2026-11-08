"""真实数据库状态机与 HTTP 边界；仅用可控响应替代模型。"""
import json
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4
import pytest
from app.models.review import ReviewConfig, ReviewResult
from app.models.submission import Submission
from app.models.assignment import Draft
from app.models.llm import LLMCallLog
from app.models.dataset import DatasetItem
from app.services.review_domain import create_ai_review_job
from app.worker.ai_review_worker import _execute_review
from tests.helpers import setup_published_task
from tests.integration.test_llm_assist_metadata import _LLM_SCHEMA

DIMS = [{"key":"correctness", "label":"标注正确性", "description":"标注符合材料与规范", "weight":1.0, "scoreRange":[0,100]}]


def make_result(decision="PASS", score=95):
    return {"decision":decision, "totalScore":score, "dimensionScores":[{"key":"correctness","score":score,"reason":"材料支持标注"}],
            "fieldIssues":[], "summary":"标注已核查", "confidence":0.95}


def response(data):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(data), tool_calls=None), finish_reason="stop")], usage=None)


def setup_job(client, auth, db):
    ctx = setup_published_task(client, db, auth["OWNER"])
    claim = client.post(f"/api/v1/tasks/{ctx['task_id']}/claim",json={},headers=auth["LABELER"]).json()
    asn = claim["context"]["assignment"]["id"]
    sub_id = client.post(f"/api/v1/assignments/{asn}/submit",json={"answers":{"summary":"正确标注"}},headers=auth["LABELER"]).json()["submission"]["id"]
    sub = db.get(Submission,sub_id); sub.status="AI_REVIEWING"
    cfg = ReviewConfig(id="cfg_"+uuid4().hex,task_id=ctx["task_id"],enabled=True,model_policy_id="policy_test",
        prompt_template="旧模板只评价原始回答",dimensions_json=deepcopy(DIMS),thresholds_json={"passScore":0.8,"returnScore":0.45},
        conclusion_mapping_json={"mode":"AUTO_PASS_RETURN"},max_retries=1)
    db.add(cfg); db.flush()
    job=create_ai_review_job(db,sub,cfg); db.commit()
    return ctx,sub,cfg,job


def mock_model(monkeypatch, callback):
    monkeypatch.setattr("openai.OpenAI",lambda **kw: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=callback))))


def test_snapshot_input_and_configuration_do_not_drift(client, auth, db_session, monkeypatch):
    ctx,sub,cfg,job=setup_job(client,auth,db_session)
    old_model=job.model_snapshot_json["model"]
    cfg.prompt_template="新模板"; cfg.thresholds_json={"passScore":0.99,"returnScore":0.98}
    cfg.dimensions_json=[]; db_session.get(DatasetItem,sub.item_id).source_payload={"text":"变更后的材料"}
    db_session.commit()
    captured={}
    def call(**kwargs):
        captured.update(kwargs); return response(make_result())
    mock_model(monkeypatch,call)
    _execute_review(db_session,job.id)
    assert sub.status=="ACCEPTED"
    assert captured["model"]==old_model
    assert "旧模板" in captured["messages"][1]["content"]
    evidence=json.loads(captured["messages"][2]["content"].split("\n",1)[1])
    assert evidence["context"]["item"]["sourcePayload"]=={"text":"测试题目内容"}
    assert evidence["context"]["submission"]["answers"]=={"summary":"正确标注"}
    assert "标注员提交的答案" in captured["messages"][0]["content"]
    assert job.status=="SUCCEEDED"
    before=db_session.query(ReviewResult).count()
    _execute_review(db_session,job.id)
    assert db_session.query(ReviewResult).count()==before


@pytest.mark.parametrize("mutation", [lambda r:r.update(confidence=None), lambda r:r.update(totalScore=150),
    lambda r:r["dimensionScores"][0].update(score="95"),lambda r:r.pop("fieldIssues")])
def test_invalid_result_cannot_accept_or_modify_submission(client, auth, db_session, monkeypatch, mutation):
    _,sub,_,job=setup_job(client,auth,db_session)
    candidate=make_result(); mutation(candidate)
    mock_model(monkeypatch,lambda **kw:response(candidate))
    _execute_review(db_session,job.id)
    assert sub.status=="NEEDS_HUMAN_REVIEW"
    assert sub.answers_json=={"summary":"正确标注"}
    assert job.status=="FAILED_TO_HUMAN_REVIEW"
    assert db_session.query(ReviewResult).filter_by(submission_id=sub.id).count()==0
    assert db_session.query(LLMCallLog).filter_by(submission_id=sub.id).one().status=="FAILED"


@pytest.mark.parametrize("decision,score,status", [("PASS",1,"NEEDS_HUMAN_REVIEW"),("RETURN",1,"RETURNED"),
    ("NEED_HUMAN_REVIEW",99,"NEEDS_HUMAN_REVIEW"),("PASS",95,"ACCEPTED")])
def test_route_drives_actual_state_machine(client, auth, db_session, monkeypatch, decision,score,status):
    _,sub,_,job=setup_job(client,auth,db_session)
    mock_model(monkeypatch,lambda **kw:response(make_result(decision,score)))
    _execute_review(db_session,job.id)
    assert sub.status==status
    assert sub.answers_json=={"summary":"正确标注"}


def test_legacy_job_without_snapshot_goes_human(client,auth,db_session,monkeypatch):
    _,sub,_,job=setup_job(client,auth,db_session); job.workflow_snapshot_json=None; db_session.commit()
    mock_model(monkeypatch,lambda **kw:pytest.fail("旧快照不能调用模型"))
    _execute_review(db_session,job.id)
    assert sub.status=="NEEDS_HUMAN_REVIEW"


def test_retry_reuses_snapshot(client,auth,db_session,monkeypatch):
    _,sub,cfg,job=setup_job(client,auth,db_session)
    scheduled=[]
    monkeypatch.setattr("app.worker.ai_review_worker.celery_app.send_task",lambda *a,**kw:scheduled.append(kw))
    def failed(**kwargs): raise RuntimeError("模拟网关故障；不应写入日志正文")
    mock_model(monkeypatch,failed); _execute_review(db_session,job.id)
    assert job.status=="RETRYING" and scheduled[0]["countdown"]==5
    cfg.prompt_template="更改提示词"; db_session.commit()
    def retry(**kwargs):
        assert "旧模板" in kwargs["messages"][1]["content"]
        return response(make_result())
    mock_model(monkeypatch,retry); _execute_review(db_session,job.id)
    assert job.status=="SUCCEEDED" and job.failure_reason is None


def test_assist_sends_material_and_rejects_invalid_patch(client,auth,db_session,monkeypatch):
    ctx=setup_published_task(client,db_session,auth["OWNER"],schema=_LLM_SCHEMA)
    asn=client.post(f"/api/v1/tasks/{ctx['task_id']}/claim",json={},headers=auth["LABELER"]).json()["context"]["assignment"]["id"]
    calls=[]
    def call(**kwargs): calls.append(kwargs); return response({"output":123})
    mock_model(monkeypatch,call)
    r=client.post(f"/api/v1/assignments/{asn}/llm-assist",json={"nodeId":"node-llm-1","answers":{"summary":"草稿"}},headers=auth["LABELER"])
    assert r.status_code>=400
    payload=json.loads(calls[0]["messages"][1]["content"])
    assert payload["sourceMaterial"]=={"text":"测试题目内容"}
    assert payload["answers"]=={"summary":"草稿"}
    assert payload["schema"]["schemaVersionId"]==ctx["schema_version_id"]
    assert db_session.query(LLMCallLog).filter_by(assignment_id=asn).one().status=="FAILED"
    draft=db_session.query(Draft).filter_by(assignment_id=asn).first()
    assert draft is None or draft.answers_json!={"summary":123}


def test_disabled_config_stops_inflight_result(client,auth,db_session,monkeypatch):
    _,sub,cfg,job=setup_job(client,auth,db_session)
    def call(**kwargs):
        cfg.enabled=False; db_session.commit()
        return response(make_result())
    mock_model(monkeypatch,call)
    _execute_review(db_session,job.id)
    assert sub.status=="NEEDS_HUMAN_REVIEW"
    assert job.status=="FAILED_TO_HUMAN_REVIEW"


def test_missing_prompt_variable_goes_human_without_model(client,auth,db_session,monkeypatch):
    _,sub,_,job=setup_job(client,auth,db_session)
    job.workflow_snapshot_json={**job.workflow_snapshot_json,"promptTemplate":"{{ undefined.value }}"}
    db_session.commit()
    mock_model(monkeypatch,lambda **kw:pytest.fail("缺少模板变量不能调用模型"))
    _execute_review(db_session,job.id)
    assert sub.status=="NEEDS_HUMAN_REVIEW"
