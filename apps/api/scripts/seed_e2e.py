"""
LabelHub Web E2E 确定性数据初始化。

运行：
  docker compose --profile tools run --rm seed

职责：
1. 复用 seed_demo 的幂等重建逻辑；
2. 验证三角色登录、可领取任务和待人工复核提交等 E2E 前置条件；
3. 初始化失败时以非零退出码阻断 CI。

Playwright 测试本身不会再偷偷迁移或播种数据库，确保 CI 的环境准备步骤可见、可诊断。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.seed_demo import (
    DEMO_USERS,
    REVIEW_SUB_ID,
    SV_ID,
    TASK_ID,
    main as seed_demo,
)
from app.database import SessionLocal
from app.models.dataset import DatasetItem
from app.models.review import ReviewResult
from app.models.submission import Submission
from app.models.task import Task
from app.models.user import User


def _verify_e2e_preconditions() -> None:
    db = SessionLocal()
    try:
        errors: list[str] = []

        for spec in DEMO_USERS:
            user = db.query(User).filter(User.email == spec["email"]).first()
            if user is None:
                errors.append(f"缺少 E2E 账号：{spec['email']}")
            elif user.role != spec["role"] or user.status != "ACTIVE":
                errors.append(
                    f"E2E 账号状态异常：{spec['email']} role={user.role} status={user.status}"
                )

        task = db.get(Task, TASK_ID)
        if task is None:
            errors.append(f"缺少 E2E 任务：{TASK_ID}")
        elif task.status != "PUBLISHED" or task.active_schema_version_id != SV_ID:
            errors.append(
                f"E2E 任务未正确发布：status={task.status} "
                f"schemaVersionId={task.active_schema_version_id}"
            )

        available_count = (
            db.query(DatasetItem)
            .filter(
                DatasetItem.task_id == TASK_ID,
                DatasetItem.status == "AVAILABLE",
            )
            .count()
        )
        if available_count < 1:
            errors.append("E2E 任务没有可领取数据")

        submission = db.get(Submission, REVIEW_SUB_ID)
        if submission is None or submission.status != "NEEDS_HUMAN_REVIEW":
            errors.append(f"缺少待人工复核提交：{REVIEW_SUB_ID}")
        else:
            has_ai_result = (
                db.query(ReviewResult)
                .filter(
                    ReviewResult.submission_id == REVIEW_SUB_ID,
                    ReviewResult.stage == "AI_PRECHECK",
                )
                .first()
                is not None
            )
            if not has_ai_result:
                errors.append(f"待复核提交缺少 AI_PRECHECK 结果：{REVIEW_SUB_ID}")

        if errors:
            detail = "\n".join(f"  - {message}" for message in errors)
            raise SystemExit(f"E2E seed 前置条件验证失败：\n{detail}")

        print("\n✅ E2E 前置条件验证通过")
        print(f"   三角色账号：{len(DEMO_USERS)}")
        print(f"   可领取数据：{available_count}")
        print(f"   待复核提交：{REVIEW_SUB_ID}")
    finally:
        db.close()


def main() -> None:
    seed_demo()
    _verify_e2e_preconditions()


if __name__ == "__main__":
    main()
