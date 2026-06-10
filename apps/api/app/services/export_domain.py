from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy.orm import Session

from app.middleware.error_handler import (
    ResourceNotFoundException,
    ExportMappingInvalidException,
    InvalidStateTransitionException,
    PermissionDeniedException,
)
from app.models.export import ExportJob
from app.models.export_record import ExportRecord
from app.models.file import FileObject
from app.services.audit_domain import write_audit_log
from app.state_machines.export_sm import apply_transition
from app.utils.hashing import hash_canonical_json, ANSWER_HASH_ALGORITHM

# submission.status → DataQualityPassport.reviewStatus（契约枚举：APPROVED/REJECTED/RETURNED/UNREVIEWED）
_REVIEW_STATUS_MAP = {
    "ACCEPTED": "APPROVED",
    "REJECTED": "REJECTED",
    "RETURNED": "RETURNED",
}

# RuntimeContext 命名空间根。sourcePath 允许是命名空间根本身（如 $.answers 整对象），
# 或其下的具体路径（如 $.item.id）。
_VALID_NAMESPACES = (
    "$.task", "$.schema", "$.item", "$.answers",
    "$.review", "$.system", "$.meta",
)


def _is_valid_source_path(source_path: str) -> bool:
    return any(
        source_path == ns or source_path.startswith(ns + ".")
        for ns in _VALID_NAMESPACES
    )


def _validate_mapping(mapping_json: dict) -> None:
    answer_source = mapping_json.get("answerSource", "ORIGINAL_ANSWERS")
    allow_patched = mapping_json.get("allowPatchedAnswers")
    fmt = mapping_json.get("format", "")
    columns = mapping_json.get("columns", [])

    if answer_source == "PATCHED_ANSWERS" and not allow_patched:
        raise ExportMappingInvalidException(
            "PATCHED_ANSWERS 必须显式设置 allowPatchedAnswers=true"
        )

    if fmt not in ("JSON", "JSONL", "CSV", "EXCEL"):
        raise ExportMappingInvalidException(f"不支持的导出格式: {fmt}")

    for col in columns:
        source_path = col.get("sourcePath", "")
        if not _is_valid_source_path(source_path):
            raise ExportMappingInvalidException(
                f"sourcePath {source_path!r} 不符合 RuntimeContext 命名空间规范"
            )


def create_export_job(db: Session, task_id: str, actor, req) -> tuple:
    from app.models.task import Task
    from app.models.schema import SchemaVersion

    task = db.query(Task).filter_by(id=task_id).first()
    if not task:
        raise ResourceNotFoundException(f"Task {task_id!r} 不存在")

    mapping_json = req.mapping.model_dump()
    _validate_mapping(mapping_json)

    schema_version_id = req.mapping.schemaVersionId
    sv = db.query(SchemaVersion).filter_by(id=schema_version_id).first()
    if not sv or sv.task_id != task_id:
        raise ResourceNotFoundException("SchemaVersion 不存在或不属于此任务")

    job = ExportJob(
        id="exp_" + uuid4().hex,
        task_id=task_id,
        schema_version_id=schema_version_id,
        status="PENDING",
        mapping_json=mapping_json,
        progress_total=0,
        progress_done=0,
        created_by=actor.id,
    )
    db.add(job)

    log = write_audit_log(
        db,
        entity_type="EXPORT",
        entity_id=job.id,
        action="EXPORT_CREATED",
        actor_id=actor.id,
        after={
            "taskId": task_id,
            "format": req.mapping.format,
            "answerSource": req.mapping.answerSource,
        },
    )

    db.commit()
    db.refresh(job)

    from app.worker.celery_app import celery_app
    celery_app.send_task(
        "app.worker.export_worker.run_export",
        args=[job.id],
        queue="export",
    )

    return job, log


def get_export_job(db: Session, export_job_id: str, actor) -> ExportJob:
    job = db.query(ExportJob).filter_by(id=export_job_id).first()
    if not job:
        raise ResourceNotFoundException(f"ExportJob {export_job_id!r} 不存在")
    return job


def list_export_jobs(db: Session, task_id: str, actor, page: int, page_size: int) -> tuple:
    query = db.query(ExportJob).filter_by(task_id=task_id)
    total = query.count()
    jobs = (
        query.order_by(ExportJob.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return jobs, total


def cancel_export_job(db: Session, export_job_id: str, actor) -> tuple:
    from app.models.task import Task

    job = db.query(ExportJob).filter_by(id=export_job_id).with_for_update().first()
    if not job:
        raise ResourceNotFoundException(f"ExportJob {export_job_id!r} 不存在")

    task = db.query(Task).filter_by(id=job.task_id).first()
    if task and task.owner_id != actor.id and actor.role not in ("ADMIN",):
        raise PermissionDeniedException("只有任务 Owner 可以取消导出任务")

    new_status = apply_transition(job.status, "cancelExportJob")
    job.status = new_status
    job.finished_at = datetime.now(timezone.utc)

    log = write_audit_log(
        db,
        entity_type="EXPORT",
        entity_id=job.id,
        action="EXPORT_CANCELED",
        actor_id=actor.id,
    )

    db.commit()
    db.refresh(job)
    return job, log


def get_download_info(db: Session, export_job_id: str, actor) -> tuple:
    from datetime import timedelta

    job = get_export_job(db, export_job_id, actor)

    if job.status != "SUCCEEDED":
        raise InvalidStateTransitionException("导出任务尚未完成，无法下载")

    if not job.file_id:
        raise ResourceNotFoundException("导出文件记录不存在")

    file_obj = db.query(FileObject).filter_by(id=job.file_id).first()
    if not file_obj or file_obj.status != "READY":
        raise ResourceNotFoundException("导出文件不可用")

    download_url = f"/api/v1/exports/{export_job_id}/download/file"
    expires_at = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=1)

    return job, file_obj, download_url, expires_at


# ---------------------------------------------------------------------------
# Data Quality Passport（Quality Layer）
# ---------------------------------------------------------------------------

def _latest_review_patches(db: Session, submission_id: str) -> list[dict]:
    from app.models.review import ReviewResult
    latest = (
        db.query(ReviewResult)
        .filter(
            ReviewResult.submission_id == submission_id,
            ReviewResult.stage.in_(["HUMAN_REVIEW", "FINAL_REVIEW"]),
        )
        .order_by(ReviewResult.created_at.desc())
        .first()
    )
    if not latest:
        return []
    return (latest.result_json or {}).get("patches", []) or []


def build_passport(db: Session, submission) -> dict:
    """
    为单条 submission 构造 DataQualityPassport（镜像 contracts export.ts）。
    finalAnswerHash 基于"应用 reviewer patches 后的最终答案"，与前端 canonical hash 一致。
    """
    from app.models.llm import LLMCallLog

    original = dict(submission.answers_json or {})
    patches = _latest_review_patches(db, submission.id)
    final_answers = dict(original)
    changed_fields: list[str] = []
    for p in patches:
        fn = p.get("fieldName")
        if fn:
            final_answers[fn] = p.get("nextValue")
            changed_fields.append(fn)

    review_status = _REVIEW_STATUS_MAP.get(submission.status, "UNREVIEWED")

    ai_assist_count = (
        db.query(LLMCallLog)
        .filter_by(assignment_id=submission.assignment_id, purpose="LLM_ASSIST")
        .count()
    )

    return {
        "submissionId": submission.id,
        "schemaVersionId": submission.schema_version_id,
        "finalAnswerHash": hash_canonical_json(final_answers),
        "answerHashAlgorithm": ANSWER_HASH_ALGORITHM,
        "reviewStatus": review_status,
        "reviewerPatchCount": len(patches),
        "changedFieldNames": changed_fields,
        "aiAssistUsed": ai_assist_count > 0,
        "aiAssistCallCount": ai_assist_count,
        "qualityLedgerRef": {"submissionId": submission.id, "assignmentId": submission.assignment_id},
    }


def compute_passport_batch_hash(passports: list[dict]) -> str:
    """所有 passport 的批次 hash（按 submissionId 排序后整体 canonical hash）。"""
    ordered = sorted(passports, key=lambda p: p.get("submissionId", ""))
    return hash_canonical_json(ordered)


def get_export_records(db: Session, export_job_id: str, actor) -> dict:
    """GET /exports/{id}/records：返回该导出任务的记录（含 passport）+ artifactSummary。"""
    job = db.query(ExportJob).filter_by(id=export_job_id).first()
    if not job:
        raise ResourceNotFoundException(f"导出任务 {export_job_id!r} 不存在")

    records = (
        db.query(ExportRecord)
        .filter_by(export_job_id=export_job_id)
        .order_by(ExportRecord.record_index.asc())
        .all()
    )
    return {"job": job, "records": records}
