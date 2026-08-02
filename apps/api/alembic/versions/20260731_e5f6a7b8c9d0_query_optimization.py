"""batch statistics, database audit filtering and hot-query indexes

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-07-31

The audit JSON remains the authoritative immutable snapshot. Nullable materialized
columns make common filters indexable without a MySQL-specific generated-column
contract. Existing rows are backfilled during the migration.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


_AUDIT_COLUMNS = (
    ("actor_id", 64),
    ("entity_type", 40),
    ("entity_id", 64),
    ("task_id", 64),
    ("schema_version_id", 64),
    ("assignment_id", 64),
    ("submission_id", 64),
    ("review_id", 64),
    ("export_id", 64),
    ("migration_plan_id", 64),
)

_INDEXES = (
    ("ix_assignments_labeler_created", "assignments", ["labeler_id", "created_at"]),
    (
        "ix_assignments_task_labeler_status",
        "assignments",
        ["task_id", "labeler_id", "status"],
    ),
    ("ix_submissions_status_created", "submissions", ["status", "created_at"]),
    ("ix_submissions_task_status", "submissions", ["task_id", "status"]),
    (
        "ix_dataset_items_task_status_created",
        "dataset_items",
        ["task_id", "status", "created_at"],
    ),
    ("ix_tasks_owner_created", "tasks", ["owner_id", "created_at"]),
    (
        "ix_audit_events_task_created",
        "audit_events",
        ["task_id", "created_at"],
    ),
    (
        "ix_audit_events_entity_created",
        "audit_events",
        ["entity_type", "entity_id", "created_at"],
    ),
    (
        "ix_audit_events_submission_created",
        "audit_events",
        ["submission_id", "created_at"],
    ),
    (
        "ix_audit_events_type_created",
        "audit_events",
        ["type", "created_at"],
    ),
    (
        "ix_audit_events_actor_created",
        "audit_events",
        ["actor_id", "created_at"],
    ),
)


def _backfill_audit_filter_columns() -> None:
    dialect = op.get_bind().dialect.name
    paths = {
        "actor_id": ("actor_json", "$.id"),
        "entity_type": ("target_json", "$.entityType"),
        "entity_id": ("target_json", "$.entityId"),
        "task_id": ("target_json", "$.taskId"),
        "schema_version_id": ("target_json", "$.schemaVersionId"),
        "assignment_id": ("target_json", "$.assignmentId"),
        "submission_id": ("target_json", "$.submissionId"),
        "review_id": ("target_json", "$.reviewId"),
        "export_id": ("target_json", "$.exportId"),
        "migration_plan_id": ("target_json", "$.migrationPlanId"),
    }
    if dialect == "mysql":
        assignments = ", ".join(
            f"{column} = NULLIF(JSON_UNQUOTE(JSON_EXTRACT({json_column}, '{path}')), 'null')"
            for column, (json_column, path) in paths.items()
        )
    elif dialect == "sqlite":
        assignments = ", ".join(
            f"{column} = json_extract({json_column}, '{path}')"
            for column, (json_column, path) in paths.items()
        )
    else:
        # Production is MySQL. Other dialects can still migrate new writes safely;
        # a portable application-level backfill can be run before exposing history.
        return
    op.execute(sa.text(f"UPDATE audit_events SET {assignments}"))


def upgrade() -> None:
    for column_name, length in _AUDIT_COLUMNS:
        op.add_column(
            "audit_events",
            sa.Column(column_name, sa.String(length=length), nullable=True),
        )

    _backfill_audit_filter_columns()

    for index_name, table_name, columns in _INDEXES:
        op.create_index(index_name, table_name, columns, unique=False)

    if op.get_bind().dialect.name == "mysql":
        # These MySQL-created FK indexes are redundant after the composite
        # left-prefix indexes above exist. Removing them keeps write amplification
        # bounded and makes repeated downgrade/upgrade cycles deterministic.
        redundant_fk_indexes = (
            ("owner_id", "tasks"),
            ("task_id", "assignments"),
            ("labeler_id", "assignments"),
            ("task_id", "submissions"),
        )
        bind = op.get_bind()
        for index_name, table_name in redundant_fk_indexes:
            existing = {
                item["name"] for item in inspect(bind).get_indexes(table_name)
            }
            if index_name in existing:
                op.drop_index(index_name, table_name=table_name)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "mysql":
        # MySQL may remove an implicit FK index after a new composite index takes
        # over its left-most prefix. Restore the pre-migration FK indexes before
        # dropping composites, otherwise ERROR 1553 makes rollback impossible.
        fallback_indexes = (
            ("owner_id", "tasks", ["owner_id"]),
            ("task_id", "assignments", ["task_id"]),
            ("labeler_id", "assignments", ["labeler_id"]),
            ("task_id", "submissions", ["task_id"]),
        )
        for index_name, table_name, columns in fallback_indexes:
            existing = {
                item["name"] for item in inspect(bind).get_indexes(table_name)
            }
            if index_name not in existing:
                op.create_index(index_name, table_name, columns, unique=False)

    for index_name, table_name, _columns in reversed(_INDEXES):
        existing = {
            item["name"] for item in inspect(bind).get_indexes(table_name)
        }
        if index_name in existing:
            op.drop_index(index_name, table_name=table_name)

    for column_name, _length in reversed(_AUDIT_COLUMNS):
        existing_columns = {
            item["name"] for item in inspect(bind).get_columns("audit_events")
        }
        if column_name in existing_columns:
            op.drop_column("audit_events", column_name)
