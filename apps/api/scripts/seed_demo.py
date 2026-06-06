"""
LabelHub 演示数据 Seeder（路演 / 端到端演示用）。

运行：cd labelhub/apps/api && python scripts/seed_demo.py
（容器内：docker compose exec -w /workspace/apps/api api python scripts/seed_demo.py）

一键初始化：
  - 三个角色账号：owner@labelhub.com / labeler@labelhub.com / reviewer@labelhub.com（密码 password123）
  - 一个 PUBLISHED 任务（含配额 + 分发策略）
  - 10 条测试题目（从 datasets/ 读取；不存在则生成 mock）
  - 一套标注模板 Schema（ShowItem + 单选 + 多行文本）并发布为 v1
  - 一条 ReviewConfig（评分维度 + 通过/打回阈值）

幂等：每次运行先清空本演示任务及其关联数据，再重建，可重复执行不报错。

与 seed.py 隔离：本脚本账号为 *@labelhub.com / password123，
不触碰 seed.py 的 *@labelhub.test / Seed@1234（E2E 依赖），两套互不覆盖。
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from passlib.context import CryptContext
from dotenv import load_dotenv

load_dotenv()  # 必须在 import app.* 之前

from app.database import SessionLocal
from app.models.user import User
from app.models.task import Task
from app.models.schema import SchemaDraft, SchemaVersion
from app.models.dataset import DatasetItem
from app.models.review import ReviewConfig, AIReviewJob, ReviewResult
from app.models.assignment import Assignment, Draft
from app.models.submission import Submission

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
_PASSWORD = "password123"

# 固定 ID，保证幂等可重复清理
TASK_ID = "task_demo_news_quality"
DRAFT_ID = "sd_demo_news_quality"
SV_ID = "sv_demo_news_quality_v1"
RC_ID = "rc_demo_news_quality"

_DEMO_USERS = [
    {"id": "usr_demo_owner",    "role": "OWNER",    "email": "owner@labelhub.com",    "display_name": "演示 Owner"},
    {"id": "usr_demo_labeler",  "role": "LABELER",  "email": "labeler@labelhub.com",  "display_name": "演示 Labeler"},
    {"id": "usr_demo_reviewer", "role": "REVIEWER", "email": "reviewer@labelhub.com", "display_name": "演示 Reviewer"},
]

# 标注模板：ShowItem（只读展示）+ 单选 + 多行文本
_DEMO_SCHEMA = {
    "nodes": [
        {"id": "show-title", "type": "show.text", "label": "原文标题",
         "sourcePath": "$.item.sourcePayload.title"},
        {"id": "q-quality", "type": "choice.radio", "name": "quality", "label": "质量评级",
         "required": True,
         "options": [
             {"value": "high", "label": "高质量"},
             {"value": "medium", "label": "中等"},
             {"value": "low", "label": "低质量"},
         ]},
        {"id": "q-comment", "type": "input.textarea", "name": "comment", "label": "评语",
         "required": False},
    ]
}

_DEMO_REVIEW_DIMENSIONS = [
    {"key": "relevance", "label": "相关性", "weight": 0.4},
    {"key": "accuracy", "label": "准确性", "weight": 0.4},
    {"key": "compliance", "label": "格式合规", "weight": 0.2},
]
_DEMO_REVIEW_THRESHOLDS = {"autoPass": 0.85, "autoReturn": 0.5}
_DEMO_REVIEW_CONCLUSION_MAPPING = {
    "PASS": "AI_PASSED",
    "RETURN": "RETURNED",
    "NEED_HUMAN_REVIEW": "NEEDS_HUMAN_REVIEW",
}


def _load_items() -> list[dict]:
    """优先从 datasets/ 读取 JSON/JSONL；不存在则生成 10 条 mock。"""
    candidates = [
        Path(__file__).resolve().parents[3] / "datasets",
        Path(__file__).resolve().parents[1] / "datasets",
    ]
    for d in candidates:
        if d.is_dir():
            for f in sorted(d.glob("*.json*")):
                try:
                    text = f.read_text(encoding="utf-8")
                    if f.suffix == ".jsonl":
                        rows = [json.loads(l) for l in text.splitlines() if l.strip()]
                    else:
                        rows = json.loads(text)
                        rows = rows if isinstance(rows, list) else [rows]
                    if rows:
                        print(f"  从 {f} 读取 {len(rows)} 条题目")
                        return rows[:10]
                except Exception as e:  # noqa: BLE001
                    print(f"  跳过 {f}（解析失败：{e}）")
    print("  未找到 datasets/，使用 mock 题目")
    return [
        {"title": f"演示新闻标题 {i+1}", "body": f"这是第 {i+1} 条演示新闻正文内容，用于标注质量评级。"}
        for i in range(10)
    ]


def _wipe_demo(db) -> None:
    """按 task_id 清理本演示任务的全部关联数据（FK 安全顺序）。"""
    sub_ids = [s.id for s in db.query(Submission).filter_by(task_id=TASK_ID).all()]
    asn_ids = [a.id for a in db.query(Assignment).filter_by(task_id=TASK_ID).all()]
    if sub_ids:
        db.query(ReviewResult).filter(ReviewResult.submission_id.in_(sub_ids)).delete(synchronize_session=False)
        db.query(AIReviewJob).filter(AIReviewJob.submission_id.in_(sub_ids)).delete(synchronize_session=False)
    db.query(Submission).filter_by(task_id=TASK_ID).delete(synchronize_session=False)
    if asn_ids:
        db.query(Draft).filter(Draft.assignment_id.in_(asn_ids)).delete(synchronize_session=False)
    db.query(Assignment).filter_by(task_id=TASK_ID).delete(synchronize_session=False)
    db.query(DatasetItem).filter_by(task_id=TASK_ID).delete(synchronize_session=False)
    db.query(ReviewConfig).filter_by(task_id=TASK_ID).delete(synchronize_session=False)
    # task 先解除 active_schema_version_id 外键，再删 schema_versions / drafts
    task = db.get(Task, TASK_ID)
    if task:
        task.active_schema_version_id = None
        db.flush()
    db.query(SchemaVersion).filter_by(task_id=TASK_ID).delete(synchronize_session=False)
    db.query(SchemaDraft).filter_by(task_id=TASK_ID).delete(synchronize_session=False)
    db.query(Task).filter_by(id=TASK_ID).delete(synchronize_session=False)
    db.commit()


def _upsert_users(db) -> dict:
    result = {}
    for spec in _DEMO_USERS:
        user = db.query(User).filter_by(email=spec["email"]).first()
        if user is None:
            user = User(
                id=spec["id"], email=spec["email"],
                hashed_password=_pwd.hash(_PASSWORD),
                display_name=spec["display_name"], role=spec["role"], status="ACTIVE",
            )
            db.add(user)
        result[spec["role"]] = spec["id"]
    db.commit()
    return result


def main() -> None:
    db = SessionLocal()
    try:
        print("=" * 60)
        print("LabelHub 演示数据 Seeder（seed_demo）")
        print("=" * 60)

        users = _upsert_users(db)
        print(f"\n✅ 演示账号就绪（密码均为 {_PASSWORD}）：")
        for spec in _DEMO_USERS:
            print(f"   [{spec['role']:<8}] {spec['email']}")

        _wipe_demo(db)
        print("\n🧹 已清理旧演示任务数据")

        # 任务（先建 DRAFT，发布 schema 后转 PUBLISHED）
        task = Task(
            id=TASK_ID, title="新闻质量标注（演示）",
            description="对新闻条目进行质量评级与评语标注，用于端到端演示。",
            tags_json=["demo", "news"],
            quota_json={"total": 100, "perLabeler": 20},
            distribution_strategy_json={"type": "FIRST_COME_FIRST_SERVED"},
            review_policy_json={"type": "SINGLE_REVIEW"},
            status="DRAFT", owner_id=users["OWNER"],
        )
        db.add(task)
        db.flush()

        # Schema 草稿 + 发布为 v1
        db.add(SchemaDraft(
            id=DRAFT_ID, task_id=TASK_ID, schema_json=_DEMO_SCHEMA,
            schema_draft_revision=1, updated_by=users["OWNER"],
        ))
        db.flush()
        db.add(SchemaVersion(
            id=SV_ID, task_id=TASK_ID, schema_id=DRAFT_ID, schema_version_no=1,
            contract_version="1.1", schema_json=_DEMO_SCHEMA,
            published_at=datetime.now(timezone.utc),
        ))
        db.flush()

        # ReviewConfig
        db.add(ReviewConfig(
            id=RC_ID, task_id=TASK_ID, enabled=True,
            model_policy_id="mp_doubao_pro",
            prompt_template="请基于相关性、准确性、格式合规对该标注打分并给出结论。",
            dimensions_json=_DEMO_REVIEW_DIMENSIONS,
            thresholds_json=_DEMO_REVIEW_THRESHOLDS,
            conclusion_mapping_json=_DEMO_REVIEW_CONCLUSION_MAPPING,
            max_retries=3,
        ))

        # 10 条题目
        rows = _load_items()
        for i, payload in enumerate(rows):
            db.add(DatasetItem(
                id=f"item_demo_{i+1:02d}", task_id=TASK_ID,
                external_key=f"demo-{i+1:02d}",
                source_payload=payload, status="AVAILABLE",
            ))

        # 发布任务
        task.status = "PUBLISHED"
        task.active_schema_version_id = SV_ID
        db.commit()

        print(f"\n✅ 演示任务已发布：{TASK_ID}")
        print(f"   Schema 版本   : {SV_ID}（v1，ShowItem + 单选 + 多行文本）")
        print(f"   ReviewConfig  : {RC_ID}（enabled，3 维度）")
        print(f"   题目数量      : {len(rows)}")
        print("\n" + "=" * 60)
        print("演示数据初始化完成。可用上面账号登录前端走完整流程。")
        print("=" * 60)
    finally:
        db.close()


if __name__ == "__main__":
    main()
