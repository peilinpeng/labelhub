"""单元测试：绩效看板聚合 analytics_domain.get_dashboard + 端点角色门控。

构造最小数据：1 任务、2 标注员、3 提交（含 AI 预审 + 人工终判）、若干 LLM 调用日志，
断言三块聚合口径（AI 成本 / Labeler 效能 / AI-人工一致率）符合约定。
"""
from app.models.user import User
from app.models.submission import Submission
from app.models.review import ReviewResult
from app.models.llm import LLMCallLog
from app.services import analytics_domain


def _sub(db, sub_id, labeler_id, status):
    db.add(Submission(
        id=sub_id, assignment_id=f"asn_{sub_id}", task_id="task_a", item_id=f"item_{sub_id}",
        labeler_id=labeler_id, schema_version_id="sv_a", attempt_no=1,
        answers_json={}, status=status, validation_json={},
    ))


def _rr(db, rid, sub_id, stage, decision, result_json):
    db.add(ReviewResult(
        id=rid, submission_id=sub_id, schema_version_id="sv_a",
        stage=stage, decision=decision, result_json=result_json, actor_id="usr_sys",
    ))


def _llm(db, lid, purpose, status, *, tokens=None, latency=None, submission_id=None, assignment_id=None):
    db.add(LLMCallLog(
        id=lid, purpose=purpose, actor_id="usr_sys", model_policy_id="m1",
        prompt_snapshot_hash="h", input_hash="h", status=status,
        total_tokens=tokens, latency_ms=latency,
        submission_id=submission_id, assignment_id=assignment_id,
    ))


def _seed(db):
    # 不建 Task 行：None-scope 不查 Task 表，且 sqlite 不强制 FK，提交直接挂 task_a 即可。
    db.add(User(id="usr_l1", email="l1@t.local", hashed_password="x", display_name="标注员一", role="LABELER", status="ACTIVE"))
    db.add(User(id="usr_l2", email="l2@t.local", hashed_password="x", display_name="标注员二", role="LABELER", status="ACTIVE"))

    # L1: s1 通过、s2 打回；L2: s3 审核中
    _sub(db, "sub1", "usr_l1", "ACCEPTED")
    _sub(db, "sub2", "usr_l1", "RETURNED")
    _sub(db, "sub3", "usr_l2", "NEEDS_HUMAN_REVIEW")

    # AI 原始预审（AI_PRECHECK）
    _rr(db, "rev1", "sub1", "AI_PRECHECK", "PASS", {"totalScore": 90})
    _rr(db, "rev2", "sub2", "AI_PRECHECK", "RETURN", {"totalScore": 30})
    _rr(db, "rev3", "sub3", "AI_PRECHECK", "NEED_HUMAN_REVIEW", {"totalScore": 60})

    # 人工终判：sub1 AI PASS↔人工 PASS（一致）；sub2 AI RETURN↔人工 PASS（不一致）
    _rr(db, "h1", "sub1", "HUMAN_REVIEW", "PASS", {"patches": [{"fieldName": "a"}, {"fieldName": "b"}]})
    _rr(db, "h2", "sub2", "HUMAN_REVIEW", "PASS", {"patches": []})

    # LLM 调用日志
    _llm(db, "llm1", "AI_REVIEW", "SUCCEEDED", tokens=100, latency=200, submission_id="sub1")
    _llm(db, "llm2", "LLM_ASSIST", "SUCCEEDED", tokens=50, latency=120, assignment_id="asn_sub1")
    _llm(db, "llm3", "SCHEMA_GENERATION", "SUCCEEDED", tokens=200, latency=300)
    _llm(db, "llm4", "SCHEMA_GENERATION", "FAILED")  # 失败、无 token
    db.commit()


def test_ai_cost_aggregation(db_session):
    _seed(db_session)
    data = analytics_domain.get_dashboard(db_session, None)
    cost = data["aiCost"]
    by = {row["purpose"]: row for row in cost["byPurpose"]}

    assert by["AI_REVIEW"]["calls"] == 1
    assert by["AI_REVIEW"]["totalTokens"] == 100
    assert by["LLM_ASSIST"]["totalTokens"] == 50
    # SCHEMA_GENERATION：2 次调用，1 成功 1 失败 → failureRate 0.5；token 仅成功那条计入
    assert by["SCHEMA_GENERATION"]["calls"] == 2
    assert by["SCHEMA_GENERATION"]["failed"] == 1
    assert by["SCHEMA_GENERATION"]["failureRate"] == 0.5
    assert by["SCHEMA_GENERATION"]["totalTokens"] == 200
    assert by["SCHEMA_GENERATION"]["tokenCoverage"] == 0.5  # 2 次里 1 次有 token
    assert cost["totalTokens"] == 350
    assert cost["totalCalls"] == 4


def test_labeler_effectiveness(db_session):
    _seed(db_session)
    data = analytics_domain.get_dashboard(db_session, None)
    rows = {r["labelerId"]: r for r in data["labelers"]}

    l1 = rows["usr_l1"]
    assert l1["displayName"] == "标注员一"
    assert l1["submitted"] == 2
    assert l1["accepted"] == 1 and l1["returned"] == 1
    assert l1["acceptRate"] == 0.5
    assert l1["avgAiScore"] == 60.0          # (90 + 30) / 2
    assert l1["reviewerPatchedFields"] == 2  # sub1 改了 2 个字段

    l2 = rows["usr_l2"]
    assert l2["submitted"] == 1 and l2["inReview"] == 1
    assert l2["acceptRate"] is None          # 无终态提交


def test_ai_human_agreement(db_session):
    _seed(db_session)
    q = analytics_domain.get_dashboard(db_session, None)["aiQuality"]
    assert q["aiRawTotal"] == 3
    assert q["byRawDecision"] == {"PASS": 1, "RETURN": 1, "NEED_HUMAN_REVIEW": 1}
    assert q["humanReviewRate"] == round(1 / 3, 4)
    # 仅 sub1(PASS) / sub2(RETURN) 进入一致率统计：sub1 一致、sub2 不一致 → 1/2
    assert q["evaluated"] == 2
    assert q["agreements"] == 1
    assert q["agreementRate"] == 0.5


def test_empty_task_scope(db_session):
    _seed(db_session)
    data = analytics_domain.get_dashboard(db_session, "task_nonexistent")
    assert data["labelers"] == []
    assert data["aiQuality"]["aiRawTotal"] == 0
    assert data["aiQuality"]["agreementRate"] is None


def test_endpoint_role_gating(client, auth):
    # OWNER 可访问
    r_owner = client.get("/api/v1/analytics/dashboard", headers=auth["OWNER"])
    assert r_owner.status_code == 200
    body = r_owner.json()
    assert "aiCost" in body and "labelers" in body and "aiQuality" in body
    # LABELER 无权
    r_labeler = client.get("/api/v1/analytics/dashboard", headers=auth["LABELER"])
    assert r_labeler.status_code == 403
