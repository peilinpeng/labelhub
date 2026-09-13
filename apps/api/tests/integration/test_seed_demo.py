"""演示数据 seed 的数据库级幂等回归测试。"""

from datetime import datetime, timezone

import pytest
from sqlalchemy import text

from app.models.ai_assist import AiAssistAction
from app.models.assignment import Assignment
from app.models.dataset import DatasetItem
from app.models.export import ExportJob
from app.models.export_record import ExportRecord
from app.models.schema import SchemaDraft, SchemaVersion
from app.models.submission import Submission
from app.models.task import Task
from scripts.seed_demo import TASK_ID, _wipe_demo


@pytest.fixture
def foreign_key_db(db_session):
    """仅在当前用例启用 SQLite 外键，并在 teardown 恢复共享测试连接。"""
    db_session.execute(text("PRAGMA foreign_keys = ON"))
    try:
        yield db_session
    finally:
        db_session.rollback()
        db_session.execute(text("PRAGMA foreign_keys = OFF"))
        db_session.commit()


def test_wipe_demo_removes_export_dependencies_before_submission(foreign_key_db, users):
    """导出记录存在时仍可按外键顺序完整清理演示任务。"""
    db_session = foreign_key_db

    owner = users["OWNER"]
    labeler = users["LABELER"]
    draft_id = "sd_seed_repeat"
    schema_version_id = "sv_seed_repeat"
    item_id = "item_seed_repeat"
    assignment_id = "asn_seed_repeat"
    submission_id = "sub_seed_repeat"
    export_job_id = "exp_seed_repeat"

    db_session.add(
        Task(
            id=TASK_ID,
            title="重复 seed 回归任务",
            description="验证导出后可重新播种",
            tags_json=["test"],
            quota_json={"total": 1},
            distribution_strategy_json={"type": "FIRST_COME_FIRST_SERVED"},
            review_policy_json={"type": "SINGLE_REVIEW"},
            status="PUBLISHED",
            owner_id=owner.id,
        )
    )
    db_session.flush()
    db_session.add(
        SchemaDraft(
            id=draft_id,
            task_id=TASK_ID,
            schema_json={"nodes": []},
            schema_draft_revision=1,
            updated_by=owner.id,
        )
    )
    db_session.flush()
    db_session.add(
        SchemaVersion(
            id=schema_version_id,
            task_id=TASK_ID,
            schema_id=draft_id,
            schema_version_no=1,
            contract_version="1.1",
            schema_json={"nodes": []},
            published_at=datetime.now(timezone.utc),
        )
    )
    db_session.flush()
    task = db_session.get(Task, TASK_ID)
    assert task is not None
    task.active_schema_version_id = schema_version_id

    db_session.add(
        DatasetItem(
            id=item_id,
            task_id=TASK_ID,
            external_key="seed-repeat",
            source_payload={"text": "测试"},
            status="COMPLETED",
        )
    )
    db_session.flush()
    db_session.add(
        Assignment(
            id=assignment_id,
            task_id=TASK_ID,
            item_id=item_id,
            labeler_id=labeler.id,
            schema_version_id=schema_version_id,
            status="ACCEPTED",
        )
    )
    db_session.flush()
    db_session.add(
        Submission(
            id=submission_id,
            assignment_id=assignment_id,
            task_id=TASK_ID,
            item_id=item_id,
            labeler_id=labeler.id,
            schema_version_id=schema_version_id,
            attempt_no=1,
            answers_json={"quality": "high"},
            status="ACCEPTED",
            validation_json={"valid": True, "errors": []},
        )
    )
    db_session.flush()
    assignment = db_session.get(Assignment, assignment_id)
    item = db_session.get(DatasetItem, item_id)
    assert assignment is not None and item is not None
    assignment.latest_submission_id = submission_id
    item.current_assignment_id = assignment_id

    db_session.add(
        ExportJob(
            id=export_job_id,
            task_id=TASK_ID,
            schema_version_id=schema_version_id,
            status="SUCCEEDED",
            mapping_json={"format": "JSONL"},
            progress_total=1,
            progress_done=1,
            created_by=owner.id,
        )
    )
    db_session.flush()
    db_session.add(
        ExportRecord(
            id="erec_seed_repeat",
            export_job_id=export_job_id,
            submission_id=submission_id,
            schema_version_id=schema_version_id,
            record_index=0,
            data_json={"quality": "high"},
        )
    )
    db_session.add(
        AiAssistAction(
            id="aaa_seed_repeat",
            suggestion_id="aas_seed_repeat_0",
            submission_id=submission_id,
            action="dismiss",
            resulting_status="DISMISSED",
            actor_json={"id": owner.id, "role": "OWNER"},
        )
    )
    db_session.commit()

    _wipe_demo(db_session)

    assert db_session.get(ExportRecord, "erec_seed_repeat") is None
    assert db_session.get(AiAssistAction, "aaa_seed_repeat") is None
    assert db_session.get(ExportJob, export_job_id) is None
    assert db_session.get(Submission, submission_id) is None
    assert db_session.get(Task, TASK_ID) is None
