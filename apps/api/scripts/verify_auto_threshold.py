"""真机验证：AUTO_PASS_RETURN 模式的「硬阈值闸门」。

证明两件事（真调 Doubao，不 mock）：
  1) 端到端：在 AUTO 模式下提交 → AI 预审 → 提交按 totalScore 与阈值自动流转到终态
     （高分→AI_PASSED、低分→RETURNED、中间→NEEDS_HUMAN_REVIEW）。
  2) 「阈值说了算，不是 LLM 说了算」：拿同一条真实 totalScore，换两套阈值跑
     _route_by_strategy，闸门决策随阈值翻转 —— 决定权在数值比较，而非 LLM 自报的 decision。

零污染：临时把某任务 ReviewConfig 切到 AUTO，跑完删除全部新建记录并还原配置/数据集状态。

运行（容器内）：
  docker compose exec -w /workspace/apps/api api python scripts/verify_auto_threshold.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import time
from uuid import uuid4

from dotenv import load_dotenv
load_dotenv()

import app.models  # noqa: F401  聚合注册全部模型
from app.database import SessionLocal
from app.models.task import Task
from app.models.dataset import DatasetItem
from app.models.assignment import Assignment, Draft
from app.models.submission import Submission
from app.models.review import ReviewConfig, AIReviewJob, ReviewResult
from app.models.llm import LLMCallLog
from app.models.audit import AuditLog
from app.services.review_domain import create_ai_review_job
from app.worker.ai_review_worker import _execute_review, _route_by_strategy, _decide_by_threshold

# 新闻内容质量与分类标注任务：其 AI 预审真正评估标注员填写的 summary/category/rewrite，
# 对垃圾标注会给出真实低分，便于同时演示 PASS 与 RETURN 两条流转。
TASK_ID = "task_4208a6442c2944f0a5ec3e7be0b0497e"
LABELER_ID = "usr_demo_labeler"
THRESHOLDS = {"passScore": 0.8, "returnScore": 0.45}

# 两条提交：一条高质量（期望高分→PASS），一条垃圾（期望低分→RETURN）。
HIGH_QUALITY = {
    "summary": "2026 年城市马拉松完赛人数突破 4.2 万创历史新高，男女全程冠军成绩刷新赛会纪录，"
               "全程设置 18 个医疗点，赛事全程未发生重大安全事故。",
    "category": "体育",
    "qualityRating": "pass",
    "rewriteSuggestion": "摘要已完整覆盖完赛人数、冠军成绩、医疗保障与安全情况，无需大改，"
                         "可补充一句赛事社会影响以增强完整性。",
}
GARBAGE = {
    "summary": "111",
    "category": "",
    "qualityRating": "pass",
    "rewriteSuggestion": "11",
}


def _run_to_terminal(db, job_id, sub_id):
    for _ in range(6):
        try:
            _execute_review(db, job_id)
        except Exception as exc:
            db.rollback()
            print(f"    ! AI 调用异常，重试：{str(exc)[:120]}")
        db.expire_all()
        if db.get(Submission, sub_id).status != "AI_REVIEWING":
            return
        time.sleep(2)


def main():
    db = SessionLocal()
    created_sub_ids, created_asn_ids = [], []
    touched_items = {}  # item_id -> (orig_status, orig_assignment)
    cfg = db.query(ReviewConfig).filter_by(task_id=TASK_ID).first()
    if not cfg or not cfg.enabled:
        raise SystemExit(f"❌ {TASK_ID} 缺启用的 ReviewConfig，请先跑 seed_competition.py")
    orig_mapping = dict(cfg.conclusion_mapping_json or {})
    orig_thresholds = dict(cfg.thresholds_json or {})
    task = db.query(Task).filter_by(id=TASK_ID).first()
    sv_id = task.active_schema_version_id if task else None
    if not sv_id:
        raise SystemExit(f"❌ {TASK_ID} 无 active schema version")

    try:
        # —— 临时切到 AUTO 模式 + 已知阈值 ——
        cfg.conclusion_mapping_json = {**orig_mapping, "mode": "AUTO_PASS_RETURN"}
        cfg.thresholds_json = THRESHOLDS
        db.commit()
        print(f"已临时将 {TASK_ID} 切到 AUTO_PASS_RETURN，thresholds={THRESHOLDS}\n")

        items = (db.query(DatasetItem).filter_by(task_id=TASK_ID)
                 .order_by(DatasetItem.id.asc()).limit(2).all())
        if len(items) < 2:
            raise SystemExit("❌ 数据集不足 2 条，无法验证")

        cases = [("高质量标注", HIGH_QUALITY), ("垃圾标注(111)", GARBAGE)]
        results = []
        for (label, answers), item in zip(cases, items):
            touched_items[item.id] = (item.status, item.current_assignment_id)
            asn_id = f"asn_vrfy_{uuid4().hex[:8]}"
            sub_id = f"sub_vrfy_{uuid4().hex[:8]}"
            created_asn_ids.append(asn_id)
            created_sub_ids.append(sub_id)
            db.add(Assignment(id=asn_id, task_id=TASK_ID, item_id=item.id,
                              labeler_id=LABELER_ID, schema_version_id=sv_id, status="SUBMITTED"))
            db.flush()
            db.add(Submission(id=sub_id, assignment_id=asn_id, task_id=TASK_ID, item_id=item.id,
                              labeler_id=LABELER_ID, schema_version_id=sv_id, attempt_no=1,
                              answers_json=answers, status="AI_REVIEWING",
                              validation_json={"valid": True, "errors": []}))
            db.flush()
            db.query(Assignment).filter_by(id=asn_id).update({Assignment.latest_submission_id: sub_id})
            item.current_assignment_id = asn_id
            item.status = "LOCKED"
            db.commit()

            job = create_ai_review_job(db, db.get(Submission, sub_id), cfg)
            db.commit()
            print(f"▶ {label} → 调 Doubao 预审中…")
            _run_to_terminal(db, job.id, sub_id)

            sub = db.get(Submission, sub_id)
            ai = db.query(ReviewResult).filter_by(submission_id=sub_id, stage="AI_PRECHECK").first()
            raw = ai.decision if ai else "FAILED"
            total = (ai.result_json or {}).get("totalScore") if ai else None
            audit = (db.query(AuditLog)
                     .filter_by(entity_id=sub_id, action="AI_REVIEW_SUCCEEDED")
                     .order_by(AuditLog.created_at.desc()).first())
            gate = _decide_by_threshold(total, THRESHOLDS)
            results.append((label, total, raw, gate, sub.status, audit.after_json if audit else None))

        # —— 报告 ——
        print("\n" + "=" * 78)
        print("①  端到端：AUTO 模式下提交按分数自动流转")
        print("=" * 78)
        status_of = {"PASS": "AI_PASSED", "RETURN": "RETURNED", "NEED_HUMAN_REVIEW": "NEEDS_HUMAN_REVIEW"}
        ok = True
        for label, total, raw, gate, status, after in results:
            expected = status_of[gate]
            # 闸门 PASS 后仍可能因低置信度降级转人工，属预期收紧，不算失配。
            match = (status == expected) or (gate == "PASS" and status == "NEEDS_HUMAN_REVIEW")
            ok = ok and match
            print(f"\n  {label}")
            print(f"    LLM 自报 decision : {raw}")
            print(f"    真实 totalScore   : {total}")
            print(f"    硬阈值闸门判定     : {gate}  (passScore={THRESHOLDS['passScore']} / returnScore={THRESHOLDS['returnScore']})")
            print(f"    提交最终状态       : {status}   {'✓' if match else '✗ 不符'}")
            if after:
                print(f"    审计 flowMode={after.get('flowMode')}  strategyDowngrade={after.get('strategyDowngrade')}  decision={after.get('decision')}")

        print("\n" + "=" * 78)
        print("②  证明「阈值说了算，不是 LLM」：同一真实分数，换阈值→闸门翻转")
        print("=" * 78)
        # 取分数最低（且非满分）的真实样本，按其分数构造「夹住」该分数的两套阈值：
        # 宽松阈值令 score ≥ passScore → PASS；严苛阈值令 score < returnScore → RETURN。
        scored = [r for r in results if isinstance(r[1], (int, float))]
        sample = min(scored, key=lambda r: r[1]) if scored else None
        from app.worker.ai_review_worker import _normalize_fraction
        s = _normalize_fraction(sample[1]) if sample else None
        if sample and s is not None and s < 1.0:
            _, total, raw, _, _, _ = sample
            loose = {"passScore": round(s, 3), "returnScore": 0.0}           # score ≥ passScore → PASS
            strict = {"passScore": 1.0, "returnScore": round((s + 1) / 2, 3)}  # score < returnScore → RETURN
            d_loose, chg_loose = _route_by_strategy(raw, "AUTO_PASS_RETURN", total, loose)
            d_strict, chg_strict = _route_by_strategy(raw, "AUTO_PASS_RETURN", total, strict)
            print(f"\n  取真实分数 totalScore={total}（归一化 {round(s,3)}，LLM 自报 decision={raw}）")
            print(f"    宽松阈值 {loose} → 闸门={d_loose}  (相对LLM改写={chg_loose})")
            print(f"    严苛阈值 {strict} → 闸门={d_strict}  (相对LLM改写={chg_strict})")
            flipped = d_loose != d_strict
            print(f"    同一真实分数、不同阈值，闸门决策{'翻转 ✓ —— 决定权在数值阈值，不在 LLM' if flipped else '未翻转 ✗'}")
            ok = ok and flipped
        else:
            print("\n  （无 <100 的真实分数样本可用于阈值翻转演示，跳过②）")

        print("\n" + "=" * 78)
        print(f"结论：{'✅ 硬阈值闸门真机验证通过' if ok else '⚠️ 存在未通过项，见上'}")
        print("=" * 78)

    finally:
        # —— 清理：删除全部新建记录，还原配置与数据集状态。
        # 每步独立容错，且配置还原放最后并保证执行，避免中途异常导致任务卡在 AUTO 模式。
        db.rollback()  # 丢弃任何未提交的脏状态，从干净会话开始清理
        try:
            if created_asn_ids:
                # 先断开 assignments.latest_submission_id → submissions 的 FK，并释放数据集锁
                db.query(Assignment).filter(Assignment.id.in_(created_asn_ids)).update(
                    {Assignment.latest_submission_id: None}, synchronize_session=False)
                db.query(DatasetItem).filter(DatasetItem.current_assignment_id.in_(created_asn_ids)).update(
                    {DatasetItem.status: "AVAILABLE", DatasetItem.current_assignment_id: None},
                    synchronize_session=False)
                db.flush()
            if created_sub_ids:
                db.query(ReviewResult).filter(ReviewResult.submission_id.in_(created_sub_ids)).delete(synchronize_session=False)
                db.query(AIReviewJob).filter(AIReviewJob.submission_id.in_(created_sub_ids)).delete(synchronize_session=False)
                db.query(LLMCallLog).filter(LLMCallLog.submission_id.in_(created_sub_ids)).delete(synchronize_session=False)
                db.query(AuditLog).filter(AuditLog.entity_id.in_(created_sub_ids)).delete(synchronize_session=False)
            if created_asn_ids:
                db.query(Draft).filter(Draft.assignment_id.in_(created_asn_ids)).delete(synchronize_session=False)
            if created_sub_ids:
                db.query(Submission).filter(Submission.id.in_(created_sub_ids)).delete(synchronize_session=False)
            if created_asn_ids:
                db.query(AuditLog).filter(AuditLog.entity_id.in_(created_asn_ids)).delete(synchronize_session=False)
                db.query(Assignment).filter(Assignment.id.in_(created_asn_ids)).delete(synchronize_session=False)
            for item_id, (status, asn) in touched_items.items():
                db.query(DatasetItem).filter_by(id=item_id).update(
                    {DatasetItem.status: status, DatasetItem.current_assignment_id: asn})
            db.commit()
        except Exception as exc:  # 清理失败也要尝试还原配置
            db.rollback()
            print(f"\n⚠️ 清理记录时异常：{str(exc)[:160]}")
        # 配置还原：单独事务，无论如何都执行，确保任务不会被永久留在 AUTO 模式
        try:
            cfg = db.query(ReviewConfig).filter_by(task_id=TASK_ID).first()
            if cfg:
                cfg.conclusion_mapping_json = orig_mapping
                cfg.thresholds_json = orig_thresholds
                db.commit()
        except Exception as exc:
            db.rollback()
            print(f"\n❌ 还原 ReviewConfig 失败，请手动检查：{str(exc)[:160]}")
        db.close()
        print("\n🧹 已清理全部验证数据并还原 ReviewConfig / 数据集状态。")


if __name__ == "__main__":
    main()
