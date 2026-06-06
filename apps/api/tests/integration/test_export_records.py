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
    # finalAnswerHash 基于应用 patch 后的最终答案
    assert passport["finalAnswerHash"] == hash_canonical_json({"summary": "修正后"})


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
