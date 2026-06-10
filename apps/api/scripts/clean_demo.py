"""
清理演示数据库杂项任务（P2-D）。

默认策略：**只保留 ID 前缀为 `task_demo_` 的演示任务**（seed_demo / seed_competition 产物），
删除其余全部任务（E2E/并发/烟雾测试、随手建的脏任务等）及其级联数据，让任务市场干净。

运行：
  docker compose exec -w /workspace/apps/api api python scripts/clean_demo.py            # 预览（dry-run）
  docker compose exec -w /workspace/apps/api api python scripts/clean_demo.py --apply     # 实际删除

安全：
  - 默认 dry-run，只打印将删除的任务，不动数据；加 --apply 才真正删。
  - 审计表（audit_logs / audit_events）为追加只写，不删除（历史可追溯）。
  - 可重复执行。
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

import app.models  # noqa: F401  聚合注册全部模型（避免跨表 FK 解析报错）
from app.database import SessionLocal
from app.models.task import Task
from app.models.schema import SchemaDraft, SchemaVersion
from app.models.dataset import DatasetItem
from app.models.assignment import Assignment, Draft
from app.models.submission import Submission
from app.models.review import ReviewConfig, AIReviewJob, ReviewResult
from app.models.export import ExportJob
from app.models.export_record import ExportRecord
from app.models.llm import LLMCallLog

KEEP_PREFIX = "task_demo_"


def _delete_tasks(db, task_ids: list[str]) -> None:
    """FK 安全顺序级联删除给定任务及其所有关联数据。"""
    if not task_ids:
        return
    sub_ids = [r[0] for r in db.query(Submission.id).filter(Submission.task_id.in_(task_ids)).all()]
    asn_ids = [r[0] for r in db.query(Assignment.id).filter(Assignment.task_id.in_(task_ids)).all()]
    job_ids = [r[0] for r in db.query(ExportJob.id).filter(ExportJob.task_id.in_(task_ids)).all()]

    def _del(model, cond):
        db.query(model).filter(cond).delete(synchronize_session=False)

    if sub_ids:
        _del(ReviewResult, ReviewResult.submission_id.in_(sub_ids))
        _del(AIReviewJob, AIReviewJob.submission_id.in_(sub_ids))
        _del(ExportRecord, ExportRecord.submission_id.in_(sub_ids))
        _del(LLMCallLog, LLMCallLog.submission_id.in_(sub_ids))
    if job_ids:
        _del(ExportRecord, ExportRecord.export_job_id.in_(job_ids))
    if asn_ids:
        _del(LLMCallLog, LLMCallLog.assignment_id.in_(asn_ids))
        _del(Draft, Draft.assignment_id.in_(asn_ids))
        # 断开 assignments↔submissions 的循环外键：先清空 latest_submission_id，
        # 否则删 submissions 会触发 fk_assignments_latest_submission_id 约束
        db.query(Assignment).filter(Assignment.id.in_(asn_ids)).update(
            {Assignment.latest_submission_id: None}, synchronize_session=False
        )
        db.flush()
    _del(ExportJob, ExportJob.task_id.in_(task_ids))
    _del(Submission, Submission.task_id.in_(task_ids))
    # 断开 assignments↔dataset_items 的循环外键：先清空 dataset_items.current_assignment_id，
    # 否则删 assignments 会触发 fk_dataset_items_current_assignment_id 约束
    db.query(DatasetItem).filter(DatasetItem.task_id.in_(task_ids)).update(
        {DatasetItem.current_assignment_id: None}, synchronize_session=False
    )
    db.flush()
    _del(Assignment, Assignment.task_id.in_(task_ids))
    _del(DatasetItem, DatasetItem.task_id.in_(task_ids))
    _del(ReviewConfig, ReviewConfig.task_id.in_(task_ids))
    # 先解除 active_schema_version_id 外键，再删 schema_versions / drafts
    for t in db.query(Task).filter(Task.id.in_(task_ids)).all():
        t.active_schema_version_id = None
    db.flush()
    _del(SchemaVersion, SchemaVersion.task_id.in_(task_ids))
    _del(SchemaDraft, SchemaDraft.task_id.in_(task_ids))
    _del(Task, Task.id.in_(task_ids))


def main() -> None:
    apply = "--apply" in sys.argv
    db = SessionLocal()
    try:
        all_tasks = db.query(Task).order_by(Task.created_at.asc()).all()
        keep = [t for t in all_tasks if t.id.startswith(KEEP_PREFIX)]
        drop = [t for t in all_tasks if not t.id.startswith(KEEP_PREFIX)]

        print("=" * 64)
        print(f"清理演示 DB 杂项（{'APPLY 实删' if apply else 'DRY-RUN 预览'}）")
        print("=" * 64)
        print(f"\n保留 {len(keep)} 个演示任务（task_demo_*）：")
        for t in keep:
            print(f"  ✅ {t.id:34} {t.title}")
        print(f"\n将删除 {len(drop)} 个杂项任务：")
        for t in drop:
            print(f"  🗑  {t.id[:32]:34} status={t.status:10} {t.title}")

        if not drop:
            print("\n无需清理，已干净。")
            return

        if not apply:
            print("\n（dry-run，未删除。确认无误后加 --apply 实际执行。）")
            return

        _delete_tasks(db, [t.id for t in drop])
        db.commit()
        print(f"\n✅ 已删除 {len(drop)} 个杂项任务及其关联数据。当前剩余 {len(keep)} 个演示任务。")
    finally:
        db.close()


if __name__ == "__main__":
    main()
