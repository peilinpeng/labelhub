"""真机彩排：从零搭一个「新闻内容质量与分类标注」任务并跑全链路（真调 Doubao）。

模拟答辩当天 Owner 从创建任务 → 导入数据 → 设计 schema → 配 AI 预审(AUTO 模式)
→ 发布 → 标注 → AI 自动流转 的完整链路，确认「好标注自动通过 / 垃圾标注自动打回」
在从零搭出来的配置上稳定生效。跑完删除整个临时任务，DB 还原如初。

运行（容器内）：
  docker compose exec -w /workspace/apps/api api python scripts/verify_news_task_e2e.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import time
from datetime import datetime, timezone
from uuid import uuid4

from dotenv import load_dotenv
load_dotenv()

import app.models  # noqa: F401
from app.database import SessionLocal
from app.models.task import Task
from app.models.schema import SchemaDraft, SchemaVersion
from app.models.dataset import DatasetItem
from app.models.assignment import Assignment, Draft
from app.models.submission import Submission
from app.models.review import ReviewConfig, AIReviewJob, ReviewResult
from app.models.ai_assist import AiAssistAction
from app.models.llm import LLMCallLog
from app.models.audit import AuditLog
from app.services.review_domain import create_ai_review_job
from app.worker.ai_review_worker import _execute_review, _decide_by_threshold, _normalize_fraction
from scripts.seed_competition import _show, _field, _schema

OWNER_ID = "usr_demo_owner"
LABELER_ID = "usr_demo_labeler"
SUFFIX = uuid4().hex[:8]
TASK_ID = f"task_newsverify_{SUFFIX}"

# 用户给的 6 条新闻数据集（内嵌，避免文件挂载路径问题）。
NEWS = [
    {"id": "NEWS-001", "title": "本市首条全自动驾驶地铁线路开通试运营",
     "body": "9月28日，本市轨道交通11号线正式开通试运营。该线路全长约32公里，共设21座车站，采用全自动无人驾驶（GoA4）系统，最高运行时速80公里。官方通报称，初期运营间隔为6分钟，后续将根据客流逐步加密至3分钟。",
     "candidate_categories": ["社会民生", "科技", "财经", "国际"], "source": "市交通委员会官方通报"},
    {"id": "NEWS-002", "title": "国产新一代AI推理芯片发布，单卡算力较上代提升约两倍",
     "body": "某科技公司在年度发布会上推出新一代AI推理芯片，官方称其在主流大模型推理场景下吞吐量较上一代提升约2倍，功耗下降30%。该芯片采用先进封装工艺，预计第四季度量产出货。发布会未披露具体制程节点。",
     "candidate_categories": ["科技", "财经", "社会民生", "体育"], "source": "厂商发布会实录"},
    {"id": "NEWS-003", "title": "央行宣布下调存款准备金率0.5个百分点",
     "body": "中国人民银行公告，自下月起下调金融机构存款准备金率0.5个百分点（不含已执行5%存款准备金率的金融机构），预计释放长期资金约1万亿元。央行表示此举旨在保持流动性合理充裕，支持实体经济。",
     "candidate_categories": ["财经", "社会民生", "国际", "科技"], "source": "中国人民银行公告"},
    {"id": "NEWS-004", "title": "本届城市马拉松完赛人数创历史新高",
     "body": "2026年城市马拉松上周末举行，组委会数据显示完赛人数突破4.2万人，创赛事举办以来新高。男子全程冠军成绩为2小时09分，女子全程冠军成绩为2小时26分。赛事期间共设置18个医疗点，未出现重大安全事故。",
     "candidate_categories": ["体育", "社会民生", "健康", "财经"], "source": "赛事组委会新闻稿"},
    {"id": "NEWS-005", "title": "研究团队公布新型钠离子电池能量密度提升进展",
     "body": "某高校联合实验室发表论文，称其研发的新型钠离子电池正极材料使电芯能量密度达到约160Wh/kg，循环2000次后容量保持率超过85%。研究者表示该结果目前处于实验室阶段，距离规模化量产仍需进一步验证。论文已通过同行评审。",
     "candidate_categories": ["科技", "财经", "健康", "国际"], "source": "同行评审期刊论文摘要"},
    {"id": "NEWS-006", "title": "多国代表出席区域气候合作峰会并签署联合声明",
     "body": "为期两天的区域气候合作峰会闭幕，与会多国代表签署联合声明，承诺在可再生能源、碳市场互联和绿色技术转让等领域加强合作。声明为非约束性文件，具体执行细则将由后续工作组商定。峰会未设定统一的减排时间表。",
     "candidate_categories": ["国际", "财经", "社会民生", "科技"], "source": "峰会联合声明（公开版）"},
]

# 答辩当天要照抄的 AI 预审 prompt（与既有新闻任务一致，已验证能按内容打分）。
REVIEW_PROMPT = """你是 LabelHub 的 AI 预审 Agent。请基于下面这条样本的真实内容，对【标注答案】做质量预审。

【题目 / 源数据】
{{ item.sourcePayload }}

【标注答案】
{{ submission.answers }}

请对标注答案逐维度打分（每维 0-100 的整数），维度如下：
{% for d in dimensions %}- {{ d.key }}：{{ d.label }}
{% endfor %}
要求：
1. dimensionScores 中每项的 key 必须使用上面的英文维度 key，不要用中文。
2. score 必须依据本样本的具体内容给出，不同样本应有不同分数；reason 用一句中文引用本样本的具体情况。
3. totalScore 取各维度的加权或平均（0-100）。
4. decision：质量明显合格→PASS；存在明显问题应退回→RETURN；把握不足→NEED_HUMAN_REVIEW。
5. summary 用一句中文总结，需引用本样本的具体内容；confidence 为你的把握（0-1）。
请通过 submit_ai_review_result 函数提交结构化结果。"""

DIMENSIONS = [
    {"key": "factuality", "label": "事实完整性", "weight": 0.3, "scoreRange": [0.0, 1.0], "description": "事实表述是否完整、可核查"},
    {"key": "category", "label": "类别准确性", "weight": 0.25, "scoreRange": [0.0, 1.0], "description": "类别选择是否符合内容"},
    {"key": "evidence", "label": "证据充分性", "weight": 0.25, "scoreRange": [0.0, 1.0], "description": "是否提供来源、证据或复核说明"},
    {"key": "format", "label": "格式合规", "weight": 0.2, "scoreRange": [0.0, 1.0], "description": "答案格式和必填项是否合规"},
]
THRESHOLDS = {"passScore": 0.8, "returnScore": 0.45}

# 标注样本：good=按正文写全关键数字（期望高分自动通过）；garbage=111（期望低分自动打回）。
GOOD_SUMMARY = {
    "NEWS-001": "本市轨道交通11号线9月28日开通试运营，全长约32公里、设21座车站，采用GoA4全自动无人驾驶、最高时速80公里，初期运营间隔6分钟后续加密至3分钟。",
    "NEWS-004": "2026年城市马拉松完赛人数突破4.2万创历史新高，男子全程冠军2小时09分、女子2小时26分，全程设18个医疗点未发生重大安全事故。",
}
CASES = [
    ("NEWS-001", "good"), ("NEWS-004", "good"),
    ("NEWS-002", "garbage"), ("NEWS-003", "garbage"),
]


def _answers(news_id: str, kind: str) -> dict:
    if kind == "good":
        return {"qualityRating": "pass", "summary": GOOD_SUMMARY[news_id],
                "rewriteSuggestion": "摘要已完整覆盖正文关键事实，表述准确，无需修改。"}
    return {"qualityRating": "pass", "summary": "111", "rewriteSuggestion": "11"}


def _build_task(db) -> str:
    """从零搭任务：Task(DRAFT) → SchemaDraft+Version → ReviewConfig(AUTO) → 导入6条 → PUBLISH。"""
    schema = _schema(f"schema_newsverify_{SUFFIX}", "新闻内容质量与分类标注（彩排）", TASK_ID, children=[
        _show("nv-title", "show.text", "新闻标题", "$.item.sourcePayload.title", {"type": "TEXT", "fallback": "（无）"}),
        _show("nv-body", "show.text", "新闻正文", "$.item.sourcePayload.body", {"type": "TEXT", "fallback": "（无）"}),
        _field("nv-quality", "choice.radio", "qualityRating", "质量判断", required=True, options=[
            {"value": "pass", "label": "通过"}, {"value": "needs_revision", "label": "需要修改"},
            {"value": "rejected", "label": "不可用"}]),
        _field("nv-summary", "input.textarea", "summary", "新闻摘要", required=True),
        _field("nv-rewrite", "input.textarea", "rewriteSuggestion", "修改建议"),
    ])
    draft_id, sv_id, rc_id = f"draft_{SUFFIX}", f"sv_{SUFFIX}", f"cfg_{SUFFIX}"
    db.add(Task(id=TASK_ID, title="新闻内容质量与分类标注（彩排）", description="答辩彩排临时任务",
                tags_json=["news"], quota_json={"total": 6, "perLabeler": 6},
                distribution_strategy_json={"type": "FIRST_COME_FIRST_SERVED"},
                review_policy_json={"type": "SINGLE_REVIEW"}, status="DRAFT", owner_id=OWNER_ID))
    db.flush()
    db.add(SchemaDraft(id=draft_id, task_id=TASK_ID, schema_json=schema, schema_draft_revision=1, updated_by=OWNER_ID))
    db.flush()
    db.add(SchemaVersion(id=sv_id, task_id=TASK_ID, schema_id=draft_id, schema_version_no=1,
                         contract_version="1.1", schema_json=schema, published_at=datetime.now(timezone.utc)))
    db.flush()
    db.add(ReviewConfig(id=rc_id, task_id=TASK_ID, enabled=True, model_policy_id="mp_doubao_pro",
                        prompt_template=REVIEW_PROMPT, dimensions_json=DIMENSIONS, thresholds_json=THRESHOLDS,
                        conclusion_mapping_json={"passWhen": "totalScore >= 0.8", "returnWhen": "totalScore < 0.45",
                                                 "humanReviewOtherwise": True, "mode": "AUTO_PASS_RETURN"},
                        max_retries=3))
    for i, n in enumerate(NEWS):
        db.add(DatasetItem(id=f"item_nv_{SUFFIX}_{i+1:03d}", task_id=TASK_ID,
                           external_key=n["id"], source_payload=n, status="AVAILABLE"))
    task = db.get(Task, TASK_ID)
    task.status = "PUBLISHED"
    task.active_schema_version_id = sv_id
    db.commit()
    print(f"✅ 从零搭好任务并发布：{TASK_ID}（schema 5 节点 / 4 维度 / AUTO_PASS_RETURN / 6 题）\n")
    return sv_id


def _run_one(db, sv_id, news_id, kind, idx):
    item = db.query(DatasetItem).filter_by(task_id=TASK_ID, external_key=news_id).first()
    asn_id, sub_id = f"asn_nv_{SUFFIX}_{idx}", f"sub_nv_{SUFFIX}_{idx}"
    db.add(Assignment(id=asn_id, task_id=TASK_ID, item_id=item.id, labeler_id=LABELER_ID,
                      schema_version_id=sv_id, status="SUBMITTED"))
    db.flush()
    db.add(Submission(id=sub_id, assignment_id=asn_id, task_id=TASK_ID, item_id=item.id,
                      labeler_id=LABELER_ID, schema_version_id=sv_id, attempt_no=1,
                      answers_json=_answers(news_id, kind), status="AI_REVIEWING",
                      validation_json={"valid": True, "errors": []}))
    db.flush()
    db.query(Assignment).filter_by(id=asn_id).update({Assignment.latest_submission_id: sub_id})
    item.current_assignment_id = asn_id
    item.status = "LOCKED"
    db.commit()
    cfg = db.query(ReviewConfig).filter_by(task_id=TASK_ID).first()
    job = create_ai_review_job(db, db.get(Submission, sub_id), cfg)
    db.commit()
    for _ in range(6):
        try:
            _execute_review(db, job.id)
        except Exception as exc:
            db.rollback()
            print(f"    ! AI 调用异常重试：{str(exc)[:100]}")
        db.expire_all()
        if db.get(Submission, sub_id).status != "AI_REVIEWING":
            break
        time.sleep(2)
    ai = db.query(ReviewResult).filter_by(submission_id=sub_id, stage="AI_PRECHECK").first()
    total = (ai.result_json or {}).get("totalScore") if ai else None
    raw = ai.decision if ai else "FAILED"
    return total, raw, db.get(Submission, sub_id).status


def _cleanup(db):
    db.rollback()
    try:
        subs = [r[0] for r in db.query(Submission.id).filter_by(task_id=TASK_ID).all()]
        asns = [r[0] for r in db.query(Assignment.id).filter_by(task_id=TASK_ID).all()]
        if asns:
            db.query(Assignment).filter(Assignment.id.in_(asns)).update({Assignment.latest_submission_id: None}, synchronize_session=False)
        db.query(DatasetItem).filter_by(task_id=TASK_ID).update({DatasetItem.current_assignment_id: None, DatasetItem.status: "AVAILABLE"}, synchronize_session=False)
        db.flush()
        if subs:
            for M in (ReviewResult, AIReviewJob, AiAssistAction, LLMCallLog):
                db.query(M).filter(M.submission_id.in_(subs)).delete(synchronize_session=False)
            db.query(AuditLog).filter(AuditLog.entity_id.in_(subs)).delete(synchronize_session=False)
        if asns:
            db.query(Draft).filter(Draft.assignment_id.in_(asns)).delete(synchronize_session=False)
            db.query(LLMCallLog).filter(LLMCallLog.assignment_id.in_(asns)).delete(synchronize_session=False)
        db.query(Submission).filter_by(task_id=TASK_ID).delete(synchronize_session=False)
        db.query(Assignment).filter_by(task_id=TASK_ID).delete(synchronize_session=False)
        db.query(DatasetItem).filter_by(task_id=TASK_ID).delete(synchronize_session=False)
        db.query(ReviewConfig).filter_by(task_id=TASK_ID).delete(synchronize_session=False)
        # 先断 task→schema_version 外键，再删 schema
        task = db.get(Task, TASK_ID)
        if task:
            task.active_schema_version_id = None
        db.flush()
        db.query(SchemaVersion).filter_by(task_id=TASK_ID).delete(synchronize_session=False)
        db.query(SchemaDraft).filter_by(task_id=TASK_ID).delete(synchronize_session=False)
        db.query(AuditLog).filter_by(entity_id=TASK_ID).delete(synchronize_session=False)
        db.query(Task).filter_by(id=TASK_ID).delete(synchronize_session=False)
        db.commit()
        print(f"\n🧹 已删除彩排任务 {TASK_ID} 及全部关联数据，DB 还原。")
    except Exception as exc:
        db.rollback()
        print(f"\n⚠️ 清理异常（请手动核查 {TASK_ID}）：{str(exc)[:200]}")


def main():
    db = SessionLocal()
    try:
        sv_id = _build_task(db)
        rows = []
        for i, (news_id, kind) in enumerate(CASES):
            print(f"▶ [{i+1}/{len(CASES)}] {news_id} · {kind} → 调 Doubao 预审…")
            total, raw, status = _run_one(db, sv_id, news_id, kind, i)
            rows.append((news_id, kind, total, raw, status))

        print("\n" + "=" * 76)
        print("从零搭任务 · AUTO 模式硬阈值自动流转结果（passScore=0.8 / returnScore=0.45）")
        print("=" * 76)
        ok = True
        for news_id, kind, total, raw, status in rows:
            gate = _decide_by_threshold(total, THRESHOLDS)
            exp_status = {"PASS": "AI_PASSED", "RETURN": "RETURNED", "NEED_HUMAN_REVIEW": "NEEDS_HUMAN_REVIEW"}[gate]
            match = status == exp_status or (gate == "PASS" and status == "NEEDS_HUMAN_REVIEW")
            want = "自动通过" if kind == "good" else "自动打回"
            got = {"AI_PASSED": "自动通过", "RETURNED": "自动打回", "NEEDS_HUMAN_REVIEW": "转人工"}.get(status, status)
            hit = (kind == "good" and status == "AI_PASSED") or (kind == "garbage" and status == "RETURNED")
            ok = ok and hit
            print(f"  {news_id} {kind:8s} 分数={str(total):5s} 归一={_normalize_fraction(total)}  闸门={gate:18s} 状态={status:20s} 期望={want} 实得={got} {'✓' if hit else '✗'}")
        print("\n" + "=" * 76)
        print(f"结论：{'✅ 从零搭出来的配置可靠 —— 好标注自动通过、垃圾标注自动打回' if ok else '⚠️ 有样本未达预期，见上（可能是模型当次打分偏移）'}")
        print("=" * 76)
    finally:
        _cleanup(db)
        db.close()


if __name__ == "__main__":
    main()
