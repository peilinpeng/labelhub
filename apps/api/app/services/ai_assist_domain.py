"""
AI Assist 动作领域服务：一键采纳 / 编辑后采纳 / 忽略 的后端闭环。

建议（AiAssistSuggestion）由 submission 的 AI 预审结果 fieldIssues 派生（确定性 id），
不单独建表。动作（AiAssistAction）持久化，并写富审计事件：
- accept       → AI_ASSIST_ACCEPTED
- edit_accept  → AI_ASSIST_EDITED
- dismiss      → AI_ASSIST_DISMISSED
accept / edit_accept 若带结构化补丁，尝试应用到 submission.answers_json：
- 成功 → 额外写 AI_ASSIST_PATCH_APPLIED，建议状态 ACCEPTED / EDIT_ACCEPTED
- 失败 → 额外写 AI_ASSIST_PATCH_FAILED，建议状态 APPLY_FAILED（绝不静默）

最低闭环：即使补丁无法应用，采纳动作仍被保存并产生审计事件。
"""
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from app.middleware.error_handler import ResourceNotFoundException
from app.models.ai_assist import AiAssistAction
from app.models.review import ReviewResult
from app.models.submission import Submission
from app.services.audit_event_domain import emit_audit_event

# 答案已冻结、不允许再被 AI 修订写入的终态
_FROZEN_SUBMISSION_STATUSES = {"ACCEPTED", "REJECTED"}

_MAIN_EVENT_TYPE = {
    "accept": "AI_ASSIST_ACCEPTED",
    "edit_accept": "AI_ASSIST_EDITED",
    "dismiss": "AI_ASSIST_DISMISSED",
}
_SUCCESS_STATUS = {
    "accept": "ACCEPTED",
    "edit_accept": "EDIT_ACCEPTED",
    "dismiss": "DISMISSED",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _severity(raw: Any) -> str:
    return raw if raw in ("LOW", "MEDIUM", "HIGH") else "MEDIUM"


def _latest_action(db: Session, suggestion_id: str) -> AiAssistAction | None:
    return (
        db.query(AiAssistAction)
        .filter_by(suggestion_id=suggestion_id)
        .order_by(AiAssistAction.created_at.desc())
        .first()
    )


def derive_suggestions(db: Session, submission: Submission) -> list[dict]:
    """从 AI 预审结果 fieldIssues 派生可操作建议（确定性 id + 当前状态）。"""
    ai_result = (
        db.query(ReviewResult)
        .filter_by(submission_id=submission.id, stage="AI_PRECHECK")
        .order_by(ReviewResult.created_at.desc())
        .first()
    )
    if ai_result is None:
        return []

    result_json = ai_result.result_json or {}
    field_issues = result_json.get("fieldIssues") or []
    answers = submission.answers_json or {}
    suggestions: list[dict] = []

    for index, issue in enumerate(field_issues):
        if not isinstance(issue, dict):
            continue
        suggestion_id = f"aas_{submission.id}_{index}"
        field_name = issue.get("fieldName")
        suggestion_text = issue.get("suggestion")
        message = issue.get("message") or "AI 建议进一步核对本字段。"
        summary = message if not suggestion_text else f"{message}（建议：{suggestion_text}）"

        structured_patch: list[dict] = []
        if isinstance(field_name, str) and field_name and isinstance(suggestion_text, str) and suggestion_text:
            structured_patch = [
                {
                    "fieldName": field_name,
                    "previousValue": answers.get(field_name),
                    "nextValue": suggestion_text,
                }
            ]

        latest = _latest_action(db, suggestion_id)
        status = latest.resulting_status if latest is not None else "PENDING"

        suggestion = {
            "id": suggestion_id,
            "submissionId": submission.id,
            "taskId": submission.task_id,
            "itemId": submission.item_id,
            "schemaVersionId": submission.schema_version_id,
            "fieldName": field_name,
            "assistType": "QUALITY_CHECK",
            "severity": _severity(issue.get("severity")),
            "summary": summary,
            "structuredPatch": structured_patch,
            "status": status,
            "createdAt": ai_result.created_at,
        }
        confidence = result_json.get("confidence")
        if isinstance(confidence, (int, float)):
            suggestion["confidence"] = float(confidence)
        if latest is not None:
            suggestion["resolvedAt"] = latest.created_at
        suggestions.append(suggestion)

    return suggestions


def list_suggestions(db: Session, submission_id: str) -> list[dict]:
    submission = db.query(Submission).filter_by(id=submission_id).first()
    if submission is None:
        raise ResourceNotFoundException(f"Submission {submission_id!r} 不存在")
    return derive_suggestions(db, submission)


def _apply_patch_to_answers(submission: Submission, ops: list[dict]) -> list[str]:
    """把结构化补丁应用到 submission.answers_json，返回实际写入字段名（排序）。

    冻结态 submission 抛 ValueError（由调用方转成 PATCH_FAILED，绝不静默）。
    """
    if submission.status in _FROZEN_SUBMISSION_STATUSES:
        raise ValueError("提交已进入终态，答案已冻结，无法应用 AI 修订。")

    answers = dict(submission.answers_json or {})
    applied: list[str] = []
    for op in ops:
        field_name = op.get("fieldName")
        if not isinstance(field_name, str) or not field_name:
            raise ValueError("结构化补丁缺少有效 fieldName，无法应用。")
        if "nextValue" in op and op["nextValue"] is None:
            answers.pop(field_name, None)
        else:
            answers[field_name] = op.get("nextValue")
        applied.append(field_name)

    submission.answers_json = answers
    return sorted(set(applied))


def apply_action(
    db: Session,
    submission_id: str,
    suggestion_id: str,
    req: Any,
    actor: Any,
) -> dict:
    """对某条建议执行动作，返回 {suggestion, action, auditEventType}。"""
    submission = db.query(Submission).filter_by(id=submission_id).first()
    if submission is None:
        raise ResourceNotFoundException(f"Submission {submission_id!r} 不存在")

    suggestions = derive_suggestions(db, submission)
    suggestion = next((s for s in suggestions if s["id"] == suggestion_id), None)
    if suggestion is None:
        raise ResourceNotFoundException(f"AI 建议 {suggestion_id!r} 不存在")

    action_type = req.action  # Literal 已由 Pydantic 校验合法性
    actor_json = {
        "id": getattr(actor, "id", "usr_system"),
        "role": getattr(actor, "role", "REVIEWER"),
        "displayName": getattr(actor, "display_name", None) or "审核员",
    }
    target = {
        "entityType": "SUBMISSION",
        "entityId": submission.id,
        "taskId": submission.task_id,
        "submissionId": submission.id,
        "schemaVersionId": submission.schema_version_id,
    }

    # 1) 确定要应用的补丁
    ops: list[dict] = []
    if action_type == "accept":
        ops = [op for op in (suggestion.get("structuredPatch") or [])]
    elif action_type == "edit_accept":
        ops = [op.model_dump() for op in (req.editedPatch or [])]

    # 2) 尝试应用补丁（仅 accept/edit_accept 且补丁非空）
    patch_applied: bool | None = None
    applied_field_names: list[str] | None = None
    patch_failure_reason: str | None = None
    resulting_status = _SUCCESS_STATUS[action_type]

    if action_type in ("accept", "edit_accept") and ops:
        try:
            applied_field_names = _apply_patch_to_answers(submission, ops)
            patch_applied = True
        except ValueError as exc:
            patch_applied = False
            patch_failure_reason = str(exc)
            resulting_status = "APPLY_FAILED"

    # 3) 保存动作记录
    action = AiAssistAction(
        id="aaa_" + uuid4().hex,
        suggestion_id=suggestion_id,
        submission_id=submission.id,
        action=action_type,
        resulting_status=resulting_status,
        applied_patch_field_names_json=applied_field_names,
        patch_applied=patch_applied,
        patch_failure_reason=patch_failure_reason,
        comment=req.comment,
        actor_json=actor_json,
        created_at=_now(),
    )
    db.add(action)

    # 4) 写主审计事件
    main_event_type = _MAIN_EVENT_TYPE[action_type]
    main_payload = {
        "suggestionId": suggestion_id,
        "submissionId": submission.id,
        "action": action_type,
        "summary": suggestion.get("summary"),
    }
    if action_type == "accept":
        main_payload["acceptedCount"] = 1
    elif action_type == "dismiss":
        main_payload["dismissedCount"] = 1
    elif action_type == "edit_accept":
        main_payload["editedCount"] = 1
    emit_audit_event(
        db,
        type=main_event_type,
        source="API",
        actor=actor_json,
        target=target,
        payload=main_payload,
        severity="INFO",
        commit=False,
    )

    # 5) 写补丁应用结果审计事件（不静默）
    if patch_applied is True:
        emit_audit_event(
            db,
            type="AI_ASSIST_PATCH_APPLIED",
            source="API",
            actor=actor_json,
            target=target,
            payload={
                "suggestionId": suggestion_id,
                "submissionId": submission.id,
                "action": action_type,
                "patchApplied": True,
                "appliedPatchFieldNames": applied_field_names or [],
                "summary": "AI 修订已应用",
            },
            severity="INFO",
            commit=False,
        )
    elif patch_applied is False:
        emit_audit_event(
            db,
            type="AI_ASSIST_PATCH_FAILED",
            source="API",
            actor=actor_json,
            target=target,
            payload={
                "suggestionId": suggestion_id,
                "submissionId": submission.id,
                "action": action_type,
                "patchApplied": False,
                "patchFailureReason": patch_failure_reason,
                "summary": "AI 修订应用失败",
            },
            severity="WARNING",
            commit=False,
        )

    db.commit()
    db.refresh(action)

    # 6) 组装返回的更新后建议
    updated_suggestion = dict(suggestion)
    updated_suggestion["status"] = resulting_status
    updated_suggestion["resolvedAt"] = action.created_at

    return {
        "suggestion": updated_suggestion,
        "action": action,
        "auditEventType": main_event_type,
    }
