"""确认重复 seed 回归场景已生成引用演示提交的导出记录。"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()

from app.database import SessionLocal
from app.models.export_record import ExportRecord
from app.models.submission import Submission
from app.security import require_demo_mode
from scripts.seed_demo import TASK_ID


def main() -> None:
    require_demo_mode("verify_seed_repeat_precondition")
    db = SessionLocal()
    try:
        record_count = (
            db.query(ExportRecord)
            .join(Submission, Submission.id == ExportRecord.submission_id)
            .filter(Submission.task_id == TASK_ID)
            .count()
        )
        if record_count < 1:
            raise SystemExit("重复 seed 回归前置条件失败：演示任务没有 export_records")
        print(f"✅ 重复 seed 回归前置条件就绪：export_records={record_count}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
