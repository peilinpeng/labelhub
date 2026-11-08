"""新增快照列兼容已有任务，迁移不会重写旧记录。"""
import importlib.util
from pathlib import Path
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text, inspect


def test_snapshot_column_upgrade_and_downgrade_preserve_rows():
    path=Path(__file__).parents[2]/"alembic"/"versions"/"20261108_a7b8c9d0e1f2_ai_workflow_snapshot.py"
    spec=importlib.util.spec_from_file_location("snapshot_migration",path)
    migration=importlib.util.module_from_spec(spec); spec.loader.exec_module(migration)
    engine=create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE ai_review_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL)"))
        connection.execute(text("INSERT INTO ai_review_jobs VALUES ('old', 'PENDING')"))
        migration.op=Operations(MigrationContext.configure(connection))
        migration.upgrade()
        assert connection.execute(text("SELECT workflow_snapshot_json FROM ai_review_jobs")).scalar() is None
        migration.downgrade()
        assert connection.execute(text("SELECT status FROM ai_review_jobs WHERE id='old'")).scalar()=="PENDING"
        assert "workflow_snapshot_json" not in {c["name"] for c in inspect(connection).get_columns("ai_review_jobs")}
