import hashlib
import json
import logging
import time
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


def _loads_lenient(raw: str) -> dict:
    """
    容错解析 LLM 返回的 JSON（提升 AI 鲁棒性 / 评分稳定性）。
    依次尝试：直接解析 → 去 ```json 围栏 → 截取首尾大括号 → 补全未闭合的括号/引号。
    全部失败才抛 ValueError，交由上层重试 / 人工兜底。
    """
    if not raw or not raw.strip():
        raise ValueError("LLM 返回为空")

    candidates: list[str] = [raw]

    # 去掉 markdown 代码围栏
    fenced = raw.strip()
    if fenced.startswith("```"):
        fenced = fenced.split("```", 2)
        fenced = fenced[1] if len(fenced) > 1 else raw
        if fenced.lstrip().lower().startswith("json"):
            fenced = fenced.lstrip()[4:]
        candidates.append(fenced)

    # 截取第一个 { 到最后一个 }
    src = candidates[-1]
    start, end = src.find("{"), src.rfind("}")
    if start != -1 and end > start:
        candidates.append(src[start:end + 1])

    # 对截断的 JSON 做补全（best-effort）：扫描出未闭合的字符串与括号栈，按逆序补齐
    trimmed = candidates[-1]
    stack: list[str] = []
    in_str = False
    esc = False
    for ch in trimmed:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch in "{[":
                stack.append(ch)
            elif ch == "}" and stack and stack[-1] == "{":
                stack.pop()
            elif ch == "]" and stack and stack[-1] == "[":
                stack.pop()
    if in_str or stack:
        repaired = trimmed + ('"' if in_str else "")
        repaired += "".join("}" if c == "{" else "]" for c in reversed(stack))
        candidates.append(repaired)

    last_err: Exception | None = None
    for cand in candidates:
        try:
            parsed = json.loads(cand)
            if isinstance(parsed, dict):
                return parsed
        except Exception as e:  # noqa: BLE001
            last_err = e
    raise ValueError(f"无法解析 LLM JSON 输出：{last_err}")


def _extract_ai_result(response) -> dict:
    """从 LLM 响应提取结构化结果：优先 tool_calls，回退 message.content。"""
    message = response.choices[0].message
    tool_calls = getattr(message, "tool_calls", None)
    if tool_calls:
        return _loads_lenient(tool_calls[0].function.arguments)
    # 部分模型可能不走 function calling，回退解析正文
    if getattr(message, "content", None):
        return _loads_lenient(message.content)
    raise ValueError("LLM 未返回 tool_call 或可解析正文")


def _route_with_confidence(raw_decision: str, confidence, threshold: float) -> tuple[str, bool]:
    """置信度感知路由（human-in-the-loop）。

    LLM 给 PASS 但 confidence 低于阈值时，降级为 NEED_HUMAN_REVIEW，不把"不确定的通过"
    自动放行。仅收紧不放宽：RETURN / NEED_HUMAN_REVIEW 原样返回，永不因此自动通过更多。
    返回 (有效决策, 是否发生了降级)。
    """
    low = (
        raw_decision == "PASS"
        and isinstance(confidence, (int, float))
        and float(confidence) < threshold
    )
    return ("NEED_HUMAN_REVIEW" if low else raw_decision), low


# 仅此模式允许 AI 决策自动流转到终态（自动通过 / 自动打回）。
# 其余模式（AI_THEN_HUMAN / HUMAN_REVIEW_ONLY）下 AI 结论仅作参考，一律转人工复核。
AUTO_FLOW_MODE = "AUTO_PASS_RETURN"


def _normalize_fraction(value) -> float | None:
    """把分数 / 阈值统一归一化到 0..1。totalScore 契约为 0-100，阈值配置为 0-1，
    这里按「>1 视为百分制、除以 100」抹平两种量纲，避免硬比较时鸡同鸭讲。"""
    if not isinstance(value, (int, float)):
        return None
    v = float(value)
    return v / 100.0 if v > 1 else v


def _decide_by_threshold(total_score, thresholds: dict) -> str:
    """AUTO 模式的硬阈值闸门：按 totalScore 与 passScore / returnScore 的数值比较得出决策，
    不再单纯信任 LLM 自报的 decision——阈值才真正「说了算」。

    score >= passScore → PASS；score < returnScore → RETURN；落在中间或缺分 → 转人工。
    """
    score = _normalize_fraction(total_score)
    if score is None:
        return "NEED_HUMAN_REVIEW"
    # 阈值键名存在两套约定：前端存 passScore/returnScore，seed_competition 存 autoPass/autoReturn。
    # 两者都兼容，避免老配置（autoPass/autoReturn）下闸门取不到阈值而恒转人工。
    pass_score = _normalize_fraction(thresholds.get("passScore", thresholds.get("autoPass")))
    return_score = _normalize_fraction(thresholds.get("returnScore", thresholds.get("autoReturn")))
    if pass_score is not None and score >= pass_score:
        return "PASS"
    if return_score is not None and score < return_score:
        return "RETURN"
    return "NEED_HUMAN_REVIEW"


def _route_by_strategy(
    raw_decision: str, mode: str, total_score=None, thresholds: dict | None = None
) -> tuple[str, bool]:
    """审核策略门控：把 owner 配置的 conclusionMapping.mode 真正落到流转上。

    - AUTO_PASS_RETURN：用 totalScore 与阈值硬比较（_decide_by_threshold）决定 PASS/RETURN/转人工，
      自动通过线由数值闸门把关，而非只信 LLM 的 decision。
    - 其余模式（AI_THEN_HUMAN / HUMAN_REVIEW_ONLY）：AI 结论仅作人工参考，PASS/RETURN 一律
      降级为 NEED_HUMAN_REVIEW，绝不无人工自动流转。

    返回 (有效决策, 是否相对 LLM 原始判断发生改写)。
    """
    if mode == AUTO_FLOW_MODE:
        decided = _decide_by_threshold(total_score, thresholds or {})
        return decided, decided != raw_decision
    if raw_decision in ("PASS", "RETURN"):
        return "NEED_HUMAN_REVIEW", True
    return raw_decision, False


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
        action="AI_REVIEW_STARTED",
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

        _started = time.monotonic()
        response = client.chat.completions.create(
            model=settings.DOUBAO_MODEL,
            messages=[{"role": "user", "content": rendered_prompt}],
            tools=[AI_REVIEW_TOOL],
            tool_choice={"type": "function", "function": {"name": "submit_ai_review_result"}},
            temperature=0,        # 确定性输出，提升评分稳定性
            max_tokens=2048,      # 防止结构化 JSON 被截断（之前未设置导致 "Expecting ':'"）
        )
        _latency_ms = int((time.monotonic() - _started) * 1000)
        ai_result = _extract_ai_result(response)  # 容错解析（截断/围栏/补全）
        raw_output = json.dumps(ai_result, ensure_ascii=False)
        output_hash = _sha256(raw_output)

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

    # 路由分两道闸，AI_PRECHECK 记录上面已存 LLM 原始决策，这里只调整路由用的有效决策，
    # 原始判断保留供人机一致性对账：
    #   1) 审核策略门控（_route_by_strategy）：AUTO_PASS_RETURN 模式用 totalScore 硬阈值决定
    #      PASS/RETURN；其余模式（AI 预审后人工复核 / 仅质检提示）一律降级转人工，绝不无人工自动流转。
    #   2) 置信度感知路由（_route_with_confidence）：自动模式下，低置信度的 PASS 再降级转人工。
    raw_decision = ai_result["decision"]
    confidence = ai_result.get("confidence")
    threshold = settings.AI_REVIEW_CONFIDENCE_THRESHOLD
    conclusion_mapping = review_config.conclusion_mapping_json or {}
    flow_mode = conclusion_mapping.get("mode", "AI_THEN_HUMAN")
    thresholds_cfg = review_config.thresholds_json or {}

    strategy_decision, strategy_downgrade = _route_by_strategy(
        raw_decision, flow_mode, ai_result.get("totalScore"), thresholds_cfg
    )
    decision, low_confidence_downgrade = _route_with_confidence(strategy_decision, confidence, threshold)

    action = "AI_REVIEW_SUCCEEDED"
    if decision == "PASS":
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
            "rawDecision": raw_decision,
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
    except Exception as e:
        logger.exception("ai_review job=%s unexpected error: %s", job_id, e)
    finally:
        db.close()
