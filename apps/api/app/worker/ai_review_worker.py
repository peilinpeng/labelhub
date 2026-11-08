import logging
import time
from datetime import datetime, timezone
from uuid import uuid4
from jinja2 import TemplateError

from app.config import settings
from app.services.audit_domain import write_audit_log
from app.state_machines.submission_sm import apply_transition
from app.worker.celery_app import celery_app

logger = logging.getLogger(__name__)

from app.services.ai_quality import AI_REVIEW_TOOL

# 保留内部函数别名供已有调用方使用；不再修补截断 JSON。
from app.services.ai_quality import (
    strict_json as _loads_lenient, extract_result,
    route_with_confidence as _route_with_confidence,
    decide_by_threshold as _decide_by_threshold,
    route_by_strategy as _route_by_strategy, validate_review_result, validate_config,
)
from app.services.ai_workflow import VERSION, review_messages, field_names
from app.utils.hashing import hash_canonical_json
AUTO_FLOW_MODE = "AUTO_PASS_RETURN"


def _extract_ai_result(response):
    return extract_result(response, "submit_ai_review_result")


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


def _handle_auto_accept(db, submission, actor_id: str) -> None:
    """AUTO_PASS_RETURN 策略下高分自动通过：把 assignment 推进到 ACCEPTED、题目置为 COMPLETED，
    与人工"通过单审"的收尾保持一致（区别仅在 actor 为系统、无 HUMAN_REVIEW 评审记录）。"""
    from app.models.assignment import Assignment
    from app.state_machines.assignment_sm import apply_transition as assign_transition

    assignment = db.query(Assignment).filter_by(id=submission.assignment_id).first()
    if assignment and assignment.status == "SUBMITTED":
        assignment.status = assign_transition(assignment.status, "aiReviewAutoAccept")
        write_audit_log(
            db,
            entity_type="ASSIGNMENT",
            entity_id=assignment.id,
            action="REVIEW_ACCEPTED",
            actor_id=actor_id,
            after={"reason": "AI Review 高分自动通过", "submissionId": submission.id},
        )
    try:
        from app.models.dataset import DatasetItem
        item = db.query(DatasetItem).filter_by(id=submission.item_id).first()
        if item is not None:
            item.status = "COMPLETED"
    except ImportError:
        pass


def _execute_review(db, job_id: str) -> None:
    from app.models.llm import LLMCallLog
    from app.models.review import AIReviewJob, ReviewConfig, ReviewResult
    from app.models.submission import Submission
    from app.models.user import User

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
        action="AI_REVIEW_STARTED",
        actor_id=system_actor_id,
        after={"jobId": job.id, "retryCount": job.retry_count},
    )
    db.commit()

    review_config = db.query(ReviewConfig).filter_by(task_id=submission.task_id).first()

    if not review_config or not review_config.enabled:
        _fail_to_human(db, job, submission, system_actor_id, "ReviewConfig 不存在或已禁用")
        return

    snapshot = job.workflow_snapshot_json
    try:
        if not snapshot or snapshot.get("version") != VERSION:
            raise ValueError("任务缺少固定工作流快照，请转人工审核")
        context = snapshot["context"]
        validate_config(context["dimensions"], context["thresholds"])
        if not context["item"]["sourcePayload"]:
            raise ValueError("原始材料为空")
        messages = review_messages(snapshot)
        input_hash = hash_canonical_json(messages)
        prompt_hash = hash_canonical_json(snapshot["promptTemplate"])
    except (ValueError, KeyError, TypeError, TemplateError):
        _fail_to_human(db, job, submission, system_actor_id, "AI 上下文无效或缺少快照")
        return

    llm_log = LLMCallLog(
        id="llm_" + uuid4().hex,
        purpose="AI_REVIEW",
        actor_id=system_actor_id,
        submission_id=submission.id,
        model_policy_id=snapshot["modelPolicyId"],
        prompt_snapshot_hash=prompt_hash,
        input_hash=input_hash,
        status="PENDING",
    )
    db.add(llm_log)
    db.flush()

    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.DOUBAO_API_KEY, base_url=settings.DOUBAO_BASE_URL, timeout=30, max_retries=0)
        llm_log.status = "RUNNING"
        db.flush()

        _started = time.monotonic()
        response = client.chat.completions.create(
            model=snapshot["model"]["model"],
            messages=messages,
            tools=[AI_REVIEW_TOOL],
            tool_choice={"type": "function", "function": {"name": "submit_ai_review_result"}},
            temperature=snapshot["model"]["temperature"],  # 固定采样参数，不声称模型完全确定
            max_tokens=4096,      # 有界输出；截断响应仍会被拒绝
        )
        _latency_ms = int((time.monotonic() - _started) * 1000)
        raw_result = _extract_ai_result(response)
        ai_result = validate_review_result(raw_result, context["dimensions"], context["thresholds"], field_names(context["schema"]))
        output_hash = hash_canonical_json(raw_result)

        llm_log.status = "SUCCEEDED"
        llm_log.output_hash = output_hash
        llm_log.latency_ms = _latency_ms
        # Token 用量（TC-AI-07 可追溯）；部分网关可能不返回 usage，做容错
        _usage = getattr(response, "usage", None)
        if _usage is not None:
            llm_log.prompt_tokens = getattr(_usage, "prompt_tokens", None)
            llm_log.completion_tokens = getattr(_usage, "completion_tokens", None)
            llm_log.total_tokens = getattr(_usage, "total_tokens", None)
        llm_log.finished_at = datetime.now(timezone.utc)
        job.raw_output_ref = llm_log.id

    except ValueError:
        llm_log.status = "FAILED"
        llm_log.error_message = "AI 审核输出校验失败"
        llm_log.finished_at = datetime.now(timezone.utc)
        _fail_to_human(db, job, submission, system_actor_id, "AI 审核输出校验失败")
        return
    except Exception:
        llm_log.status = "FAILED"
        llm_log.error_message = "AI 服务调用失败"
        llm_log.finished_at = datetime.now(timezone.utc)
        job.failure_reason = "AI 服务调用失败"
        job.retry_count += 1

        if job.retry_count <= job.max_retries:
            job.status = "RETRYING"
            write_audit_log(
                db,
                entity_type="SUBMISSION",
                entity_id=submission.id,
                action="AI_REVIEW_FAILED",
                actor_id=system_actor_id,
                after={"jobId": job.id, "retryCount": job.retry_count, "error": "AI 服务调用失败"},
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
            _fail_to_human(db, job, submission, system_actor_id, "AI 服务调用失败")
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

    # AI_PRECHECK 保存校验后的意见与复算总分；日志摘要保留原始输出的哈希。
    # 原始判断保留供人机一致性对账：
    #   1) 审核策略门控（_route_by_strategy）：AUTO_PASS_RETURN 模式用 totalScore 硬阈值决定
    #      PASS/RETURN；其余模式（AI 预审后人工复核 / 仅质检提示）一律降级转人工，绝不无人工自动流转。
    #   2) 置信度感知路由（_route_with_confidence）：自动模式下，低置信度的 PASS 再降级转人工。
    db.refresh(review_config)
    if not review_config.enabled:
        _fail_to_human(db, job, submission, system_actor_id, "审核配置已禁用")
        return
    raw_decision = ai_result["decision"]
    confidence = ai_result.get("confidence")
    threshold = snapshot["confidenceThreshold"]
    flow_mode = snapshot["flowMode"]
    thresholds_cfg = context["thresholds"]

    strategy_decision, strategy_downgrade = _route_by_strategy(
        raw_decision, flow_mode, ai_result.get("totalScore"), thresholds_cfg
    )
    decision, low_confidence_downgrade = _route_with_confidence(strategy_decision, confidence, threshold)

    action = "AI_REVIEW_SUCCEEDED"
    if decision == "PASS" and flow_mode == AUTO_FLOW_MODE:
        # 高分自动通过 → 直接落终态 ACCEPTED，无需人工（见 _handle_auto_accept）。
        command = "aiReviewAutoAccept"
        action = "AI_REVIEW_AUTO_ACCEPTED"
        _handle_auto_accept(db, submission, system_actor_id)
    elif decision == "PASS":
        # 理论上策略门控已保证非 AUTO 模式不会出现 PASS；保留旧路径作兜底（建议通过待人工）。
        command = "aiReviewPass"
    elif decision == "RETURN":
        command = "aiReviewReturn"
        _handle_submission_return(db, submission, system_actor_id)
    else:
        command = "aiReviewNeedHuman"

    new_sub_status = apply_transition(submission.status, command)
    submission.status = new_sub_status

    write_audit_log(
        db,
        entity_type="SUBMISSION",
        entity_id=submission.id,
        action=action,
        actor_id=system_actor_id,
        after={
            "decision": decision,
            "rawDecision": raw_result["decision"],
            "confidence": confidence,
            "confidenceThreshold": threshold,
            "flowMode": flow_mode,
            "strategyDowngrade": strategy_downgrade,
            "lowConfidenceDowngrade": low_confidence_downgrade,
            "totalScore": ai_result.get("totalScore"),
            "jobId": job.id,
        },
    )

    job.status = "SUCCEEDED"
    job.failure_reason = None  # 重试成功后清除上一次尝试的失败原因
    db.commit()

    logger.info("AI Review completed job=%s decision=%s submission=%s", job_id, decision, submission.id)


@celery_app.task(bind=True, name="app.worker.ai_review_worker.run_ai_review", max_retries=0)
def run_ai_review(self, job_id: str) -> None:
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        _execute_review(db, job_id)
    except Exception:
        db.rollback()
        from app.models.review import AIReviewJob
        from app.models.submission import Submission
        job = db.get(AIReviewJob, job_id)
        submission = db.get(Submission, job.submission_id) if job else None
        if submission and submission.status == "AI_REVIEWING":
            _fail_to_human(db, job, submission, submission.labeler_id, "AI 工作流执行失败")
        logger.error("AI 工作流执行失败 job=%s", job_id)
    finally:
        db.close()
