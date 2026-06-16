"""集成测试：DataQualityPassport + export records（E4）。"""
from app.models.submission import Submission
from app.models.review import ReviewResult
from app.models.export import ExportJob
from app.models.export_record import ExportRecord
from app.services import export_domain
from app.services.export_domain import build_passport, compute_passport_batch_hash
from app.utils.hashing import hash_canonical_json
from tests.helpers import setup_published_task
from uuid import uuid4


def _make_accepted_submission(client, auth, db_session, task_id, answers):
    asn = client.post(f"/api/v1/tasks/{task_id}/claim", json={}, headers=auth["LABELER"]).json()["context"]["assignment"]["id"]
    sub_id = client.post(
        f"/api/v1/assignments/{asn}/submit", json={"answers": answers}, headers=auth["LABELER"],
    ).json()["submission"]["id"]
    sub = db_session.query(Submission).filter_by(id=sub_id).first()
    sub.status = "ACCEPTED"
    db_session.commit()
    return sub


def test_build_passport_basic(client, auth, db_session):
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    sub = _make_accepted_submission(client, auth, db_session, ctx["task_id"], {"summary": "ans"})

    passport = build_passport(db_session, sub)
    assert passport["submissionId"] == sub.id
    assert passport["reviewStatus"] == "APPROVED"
    assert passport["answerHashAlgorithm"] == "canonical-json-v1+SHA-256"
    assert passport["finalAnswerHash"] == hash_canonical_json({"summary": "ans"})
    assert passport["reviewerPatchCount"] == 0
    assert passport["changedFieldNames"] == []


def test_build_passport_audit_event_count(client, auth, db_session):
    """auditEventCount 取合规账本 audit_logs 中本提交的治理动作数，且与直查一致（不再恒为 0）。"""
    from app.models.audit import AuditLog

    ctx = setup_published_task(client, db_session, auth["OWNER"])
    sub = _make_accepted_submission(client, auth, db_session, ctx["task_id"], {"summary": "ans"})

    expected = (
        db_session.query(AuditLog)
        .filter_by(entity_type="SUBMISSION", entity_id=sub.id)
        .count()
    )
    passport = build_passport(db_session, sub)
    # 经过 claim+submit 的真实链路至少写了 SUBMISSION_CREATED / AI_REVIEW_ENQUEUED 等审计
    assert expected >= 1
    assert passport["auditEventCount"] == expected


def test_build_passport_with_reviewer_patches(client, auth, db_session):
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    sub = _make_accepted_submission(client, auth, db_session, ctx["task_id"], {"summary": "原始"})
    # 追加一条带 patch 的 HUMAN_REVIEW 结果
    db_session.add(ReviewResult(
        id="rev_" + uuid4().hex, submission_id=sub.id, schema_version_id=sub.schema_version_id,
        stage="HUMAN_REVIEW", decision="PASS",
        result_json={"patches": [{"fieldName": "summary", "nextValue": "修正后"}]},
        actor_id="usr_reviewer_1",
    ))
    db_session.commit()

    passport = build_passport(db_session, sub)
    assert passport["reviewerPatchCount"] == 1
    assert passport["changedFieldNames"] == ["summary"]
    # 直接调用未传 exported_answers → 回退到应用 patch 后的最终答案
    assert passport["finalAnswerHash"] == hash_canonical_json({"summary": "修正后"})


def test_passport_hash_respects_answer_source(client, auth, db_session):
    """方案A 回归：finalAnswerHash 必须对“实际导出的那份答案”取，而非恒为补丁后答案。
    ORIGINAL 导出 → 指纹=原始答案；PATCHED 导出 → 指纹=补丁后答案。"""
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    sub = _make_accepted_submission(client, auth, db_session, ctx["task_id"], {"summary": "原始"})
    db_session.add(ReviewResult(
        id="rev_" + uuid4().hex, submission_id=sub.id, schema_version_id=sub.schema_version_id,
        stage="HUMAN_REVIEW", decision="PASS",
        result_json={"patches": [{"fieldName": "summary", "nextValue": "修正后"}]},
        actor_id="usr_reviewer_1",
    ))
    db_session.commit()

    original = {"summary": "原始"}
    patched = {"summary": "修正后"}
    # ORIGINAL 导出：指纹对原始答案（修复前这里会错误地等于补丁后答案）
    p_original = build_passport(db_session, sub, exported_answers=original)
    assert p_original["finalAnswerHash"] == hash_canonical_json(original)
    # PATCHED 导出：指纹对补丁后答案
    p_patched = build_passport(db_session, sub, exported_answers=patched)
    assert p_patched["finalAnswerHash"] == hash_canonical_json(patched)
    # patch 元信息与 answerSource 无关，两种导出都如实反映审核改动
    assert p_original["reviewerPatchCount"] == p_patched["reviewerPatchCount"] == 1
    assert p_original["changedFieldNames"] == ["summary"]


def test_passport_ai_assist_counts(client, auth, db_session):
    """aiAccepted/Edited/Dismissed 来自 ai_assist_actions；aiAssistUsed 只在被采纳/改采纳时为真。"""
    from app.models.ai_assist import AiAssistAction

    ctx = setup_published_task(client, db_session, auth["OWNER"])
    sub = _make_accepted_submission(client, auth, db_session, ctx["task_id"], {"summary": "ans"})

    # 只 dismiss → 看了但没用，aiAssistUsed 应为 False
    db_session.add(AiAssistAction(
        id="aaa_" + uuid4().hex, suggestion_id="aas_x_0", submission_id=sub.id,
        action="dismiss", resulting_status="DISMISSED", actor_json={"id": "usr_reviewer_1"},
    ))
    db_session.commit()
    p = build_passport(db_session, sub)
    assert p["aiDismissedCount"] == 1
    assert p["aiAcceptedCount"] == 0 and p["aiEditedCount"] == 0
    assert p["aiAssistUsed"] is False

    # 再加一条 accept → 真正影响了答案，aiAssistUsed 翻 True
    db_session.add(AiAssistAction(
        id="aaa_" + uuid4().hex, suggestion_id="aas_x_1", submission_id=sub.id,
        action="accept", resulting_status="ACCEPTED", actor_json={"id": "usr_reviewer_1"},
    ))
    db_session.commit()
    p2 = build_passport(db_session, sub)
    assert p2["aiAcceptedCount"] == 1 and p2["aiDismissedCount"] == 1
    assert p2["aiAssistUsed"] is True
    # qualityLedgerRef 带上 AI 辅助动作事件 id（契约对齐）
    assert len(p2["qualityLedgerRef"]["aiAssistEventIds"]) == 2


def test_batch_hash_order_independent(db_session):
    p1 = {"submissionId": "sub_b", "finalAnswerHash": "h2"}
    p2 = {"submissionId": "sub_a", "finalAnswerHash": "h1"}
    assert compute_passport_batch_hash([p1, p2]) == compute_passport_batch_hash([p2, p1])


def test_get_export_records_endpoint(client, auth, db_session):
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    sub = _make_accepted_submission(client, auth, db_session, ctx["task_id"], {"summary": "ans"})
    passport = build_passport(db_session, sub)

    job_id = "exp_" + uuid4().hex
    db_session.add(ExportJob(
        id=job_id, task_id=ctx["task_id"], schema_version_id=ctx["schema_version_id"],
        status="SUCCEEDED", mapping_json={"format": "JSON"},
        progress_total=1, progress_done=1, created_by="usr_owner_1",
        artifact_summary_json={
            "exportId": job_id, "taskId": ctx["task_id"], "format": "JSON",
            "recordCount": 1, "warningCount": 0, "passportCount": 1,
            "passportBatchHash": compute_passport_batch_hash([passport]),
        },
    ))
    db_session.add(ExportRecord(
        id="erec_" + uuid4().hex, export_job_id=job_id, submission_id=sub.id,
        schema_version_id=sub.schema_version_id, record_index=0,
        data_json={"summary": "ans"}, passport_json=passport,
    ))
    db_session.commit()

    resp = client.get(f"/api/v1/exports/{job_id}/records", headers=auth["OWNER"])
    assert resp.status_code == 200, resp.text
    d = resp.json()
    assert d["exportId"] == job_id
    assert len(d["records"]) == 1
    rec = d["records"][0]
    assert rec["submissionId"] == sub.id
    assert rec["passport"]["reviewStatus"] == "APPROVED"
    assert d["artifactSummary"]["passportCount"] == 1
    assert len(d["artifactSummary"]["passportBatchHash"]) == 64


def test_get_export_records_not_found(client, auth):
    assert client.get("/api/v1/exports/exp_ghost/records", headers=auth["OWNER"]).status_code == 404


# ---------------------------------------------------------------------------
# 导出字段映射校验（sourcePath 必须是 RuntimeContext 命名空间）
# ---------------------------------------------------------------------------
def test_validate_mapping_accepts_runtimecontext_paths():
    """命名空间根（$.answers 整对象）与具体路径（$.item.id）都应通过。"""
    export_domain._validate_mapping({
        "format": "JSONL",
        "columns": [
            {"sourcePath": "$.item.id"},
            {"sourcePath": "$.item.sourcePayload"},
            {"sourcePath": "$.answers"},
            {"sourcePath": "$.review.latestDecision"},
        ],
    })


def test_validate_mapping_rejects_non_namespace_path():
    """无 $. 前缀或非法命名空间（如旧的 item.id / submission.answers）应被拒。"""
    import pytest
    from app.middleware.error_handler import ExportMappingInvalidException
    for bad in ("item.id", "submission.answers", "submission.status", "$.unknown.x"):
        with pytest.raises(ExportMappingInvalidException):
            export_domain._validate_mapping({"format": "JSONL", "columns": [{"sourcePath": bad}]})
