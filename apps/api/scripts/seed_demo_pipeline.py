"""
在举办方真实数据上生成「真实评审历史」，供答辩演示（真调 Doubao，不 mock）。

背景：seed_competition.py 只建任务 + 数据集 + schema + ReviewConfig，没有任何提交/审核记录，
导致 AI 一致率、质量护照、Reviewer 队列全是空的。本脚本对两个真实任务
（task_demo_qa_quality / task_demo_pref_compare）真跑一遍流水线：
  直接构造提交（标注答案，pref 用数据集自带 ground-truth）
  → 同步真调 Doubao 跑 AI 预审（写 AI_PRECHECK ReviewResult）
  → 对 AI 判通过(AI_PASSED) 的提交做人工审核，按 --disagree-rate 故意翻转少量 → 非平凡一致率
  → 一部分走到 ACCEPTED（质量护照非空），留 --leave-queue 条在队列（现场可审）。

关键链路约束：AI 判 RETURN 的提交直接回到 RETURNED、不进人工审核，故一致率有效样本
（evaluated）来自 AI=PASS 的提交，口径为「AI 判通过时人工的认同率」。

幂等可复跑：每次先重置两任务的评审历史（保留 task/schema/review_config/dataset_items）。
顺带删除非举办方的 task_demo_news_quality（--keep-news 可关）。

运行（容器内）：
  docker compose exec -w /workspace/apps/api api python scripts/seed_demo_pipeline.py --dry-run
  docker compose exec -w /workspace/apps/api api python scripts/seed_demo_pipeline.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import argparse
import random
import time
from types import SimpleNamespace
from uuid import uuid4

from dotenv import load_dotenv
load_dotenv()  # 必须在 import app.* 之前（读 DOUBAO_API_KEY 等）

import app.models  # noqa: F401  聚合注册全部模型，避免跨表 FK 解析报错
from app.database import SessionLocal
from app.models.task import Task
from app.models.dataset import DatasetItem
from app.models.assignment import Assignment, Draft
from app.models.submission import Submission
from app.models.review import ReviewConfig, AIReviewJob, ReviewResult
from app.models.ai_assist import AiAssistAction
from app.models.export import ExportJob
from app.models.export_record import ExportRecord
from app.models.llm import LLMCallLog
from app.services.review_domain import create_ai_review_job, claim_review, submit_review_decision
from app.services.review_eval_domain import compute_agreement
from app.schemas.review import ReviewDecisionRequest
from app.worker.ai_review_worker import _execute_review

QA_TASK = "task_demo_qa_quality"
PREF_TASK = "task_demo_pref_compare"
NEWS_TASK = "task_demo_news_quality"
LABELER_ID = "usr_demo_labeler"
REVIEWER_ID = "usr_demo_reviewer"

# Reviewer 决策只读 actor.id/role/display_name，无需走鉴权中间件。
REVIEWER_ACTOR = SimpleNamespace(id=REVIEWER_ID, role="REVIEWER", display_name="演示 Reviewer")

# pref 数据集 margin 用中文标签，schema 字段值是 strong/slight/equal，需映射。
_MARGIN_MAP = {"明显优于": "strong", "略优于": "slight", "相当": "equal", "平局": "equal"}


# ---------------------------------------------------------------------------
# answers 模板（字段名取自 seed_competition.py 两任务 schema）
# ---------------------------------------------------------------------------

def _qa_answers(idx: int, rng: random.Random) -> dict:
    """qa_quality 答案。每 4 条造一条低质量样本，让 AI 有理由判 RETURN，制造决策多样性。"""
    low_quality = (idx % 4 == 0)
    if low_quality:
        return {
            "relevance": rng.choice(["2", "3"]),
            "accuracy": "2",
            "compliance": "3",
            "safety": "4",
            "issue_types": ["fact_error", "off_topic"],
            "one_line_summary": "回答与问题相关性不足，存在事实偏差。",
            "detail_comment": "模型回答偏离用户意图，部分内容与参考答案矛盾，建议退回重做。",
        }
    return {
        "relevance": rng.choice(["4", "5"]),
        "accuracy": rng.choice(["4", "5"]),
        "compliance": "5",
        "safety": "5",
        "issue_types": [],
        "one_line_summary": "回答准确、相关性高，格式规范。",
        "detail_comment": "模型回答覆盖参考答案要点，表述清晰，无明显事实错误。",
    }


def _pref_answers(payload: dict, rng: random.Random) -> dict:
    """preference_compare 答案：优先用数据集自带 ground-truth（更真实），映射到 schema 取值。"""
    preferred = payload.get("preferred")
    if preferred not in ("A", "B", "tie"):
        preferred = rng.choice(["A", "B"])
    margin = _MARGIN_MAP.get(payload.get("margin"), rng.choice(["strong", "slight"]))
    safety_flag = "yes" if payload.get("safety_flag") else "no"
    note = (payload.get("annotator_note") or "").strip()
    if len(note) < 30:
        note = (note + "；综合相关性、准确性与完整性，做出上述偏好判断。").strip("；")
    return {
        "preferred": preferred,
        "margin": margin,
        "safety_flag": safety_flag,
        "judge_dimensions": ["relevance", "accuracy", "completeness"],
        "one_line_conclusion": f"{preferred} 更优。",
        "annotator_note": note,
    }


# ---------------------------------------------------------------------------
# 幂等重置：只清评审历史，保留 task / schema / review_config / dataset_items
# ---------------------------------------------------------------------------

def _reset_history(db, task_id: str) -> None:
    sub_ids = [r[0] for r in db.query(Submission.id).filter_by(task_id=task_id).all()]
    asn_ids = [r[0] for r in db.query(Assignment.id).filter_by(task_id=task_id).all()]
    job_ids = [r[0] for r in db.query(ExportJob.id).filter_by(task_id=task_id).all()]
    if sub_ids:
        db.query(ReviewResult).filter(ReviewResult.submission_id.in_(sub_ids)).delete(synchronize_session=False)
        db.query(AIReviewJob).filter(AIReviewJob.submission_id.in_(sub_ids)).delete(synchronize_session=False)
        db.query(AiAssistAction).filter(AiAssistAction.submission_id.in_(sub_ids)).delete(synchronize_session=False)
        db.query(ExportRecord).filter(ExportRecord.submission_id.in_(sub_ids)).delete(synchronize_session=False)
        db.query(LLMCallLog).filter(LLMCallLog.submission_id.in_(sub_ids)).delete(synchronize_session=False)
    if job_ids:
        db.query(ExportRecord).filter(ExportRecord.export_job_id.in_(job_ids)).delete(synchronize_session=False)
        db.query(ExportJob).filter(ExportJob.task_id == task_id).delete(synchronize_session=False)
    if asn_ids:
        db.query(LLMCallLog).filter(LLMCallLog.assignment_id.in_(asn_ids)).delete(synchronize_session=False)
        db.query(Draft).filter(Draft.assignment_id.in_(asn_ids)).delete(synchronize_session=False)
        # 断开 assignments→submissions 循环外键，再删 submissions
        db.query(Assignment).filter(Assignment.id.in_(asn_ids)).update(
            {Assignment.latest_submission_id: None}, synchronize_session=False)
        db.flush()
    db.query(Submission).filter_by(task_id=task_id).delete(synchronize_session=False)
    # 题目恢复 AVAILABLE 并断开 dataset_items→assignments 循环外键
    db.query(DatasetItem).filter_by(task_id=task_id).update(
        {DatasetItem.current_assignment_id: None, DatasetItem.status: "AVAILABLE"},
        synchronize_session=False)
    db.flush()
    db.query(Assignment).filter_by(task_id=task_id).delete(synchronize_session=False)
    db.commit()


# ---------------------------------------------------------------------------
# 单任务流水线
# ---------------------------------------------------------------------------

def _run_task(db, task_id: str, answers_fn, per_task: int, leave_queue: int,
              disagree_rate: float, rng: random.Random, dry_run: bool) -> dict:
    task = db.query(Task).filter_by(id=task_id).first()
    if task is None:
        raise SystemExit(f"❌ 任务 {task_id} 不存在，请先跑 scripts/seed_competition.py")
    sv_id = task.active_schema_version_id
    review_config = db.query(ReviewConfig).filter_by(task_id=task_id).first()
    if sv_id is None or review_config is None or not review_config.enabled:
        raise SystemExit(f"❌ 任务 {task_id} 缺 active schema / 启用的 ReviewConfig，请先跑 seed_competition.py")

    items = (db.query(DatasetItem).filter_by(task_id=task_id)
             .order_by(DatasetItem.id.asc()).limit(per_task).all())
    print(f"\n=== {task_id} ===  数据集前 {len(items)} 条用于流水线（共 {db.query(DatasetItem).filter_by(task_id=task_id).count()} 条）")

    if dry_run:
        if not items:
            sample = {}
        elif task_id == PREF_TASK:
            sample = answers_fn(items[0].source_payload or {}, rng)
        else:
            sample = answers_fn(0, rng)
        print(f"  [dry-run] 不调 Doubao、不写库。answers 模板示例：{sample}")
        return {"task": task_id, "dry_run": True}

    _reset_history(db, task_id)

    # 1) 构造提交 + 同步真跑 AI
    ai_dist = {"PASS": 0, "RETURN": 0, "NEED_HUMAN_REVIEW": 0}
    ai_passed_sub_ids: list[str] = []
    for i, item in enumerate(items):
        answers = answers_fn(item.source_payload or {}, rng) if task_id == PREF_TASK else answers_fn(i, rng)
        asn_id = f"asn_pipe_{i:03d}_{uuid4().hex[:6]}"
        sub_id = f"sub_pipe_{i:03d}_{uuid4().hex[:6]}"
        db.add(Assignment(id=asn_id, task_id=task_id, item_id=item.id,
                          labeler_id=LABELER_ID, schema_version_id=sv_id, status="SUBMITTED"))
        db.flush()
        db.add(Submission(id=sub_id, assignment_id=asn_id, task_id=task_id, item_id=item.id,
                          labeler_id=LABELER_ID, schema_version_id=sv_id, attempt_no=1,
                          answers_json=answers, status="AI_REVIEWING",
                          validation_json={"valid": True, "errors": []}))
        db.flush()
        db.query(Assignment).filter_by(id=asn_id).update({Assignment.latest_submission_id: sub_id})
        item.current_assignment_id = asn_id
        item.status = "LOCKED"
        db.commit()

        # 同步真调 Doubao 并驱动到终态。Doubao 偶发超时时 _execute_review 会排 celery 重试
        # 后返回、提交卡在 AI_REVIEWING；这里不依赖后台 worker，自行同步重试直到离开 AI_REVIEWING
        # （成功 → AI_PASSED/RETURNED/NEEDS_HUMAN_REVIEW，或重试耗尽 → NEEDS_HUMAN_REVIEW）。
        job = create_ai_review_job(db, db.get(Submission, sub_id), review_config)
        db.commit()
        t0 = time.time()
        for attempt in range(6):
            try:
                _execute_review(db, job.id)
            except Exception as exc:  # Doubao 偶发异常：不拖垮整轮，下一轮重试
                db.rollback()
                print(f"      ! 第 {attempt + 1} 次 AI 调用异常，重试：{str(exc)[:120]}")
            db.expire_all()  # _execute_review 内部 commit，刷新会话快照
            if db.get(Submission, sub_id).status != "AI_REVIEWING":
                break
            time.sleep(2)
        latency = int((time.time() - t0) * 1000)
        ai = db.query(ReviewResult).filter_by(submission_id=sub_id, stage="AI_PRECHECK").first()
        ai_dec = ai.decision if ai else "FAILED"
        ai_dist[ai_dec] = ai_dist.get(ai_dec, 0) + 1
        if ai_dec == "PASS":
            ai_passed_sub_ids.append(sub_id)
        print(f"  [{i + 1}/{len(items)}] AI decision={ai_dec}  latency={latency}ms")

    # 2) 人工审核分流（只能审 AI_PASSED：AI=RETURN→RETURNED 不可审）
    #    留 leave_queue 条不审（现场队列非空），其余审：按 disagree_rate 翻转为 RETURN。
    rng.shuffle(ai_passed_sub_ids)
    reserve = ai_passed_sub_ids[:leave_queue]
    to_review = ai_passed_sub_ids[leave_queue:]
    n_flip = int(round(disagree_rate * len(to_review)))
    accepted = returned = 0
    for j, sub_id in enumerate(to_review):
        flip = (j < n_flip)  # 前 n_flip 条故意与 AI(PASS) 不一致 → 人工 RETURN
        claim_review(db, sub_id, REVIEWER_ACTOR)
        if flip:
            req = ReviewDecisionRequest(stage="HUMAN_REVIEW", decision="RETURN",
                                        reason="人工复核：答案与参考存在偏差，退回修订。")
            returned += 1
        else:
            req = ReviewDecisionRequest(stage="HUMAN_REVIEW", decision="PASS")
            accepted += 1
        submit_review_decision(db, sub_id, REVIEWER_ACTOR, req)

    agg = compute_agreement(db, task_id)
    print(f"  AI 决策分布: {ai_dist}  |  人工: ACCEPTED={accepted} RETURNED={returned} 留队列(AI_PASSED)={len(reserve)}")
    print(f"  一致率: evaluated={agg['evaluated']} agreementRate={agg['agreementRate']} aiAbstain={agg['aiAbstain']}")
    return {"task": task_id, "ai_dist": ai_dist, "accepted": accepted, "returned": returned,
            "reserved": len(reserve), "agreement": agg}


def _drop_news(db) -> None:
    if db.query(Task).filter_by(id=NEWS_TASK).first() is None:
        print(f"\n（{NEWS_TASK} 不存在，跳过删除）")
        return
    from scripts.clean_demo import _delete_tasks
    _delete_tasks(db, [NEWS_TASK])
    db.commit()
    print(f"\n🗑  已删除非举办方演示任务 {NEWS_TASK}")


def main() -> None:
    parser = argparse.ArgumentParser(description="在举办方真实数据上生成真实评审历史（真调 Doubao）")
    parser.add_argument("--task", choices=["qa", "pref", "both"], default="both")
    parser.add_argument("--per-task", type=int, default=9, help="每任务生成的提交数（留余量不领完）")
    parser.add_argument("--leave-queue", type=int, default=2, help="留在 Reviewer 队列不审的 AI_PASSED 提交数")
    parser.add_argument("--disagree-rate", type=float, default=0.2, help="人工故意与 AI 不一致比例（→ 一致率≈0.8）")
    parser.add_argument("--seed", type=int, default=42, help="random 种子，保证可复现")
    parser.add_argument("--dry-run", action="store_true", help="只打印计划与模板，不调 Doubao 不写库")
    parser.add_argument("--keep-news", action="store_true", help="保留 task_demo_news_quality（默认删除）")
    args = parser.parse_args()

    rng = random.Random(args.seed)
    targets = []
    if args.task in ("qa", "both"):
        targets.append((QA_TASK, _qa_answers))
    if args.task in ("pref", "both"):
        targets.append((PREF_TASK, _pref_answers))

    db = SessionLocal()
    try:
        print("=" * 64)
        print(f"真实数据流水线 seeding（{'DRY-RUN' if args.dry_run else '真跑 · 真调 Doubao'}）")
        print("=" * 64)

        if not args.dry_run and not args.keep_news:
            _drop_news(db)

        results = []
        for task_id, fn in targets:
            results.append(_run_task(db, task_id, fn, args.per_task, args.leave_queue,
                                     args.disagree_rate, rng, args.dry_run))

        if args.dry_run:
            print("\n（dry-run 结束，未写库。去掉 --dry-run 真跑。）")
            return

        print("\n" + "=" * 64)
        print("汇总")
        print("=" * 64)
        for r in results:
            agg = r["agreement"]
            print(f"{r['task']}: AI {r['ai_dist']} | ACCEPTED={r['accepted']} RETURNED={r['returned']} "
                  f"队列保留={r['reserved']} | 一致率 evaluated={agg['evaluated']} rate={agg['agreementRate']}")
            if agg["evaluated"] < 5:
                print(f"  ⚠️  evaluated={agg['evaluated']} 偏小（Doubao 多判转人工）。建议增大 --per-task 重跑。")
    finally:
        db.close()


if __name__ == "__main__":
    main()
