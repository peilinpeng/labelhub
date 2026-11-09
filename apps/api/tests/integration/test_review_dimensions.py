from copy import deepcopy
from tests.integration.test_ai_workflow import setup_job
from scripts.repair_demo_review_ranges import EXPECTED_KEYS, repair
from app.models.review import ReviewConfig
from app.models.task import Task
from app.services.review_domain import review_dimension_display
import pytest


def test_detail_uses_snapshot_labels_and_legacy_config_without_leaking_prompt(client, auth, db_session):
    _, sub, config, job = setup_job(client, auth, db_session)
    snapshot = deepcopy(job.workflow_snapshot_json)
    config.dimensions_json = [{**config.dimensions_json[0], "label": "更名后的维度"}]
    db_session.commit()
    url = f"/api/v1/review/submissions/{sub.id}"
    response = client.get(url, headers=auth["REVIEWER"])
    assert response.status_code == 200
    assert response.json()["reviewDimensions"] == [{"key": "correctness", "label": "标注正确性"}]
    assert job.workflow_snapshot_json == snapshot
    job.workflow_snapshot_json = None
    db_session.commit()
    assert client.get(url, headers=auth["REVIEWER"]).json()["reviewDimensions"] == [{"key": "correctness", "label": "更名后的维度"}]
    assert client.get(url, headers=auth["LABELER"]).status_code == 403


def test_missing_or_malformed_display_metadata_is_safe():
    from types import SimpleNamespace
    assert review_dimension_display(None, None) == []
    config = SimpleNamespace(dimensions_json=[{"key":"x","label":"现有名称"}])
    job = SimpleNamespace(workflow_snapshot_json={"context":{"dimensions":[None, {"key":"x","label":" "}, {"key":"y","label":" 自定义 "}, {"key":"y","label":"重复"}]}})
    assert review_dimension_display(job, config) == [{"key":"y","label":"自定义"}]
    job.workflow_snapshot_json={"context":{}}
    assert review_dimension_display(job, config) == []


def test_repair_is_atomic_and_does_not_rewrite_other_config_fields(db_session, auth):
    from app.models.user import User
    owner=db_session.query(User).filter_by(role="OWNER").first()
    configs=[]
    for index,(tid,keys) in enumerate(EXPECTED_KEYS.items()):
        db_session.add(Task(id=tid,owner_id=owner.id,title="演示",description="原规范",status="DRAFT",quota_json={"total":10},distribution_strategy_json={},review_policy_json={}))
        db_session.flush()
        config=ReviewConfig(id=f"repair_{index}",task_id=tid,enabled=True,model_policy_id="original",prompt_template="原始规范",
          dimensions_json=[{"key":k,"label":k,"weight":1/len(keys)} for k in sorted(keys)],thresholds_json={"autoPass":.85,"autoReturn":.5},conclusion_mapping_json={"mode":"AI_THEN_HUMAN"},max_retries=2)
        db_session.add(config);configs.append(config)
    db_session.commit()
    original=[deepcopy(c.dimensions_json) for c in configs]
    assert all(r["changed"] for r in repair(db_session))
    assert [c.dimensions_json for c in configs] == original
    configs[-1].thresholds_json={"autoPass":.1,"autoReturn":.5};db_session.commit()
    with pytest.raises(ValueError):repair(db_session,True)
    db_session.rollback()
    assert [c.dimensions_json for c in configs] == original
    configs[-1].thresholds_json={"autoPass":.85,"autoReturn":.5};db_session.commit()
    repair(db_session,True)
    for c in configs:
        assert all(d["scoreRange"]==[0,100] for d in c.dimensions_json)
        assert (c.prompt_template,c.model_policy_id,c.max_retries,c.conclusion_mapping_json)==("原始规范","original",2,{"mode":"AI_THEN_HUMAN"})
    assert not any(r["changed"] for r in repair(db_session,True))


def test_explicit_repair_subset_preserves_other_tasks_and_default_stays_strict(db_session, auth):
    from app.models.user import User
    owner = db_session.query(User).filter_by(role="OWNER").first()
    selected, untouched = list(EXPECTED_KEYS)[:2]
    configs = []
    for index, tid in enumerate((selected, untouched)):
        db_session.add(Task(id=tid, owner_id=owner.id, title="演示", description="保留原数据", status="DRAFT", quota_json={"total":10}, distribution_strategy_json={}, review_policy_json={}))
        db_session.flush()
        keys = sorted(EXPECTED_KEYS[tid])
        config = ReviewConfig(id=f"subset_{index}", task_id=tid, enabled=True, model_policy_id="original", prompt_template="原始规范",
            dimensions_json=[{"key":key,"label":key,"weight":1/len(keys)} for key in keys], thresholds_json={"autoPass":.85,"autoReturn":.5}, conclusion_mapping_json={"mode":"AI_THEN_HUMAN"}, max_retries=2)
        db_session.add(config)
        configs.append(config)
    db_session.commit()
    original = [deepcopy(c.dimensions_json) for c in configs]
    # 缺少第三份配置时默认仍失败，不静默跳过。
    for targets in (None, [], ["unknown"], [list(EXPECTED_KEYS)[2]]):
        with pytest.raises(ValueError):
            repair(db_session, True, targets)
        db_session.rollback()
        assert [c.dimensions_json for c in configs] == original
    preview = repair(db_session, task_ids=[selected])
    assert len(preview) == 1 and preview[0]["taskId"] == selected and preview[0]["changed"]
    assert [c.dimensions_json for c in configs] == original
    repair(db_session, True, [selected])
    assert configs[0].dimensions_json == [{**d,"scoreRange":[0,100]} for d in original[0]]
    assert configs[1].dimensions_json == original[1]
    assert configs[0].prompt_template == "原始规范"
    assert not repair(db_session, True, [selected])[0]["changed"]
