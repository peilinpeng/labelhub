"""关闭或未配置 AI 时，真实提交必须可人工审核，不伪造模型结果。"""
from unittest.mock import patch

import pytest

from app.models.audit import AuditLog
from app.models.llm import LLMCallLog
from app.models.review import AIReviewJob, ReviewConfig, ReviewResult
from tests.helpers import setup_published_task


@pytest.mark.parametrize("disabled_config", [False, True])
def test_manual_only_submit_return_resubmit_preserves_history(client, auth, db_session, disabled_config):
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    task_id = ctx["task_id"]
    if disabled_config:
        db_session.add(ReviewConfig(id="cfg_disabled", task_id=task_id, enabled=False,
            model_policy_id="unused", prompt_template="不得调用", dimensions_json=[],
            thresholds_json={}, conclusion_mapping_json={}, max_retries=0))
        db_session.commit()
    claimed = client.post(f"/api/v1/tasks/{task_id}/claim", json={}, headers=auth["LABELER"])
    assignment = claimed.json()["context"]["assignment"]["id"]
    with patch("app.worker.celery_app.celery_app.send_task") as send:
        first = client.post(f"/api/v1/assignments/{assignment}/submit",
            json={"answers": {"summary": "待修改的原答案"}}, headers=auth["LABELER"])
        assert first.status_code == 201, first.text
        original = first.json()["submission"]
        assert original["status"] == "NEEDS_HUMAN_REVIEW"
        queue = client.get("/api/v1/review/queue", headers=auth["REVIEWER"])
        assert original["id"] in [row["submission"]["id"] for row in queue.json()["items"]]
        denied = client.post(f"/api/v1/review/submissions/{original['id']}/decision",
            json={"stage": "HUMAN_REVIEW", "decision": "PASS", "comments": []}, headers=auth["LABELER"])
        assert denied.status_code == 403
        assert client.post(f"/api/v1/review/submissions/{original['id']}/claim",
            json={}, headers=auth["REVIEWER"]).status_code == 200
        returned = client.post(f"/api/v1/review/submissions/{original['id']}/decision",
            json={"stage": "HUMAN_REVIEW", "decision": "RETURN", "reason": "请补充依据", "comments": []},
            headers=auth["REVIEWER"])
        assert returned.status_code == 200, returned.text
        assert returned.json()["submission"]["status"] == "RETURNED"
        second = client.post(f"/api/v1/assignments/{assignment}/submit",
            json={"answers": {"summary": "修订后有依据的答案"}}, headers=auth["LABELER"])
        assert second.status_code == 201, second.text
        revised = second.json()["submission"]
        assert revised["status"] == "NEEDS_HUMAN_REVIEW"
        assert revised["attemptNo"] == 2 and revised["id"] != original["id"]
        assert client.post(f"/api/v1/review/submissions/{revised['id']}/claim",
            json={}, headers=auth["REVIEWER"]).status_code == 200
        accepted = client.post(f"/api/v1/review/submissions/{revised['id']}/decision",
            json={"stage": "HUMAN_REVIEW", "decision": "PASS", "comments": []}, headers=auth["REVIEWER"])
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["submission"]["status"] == "ACCEPTED"
        send.assert_not_called()
    old = client.get(f"/api/v1/review/submissions/{original['id']}", headers=auth["REVIEWER"]).json()
    assert old["submission"]["answers"] == {"summary": "待修改的原答案"}
    assert old["submission"]["status"] == "RETURNED"
    assert db_session.query(AIReviewJob).count() == 0
    assert db_session.query(LLMCallLog).count() == 0
    assert db_session.query(ReviewResult).filter_by(stage="AI_PRECHECK").count() == 0
    logs = db_session.query(AuditLog).filter_by(action="AI_REVIEW_FAILED_TO_HUMAN").all()
    assert len(logs) == 2
    assert all(log.after_json == {"jobId": None, "reason": "AI 预审未启用，转人工审核"} for log in logs)
