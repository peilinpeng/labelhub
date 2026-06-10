"""
ai_assist_actions 表 ORM 模型，对应 contracts `AiAssistActionRecord`（ai-assist.ts）。

记录 reviewer 对某条 AI Assist 建议执行的动作（accept / edit_accept / dismiss）及其结果。
建议本身（AiAssistSuggestion）由 AI 预审结果 fieldIssues 派生，不单独建表；
本表是「动作 + 状态 + patch 应用结果」的追加只写审计记录，无 updated_at。
"""
from sqlalchemy import Column, String, Text, Boolean, JSON, DateTime, ForeignKey, func

from app.database import Base


class AiAssistAction(Base):
    __tablename__ = "ai_assist_actions"

    # ID 由应用层生成，前缀 aaa_
    id = Column(String(64), primary_key=True, nullable=False)

    # 派生建议 id（格式 aas_{submission_id}_{index}），不建外键（建议非独立表）
    suggestion_id = Column(String(128), nullable=False)

    # FK → submissions.id
    submission_id = Column(String(64), ForeignKey("submissions.id"), nullable=False)

    # contracts AiAssistActionType：accept / edit_accept / dismiss
    action = Column(String(20), nullable=False)

    # contracts AiAssistSuggestionStatus：动作执行后建议进入的状态
    #   ACCEPTED / EDIT_ACCEPTED / DISMISSED / APPLY_FAILED
    resulting_status = Column(String(20), nullable=False)

    # accept / edit_accept 实际应用的字段名（排序后）
    applied_patch_field_names_json = Column(JSON, nullable=True)

    # accept / edit_accept 时结构化补丁是否成功应用；dismiss 为 None
    patch_applied = Column(Boolean, nullable=True)

    # 补丁应用失败原因（人话），仅 APPLY_FAILED 时出现
    patch_failure_reason = Column(Text, nullable=True)

    # 审核员备注
    comment = Column(Text, nullable=True)

    # contracts AuditActor（{id, role, displayName?}）原样 JSON
    actor_json = Column(JSON, nullable=False)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
