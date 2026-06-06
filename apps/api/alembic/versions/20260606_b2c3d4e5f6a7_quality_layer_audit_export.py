"""quality layer: audit_events + export_records + export_jobs.artifact_summary_json

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-06-06

手写迁移（非 autogenerate）：仅新增 2 张表 + 给 export_jobs 追加 1 个可空列，
不重建任何现有表（规避 schema_drafts↔schema_versions↔tasks 循环 FK 的 autogenerate 误判）。
"""
from alembic import op
import sqlalchemy as sa


revision = 'b2c3d4e5f6a7'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'audit_events',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('type', sa.String(length=64), nullable=False),
        sa.Column('severity', sa.String(length=20), nullable=False),
        sa.Column('source', sa.String(length=40), nullable=False),
        sa.Column('actor_json', sa.JSON(), nullable=False),
        sa.Column('target_json', sa.JSON(), nullable=False),
        sa.Column('payload_json', sa.JSON(), nullable=True),
        sa.Column('request_id', sa.String(length=255), nullable=True),
        sa.Column('idempotency_key', sa.String(length=255), nullable=True),
        sa.Column('checksum', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('idempotency_key'),
    )

    op.create_table(
        'export_records',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('export_job_id', sa.String(length=64), nullable=False),
        sa.Column('submission_id', sa.String(length=64), nullable=False),
        sa.Column('schema_version_id', sa.String(length=64), nullable=False),
        sa.Column('record_index', sa.Integer(), nullable=False),
        sa.Column('data_json', sa.JSON(), nullable=False),
        sa.Column('metadata_json', sa.JSON(), nullable=True),
        sa.Column('passport_json', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['export_job_id'], ['export_jobs.id']),
        sa.ForeignKeyConstraint(['submission_id'], ['submissions.id']),
        sa.PrimaryKeyConstraint('id'),
    )

    op.add_column('export_jobs', sa.Column('artifact_summary_json', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('export_jobs', 'artifact_summary_json')
    op.drop_table('export_records')
    op.drop_table('audit_events')
