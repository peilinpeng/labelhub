"""集成测试：AI 预审 vs 人工最终决策一致性指标（P1）。

构造已知的 AI / 人工决策组合，验证一致率、混淆矩阵、abstain 统计与端点鉴权。
测试 SQLite 不强制外键，直接插 Submission + ReviewResult，避免「一人对一任务只能领一次」的限制。
"""
from uuid import uuid4

from app.models.review import ReviewResult
from app.models.submission import Submission

_TASK = "task_agreement_test"


def _mk_submission(db_session, idx) -> str:
    sub_id = f"sub_agg_{idx}_{uuid4().hex[:8]}"
    db_session.add(Submission(
        id=sub_id,
        assignment_id=f"asn_agg_{idx}_{uuid4().hex[:8]}",
        task_id=_TASK,
        item_id=f"item_agg_{idx}",
        labeler_id="usr_labeler_1",
        schema_version_id="sv_agg",
        answers_json={},
        validation_json={},
        status="ACCEPTED",
    ))
    db_session.commit()
    return sub_id


def _add_result(db_session, sub_id, stage, decision):
    db_session.add(ReviewResult(
        id="rev_" + uuid4().hex,
        submission_id=sub_id,
        schema_version_id="sv_agg",
        stage=stage,
        decision=decision,
        result_json={},
        actor_id="usr_owner_1",
    ))
    db_session.commit()


def _seed(db_session, combos):
    for idx, (ai_dec, human_dec) in enumerate(combos):
        sub_id = _mk_submission(db_session, idx)
        _add_result(db_session, sub_id, "AI_PRECHECK", ai_dec)
        if human_dec is not None:
            _add_result(db_session, sub_id, "HUMAN_REVIEW", human_dec)


def test_agreement_metrics(client, auth, db_session):
    # sub0 AI PASS/人工 PASS→一致；sub1 AI PASS/人工 RETURN→不一致；
    # sub2 AI RETURN/人工 RETURN→一致；sub3 AI NEED_HUMAN_REVIEW/人工 PASS→abstain（不计入）
    _seed(db_session, [
        ("PASS", "PASS"),
        ("PASS", "RETURN"),
        ("RETURN", "RETURN"),
        ("NEED_HUMAN_REVIEW", "PASS"),
    ])

    resp = client.get(f"/api/v1/review/agreement?taskId={_TASK}", headers=auth["OWNER"])
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["evaluated"] == 3
    assert body["agreementCount"] == 2
    assert body["agreementRate"] == 0.6667
    assert body["aiAbstain"] == 1
    assert body["confusion"] == {
        "aiPassHumanPass": 1,
        "aiPassHumanReturn": 1,
        "aiReturnHumanPass": 0,
        "aiReturnHumanReturn": 1,
    }


def test_agreement_excludes_ai_only_submissions(client, auth, db_session):
    # 只有 AI 预审、还没人工决策的提交不计入（human=None）。
    _seed(db_session, [("PASS", None), ("RETURN", None)])
    resp = client.get(f"/api/v1/review/agreement?taskId={_TASK}", headers=auth["OWNER"])
    body = resp.json()
    assert body["evaluated"] == 0
    assert body["agreementRate"] is None
    assert body["submissionsConsidered"] == 2


def test_agreement_empty_task_returns_null_rate(client, auth, db_session):
    resp = client.get("/api/v1/review/agreement?taskId=task_nonexistent", headers=auth["OWNER"])
    assert resp.status_code == 200
    body = resp.json()
    assert body["evaluated"] == 0
    assert body["agreementRate"] is None
    assert body["aiAbstain"] == 0


def test_agreement_requires_auth(client):
    assert client.get("/api/v1/review/agreement").status_code == 401
