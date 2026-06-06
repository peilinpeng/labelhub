import logging
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.worker.celery_app import celery_app
from app.state_machines.export_sm import apply_transition
from app.services.audit_domain import write_audit_log
from app.services.audit_event_domain import emit_audit_event
from app.services.export_domain import build_passport, compute_passport_batch_hash
from app.models.export_record import ExportRecord

logger = logging.getLogger(__name__)


def _resolve_path(context: dict, path: str) -> Any:
    if not path.startswith("$."):
        return None
    parts = path[2:].split(".")
    current = context
    for part in parts:
        if "[" in part:
            key, rest = part.split("[", 1)
            idx = int(rest.rstrip("]"))
            if not isinstance(current, dict) or key not in current:
                return None
            current = current[key]
            if not isinstance(current, list) or idx >= len(current):
                return None
            current = current[idx]
        else:
            if not isinstance(current, dict) or part not in current:
                return None
            current = current[part]
    return current


def _apply_transform(value: Any, transform: dict | None, fmt: str) -> Any:
    import json

    if transform is None:
        if fmt in ("CSV", "EXCEL") and isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False)
        return value if value is not None else ""

    t = transform.get("type", "TEXT")
    if t == "TEXT":
        if value is None or value == "":
            return transform.get("fallback", "")
        return str(value)
    elif t == "JSON_STRINGIFY":
        space = transform.get("space", 2)
        return json.dumps(value, ensure_ascii=False, indent=space)
    elif t == "DATE":
        if value is None:
            return ""
        return str(value)
    elif t in ("FILE_URLS", "IMAGE_PREVIEW"):
        if isinstance(value, list):
            return ", ".join(
                str(item.get("fileId", item)) if isinstance(item, dict) else str(item)
                for item in value
            )
        return str(value) if value is not None else ""
    elif t == "MARKDOWN":
        return str(value) if value is not None else ""
    else:
        return str(value) if value is not None else ""


def _build_runtime_context(submission, task, item, schema_version, answers: dict) -> dict:
    return {
        "task": {
            "id": task.id,
            "title": task.title,
            "status": task.status,
            "activeSchemaVersionId": getattr(task, "active_schema_version_id", None),
        },
        "schema": {
            "schemaId": schema_version.schema_id,
            "schemaVersionId": schema_version.id,
            "schemaVersionNo": schema_version.schema_version_no,
            "contractVersion": schema_version.contract_version,
        },
        "item": {
            "id": item.id,
            "externalKey": item.external_key,
            "sourcePayload": item.source_payload or {},
        },
        "answers": answers,
        "system": {
            "actor": {"id": "SYSTEM"},
            "role": "SYSTEM",
            "now": datetime.now(timezone.utc).isoformat(),
        },
        "meta": {},
    }


def _get_answers(db, submission, answer_source: str) -> dict:
    from app.models.review import ReviewResult

    original = dict(submission.answers_json or {})
    if answer_source != "PATCHED_ANSWERS":
        return original

    latest_result = (
        db.query(ReviewResult)
        .filter(
            ReviewResult.submission_id == submission.id,
            ReviewResult.stage.in_(["HUMAN_REVIEW", "FINAL_REVIEW"]),
        )
        .order_by(ReviewResult.created_at.desc())
        .first()
    )
    if not latest_result:
        return original

    patches = (latest_result.result_json or {}).get("patches", [])
    patched = dict(original)
    for patch in patches:
        field_name = patch.get("fieldName")
        if field_name:
            patched[field_name] = patch.get("nextValue")
    return patched


def _get_review_context(db, submission) -> dict:
    from app.models.review import ReviewResult

    latest = (
        db.query(ReviewResult)
        .filter_by(submission_id=submission.id)
        .order_by(ReviewResult.created_at.desc())
        .first()
    )
    if not latest:
        return {}
    result_json = latest.result_json or {}
    return {
        "latestDecision": latest.decision,
        "patches": result_json.get("patches", []),
        "comments": result_json.get("comments", []),
    }


def _query_submissions(db, task_id: str, filters: dict | None) -> list:
    from app.models.submission import Submission

    query = db.query(Submission).filter_by(task_id=task_id)

    if filters:
        accepted_only = filters.get("acceptedOnly")
        status_list = filters.get("submissionStatus")
        if accepted_only:
            query = query.filter(Submission.status == "ACCEPTED")
        elif status_list:
            query = query.filter(Submission.status.in_(status_list))
        else:
            query = query.filter(Submission.status == "ACCEPTED")
    else:
        query = query.filter(Submission.status == "ACCEPTED")

    return query.all()


def _extract_row(submission, task, item, schema_version, db, mapping: dict) -> dict:
    answer_source = mapping.get("answerSource", "ORIGINAL_ANSWERS")
    answers = _get_answers(db, submission, answer_source)
    review_ctx = _get_review_context(db, submission) if mapping.get("includeReviewRecords") else {}
    context = _build_runtime_context(submission, task, item, schema_version, answers)
    if review_ctx:
        context["review"] = review_ctx

    fmt = mapping.get("format", "JSON")
    row = {}
    for col in mapping.get("columns", []):
        header = col.get("header", col.get("sourcePath", ""))
        source_path = col.get("sourcePath", "")
        transform = col.get("transform")
        default_value = col.get("defaultValue")

        raw = _resolve_path(context, source_path)
        if raw is None:
            raw = default_value
        row[header] = _apply_transform(raw, transform, fmt)
    return row


def _generate_file(rows: list[dict], fmt: str, job_id: str) -> tuple[str, str, str, int]:
    import os
    import json
    import csv
    import io
    from app.config import settings

    export_dir = os.path.join(settings.LOCAL_STORAGE_DIR, "exports", job_id)
    os.makedirs(export_dir, exist_ok=True)

    if fmt == "JSON":
        filename = "result.json"
        content = json.dumps(rows, ensure_ascii=False, indent=2).encode("utf-8")
        mime = "application/json"

    elif fmt == "JSONL":
        filename = "result.jsonl"
        lines = [json.dumps(row, ensure_ascii=False) for row in rows]
        content = ("\n".join(lines) + "\n").encode("utf-8")
        mime = "application/x-ndjson"

    elif fmt == "CSV":
        filename = "result.csv"
        buf = io.StringIO()
        headers = list(rows[0].keys()) if rows else []
        writer = csv.DictWriter(buf, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)
        content = buf.getvalue().encode("utf-8-sig")
        mime = "text/csv"

    elif fmt == "EXCEL":
        filename = "result.xlsx"
        import openpyxl
        wb = openpyxl.Workbook()
        ws = wb.active
        if rows:
            ws.append(list(rows[0].keys()))
            for row in rows:
                ws.append([str(v) if v is not None else "" for v in row.values()])
        buf = io.BytesIO()
        wb.save(buf)
        content = buf.getvalue()
        mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    else:
        raise ValueError(f"不支持的格式: {fmt}")

    storage_key = f"exports/{job_id}/{filename}"
    file_path = os.path.join(settings.LOCAL_STORAGE_DIR, storage_key)
    with open(file_path, "wb") as f:
        f.write(content)

    return storage_key, file_path, mime, len(content)


def _execute_export(db, job_id: str) -> None:
    from app.models.export import ExportJob
    from app.models.user import User
    from app.models.task import Task
    from app.models.schema import SchemaVersion
    from app.models.dataset import DatasetItem
    from app.models.file import FileObject

    job = db.query(ExportJob).filter_by(id=job_id).first()
    if not job:
        return
    if job.status not in ("PENDING",):
        return

    system_user = db.query(User).filter_by(role="SYSTEM").first()
    system_actor_id = system_user.id if system_user else job.created_by

    job.status = apply_transition(job.status, "startExportJob")
    write_audit_log(
        db,
        entity_type="EXPORT",
        entity_id=job.id,
        action="EXPORT_STARTED",
        actor_id=system_actor_id,
    )
    db.commit()

    try:
        mapping = job.mapping_json
        fmt = mapping.get("format", "JSON")
        filters = mapping.get("filters")

        task = db.query(Task).filter_by(id=job.task_id).first()
        schema_version = db.query(SchemaVersion).filter_by(id=job.schema_version_id).first()
        submissions = _query_submissions(db, job.task_id, filters)
        total = len(submissions)
        job.progress_total = total
        db.commit()

        rows = []
        record_specs = []  # (record_index, submission, row, passport)
        for i, sub in enumerate(submissions):
            item = db.query(DatasetItem).filter_by(id=sub.item_id).first()
            if not item:
                continue

            if fmt == "JSONL":
                answer_source = mapping.get("answerSource", "ORIGINAL_ANSWERS")
                answers = _get_answers(db, sub, answer_source)
                review_ctx = (
                    _get_review_context(db, sub) if mapping.get("includeReviewRecords") else {}
                )
                row = {
                    "item": {
                        "id": item.id,
                        "externalKey": item.external_key,
                        "sourcePayload": item.source_payload,
                    },
                    "answers": answers,
                    "review": review_ctx,
                    "meta": {
                        "submissionId": sub.id,
                        "attemptNo": sub.attempt_no,
                        "schemaVersionId": sub.schema_version_id,
                        "labelerId": sub.labeler_id,
                        "submittedAt": sub.created_at.isoformat() if sub.created_at else None,
                    },
                }
            else:
                row = _extract_row(sub, task, item, schema_version, db, mapping)

            rows.append(row)
            # Quality Layer：每条 submission 生成数据质量护照
            passport = build_passport(db, sub)
            record_specs.append((len(rows) - 1, sub, row, passport))
            job.progress_done = i + 1
            if (i + 1) % 50 == 0:
                db.commit()

        storage_key, file_path, mime_type, file_size = _generate_file(rows, fmt, job.id)

        file_obj = FileObject(
            id="file_" + uuid4().hex,
            owner_id=job.id,
            owner_type="EXPORT_JOB",
            purpose="EXPORT_RESULT",
            mime_type=mime_type,
            size=file_size,
            storage_key=storage_key,
            status="READY",
            confirmed_at=datetime.now(timezone.utc),
        )
        db.add(file_obj)
        db.flush()

        # Quality Layer：持久化 ExportRecord（含 passport）+ 批次摘要 + 审计事件
        passports = [spec[3] for spec in record_specs]
        for record_index, sub, row, passport in record_specs:
            db.add(ExportRecord(
                id="erec_" + uuid4().hex,
                export_job_id=job.id,
                submission_id=sub.id,
                schema_version_id=sub.schema_version_id,
                record_index=record_index,
                data_json=row,
                metadata_json={"attemptNo": sub.attempt_no, "labelerId": sub.labeler_id},
                passport_json=passport,
            ))
        passport_batch_hash = compute_passport_batch_hash(passports) if passports else None
        artifact_summary = {
            "exportId": job.id,
            "taskId": job.task_id,
            "format": fmt,
            "schemaVersionId": job.schema_version_id,
            "recordCount": len(record_specs),
            "warningCount": 0,
            "passportCount": len(passports),
            "passportBatchHash": passport_batch_hash,
        }
        job.artifact_summary_json = artifact_summary

        job.status = apply_transition(job.status, "markExportSucceeded")
        job.file_id = file_obj.id
        job.progress_done = total
        job.finished_at = datetime.now(timezone.utc)
        write_audit_log(
            db,
            entity_type="EXPORT",
            entity_id=job.id,
            action="EXPORT_SUCCEEDED",
            actor_id=system_actor_id,
            after={"fileId": file_obj.id, "total": total, "format": fmt},
        )
        # DATA_QUALITY_PASSPORT_GENERATED 富审计事件（并入本事务）
        emit_audit_event(
            db,
            type="DATA_QUALITY_PASSPORT_GENERATED",
            source="WORKER",
            actor={"id": system_actor_id, "role": "SYSTEM"},
            target={"entityType": "EXPORT", "entityId": job.id, "taskId": job.task_id, "exportId": job.id},
            payload={
                "exportId": job.id,
                "passportCount": len(passports),
                "passportBatchHash": passport_batch_hash,
                "warningCount": 0,
            },
            commit=False,
        )
        db.commit()
        logger.info("Export completed job=%s total=%d format=%s", job_id, total, fmt)

    except Exception as exc:
        job.status = apply_transition(job.status, "markExportFailed")
        job.error_message = str(exc)[:1000]
        job.finished_at = datetime.now(timezone.utc)
        write_audit_log(
            db,
            entity_type="EXPORT",
            entity_id=job.id,
            action="EXPORT_FAILED",
            actor_id=system_actor_id,
            after={"error": str(exc)[:500]},
        )
        db.commit()
        logger.error("Export failed job=%s error=%s", job_id, exc)


@celery_app.task(bind=True, name="app.worker.export_worker.run_export", max_retries=0)
def run_export(self, job_id: str) -> None:
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        _execute_export(db, job_id)
    except Exception as e:
        logger.exception("export job=%s unexpected error: %s", job_id, e)
    finally:
        db.close()
