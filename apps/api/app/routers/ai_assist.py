"""AI Assist 动作路由：reviewer 一键采纳 / 编辑后采纳 / 忽略 的后端闭环。"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import Actor, require_roles
from app.services import ai_assist_domain
from app.schemas.ai_assist import (
    AiAssistActionRequest,
    AiAssistActionResponse,
    AiAssistActionRecordModel,
    AiAssistSuggestionModel,
    ListAiAssistSuggestionsResponse,
)

router = APIRouter(tags=["ai-assist"])


@router.get(
    "/review/submissions/{submission_id}/ai-assist/suggestions",
    response_model=ListAiAssistSuggestionsResponse,
    summary="列出某 Submission 的可操作 AI Assist 建议（含当前状态）",
)
def list_ai_assist_suggestions(
    submission_id: str,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("REVIEWER", "OWNER", "ADMIN")),
) -> ListAiAssistSuggestionsResponse:
    suggestions = ai_assist_domain.list_suggestions(db, submission_id)
    return ListAiAssistSuggestionsResponse(
        suggestions=[AiAssistSuggestionModel(**s) for s in suggestions]
    )


@router.post(
    "/review/submissions/{submission_id}/ai-assist/{suggestion_id}/actions",
    response_model=AiAssistActionResponse,
    status_code=201,
    summary="对一条 AI Assist 建议执行 accept / edit_accept / dismiss（持久化 + 审计）",
)
def submit_ai_assist_action(
    submission_id: str,
    suggestion_id: str,
    req: AiAssistActionRequest,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("REVIEWER", "OWNER", "ADMIN")),
) -> AiAssistActionResponse:
    result = ai_assist_domain.apply_action(db, submission_id, suggestion_id, req, actor)
    return AiAssistActionResponse(
        suggestion=AiAssistSuggestionModel(**result["suggestion"]),
        action=AiAssistActionRecordModel.from_orm(result["action"]),
        auditEventType=result["auditEventType"],
    )
