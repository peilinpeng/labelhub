"""集成测试：AI Assist 一键采纳 / 编辑后采纳 / 忽略 的后端闭环 + 审计事件。"""
from uuid import uuid4

from app.models.review import ReviewResult
from app.models.submission import Submission
from app.models.ai_assist import AiAssistAction
from app.models.audit_event import AuditEvent
from tests.helpers import setup_published_task


def _submit(client, auth, db_session, task_id):
    asn = client.post(
        f"/api/v1/tasks/{task_id}/claim", json={}, headers=auth["LABELER"]
    ).json()["context"]["assignment"]["id"]
    sub_id = client.post(
        f"/api/v1/assignments/{asn}/submit",
        json={"answers": {"summary": "原始摘要"}},
        headers=auth["LABELER"],
    ).json()["submission"]["id"]
    return sub_id


def _seed_ai_precheck(db_session, sub_id, schema_version_id, *, field_issues):
    """直接写入一条 AI_PRECHECK ReviewResult（含 fieldIssues），用于派生建议。"""
    rr = ReviewResult(
        id="rev_" + uuid4().hex,
        submission_id=sub_id,
        schema_version_id=schema_version_id,
        stage="AI_PRECHECK",
        decision="NEED_HUMAN_REVIEW",
        result_json={
            "decision": "NEED_HUMAN_REVIEW",
            "totalScore": 60,
            "dimensionScores": [],
            "fieldIssues": field_issues,
            "summary": "需要人工复核",
            "confidence": 0.8,
        },
        actor_id="usr_system",
    )
    db_session.add(rr)
    db_session.commit()


def _setup(client, auth, db_session, *, field_issues):
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    sub_id = _submit(client, auth, db_session, ctx["task_id"])
    _seed_ai_precheck(db_session, sub_id, ctx["schema_version_id"], field_issues=field_issues)
    return sub_id


def test_list_suggestions_derived_from_field_issues(client, auth, db_session):
    sub_id = _setup(
        client, auth, db_session,
        field_issues=[
            {"fieldName": "summary", "severity": "HIGH", "message": "摘要不准确", "suggestion": "修正后的摘要"},
            {"severity": "LOW", "message": "整体可接受"},
        ],
    )
    resp = client.get(
        f"/api/v1/review/submissions/{sub_id}/ai-assist/suggestions",
        headers=auth["REVIEWER"],
    )
    assert resp.status_code == 200, resp.text
    suggestions = resp.json()["suggestions"]
    assert len(suggestions) == 2
    assert suggestions[0]["id"] == f"aas_{sub_id}_0"
    assert suggestions[0]["status"] == "PENDING"
    assert suggestions[0]["structuredPatch"][0]["fieldName"] == "summary"
    # 无 fieldName/suggestion 的 issue 也派生建议，但结构化补丁为空
    assert suggestions[1]["structuredPatch"] == []


def test_accept_applies_patch_and_emits_events(client, auth, db_session):
    sub_id = _setup(
        client, auth, db_session,
        field_issues=[{"fieldName": "summary", "severity": "HIGH", "message": "摘要不准确", "suggestion": "修正后的摘要"}],
    )
    sug_id = f"aas_{sub_id}_0"
    resp = client.post(
        f"/api/v1/review/submissions/{sub_id}/ai-assist/{sug_id}/actions",
        json={"action": "accept"},
        headers=auth["REVIEWER"],
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["suggestion"]["status"] == "ACCEPTED"
    assert body["action"]["patchApplied"] is True
    assert body["action"]["appliedPatchFieldNames"] == ["summary"]
    assert body["auditEventType"] == "AI_ASSIST_ACCEPTED"

    # 补丁真实写入 submission.answers_json
    sub = db_session.query(Submission).filter_by(id=sub_id).first()
    assert sub.answers_json["summary"] == "修正后的摘要"

    # 动作被持久化
    assert db_session.query(AiAssistAction).filter_by(suggestion_id=sug_id).count() == 1
    # 主事件 + patch applied 事件
    assert db_session.query(AuditEvent).filter_by(type="AI_ASSIST_ACCEPTED").count() == 1
    assert db_session.query(AuditEvent).filter_by(type="AI_ASSIST_PATCH_APPLIED").count() == 1


def test_edit_accept_applies_edited_patch(client, auth, db_session):
    sub_id = _setup(
        client, auth, db_session,
        field_issues=[{"fieldName": "summary", "severity": "MEDIUM", "message": "可优化", "suggestion": "AI 版本"}],
    )
    sug_id = f"aas_{sub_id}_0"
    resp = client.post(
        f"/api/v1/review/submissions/{sub_id}/ai-assist/{sug_id}/actions",
        json={"action": "edit_accept", "editedPatch": [{"fieldName": "summary", "nextValue": "审核员手改版本"}], "comment": "微调"},
        headers=auth["REVIEWER"],
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["suggestion"]["status"] == "EDIT_ACCEPTED"
    assert body["auditEventType"] == "AI_ASSIST_EDITED"

    sub = db_session.query(Submission).filter_by(id=sub_id).first()
    assert sub.answers_json["summary"] == "审核员手改版本"
    assert db_session.query(AuditEvent).filter_by(type="AI_ASSIST_EDITED").count() == 1
    assert db_session.query(AuditEvent).filter_by(type="AI_ASSIST_PATCH_APPLIED").count() == 1


def test_dismiss_records_action_no_patch(client, auth, db_session):
    sub_id = _setup(
        client, auth, db_session,
        field_issues=[{"fieldName": "summary", "severity": "LOW", "message": "可忽略", "suggestion": "x"}],
    )
    sug_id = f"aas_{sub_id}_0"
    resp = client.post(
        f"/api/v1/review/submissions/{sub_id}/ai-assist/{sug_id}/actions",
        json={"action": "dismiss", "comment": "与人工判断不符"},
        headers=auth["REVIEWER"],
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["suggestion"]["status"] == "DISMISSED"
    assert resp.json()["auditEventType"] == "AI_ASSIST_DISMISSED"

    sub = db_session.query(Submission).filter_by(id=sub_id).first()
    assert sub.answers_json["summary"] == "原始摘要"  # 未改动
    assert db_session.query(AuditEvent).filter_by(type="AI_ASSIST_DISMISSED").count() == 1
    assert db_session.query(AuditEvent).filter_by(type="AI_ASSIST_PATCH_APPLIED").count() == 0


def test_accept_on_frozen_submission_records_failure_not_silent(client, auth, db_session):
    sub_id = _setup(
        client, auth, db_session,
        field_issues=[{"fieldName": "summary", "severity": "HIGH", "message": "摘要不准确", "suggestion": "修正后的摘要"}],
    )
    # 模拟提交已进入终态（答案冻结）
    sub = db_session.query(Submission).filter_by(id=sub_id).first()
    sub.status = "ACCEPTED"
    db_session.commit()

    sug_id = f"aas_{sub_id}_0"
    resp = client.post(
        f"/api/v1/review/submissions/{sub_id}/ai-assist/{sug_id}/actions",
        json={"action": "accept"},
        headers=auth["REVIEWER"],
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    # 采纳动作仍被保存，但进入 APPLY_FAILED，不静默
    assert body["suggestion"]["status"] == "APPLY_FAILED"
    assert body["action"]["patchApplied"] is False
    assert body["action"]["patchFailureReason"]

    assert db_session.query(AiAssistAction).filter_by(suggestion_id=sug_id).count() == 1
    assert db_session.query(AuditEvent).filter_by(type="AI_ASSIST_ACCEPTED").count() == 1
    assert db_session.query(AuditEvent).filter_by(type="AI_ASSIST_PATCH_FAILED").count() == 1
    # 答案未被改动
    sub2 = db_session.query(Submission).filter_by(id=sub_id).first()
    assert sub2.answers_json["summary"] == "原始摘要"


def test_unknown_suggestion_returns_404(client, auth, db_session):
    sub_id = _setup(
        client, auth, db_session,
        field_issues=[{"fieldName": "summary", "severity": "LOW", "message": "x", "suggestion": "y"}],
    )
    resp = client.post(
        f"/api/v1/review/submissions/{sub_id}/ai-assist/aas_{sub_id}_99/actions",
        json={"action": "accept"},
        headers=auth["REVIEWER"],
    )
    assert resp.status_code == 404, resp.text


def test_invalid_action_returns_422(client, auth, db_session):
    sub_id = _setup(
        client, auth, db_session,
        field_issues=[{"fieldName": "summary", "severity": "LOW", "message": "x", "suggestion": "y"}],
    )
    resp = client.post(
        f"/api/v1/review/submissions/{sub_id}/ai-assist/aas_{sub_id}_0/actions",
        json={"action": "delete_everything"},
        headers=auth["REVIEWER"],
    )
    assert resp.status_code == 422, resp.text
