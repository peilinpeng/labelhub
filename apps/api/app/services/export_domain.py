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

def _review_summary(db: Session, submission_id: str) -> dict:
    """单次查询汇总本提交的审核留痕，供导出与护照共用（避免补丁读取逻辑各写一份）：
    - patches：最新一条人工/终审（HUMAN_REVIEW / FINAL_REVIEW）的 patches；
    - reviewEventId：该最新人工/终审结果的 id；
    - aiReviewEventIds：全部 AI 预审（AI_PRECHECK）结果 id。
    """
    from app.models.review import ReviewResult

    results = (
        db.query(ReviewResult)
        .filter(ReviewResult.submission_id == submission_id)
        .order_by(ReviewResult.created_at.asc())
        .all()
    )
    latest_human_review = None
    ai_review_event_ids: list[str] = []
    for r in results:
        if r.stage in ("HUMAN_REVIEW", "FINAL_REVIEW"):
            latest_human_review = r  # 升序遍历，最后写入的即最新
        elif r.stage == "AI_PRECHECK":
            ai_review_event_ids.append(r.id)
    patches = (
        (latest_human_review.result_json or {}).get("patches", []) or []
        if latest_human_review else []
    )
    return {
        "patches": patches,
        "reviewEventId": latest_human_review.id if latest_human_review else None,
        "aiReviewEventIds": ai_review_event_ids,
    }


def _latest_review_patches(db: Session, submission_id: str) -> list[dict]:
    """最新一条人工/终审的 patches（导出取补丁后答案时复用，单一来源见 _review_summary）。"""
    return _review_summary(db, submission_id)["patches"]


def build_passport(db: Session, submission, exported_answers: dict | None = None) -> dict:
    """
    为单条 submission 构造 DataQualityPassport（镜像 contracts export.ts）。

    finalAnswerHash 取**实际导出的那份答案**：由 worker 按 mapping.answerSource 解析后经
    exported_answers 传入，使下游能用交付文件独立校验、指纹必然对得上。直接调用（如单测）
    未传时，回退到"应用 reviewer patches 后的最终答案"，与前端 canonical hash 一致。
    """
    from app.models.audit import AuditLog
    from app.models.ai_assist import AiAssistAction

    original = dict(submission.answers_json or {})
    summary = _review_summary(db, submission.id)
    # 只统计真正改了字段的补丁：无 fieldName 的补丁不产生任何变更，_get_answers 应用时也会跳过，
    # 故不计入 reviewerPatchCount，避免与导出实际效果对不上。
    effective_patches = [p for p in summary["patches"] if p.get("fieldName")]
    changed_fields = list(dict.fromkeys(p["fieldName"] for p in effective_patches))

    if exported_answers is not None:
        answers_for_hash = exported_answers
    else:
        answers_for_hash = dict(original)
        for p in effective_patches:
            answers_for_hash[p["fieldName"]] = p.get("nextValue")

    review_status = _REVIEW_STATUS_MAP.get(submission.status, "UNREVIEWED")

    # AI 辅助：按契约拆 accept / edit_accept / dismiss（来自 ai_assist_actions，是审核员对建议的
    # 真实动作，而非裸 LLM 调用数）。aiAssistUsed 仅当建议被采纳/改采纳（真正写进了最终答案）才为真——
    # 只 dismiss（看了但没用）不算"用了 AI 辅助"，避免高估 AI 对数据的影响。
    assist_actions = db.query(AiAssistAction).filter_by(submission_id=submission.id).all()
    ai_accepted = sum(1 for a in assist_actions if a.action == "accept")
    ai_edited = sum(1 for a in assist_actions if a.action == "edit_accept")
    ai_dismissed = sum(1 for a in assist_actions if a.action == "dismiss")

    # auditEventCount 取合规账本 audit_logs（强一致、与业务同事务写入）中本提交的治理动作数，
    # 而非 audit_events（fire-and-forget 富事件流，允许丢失）——护照是信任凭证，计数必须权威可复现。
    # 按 entity_type='SUBMISSION' 计本提交生命周期内的审计条数（SUBMISSION_CREATED / AI_REVIEW_* / REVIEW_* …）。
    audit_event_count = (
        db.query(AuditLog)
        .filter_by(entity_type="SUBMISSION", entity_id=submission.id)
        .count()
    )

    # qualityLedgerRef：契约 DataQualityPassportQualityLedgerRef 的事件引用，用现有留痕能填的填，
    # 不造数据（labelerTrustLevel / riskCodes 等需尚未落地的子系统支撑，留空而非伪造）。
    quality_ledger_ref: dict = {}
    if summary["reviewEventId"]:
        quality_ledger_ref["reviewEventId"] = summary["reviewEventId"]
    if summary["aiReviewEventIds"]:
        quality_ledger_ref["aiReviewEventIds"] = summary["aiReviewEventIds"]
    if assist_actions:
        quality_ledger_ref["aiAssistEventIds"] = [a.id for a in assist_actions]

    return {
        "submissionId": submission.id,
        "schemaVersionId": submission.schema_version_id,
        "finalAnswerHash": hash_canonical_json(answers_for_hash),
        "answerHashAlgorithm": ANSWER_HASH_ALGORITHM,
        "reviewStatus": review_status,
        "reviewerPatchCount": len(effective_patches),
        "changedFieldNames": changed_fields,
        "aiAssistUsed": (ai_accepted + ai_edited) > 0,
        "aiAcceptedCount": ai_accepted,
        "aiDismissedCount": ai_dismissed,
        "aiEditedCount": ai_edited,
        "auditEventCount": audit_event_count,
        "qualityLedgerRef": quality_ledger_ref,
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
