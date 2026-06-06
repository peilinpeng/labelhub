"""集成测试：审核流转（TC-REV-05~09，含 A3 队列筛选 / B2 AI 可追溯）。"""
from datetime import datetime, timezone
from uuid import uuid4

from app.models.submission import Submission
from app.models.llm import LLMCallLog
from tests.helpers import setup_published_task


def _claim_and_submit(client, auth, db_session, task_id):
    """领取 + 提交，返回 submission_id，并把状态置为 NEEDS_HUMAN_REVIEW（绕过 AI worker）。"""
    r_claim = client.post(f"/api/v1/tasks/{task_id}/claim", json={}, headers=auth["LABELER"])
    asn_id = r_claim.json()["context"]["assignment"]["id"]
    r_submit = client.post(
        f"/api/v1/assignments/{asn_id}/submit",
        json={"answers": {"summary": "答案"}},
        headers=auth["LABELER"],
    )
    sub_id = r_submit.json()["submission"]["id"]
    sub = db_session.query(Submission).filter_by(id=sub_id).first()
    sub.status = "NEEDS_HUMAN_REVIEW"
    db_session.commit()
    return sub_id


def test_review_queue_contains_submission(client, auth, db_session):
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    sub_id = _claim_and_submit(client, auth, db_session, ctx["task_id"])
    resp = client.get("/api/v1/review/queue", headers=auth["REVIEWER"])
    assert resp.status_code == 200
    ids = [i["submission"]["id"] for i in resp.json()["items"]]
    assert sub_id in ids


def test_review_queue_status_filter(client, auth, db_session):
    """A3：?status= 精确筛选。"""
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    sub_id = _claim_and_submit(client, auth, db_session, ctx["task_id"])

    r_hit = client.get("/api/v1/review/queue?status=NEEDS_HUMAN_REVIEW", headers=auth["REVIEWER"])
    assert sub_id in [i["submission"]["id"] for i in r_hit.json()["items"]]

    r_other = client.get("/api/v1/review/queue?status=ACCEPTED", headers=auth["REVIEWER"])
    assert sub_id not in [i["submission"]["id"] for i in r_other.json()["items"]]


def test_review_queue_invalid_status_422(client, auth):
    resp = client.get("/api/v1/review/queue?status=BOGUS", headers=auth["REVIEWER"])
    assert resp.status_code == 422


def test_claim_and_pass_decision(client, auth, db_session):
    """TC-REV-05：领取 → 通过 → ACCEPTED。"""
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    sub_id = _claim_and_submit(client, auth, db_session, ctx["task_id"])

    r_claim = client.post(
        f"/api/v1/review/submissions/{sub_id}/claim", json={}, headers=auth["REVIEWER"],
    )
    assert r_claim.status_code in (200, 201)
    assert r_claim.json()["submission"]["status"] == "HUMAN_REVIEWING"

    r_dec = client.post(
        f"/api/v1/review/submissions/{sub_id}/decision",
        json={"stage": "HUMAN_REVIEW", "decision": "PASS", "comments": []},
        headers=auth["REVIEWER"],
    )
    assert r_dec.status_code in (200, 201)
    assert r_dec.json()["reviewResult"]["decision"] == "PASS"
    assert r_dec.json()["submission"]["status"] == "ACCEPTED"


def test_reviewer_decision_completes_item(client, auth, db_session):
    """TC-FULL-01 片段：通过后题目状态 → COMPLETED。"""
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    sub_id = _claim_and_submit(client, auth, db_session, ctx["task_id"])
    client.post(f"/api/v1/review/submissions/{sub_id}/claim", json={}, headers=auth["REVIEWER"])
    client.post(
        f"/api/v1/review/submissions/{sub_id}/decision",
        json={"stage": "HUMAN_REVIEW", "decision": "PASS", "comments": []},
        headers=auth["REVIEWER"],
    )
    resp = client.get(f"/api/v1/tasks/{ctx['task_id']}/items", headers=auth["OWNER"])
    statuses = {i["id"]: i["status"] for i in resp.json()["items"]}
    assert "COMPLETED" in statuses.values()


# ---------------------------------------------------------------------------
# B2：审核详情暴露 AI 可追溯信息
# ---------------------------------------------------------------------------
def test_review_detail_exposes_ai_trace(client, auth, db_session):
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    sub_id = _claim_and_submit(client, auth, db_session, ctx["task_id"])

    # 注入一条 AI_REVIEW LLMCallLog（dev 无 DOUBAO key，真实预审跑不了）
    log = LLMCallLog(
        id="llm_" + uuid4().hex,
        purpose="AI_REVIEW",
        actor_id="usr_owner_1",
        submission_id=sub_id,
        model_policy_id="mp_doubao_pro",
        prompt_snapshot_hash="hash_abc",
        input_hash="hash_in",
        output_hash="hash_out",
        status="SUCCEEDED",
        prompt_tokens=120, completion_tokens=80, total_tokens=200, latency_ms=1532,
        finished_at=datetime.now(timezone.utc),
    )
    db_session.add(log)
    db_session.commit()

    resp = client.get(f"/api/v1/review/submissions/{sub_id}", headers=auth["REVIEWER"])
    assert resp.status_code == 200
    trace = resp.json()["aiTrace"]
    assert trace is not None
    assert trace["totalTokens"] == 200
    assert trace["latencyMs"] == 1532
    assert trace["modelPolicyId"] == "mp_doubao_pro"
    assert trace["promptSnapshotHash"] == "hash_abc"


def test_review_detail_ai_trace_null_when_absent(client, auth, db_session):
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    sub_id = _claim_and_submit(client, auth, db_session, ctx["task_id"])
    resp = client.get(f"/api/v1/review/submissions/{sub_id}", headers=auth["REVIEWER"])
    assert resp.status_code == 200
    assert resp.json()["aiTrace"] is None
