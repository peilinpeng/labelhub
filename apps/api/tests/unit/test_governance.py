"""真实共享引擎 + SQLite 验证审批、冲突、幂等投递与不可变历史。"""
from copy import deepcopy
import json
import pytest
from app.models.governance import MigrationJob, MigrationRecord, TaskPermissionGrant
from app.models.submission import Submission
from app.models.audit import AuditLog
from app.services.migration_domain import execute_job
from tests.helpers import create_task, publish_schema, add_item


@pytest.fixture
def migration_case(client, db_session, auth, users, monkeypatch):
    monkeypatch.setattr("app.worker.migration_worker.enqueue", lambda job_id: True)
    task_id = create_task(client, auth["OWNER"])["id"]
    source = publish_schema(client, auth["OWNER"], task_id)
    target = publish_schema(client, auth["OWNER"], task_id)
    item_id = add_item(db_session, task_id)
    submission = Submission(id="sub_migrate", assignment_id="asn_migrate", task_id=task_id, item_id=item_id,
                            labeler_id=users["LABELER"].id, schema_version_id=source, answers_json={"summary": "保密答案"},
                            status="ACCEPTED", validation_json={}, attempt_no=1)
    db_session.add(submission)
    db_session.commit()
    base = f"/api/v1/tasks/{task_id}"
    r = client.post(base + "/permissions", json={"userId": users["REVIEWER"].id, "actions": ["migration.read", "migration.approve"], "effect": "ALLOW"}, headers=auth["OWNER"])
    assert r.status_code == 201, r.text
    r = client.post(base + "/migrations", json={"fromSchemaVersionId": source, "toSchemaVersionId": target, "submissionIds": [submission.id]}, headers=auth["OWNER"])
    assert r.status_code == 201, r.text
    return base + "/migrations/" + r.json()["id"], base


def step(client, url, command, headers, payload=None, expected=200):
    r = client.post(url + "/" + command, headers=headers, **({"json": payload} if payload is not None else {}))
    assert r.status_code == expected, r.text
    return r.json()


def approve(client, url, auth):
    job = step(client, url, "dry-run", auth["OWNER"])
    assert job["status"] == "READY", job
    step(client, url, "submit", auth["OWNER"])
    step(client, url, "approve", auth["REVIEWER"], {"checksum": job["checksum"], "reason": "已检查预演与范围"})
    return job


def test_migration_preserves_history_and_duplicate_delivery(client, db_session, auth, migration_case):
    url, _ = migration_case
    before = deepcopy(db_session.get(Submission, "sub_migrate").answers_json)
    approve(client, url, auth)
    job = step(client, url, "execute", auth["OWNER"])
    execute_job(db_session, job["id"])
    execute_job(db_session, job["id"])
    assert db_session.get(MigrationJob, job["id"]).status == "SUCCEEDED"
    assert db_session.query(MigrationRecord).count() == 1
    assert db_session.get(Submission, "sub_migrate").answers_json == before
    records = client.get(url + "/records", headers=auth["OWNER"]).json()
    assert records["items"][0]["answers"] == before
    logs = db_session.query(AuditLog).filter_by(entity_type="MIGRATION").all()
    assert "保密答案" not in json.dumps([row.after_json for row in logs], ensure_ascii=False)
    step(client, url, "retry", auth["OWNER"], expected=409)


def test_approval_requires_independence_current_checksum_and_read_permission(client, auth, migration_case):
    url, _ = migration_case
    step(client, url, "execute", auth["OWNER"], expected=409)
    preview = step(client, url, "dry-run", auth["OWNER"])
    step(client, url, "submit", auth["OWNER"])
    step(client, url, "approve", auth["OWNER"], {"checksum": preview["checksum"], "reason": "自批"}, 403)
    step(client, url, "approve", auth["REVIEWER"], {"checksum": "0" * 64, "reason": "旧摘要"}, 409)
    step(client, url, "dry-run", auth["OWNER"], expected=409)
    assert client.get(url, headers=auth["LABELER"]).status_code == 403


def test_source_conflict_does_not_create_success_artifact(client, db_session, auth, migration_case):
    url, _ = migration_case
    approve(client, url, auth)
    row = db_session.get(Submission, "sub_migrate")
    row.answers_json = {"summary": "已变化"}
    db_session.commit()
    job = step(client, url, "execute", auth["OWNER"])
    execute_job(db_session, job["id"])
    assert db_session.get(MigrationJob, job["id"]).status == "PARTIAL"
    artifact = db_session.query(MigrationRecord).one()
    assert artifact.status == "CONFLICT" and artifact.answers_json is None


def test_worker_failure_rolls_back_then_retries(client, db_session, auth, migration_case, monkeypatch):
    url, _ = migration_case
    approve(client, url, auth)
    job = step(client, url, "execute", auth["OWNER"])
    import app.services.migration_domain as domain
    original = domain.engine
    monkeypatch.setattr(domain, "engine", lambda _: (_ for _ in ()).throw(RuntimeError("失败")))
    with pytest.raises(RuntimeError):
        execute_job(db_session, job["id"])
    assert db_session.query(MigrationRecord).count() == 0
    assert db_session.get(MigrationJob, job["id"]).status == "FAILED"
    monkeypatch.setattr(domain, "engine", original)
    step(client, url, "retry", auth["OWNER"])
    execute_job(db_session, job["id"])
    assert db_session.get(MigrationJob, job["id"]).status == "SUCCEEDED"


def test_revocation_and_deny_precede_cached_replay(client, db_session, auth, users, migration_case):
    url, base = migration_case
    preview = step(client, url, "dry-run", auth["OWNER"])
    step(client, url, "submit", auth["OWNER"])
    headers = {**auth["REVIEWER"], "Idempotency-Key": "approval-replay"}
    payload = {"checksum": preview["checksum"], "reason": "检查通过"}
    step(client, url, "approve", headers, payload)
    grant = db_session.query(TaskPermissionGrant).filter_by(user_id=users["REVIEWER"].id, action="migration.approve").one()
    assert client.post(base + f"/permissions/{grant.id}/revoke", headers=auth["OWNER"]).status_code == 200
    step(client, url, "approve", headers, payload, 403)
    assert client.post(base + "/permissions", json={"userId": users["OWNER"].id, "actions": ["migration.read"], "effect": "DENY"}, headers=auth["OWNER"]).status_code == 201
    assert client.get(url, headers=auth["OWNER"]).status_code == 403


def test_disabled_user_cannot_replay(client, db_session, auth, users, migration_case):
    url, _ = migration_case
    users["OWNER"].status = "BANNED"
    db_session.commit()
    assert client.get(url, headers=auth["OWNER"]).status_code == 401


def test_tampered_preview_cannot_execute(client, db_session, auth, migration_case):
    url, _ = migration_case
    approve(client, url, auth)
    job = db_session.get(MigrationJob, url.rsplit("/", 1)[-1])
    altered = deepcopy(job.preview_json)
    altered["records"][0]["answers"] = {"summary": "篡改"}
    job.preview_json = altered
    db_session.commit()
    step(client, url, "execute", auth["OWNER"], expected=409)


def test_custom_validation_and_invalid_mapping_block_preview(client, db_session, auth, migration_case):
    url, _ = migration_case
    from app.models.schema import SchemaVersion
    job = db_session.get(MigrationJob, url.rsplit("/", 1)[-1])
    version = db_session.get(SchemaVersion, job.to_schema_version_id)
    schema = deepcopy(version.schema_json)
    schema["nodes"][0]["validationRules"] = [{"type": "custom", "ruleId": "unregistered"}]
    version.schema_json = schema
    db_session.commit()
    result = step(client, url, "dry-run", auth["OWNER"])
    assert result["status"] == "BLOCKED"
    assert "自定义校验" in str(result["report"]["blockingIssues"])
    step(client, url, "submit", auth["OWNER"], expected=409)


def test_expired_and_cross_task_grants_do_not_authorize(client, db_session, auth, users, migration_case):
    from datetime import timedelta
    from app.services.permission_domain import utcnow
    url, base = migration_case
    grants = db_session.query(TaskPermissionGrant).filter_by(user_id=users["REVIEWER"].id).all()
    for grant in grants:
        grant.expires_at = utcnow() - timedelta(seconds=1)
    db_session.commit()
    assert client.get(url, headers=auth["REVIEWER"]).status_code == 403
    other = create_task(client, auth["OWNER"])["id"]
    for grant in grants:
        grant.expires_at = None
        grant.task_id = other
    db_session.commit()
    assert client.get(url, headers=auth["REVIEWER"]).status_code == 403
    assert client.post(base + "/permissions", headers=auth["REVIEWER"], json={"userId": users["REVIEWER"].id, "actions": ["permissions.manage"], "effect": "ALLOW"}).status_code == 403


def test_action_deny_covers_direct_and_collection_reads(client, db_session, auth, users, migration_case):
    url, base = migration_case
    r = client.post(base + "/permissions", headers=auth["OWNER"], json={"userId": users["REVIEWER"].id, "actions": ["review.work"], "effect": "DENY"})
    assert r.status_code == 201
    assert client.get("/api/v1/review/submissions/sub_migrate", headers=auth["REVIEWER"]).status_code == 403
    items = client.get("/api/v1/review/queue?status=ACCEPTED", headers=auth["REVIEWER"]).json()["items"]
    assert items == []


def test_candidate_list_never_returns_answers(client, auth, migration_case):
    url, base = migration_case
    job = client.get(url, headers=auth["OWNER"]).json()
    response = client.get(base + "/migration-candidates", params={"schemaVersionId": job["fromSchemaVersionId"]}, headers=auth["OWNER"])
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert "保密答案" not in response.text
