"""受审批保护的历史迁移。所有产物追加写入，不修改 Submission。"""
import json
import os
import subprocess
from datetime import timezone
from pathlib import Path
from uuid import uuid4
from app.models.governance import MigrationJob, MigrationRecord
from app.models.submission import Submission
from app.models.schema import SchemaVersion
from app.models.dataset import DatasetItem
from app.models.user import User
from app.middleware.auth import Actor
from app.middleware.error_handler import InvalidStateTransitionException, RevisionConflictException, ValidationFailedException, ResourceNotFoundException, PermissionDeniedException
from app.services.permission_domain import require_permission, utcnow
from app.services.audit_domain import write_audit_log
from app.utils.hashing import hash_canonical_json
from app.utils.schema_normalize import normalize_schema_payload


def iso(value):
    return value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z") if value else None


def source_hash(submission):
    return hash_canonical_json({"answers": submission.answers_json, "schemaVersionId": submission.schema_version_id,
                                "status": submission.status, "updatedAt": iso(submission.updated_at)})


def engine(input_data):
    payload = json.dumps(input_data, ensure_ascii=False)
    if len(payload.encode()) > 8 * 1024 * 1024:
        raise ValidationFailedException("迁移批次超过 8 MiB，请减少选择的提交数")
    script = Path(__file__).resolve().parents[2] / "generated" / "migration-engine.cjs"
    # 文件固定，不接受客户端路径；超时或错误不回传答案及进程 stderr。
    try:
        result = subprocess.run([os.environ.get("NODE_BINARY", "node"), str(script)], input=payload,
                                text=True, capture_output=True, timeout=45, check=True)
        return json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        raise RuntimeError("迁移引擎执行失败，请检查部署及引擎构建") from error


def get_job(db, task_id, job_id, actor, permission="migration.read", lock=False):
    require_permission(db, task_id, actor, "migration.read")
    require_permission(db, task_id, actor, permission)
    query = db.query(MigrationJob).filter_by(id=job_id, task_id=task_id)
    job = query.with_for_update().first() if lock else query.first()
    if job is None:
        raise ResourceNotFoundException("迁移任务不存在")
    return job


def serialize_job(job):
    result = {"id": job.id, "taskId": job.task_id, "status": job.status, "createdBy": job.created_by,
              "fromSchemaVersionId": job.from_schema_version_id, "toSchemaVersionId": job.to_schema_version_id,
              "submissionIds": job.request_json["submissionIds"], "createdAt": iso(job.created_at),
              "updatedAt": iso(job.updated_at), "completedCount": job.completed_count, "conflictCount": job.conflict_count}
    for key, value in [("checksum", job.checksum), ("approvedBy", job.approved_by), ("approvedAt", iso(job.approved_at)),
                       ("decisionReason", job.decision_reason), ("error", job.error)]:
        if value is not None:
            result[key] = value
    if job.preview_json:
        result.update(plan=job.preview_json["plan"], report=job.preview_json["report"])
    return result


def serialize_record(record):
    result = {"id": record.id, "jobId": record.job_id, "submissionId": record.submission_id,
              "fromSchemaVersionId": record.from_schema_version_id, "toSchemaVersionId": record.to_schema_version_id,
              "status": record.status, "sourceHash": record.source_hash, "createdAt": iso(record.created_at)}
    if record.status == "SUCCEEDED":
        result.update(resultHash=record.result_hash, answers=record.answers_json, archivedAnswers=record.archived_answers_json)
    return result


def audit(db, job, actor_id, action):
    write_audit_log(db, entity_type="MIGRATION", entity_id=job.id, action=action, actor_id=actor_id,
                    after={"taskId": job.task_id, "status": job.status, "checksum": job.checksum,
                           "completedCount": job.completed_count, "conflictCount": job.conflict_count})


def require_state(job, *states):
    if job.status not in states:
        raise InvalidStateTransitionException(f"当前状态 {job.status} 不允许此操作")


def create_job(db, task_id, actor, req):
    require_permission(db, task_id, actor, "migration.plan")
    if req.fromSchemaVersionId == req.toSchemaVersionId:
        raise ValidationFailedException("源版本和目标版本必须不同")
    for version_id in [req.fromSchemaVersionId, req.toSchemaVersionId]:
        version = db.get(SchemaVersion, version_id)
        if version is None or version.task_id != task_id:
            raise ValidationFailedException("迁移版本必须是当前任务的已发布版本")
    count = db.query(Submission).filter(Submission.id.in_(req.submissionIds), Submission.task_id == task_id,
                                       Submission.schema_version_id == req.fromSchemaVersionId).count()
    if count != len(req.submissionIds):
        raise ValidationFailedException("存在不属于本任务或源版本的提交")
    job = MigrationJob(id=f"job_{uuid4().hex}", task_id=task_id, from_schema_version_id=req.fromSchemaVersionId,
                       to_schema_version_id=req.toSchemaVersionId, created_by=actor.id, status="DRAFT",
                       request_json=req.model_dump(), completed_count=0, conflict_count=0)
    db.add(job)
    audit(db, job, actor.id, "MIGRATION_CREATED")
    db.commit()
    return job


def dry_run(db, job, actor):
    require_state(job, "DRAFT", "READY", "BLOCKED")
    task = require_permission(db, job.task_id, actor, "migration.plan")
    old = db.get(SchemaVersion, job.from_schema_version_id)
    new = db.get(SchemaVersion, job.to_schema_version_id)
    rows = db.query(Submission).filter(Submission.id.in_(job.request_json["submissionIds"])).order_by(Submission.id).all()
    if len(rows) != len(job.request_json["submissionIds"]) or any(row.task_id != task.id or row.schema_version_id != old.id for row in rows):
        raise RevisionConflictException("源提交范围已变化，请重新创建计划")
    contexts = {}
    hashes = {}
    now = iso(utcnow())
    for row in rows:
        item = db.get(DatasetItem, row.item_id)
        contexts[row.id] = {"task": {"id": task.id, "title": task.title, "status": task.status, "activeSchemaVersionId": new.id},
                            "schema": {"schemaId": new.schema_id, "schemaVersionId": new.id, "schemaVersionNo": new.schema_version_no, "contractVersion": new.contract_version},
                            "item": {"id": item.id, "sourcePayload": item.source_payload}, "answers": row.answers_json,
                            "system": {"actor": {"id": actor.id, "role": actor.role, "displayName": actor.display_name}, "role": actor.role, "now": now}}
        hashes[row.id] = source_hash(row)
    options = {key: job.request_json[key] for key in ["renameMap", "defaults", "optionValueMap", "archiveRemovedFields"]}
    def canonical(version):
        return normalize_schema_payload(version.schema_json, task.id, version.schema_id, published=True,
                                        schema_version_id=version.id, schema_version_no=version.schema_version_no)
    input_data = {"oldSchema": canonical(old), "newSchema": canonical(new), "options": options, "contexts": contexts,
                  "submissions": [{"submissionId": row.id, "schemaVersionId": row.schema_version_id, "answers": row.answers_json,
                                   "updatedAt": iso(row.updated_at), "submittedAt": iso(row.created_at)} for row in rows]}
    preview = engine(input_data)
    job.snapshot_json = {"input": input_data, "sourceHashes": hashes}
    job.preview_json = preview
    job.checksum = hash_canonical_json({"snapshot": job.snapshot_json, "preview": preview})
    job.status = "READY" if preview["report"]["executable"] else "BLOCKED"
    job.updated_at = utcnow()
    audit(db, job, actor.id, "MIGRATION_PREVIEWED")
    db.commit()
    return job


def verify_checksum(job):
    if not job.checksum or job.checksum != hash_canonical_json({"snapshot": job.snapshot_json, "preview": job.preview_json}):
        raise RevisionConflictException("迁移内容摘要不匹配，请重新预演")


def command(db, job, actor, command_name, decision=None):
    actions = {"submit": "migration.plan", "approve": "migration.approve", "reject": "migration.approve",
               "execute": "migration.execute", "retry": "migration.execute", "cancel": "migration.plan"}
    require_permission(db, job.task_id, actor, actions[command_name])
    if command_name == "submit":
        require_state(job, "READY")
        verify_checksum(job)
        job.status = "PENDING_APPROVAL"
    elif command_name in ("approve", "reject"):
        require_state(job, "PENDING_APPROVAL")
        if actor.id == job.created_by:
            raise PermissionDeniedException("迁移审批人必须与发起人不同")
        verify_checksum(job)
        if decision.checksum != job.checksum:
            raise RevisionConflictException("审批摘要已过期，请刷新并重新检查")
        job.status = "APPROVED" if command_name == "approve" else "REJECTED"
        job.approved_by, job.approved_at, job.decision_reason = actor.id, utcnow(), decision.reason
        job.approved_checksum = job.checksum if command_name == "approve" else None
    elif command_name in ("execute", "retry"):
        require_state(job, "APPROVED" if command_name == "execute" else "FAILED")
        verify_checksum(job)
        if job.approved_checksum != job.checksum:
            raise RevisionConflictException("缺少有效的迁移审批")
        job.status, job.executed_by, job.error = "QUEUED", actor.id, None
    else:
        require_state(job, "DRAFT", "READY", "BLOCKED", "PENDING_APPROVAL", "APPROVED")
        job.status = "CANCELED"
    action = {"submit": "MIGRATION_SUBMITTED", "approve": "MIGRATION_APPROVED", "reject": "MIGRATION_REJECTED",
              "execute": "MIGRATION_QUEUED", "retry": "MIGRATION_QUEUED", "cancel": "MIGRATION_CANCELED"}[command_name]
    job.updated_at = utcnow()
    audit(db, job, actor.id, action)
    db.commit()
    if job.status == "QUEUED":
        # 数据库状态是可靠 outbox；临时 broker 故障由定时投递恢复。
        from app.worker.migration_worker import enqueue
        enqueue(job.id)
    return job


def execute_job(db, job_id):
    job = db.query(MigrationJob).filter_by(id=job_id).with_for_update().first()
    if job is None or job.status != "QUEUED":
        return
    actor_id = job.executed_by
    try:
        user = db.get(User, actor_id)
        if user is None or user.status != "ACTIVE":
            raise PermissionDeniedException("执行用户已失效")
        require_permission(db, job.task_id, Actor(user.id, user.role, user.display_name), "migration.execute")
        approver = db.get(User, job.approved_by)
        if approver is None or approver.status != "ACTIVE":
            raise PermissionDeniedException("审批用户已失效")
        require_permission(db, job.task_id, Actor(approver.id, approver.role, approver.display_name), "migration.approve")
        verify_checksum(job)
        if job.approved_checksum != job.checksum or job.approved_by == job.created_by:
            raise RevisionConflictException("迁移审批无效")
        job.status = "RUNNING"
        audit(db, job, actor_id, "MIGRATION_STARTED")
        # 整批在行锁事务内完成。崩溃回滚后仍为 QUEUED，由 outbox 重投；重复消息只读终态。
        preview = engine(job.snapshot_json["input"])
        if preview != job.preview_json or not preview["report"]["executable"]:
            raise RevisionConflictException("引擎结果与批准预演不一致")
        entries = {entry["submissionId"]: entry for entry in preview["records"]}
        if set(entries) != set(job.request_json["submissionIds"]):
            raise ValidationFailedException("迁移结果未覆盖批准范围")
        for submission_id in job.request_json["submissionIds"]:
            source = db.query(Submission).filter_by(id=submission_id).with_for_update().first()
            expected = job.snapshot_json["sourceHashes"][submission_id]
            conflict = source is None or source_hash(source) != expected
            entry = entries[submission_id]
            record = MigrationRecord(id=f"sub_{uuid4().hex}", job_id=job.id, submission_id=submission_id,
                                     from_schema_version_id=job.from_schema_version_id, to_schema_version_id=job.to_schema_version_id,
                                     status="CONFLICT" if conflict else "SUCCEEDED", source_hash=expected)
            if conflict:
                job.conflict_count += 1
            else:
                record.answers_json, record.archived_answers_json = entry["answers"], entry["archivedAnswers"]
                record.result_hash = hash_canonical_json(entry)
                job.completed_count += 1
            db.add(record)
        job.status = "PARTIAL" if job.conflict_count else "SUCCEEDED"
        job.updated_at = utcnow()
        audit(db, job, actor_id, "MIGRATION_COMPLETED")
        db.commit()
    except Exception:
        db.rollback()
        job = db.query(MigrationJob).filter_by(id=job_id).with_for_update().first()
        if job and job.status == "QUEUED":
            job.status, job.error, job.updated_at = "FAILED", "迁移执行失败，检查授权、审批摘要及引擎后重试", utcnow()
            audit(db, job, actor_id, "MIGRATION_FAILED")
            db.commit()
        raise
