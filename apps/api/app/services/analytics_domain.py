"""
绩效看板聚合服务（只读）。

所有指标均由现有表实时聚合，不写库、不依赖新埋点：
  - AI 成本     ← llm_call_logs（token / 调用数 / 延迟 / 失败率，按 purpose 拆）
  - Labeler 效能 ← submissions（归属 + 终态）+ review_results（AI 维度分、审核员补丁）
  - AI-人工一致率 ← review_results（AI_PRECHECK 原始决策 vs 人工 HUMAN/FINAL 终判）

口径要点（与产品确认）：
  - rawDecision 取自 review_results.AI_PRECHECK（稳定结构化来源），不依赖审计事件结构。
  - 一致率仅统计「同时有 AI 原判(PASS/RETURN)且有人工终判」的提交；NEED_HUMAN_REVIEW
    不计入一致率，只计入转人工率。映射：AI PASS↔人工 PASS 一致；AI RETURN↔人工 RETURN/REJECT 一致。
  - SCHEMA_GENERATION 调用不挂 submission/assignment，无法按 task 归属，恒按全局统计。
"""
from typing import Any

from sqlalchemy.orm import Session

from app.models.assignment import Assignment
from app.models.llm import LLMCallLog
from app.models.review import ReviewResult
from app.models.submission import Submission
from app.models.task import Task
from app.models.user import User

_PURPOSES = ["AI_REVIEW", "LLM_ASSIST", "SCHEMA_GENERATION"]
_TERMINAL = ("ACCEPTED", "RETURNED", "REJECTED")
_IN_REVIEW = (
    "SUBMITTED", "AI_REVIEWING", "AI_PASSED",
    "NEEDS_HUMAN_REVIEW", "HUMAN_REVIEWING", "FINAL_REVIEWING",
)


def _ratio(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return round(numerator / denominator, 4)


def _normalize_score(value: Any) -> float | None:
    """AI totalScore：契约 0-100，但历史/不同来源可能落 0-1，统一抹平到 0-100。"""
    if not isinstance(value, (int, float)):
        return None
    v = float(value)
    return round(v * 100, 2) if v <= 1 else round(v, 2)


# ---------------------------------------------------------------------------
# AI 成本
# ---------------------------------------------------------------------------

def _submission_ids_for_task(db: Session, task_id: str) -> set[str]:
    rows = db.query(Submission.id).filter(Submission.task_id == task_id).all()
    return {r[0] for r in rows}


def _assignment_ids_for_task(db: Session, task_id: str) -> set[str]:
    rows = db.query(Assignment.id).filter(Assignment.task_id == task_id).all()
    return {r[0] for r in rows}


def _build_ai_cost(db: Session, task_id: str | None) -> dict:
    logs = db.query(LLMCallLog).all()

    sub_ids = _submission_ids_for_task(db, task_id) if task_id else None
    asn_ids = _assignment_ids_for_task(db, task_id) if task_id else None

    def in_scope(log: LLMCallLog) -> bool:
        # 无 taskId：全局；有 taskId：按归属过滤，SCHEMA_GENERATION 始终算全局。
        if task_id is None:
            return True
        if log.purpose == "AI_REVIEW":
            return log.submission_id in sub_ids
        if log.purpose == "LLM_ASSIST":
            return log.assignment_id in asn_ids
        # SCHEMA_GENERATION 无法按 task 归属 → 恒全局纳入
        return log.purpose == "SCHEMA_GENERATION"

    by_purpose = []
    total_calls = 0
    total_tokens = 0
    for purpose in _PURPOSES:
        rows = [g for g in logs if g.purpose == purpose and in_scope(g)]
        calls = len(rows)
        succeeded = sum(1 for g in rows if g.status == "SUCCEEDED")
        failed = sum(1 for g in rows if g.status == "FAILED")
        token_rows = [g.total_tokens for g in rows if isinstance(g.total_tokens, int)]
        tokens = sum(token_rows)
        latency_rows = [g.latency_ms for g in rows if isinstance(g.latency_ms, int)]
        avg_latency = round(sum(latency_rows) / len(latency_rows)) if latency_rows else None
        scope = "global" if (task_id is None or purpose == "SCHEMA_GENERATION") else "task"
        by_purpose.append({
            "purpose": purpose,
            "scope": scope,
            "calls": calls,
            "succeeded": succeeded,
            "failed": failed,
            "failureRate": _ratio(failed, calls),
            "totalTokens": tokens,
            "tokenCoverage": _ratio(len(token_rows), calls),
            "avgLatencyMs": avg_latency,
        })
        total_calls += calls
        total_tokens += tokens

    return {
        "byPurpose": by_purpose,
        "totalCalls": total_calls,
        "totalTokens": total_tokens,
        "schemaGenerationTaskScoped": False,
    }


# ---------------------------------------------------------------------------
# Labeler 效能
# ---------------------------------------------------------------------------

def _build_labelers(db: Session, task_id: str | None) -> list[dict]:
    q = db.query(Submission)
    if task_id:
        q = q.filter(Submission.task_id == task_id)
    submissions = q.all()
    if not submissions:
        return []

    sub_ids = [s.id for s in submissions]

    # 该批提交的 AI 预审分（AI_PRECHECK）与人工补丁（HUMAN/FINAL）一次性取出，避免 N+1。
    results = (
        db.query(ReviewResult)
        .filter(ReviewResult.submission_id.in_(sub_ids))
        .all()
    )
    ai_score_by_sub: dict[str, float] = {}
    patches_by_sub: dict[str, int] = {}
    for r in results:
        rj = r.result_json or {}
        if r.stage == "AI_PRECHECK":
            score = _normalize_score(rj.get("totalScore"))
            if score is not None:
                ai_score_by_sub[r.submission_id] = score
        elif r.stage in ("HUMAN_REVIEW", "FINAL_REVIEW"):
            patches = rj.get("patches")
            if isinstance(patches, list):
                patches_by_sub[r.submission_id] = patches_by_sub.get(r.submission_id, 0) + len(patches)

    # 标注员显示名
    labeler_ids = {s.labeler_id for s in submissions}
    name_by_id = {
        u.id: (u.display_name or u.id)
        for u in db.query(User).filter(User.id.in_(labeler_ids)).all()
    }

    agg: dict[str, dict] = {}
    for s in submissions:
        a = agg.setdefault(s.labeler_id, {
            "submitted": 0, "accepted": 0, "returned": 0, "rejected": 0, "inReview": 0,
            "scoreSum": 0.0, "scoreN": 0, "patched": 0,
        })
        a["submitted"] += 1
        if s.status == "ACCEPTED":
            a["accepted"] += 1
        elif s.status == "RETURNED":
            a["returned"] += 1
        elif s.status == "REJECTED":
            a["rejected"] += 1
        elif s.status in _IN_REVIEW:
            a["inReview"] += 1
        if s.id in ai_score_by_sub:
            a["scoreSum"] += ai_score_by_sub[s.id]
            a["scoreN"] += 1
        a["patched"] += patches_by_sub.get(s.id, 0)

    rows = []
    for labeler_id, a in agg.items():
        terminal = a["accepted"] + a["returned"] + a["rejected"]
        rows.append({
            "labelerId": labeler_id,
            "displayName": name_by_id.get(labeler_id, labeler_id),
            "submitted": a["submitted"],
            "accepted": a["accepted"],
            "returned": a["returned"],
            "rejected": a["rejected"],
            "inReview": a["inReview"],
            "acceptRate": _ratio(a["accepted"], terminal),
            "returnRate": _ratio(a["returned"] + a["rejected"], terminal),
            "avgAiScore": round(a["scoreSum"] / a["scoreN"], 2) if a["scoreN"] else None,
            "reviewerPatchedFields": a["patched"],
        })
    # 按提交数降序，便于阅读；不做加权排名/评级。
    rows.sort(key=lambda r: r["submitted"], reverse=True)
    return rows


# ---------------------------------------------------------------------------
# AI-人工一致率
# ---------------------------------------------------------------------------

def _build_ai_quality(db: Session, task_id: str | None) -> dict:
    q = db.query(Submission)
    if task_id:
        q = q.filter(Submission.task_id == task_id)
    sub_ids = [s.id for s in q.all()]
    if not sub_ids:
        return {
            "aiRawTotal": 0,
            "byRawDecision": {"PASS": 0, "RETURN": 0, "NEED_HUMAN_REVIEW": 0},
            "humanReviewRate": None,
            "evaluated": 0,
            "agreements": 0,
            "agreementRate": None,
        }

    results = (
        db.query(ReviewResult)
        .filter(ReviewResult.submission_id.in_(sub_ids))
        .order_by(ReviewResult.created_at.asc())
        .all()
    )

    # AI 原始决策（AI_PRECHECK.decision，稳定来源）
    ai_raw: dict[str, str] = {}
    # 人工终判：取最新一条 HUMAN_REVIEW / FINAL_REVIEW 的 decision
    human_final: dict[str, str] = {}
    for r in results:
        if r.stage == "AI_PRECHECK":
            ai_raw[r.submission_id] = r.decision
        elif r.stage in ("HUMAN_REVIEW", "FINAL_REVIEW"):
            human_final[r.submission_id] = r.decision  # 已按时间升序，最后写入即最新

    by_raw = {"PASS": 0, "RETURN": 0, "NEED_HUMAN_REVIEW": 0}
    for dec in ai_raw.values():
        if dec in by_raw:
            by_raw[dec] += 1
    ai_raw_total = len(ai_raw)

    evaluated = 0
    agreements = 0
    for sub_id, raw in ai_raw.items():
        if raw not in ("PASS", "RETURN"):
            continue  # NEED_HUMAN_REVIEW 不计入一致率
        human = human_final.get(sub_id)
        if human is None:
            continue  # 无人工终判，不纳入
        evaluated += 1
        ai_side_pass = (raw == "PASS")
        human_side_pass = (human == "PASS")  # 人工 PASS=通过；RETURN/REJECT=不通过
        if ai_side_pass == human_side_pass:
            agreements += 1

    return {
        "aiRawTotal": ai_raw_total,
        "byRawDecision": by_raw,
        "humanReviewRate": _ratio(by_raw["NEED_HUMAN_REVIEW"], ai_raw_total),
        "evaluated": evaluated,
        "agreements": agreements,
        "agreementRate": _ratio(agreements, evaluated),
    }


# ---------------------------------------------------------------------------
# 组合
# ---------------------------------------------------------------------------

def get_dashboard(db: Session, task_id: str | None) -> dict:
    task_title = None
    if task_id:
        task = db.query(Task).filter_by(id=task_id).first()
        task_title = task.title if task else None

    return {
        "scope": {"taskId": task_id, "taskTitle": task_title},
        "aiCost": _build_ai_cost(db, task_id),
        "labelers": _build_labelers(db, task_id),
        "aiQuality": _build_ai_quality(db, task_id),
    }
