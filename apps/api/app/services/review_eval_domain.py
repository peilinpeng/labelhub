"""AI 预审 与 人工最终决策 的一致性评估（只读）。

回答"AI 审得准不准"：从 ReviewResult 里取每个提交的 AI 原始预审决策（stage=AI_PRECHECK）
与人工最终决策（stage=HUMAN_REVIEW / FINAL_REVIEW，取最新一条），对账出一致率与混淆矩阵。

设计：
- AI 决策空间 PASS / RETURN / NEED_HUMAN_REVIEW；其中 NEED_HUMAN_REVIEW 是"模型主动弃权"，
  不是对样本好坏的预测，因此**不计入一致率分母**，单独统计为 aiAbstain。
- 人工决策归一化：PASS → PASS；RETURN / REJECT → RETURN。
- 仅对"AI 给了确定判断(PASS/RETURN) 且 该提交已有人工决策"的样本计算一致率。
- 纯读，无副作用。
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models.review import ReviewResult
from app.models.submission import Submission

_HUMAN_STAGES = ("HUMAN_REVIEW", "FINAL_REVIEW")


def _normalize_human(decision: str) -> str:
    """人工决策归一化到 PASS / RETURN（REJECT 视为 RETURN 类的不通过）。"""
    return "PASS" if decision == "PASS" else "RETURN"


def compute_agreement(db: Session, task_id: str | None = None) -> dict[str, Any]:
    """计算 AI 预审 vs 人工最终决策的一致性指标。

    task_id 为空则跨全部任务统计；否则只统计该任务。
    """
    query = db.query(ReviewResult)
    if task_id is not None:
        # 按任务过滤：ReviewResult 无 task_id，经 Submission 关联。
        sub_ids = [s.id for s in db.query(Submission.id).filter(Submission.task_id == task_id).all()]
        if not sub_ids:
            return _empty_result(task_id)
        query = query.filter(ReviewResult.submission_id.in_(sub_ids))

    # 按提交聚合，按时间排序以便取"最新"。
    results = query.order_by(ReviewResult.created_at.asc()).all()
    by_submission: dict[str, dict[str, str]] = {}
    for r in results:
        slot = by_submission.setdefault(r.submission_id, {})
        if r.stage == "AI_PRECHECK":
            slot["ai"] = r.decision  # 原始 LLM 决策（置信度降级前），衡量模型真实判断力
        elif r.stage in _HUMAN_STAGES:
            slot["human"] = r.decision  # 升序遍历，最后写入的即最新人工决策

    confusion = {
        "aiPassHumanPass": 0,
        "aiPassHumanReturn": 0,
        "aiReturnHumanPass": 0,
        "aiReturnHumanReturn": 0,
    }
    agreement = 0
    evaluated = 0
    ai_abstain = 0  # AI=NEED_HUMAN_REVIEW 且已有人工决策

    for slot in by_submission.values():
        ai = slot.get("ai")
        human = slot.get("human")
        if ai is None or human is None:
            continue
        if ai == "NEED_HUMAN_REVIEW":
            ai_abstain += 1
            continue
        if ai not in ("PASS", "RETURN"):
            continue
        h = _normalize_human(human)
        evaluated += 1
        confusion[f"ai{ai.capitalize()}Human{h.capitalize()}"] += 1
        if ai == h:
            agreement += 1

    rate = round(agreement / evaluated, 4) if evaluated else None
    return {
        "taskId": task_id,
        "evaluated": evaluated,
        "agreementCount": agreement,
        "agreementRate": rate,
        "aiAbstain": ai_abstain,
        "confusion": confusion,
        "submissionsConsidered": len(by_submission),
    }


def _empty_result(task_id: str | None) -> dict[str, Any]:
    return {
        "taskId": task_id,
        "evaluated": 0,
        "agreementCount": 0,
        "agreementRate": None,
        "aiAbstain": 0,
        "confusion": {
            "aiPassHumanPass": 0,
            "aiPassHumanReturn": 0,
            "aiReturnHumanPass": 0,
            "aiReturnHumanReturn": 0,
        },
        "submissionsConsidered": 0,
    }
