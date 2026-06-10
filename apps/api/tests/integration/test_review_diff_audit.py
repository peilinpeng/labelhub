"""集成测试：reviewer 带 patches 决策 → 写 REVIEW_DIFF_GENERATED 审计事件（E3）。"""
from app.models.submission import Submission
from app.models.audit_event import AuditEvent
from tests.helpers import setup_published_task


def _claim_submit_to_review(client, auth, db_session, task_id):
    asn = client.post(f"/api/v1/tasks/{task_id}/claim", json={}, headers=auth["LABELER"]).json()["context"]["assignment"]["id"]
    sub_id = client.post(
        f"/api/v1/assignments/{asn}/submit",
        json={"answers": {"summary": "原始答案"}},
        headers=auth["LABELER"],
    ).json()["submission"]["id"]
    sub = db_session.query(Submission).filter_by(id=sub_id).first()
    sub.status = "NEEDS_HUMAN_REVIEW"
    db_session.commit()
    client.post(f"/api/v1/review/submissions/{sub_id}/claim", json={}, headers=auth["REVIEWER"])
    return sub_id


def test_decision_with_patches_emits_diff_event(client, auth, db_session):
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    sub_id = _claim_submit_to_review(client, auth, db_session, ctx["task_id"])

    resp = client.post(
        f"/api/v1/review/submissions/{sub_id}/decision",
        json={
            "stage": "HUMAN_REVIEW", "decision": "PASS", "comments": [],
            "patches": [{"fieldName": "summary", "previousValue": "原始答案",
                         "nextValue": "审核修正后", "reason": "更准确"}],
        },
        headers=auth["REVIEWER"],
    )
    assert resp.status_code in (200, 201), resp.text

    ev = (
        db_session.query(AuditEvent)
        .filter_by(type="REVIEW_DIFF_GENERATED")
        .first()
    )
    assert ev is not None
    p = ev.payload_json
    assert p["submissionId"] == sub_id
    assert p["patchCount"] == 1
    assert p["patchedFieldNames"] == ["summary"]
    assert p["decision"] == "APPROVED_WITH_CHANGES"
    assert p["beforeAnswerHash"] != p["afterAnswerHash"]   # 答案确实变了
    assert len(p["diffSummaryHash"]) == 64


def test_decision_without_patches_no_diff_event(client, auth, db_session):
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    sub_id = _claim_submit_to_review(client, auth, db_session, ctx["task_id"])
    client.post(
        f"/api/v1/review/submissions/{sub_id}/decision",
        json={"stage": "HUMAN_REVIEW", "decision": "PASS", "comments": []},
        headers=auth["REVIEWER"],
    )
    assert db_session.query(AuditEvent).filter_by(type="REVIEW_DIFF_GENERATED").count() == 0
