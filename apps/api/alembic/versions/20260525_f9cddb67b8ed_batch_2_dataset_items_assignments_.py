"""batch_2_dataset_items_assignments_drafts_submissions

Revision ID: f9cddb67b8ed
Revises: d7ef5693ca61
Create Date: 2026-05-25 22:51:07.048298

"""
# 迁移脚本模板：由 alembic 自动填充 revision id、依赖版本和生成时间。
# 手动修正说明：
#   Alembic autogenerate 将两处 use_alter=True 循环 FK 内联在 create_table 中，
#   执行时 ALTER TABLE 会在被引用表创建前发出，导致 "Cannot add foreign key constraint"。
#   修正策略：
#     ① 从 dataset_items.create_table 中移除 current_assignment_id FK（use_alter）
#     ② 从 assignments.create_table 中移除 latest_submission_id FK（use_alter）
#     ③ 在所有表创建完毕后，用 op.create_foreign_key 独立添加两条循环 FK
#     ④ downgrade 中先 drop_constraint，再按逆序删表
from alembic import op
import sqlalchemy as sa


revision = 'f9cddb67b8ed'
down_revision = 'd7ef5693ca61'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 第 1 步：建 dataset_items
    # 注意：current_assignment_id → assignments 的循环 FK 已移出，在步骤 5 单独添加
    op.create_table('dataset_items',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('task_id', sa.String(length=64), nullable=False),
    sa.Column('external_key', sa.String(length=255), nullable=True),
    sa.Column('source_payload', sa.JSON(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('current_assignment_id', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_dataset_items_external_key', 'dataset_items', ['task_id', 'external_key'], unique=False)
    op.create_index('ix_dataset_items_task_id', 'dataset_items', ['task_id'], unique=False)

    # 第 2 步：建 assignments
    # 注意：latest_submission_id → submissions 的循环 FK 已移出，在步骤 5 单独添加
    op.create_table('assignments',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('task_id', sa.String(length=64), nullable=False),
    sa.Column('item_id', sa.String(length=64), nullable=False),
    sa.Column('labeler_id', sa.String(length=64), nullable=False),
    sa.Column('schema_version_id', sa.String(length=64), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('locked_until', sa.DateTime(), nullable=True),
    sa.Column('latest_submission_id', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['item_id'], ['dataset_items.id'], ),
    sa.ForeignKeyConstraint(['labeler_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['schema_version_id'], ['schema_versions.id'], ),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ),
    sa.PrimaryKeyConstraint('id')
    )

    # 第 3 步：建 drafts（主键为 assignment_id，无独立 id 列，无 updated_at）
    op.create_table('drafts',
    sa.Column('assignment_id', sa.String(length=64), nullable=False),
    sa.Column('schema_version_id', sa.String(length=64), nullable=False),
    sa.Column('answers_json', sa.JSON(), nullable=False),
    sa.Column('client_revision', sa.Integer(), nullable=False),
    sa.Column('server_revision', sa.Integer(), nullable=False),
    sa.Column('validation_errors_json', sa.JSON(), nullable=True),
    sa.Column('saved_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['assignment_id'], ['assignments.id'], ),
    sa.ForeignKeyConstraint(['schema_version_id'], ['schema_versions.id'], ),
    sa.PrimaryKeyConstraint('assignment_id')
    )

    # 第 4 步：建 submissions（所有被引用表此时均已存在）
    op.create_table('submissions',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('assignment_id', sa.String(length=64), nullable=False),
    sa.Column('task_id', sa.String(length=64), nullable=False),
    sa.Column('item_id', sa.String(length=64), nullable=False),
    sa.Column('labeler_id', sa.String(length=64), nullable=False),
    sa.Column('schema_version_id', sa.String(length=64), nullable=False),
    sa.Column('attempt_no', sa.Integer(), nullable=False),
    sa.Column('answers_json', sa.JSON(), nullable=False),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('validation_json', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['assignment_id'], ['assignments.id'], ),
    sa.ForeignKeyConstraint(['item_id'], ['dataset_items.id'], ),
    sa.ForeignKeyConstraint(['labeler_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['schema_version_id'], ['schema_versions.id'], ),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('assignment_id', 'attempt_no', name='uq_submissions_assignment_attempt')
    )

    # 第 5 步：独立添加两条循环 FK（所有表均已建完，可安全 ALTER TABLE）
    # ① dataset_items.current_assignment_id → assignments
    op.create_foreign_key(
        'fk_dataset_items_current_assignment_id',
        'dataset_items', 'assignments',
        ['current_assignment_id'], ['id'],
    )
    # ② assignments.latest_submission_id → submissions
    op.create_foreign_key(
        'fk_assignments_latest_submission_id',
        'assignments', 'submissions',
        ['latest_submission_id'], ['id'],
    )


def downgrade() -> None:
    # 第 1 步：先删除两条独立添加的循环 FK（必须在 drop 被引用表之前）
    op.drop_constraint('fk_assignments_latest_submission_id', 'assignments', type_='foreignkey')
    op.drop_constraint('fk_dataset_items_current_assignment_id', 'dataset_items', type_='foreignkey')

    # 第 2 步：按非循环 FK 逆序删表
    op.drop_table('submissions')
    op.drop_table('drafts')
    op.drop_table('assignments')
    op.drop_index('ix_dataset_items_task_id', table_name='dataset_items')
    op.drop_index('ix_dataset_items_external_key', table_name='dataset_items')
    op.drop_table('dataset_items')
