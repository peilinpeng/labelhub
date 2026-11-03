"""持久化迁移审批、不可变产物与任务级授权。"""
from alembic import op
import sqlalchemy as sa

revision = "f6a7b8c9d0e1"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('task_permission_grants',
        sa.Column('id', sa.String(length=64), primary_key=True, nullable=False),
        sa.Column('task_id', sa.String(length=64), sa.ForeignKey('tasks.id'), nullable=False),
        sa.Column('user_id', sa.String(length=64), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('action', sa.String(length=40), nullable=False),
        sa.Column('effect', sa.String(length=10), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.Column('created_by', sa.String(length=64), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_grants_task_user', 'task_permission_grants', ['task_id', 'user_id'])
    op.create_table('migration_jobs',
        sa.Column('id', sa.String(length=64), primary_key=True, nullable=False),
        sa.Column('task_id', sa.String(length=64), sa.ForeignKey('tasks.id'), nullable=False),
        sa.Column('from_schema_version_id', sa.String(length=64), sa.ForeignKey('schema_versions.id'), nullable=False),
        sa.Column('to_schema_version_id', sa.String(length=64), sa.ForeignKey('schema_versions.id'), nullable=False),
        sa.Column('created_by', sa.String(length=64), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('status', sa.String(length=24), nullable=False),
        sa.Column('request_json', sa.JSON(), nullable=False),
        sa.Column('snapshot_json', sa.JSON(), nullable=True),
        sa.Column('preview_json', sa.JSON(), nullable=True),
        sa.Column('checksum', sa.String(length=64), nullable=True),
        sa.Column('approved_checksum', sa.String(length=64), nullable=True),
        sa.Column('approved_by', sa.String(length=64), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('approved_at', sa.DateTime(), nullable=True),
        sa.Column('decision_reason', sa.String(length=500), nullable=True),
        sa.Column('executed_by', sa.String(length=64), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('completed_count', sa.Integer(), nullable=False),
        sa.Column('conflict_count', sa.Integer(), nullable=False),
        sa.Column('error', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_migration_status', 'migration_jobs', ['status'])
    op.create_index('ix_migration_task_created', 'migration_jobs', ['task_id', 'created_at'])
    op.create_table('migration_records',
        sa.Column('id', sa.String(length=64), primary_key=True, nullable=False),
        sa.Column('job_id', sa.String(length=64), sa.ForeignKey('migration_jobs.id'), nullable=False),
        sa.Column('submission_id', sa.String(length=64), sa.ForeignKey('submissions.id'), nullable=False),
        sa.Column('from_schema_version_id', sa.String(length=64), sa.ForeignKey('schema_versions.id'), nullable=False),
        sa.Column('to_schema_version_id', sa.String(length=64), sa.ForeignKey('schema_versions.id'), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('source_hash', sa.String(length=64), nullable=False),
        sa.Column('result_hash', sa.String(length=64), nullable=True),
        sa.Column('answers_json', sa.JSON(), nullable=True),
        sa.Column('archived_answers_json', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('job_id', 'submission_id', name='uq_migration_record_job_submission'),
    )


def downgrade():
    op.drop_table('migration_records')
    op.drop_table('migration_jobs')
    op.drop_table('task_permission_grants')
