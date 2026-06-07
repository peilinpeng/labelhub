"""集成测试：审核流转（TC-REV-05~09，含 A3 队列筛选 / B2 AI 可追溯）。"""
import hashlib
from datetime import datetime, timezone
from uuid import uuid4

from app.models.submission import Submission
from app.models.llm import LLMCallLog
from app.models.review import ReviewConfig, AIReviewJob
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


# ---------------------------------------------------------------------------
# O8（§4.4）：审核详情附带原始 Prompt 原文 + 快照一致性标记
# ---------------------------------------------------------------------------
def _make_review_config(db_session, task_id: str, prompt_template: str) -> None:
    cfg = ReviewConfig(
        id="rc_" + uuid4().hex,
        task_id=task_id,
        enabled=True,
        model_policy_id="mp_doubao_pro",
        prompt_template=prompt_template,
        dimensions_json=[],
        thresholds_json={},
        conclusion_mapping_json={},
        max_retries=3,
    )
    db_session.add(cfg)
    db_session.commit()


def _inject_ai_trace(db_session, sub_id: str, prompt_snapshot_hash: str) -> None:
    """注入 AI_REVIEW LLMCallLog。生产里其 prompt_snapshot_hash 是_渲染后_ prompt 的
    哈希（含变量替换），与模板原文不同维度——故漂移判定不能用它，见 _inject_ai_job。"""
    log = LLMCallLog(
        id="llm_" + uuid4().hex,
        purpose="AI_REVIEW",
        actor_id="usr_owner_1",
        submission_id=sub_id,
        model_policy_id="mp_doubao_pro",
        prompt_snapshot_hash=prompt_snapshot_hash,
        input_hash="hash_in",
        output_hash="hash_out",
        status="SUCCEEDED",
        prompt_tokens=120, completion_tokens=80, total_tokens=200, latency_ms=1532,
        finished_at=datetime.now(timezone.utc),
    )
    db_session.add(log)
    db_session.commit()


def _inject_ai_job(db_session, sub_id: str, prompt_snapshot_hash: str) -> None:
    """注入本次调用对应的 AIReviewJob：prompt_snapshot_hash = 调用时 Prompt 模板原文
    的 SHA-256，是漂移判定的正确基准（raw-vs-raw）。"""
    sub = db_session.query(Submission).filter_by(id=sub_id).first()
    job = AIReviewJob(
        id="job_" + uuid4().hex,
        submission_id=sub_id,
        attempt_no=sub.attempt_no,
        schema_version_id=sub.schema_version_id,
        status="SUCCEEDED",
        retry_count=0,
        max_retries=3,
        idempotency_key=f"{sub_id}:{sub.attempt_no}",
        prompt_snapshot_hash=prompt_snapshot_hash,
        model_snapshot_json={"provider": "doubao", "model": "ep", "responseFormat": "JSON_SCHEMA"},
    )
    db_session.add(job)
    db_session.commit()


def test_review_detail_exposes_prompt_template_with_matching_snapshot(client, auth, db_session):
    """§4.4：aiTrace 附原始 Prompt 原文；当前模板原文 hash 与调用快照一致时 matches=True。

    刻意让 LLMCallLog 存一个_不同于_模板原文 hash 的"渲染后"哈希，证明漂移判定用的是
    AIReviewJob（模板原文 hash）而非 LLMCallLog（渲染后 hash）。"""
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    sub_id = _claim_and_submit(client, auth, db_session, ctx["task_id"])

    prompt = "请审核以下标注答案：{{answer}}"
    _make_review_config(db_session, ctx["task_id"], prompt)
    raw_hash = hashlib.sha256(prompt.encode()).hexdigest()
    _inject_ai_trace(db_session, sub_id, "rendered_hash_differs_from_template")
    _inject_ai_job(db_session, sub_id, raw_hash)

    resp = client.get(f"/api/v1/review/submissions/{sub_id}", headers=auth["REVIEWER"])
    assert resp.status_code == 200
    trace = resp.json()["aiTrace"]
    assert trace["promptTemplate"] == prompt
    assert trace["promptSnapshotMatches"] is True


def test_review_detail_prompt_snapshot_drift_flagged(client, auth, db_session):
    """Owner 调用后改过 Prompt：原文仍展示，但 matches=False 提示漂移。"""
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    sub_id = _claim_and_submit(client, auth, db_session, ctx["task_id"])

    _make_review_config(db_session, ctx["task_id"], "改动后的新 Prompt")
    _inject_ai_trace(db_session, sub_id, "rendered_hash_whatever")
    # 调用时模板原文是「原始旧 Prompt」，其 hash 与当前「改动后的新 Prompt」不一致 → 漂移
    old_raw_hash = hashlib.sha256("原始旧 Prompt".encode()).hexdigest()
    _inject_ai_job(db_session, sub_id, old_raw_hash)

    resp = client.get(f"/api/v1/review/submissions/{sub_id}", headers=auth["REVIEWER"])
    trace = resp.json()["aiTrace"]
    assert trace["promptTemplate"] == "改动后的新 Prompt"
    assert trace["promptSnapshotMatches"] is False


def test_review_detail_prompt_snapshot_matches_none_without_job(client, auth, db_session):
    """有 ReviewConfig 但无对应 AIReviewJob（旧数据）：无法判定漂移，matches=None。"""
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    sub_id = _claim_and_submit(client, auth, db_session, ctx["task_id"])

    prompt = "请审核以下标注答案：{{answer}}"
    _make_review_config(db_session, ctx["task_id"], prompt)
    _inject_ai_trace(db_session, sub_id, "rendered_hash_only")  # 无 _inject_ai_job

    resp = client.get(f"/api/v1/review/submissions/{sub_id}", headers=auth["REVIEWER"])
    trace = resp.json()["aiTrace"]
    assert trace["promptTemplate"] == prompt
    assert trace["promptSnapshotMatches"] is None


def test_review_detail_prompt_template_null_without_config(client, auth, db_session):
    """无 ReviewConfig 时原文为 None、matches 为 None（向后兼容旧 trace）。"""
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    sub_id = _claim_and_submit(client, auth, db_session, ctx["task_id"])
    _inject_ai_trace(db_session, sub_id, "hash_abc")

    resp = client.get(f"/api/v1/review/submissions/{sub_id}", headers=auth["REVIEWER"])
    trace = resp.json()["aiTrace"]
    assert trace["promptTemplate"] is None
    assert trace["promptSnapshotMatches"] is None
