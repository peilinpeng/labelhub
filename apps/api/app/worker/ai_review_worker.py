import hashlib
import json
import logging
from datetime import datetime, timezone
from uuid import uuid4

from jinja2 import Template

from app.config import settings
from app.services.audit_domain import write_audit_log
from app.state_machines.submission_sm import apply_transition
from app.worker.celery_app import celery_app

logger = logging.getLogger(__name__)

AI_REVIEW_TOOL = {
    "type": "function",
    "function": {
        "name": "submit_ai_review_result",
        "description": "Submit structured AI review result for a data annotation submission",
        "parameters": {
            "type": "object",
            "required": ["decision", "totalScore", "dimensionScores", "fieldIssues", "summary", "confidence"],
            "properties": {
                "decision": {
                    "type": "string",
                    "enum": ["PASS", "RETURN", "NEED_HUMAN_REVIEW"],
                    "description": "Final review decision",
                },
                "totalScore": {"type": "number", "description": "Weighted total score (0-100)"},
                "dimensionScores": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["key", "score", "reason"],
                        "properties": {
                            "key": {"type": "string"},
                            "score": {"type": "number"},
                            "reason": {"type": "string"},
                        },
                    },
                },
                "fieldIssues": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["severity", "message"],
                        "properties": {
                            "fieldName": {"type": "string"},
                            "severity": {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH"]},
                            "message": {"type": "string"},
                            "suggestion": {"type": "string"},
                        },
                    },
                },
                "summary": {"type": "string", "description": "Overall review summary"},
                "confidence": {"type": "number", "description": "Confidence score 0.0-1.0"},
            },
        },
    },
}


def _sha256(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _render_prompt(template_str: str, context: dict) -> str:
    return Template(template_str).render(**context)


def _build_prompt_context(task, item, submission, schema_version, review_config) -> dict:
    return {
        "task": {"id": task.id, "title": task.title, "description": task.description},
        "item": {"sourcePayload": item.source_payload},
        "submission": {"answers": submission.answers_json, "attemptNo": submission.attempt_no},
        "schema": schema_version.schema_json,
        "dimensions": review_config.dimensions_json,
        "thresholds": review_config.thresholds_json,
    }


def _fail_to_human(db, job, submission, actor_id: str, reason: str) -> None:
    job.status = "FAILED_TO_HUMAN_REVIEW"
    job.failure_reason = reason[:500] if reason else "Unknown"
    new_status = apply_transition(submission.status, "aiReviewFailedToHuman")
    submission.status = new_status
    write_audit_log(
        db,
        entity_type="SUBMISSION",
        entity_id=submission.id,
        action="AI_REVIEW_FAILED_TO_HUMAN",
        actor_id=actor_id,
        after={"jobId": job.id, "reason": reason[:200] if reason else None},
    )
    db.commit()


def _handle_submission_return(db, submission, actor_id: str) -> None:
    from app.models.assignment import Assignment
    from app.state_machines.assignment_sm import apply_transition as assign_transition

    assignment = db.query(Assignment).filter_by(id=submission.assignment_id).first()
    if assignment and assignment.status == "SUBMITTED":
        new_asn_status = assign_transition(assignment.status, "aiReviewReturn")
        assignment.status = new_asn_status
        write_audit_log(
            db,
            entity_type="ASSIGNMENT",
            entity_id=assignment.id,
            action="REVIEW_RETURNED",
            actor_id=actor_id,
            after={"reason": "AI Review 判定退回", "submissionId": submission.id},
        )


def _execute_review(db, job_id: str) -> None:
    from app.models.llm import LLMCallLog
    from app.models.review import AIReviewJob, ReviewConfig, ReviewResult
    from app.models.schema import SchemaVersion
    from app.models.submission import Submission
    from app.models.task import Task
    from app.models.user import User

    try:
        from app.models.dataset import DatasetItem
    except ImportError:
        DatasetItem = None

    job = db.query(AIReviewJob).filter_by(id=job_id).first()
    if not job:
        return

    if job.status in ("SUCCEEDED", "FAILED_TO_HUMAN_REVIEW"):
        return

    submission = db.query(Submission).filter_by(id=job.submission_id).with_for_update().first()
    if not submission:
        return

    system_user = db.query(User).filter_by(role="SYSTEM").first()
    system_actor_id = system_user.id if system_user else submission.labeler_id

    job.status = "RUNNING"
    write_audit_log(
        db,
        entity_type="SUBMISSION",
        entity_id=submission.id,
        action="AI_REVIEW_ENQUEUED",
        actor_id=system_actor_id,
        after={"jobId": job.id, "retryCount": job.retry_count},
    )
    db.commit()

    task = db.query(Task).filter_by(id=submission.task_id).first()
    item = None
    if DatasetItem is not None:
        item = db.query(DatasetItem).filter_by(id=submission.item_id).first()
    schema_version = db.query(SchemaVersion).filter_by(id=job.schema_version_id).first()
    review_config = db.query(ReviewConfig).filter_by(task_id=submission.task_id).first()

    if not review_config or not review_config.enabled:
        _fail_to_human(db, job, submission, system_actor_id, "ReviewConfig 不存在或已禁用")
        return

    context = _build_prompt_context(task, item, submission, schema_version, review_config)
    rendered_prompt = _render_prompt(review_config.prompt_template, context)
    input_str = json.dumps({"prompt": rendered_prompt, "context": context}, ensure_ascii=False)
    input_hash = _sha256(input_str)
    prompt_hash = _sha256(rendered_prompt)

    llm_log = LLMCallLog(
        id="llm_" + uuid4().hex,
        purpose="AI_REVIEW",
        actor_id=system_actor_id,
        submission_id=submission.id,
        model_policy_id=review_config.model_policy_id,
        prompt_snapshot_hash=prompt_hash,
        input_hash=input_hash,
        status="PENDING",
    )
    db.add(llm_log)
    db.flush()

    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.DOUBAO_API_KEY, base_url=settings.DOUBAO_BASE_URL)
        llm_log.status = "RUNNING"
        db.flush()

        response = client.chat.completions.create(
            model=settings.DOUBAO_MODEL,
            messages=[{"role": "user", "content": rendered_prompt}],
            tools=[AI_REVIEW_TOOL],
            tool_choice={"type": "function", "function": {"name": "submit_ai_review_result"}},
        )
        tool_call = response.choices[0].message.tool_calls[0]
        ai_result = json.loads(tool_call.function.arguments)
        raw_output = json.dumps(ai_result, ensure_ascii=False)
        output_hash = _sha256(raw_output)

        llm_log.status = "SUCCEEDED"
        llm_log.output_hash = output_hash
        llm_log.finished_at = datetime.now(timezone.utc)
        job.raw_output_ref = llm_log.id

    except Exception as llm_exc:
        llm_log.status = "FAILED"
        llm_log.error_message = str(llm_exc)[:500]
        llm_log.finished_at = datetime.now(timezone.utc)
        job.failure_reason = str(llm_exc)[:500]
        job.retry_count += 1

        if job.retry_count <= job.max_retries:
            job.status = "RETRYING"
            write_audit_log(
                db,
                entity_type="SUBMISSION",
                entity_id=submission.id,
                action="AI_REVIEW_FAILED",
                actor_id=system_actor_id,
                after={"jobId": job.id, "retryCount": job.retry_count, "error": str(llm_exc)[:200]},
            )
            db.commit()
            countdown = 5 * (2 ** (job.retry_count - 1))
            celery_app.send_task(
                "app.worker.ai_review_worker.run_ai_review",
                args=[job_id],
                queue="ai_review",
                countdown=countdown,
            )
        else:
            _fail_to_human(db, job, submission, system_actor_id, str(llm_exc)[:500])
        return

    if ai_result.get("decision") not in ("PASS", "RETURN", "NEED_HUMAN_REVIEW"):
        _fail_to_human(
            db, job, submission, system_actor_id,
            f"LLM 返回非法 decision: {ai_result.get('decision')}",
        )
        return

    review_result = ReviewResult(
        id="rev_" + uuid4().hex,
        submission_id=submission.id,
        schema_version_id=job.schema_version_id,
        stage="AI_PRECHECK",
        decision=ai_result["decision"],
        result_json=ai_result,
        actor_id=system_actor_id,
    )
    db.add(review_result)

    decision = ai_result["decision"]
    if decision == "PASS":
        command = "aiReviewPass"
        action = "AI_REVIEW_SUCCEEDED"
    elif decision == "RETURN":
        command = "aiReviewReturn"
        action = "AI_REVIEW_SUCCEEDED"
        _handle_submission_return(db, submission, system_actor_id)
    else:
        command = "aiReviewNeedHuman"
        action = "AI_REVIEW_SUCCEEDED"

    new_sub_status = apply_transition(submission.status, command)
    submission.status = new_sub_status

    write_audit_log(
        db,
        entity_type="SUBMISSION",
        entity_id=submission.id,
        action=action,
        actor_id=system_actor_id,
        after={"decision": decision, "totalScore": ai_result.get("totalScore"), "jobId": job.id},
    )

    job.status = "SUCCEEDED"
    db.commit()

    logger.info("AI Review completed job=%s decision=%s submission=%s", job_id, decision, submission.id)


@celery_app.task(bind=True, name="app.worker.ai_review_worker.run_ai_review", max_retries=0)
def run_ai_review(self, job_id: str) -> None:
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        _execute_review(db, job_id)
    except Exception as e:
        logger.exception("ai_review job=%s unexpected error: %s", job_id, e)
    finally:
        db.close()
