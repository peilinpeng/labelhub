"""batch_1_users_tasks_schema_drafts_schema_versions

Revision ID: d7ef5693ca61
Revises:
Create Date: 2026-05-25 22:39:03.876015

"""
# 迁移脚本模板：由 alembic 自动填充 revision id、依赖版本和生成时间。
from alembic import op
import sqlalchemy as sa


revision = 'd7ef5693ca61'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ### 手动调整表创建顺序，解决 tasks ↔ schema_versions 循环 FK 问题 ###
    #
    # 原始 autogenerate 顺序错误（schema_drafts/schema_versions 先于 tasks/users 创建），
    # 并在 tasks.create_table 中内联了指向 schema_versions 的 FK，形成循环依赖。
    # 修复策略：
    #   1. 按依赖关系重新排序：users → tasks → schema_drafts → schema_versions
    #   2. 从 tasks 的 create_table 中移除 active_schema_version_id 的 FK 内联定义
    #   3. 在 schema_versions 建表完成后，用独立语句添加该循环 FK

    # 第 1 步：建 users（无外键依赖）
    op.create_table('users',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('hashed_password', sa.String(length=255), nullable=False),
    sa.Column('display_name', sa.String(length=255), nullable=False),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email')
    )

    # 第 2 步：建 tasks（仅含 owner_id → users 的 FK，移除 active_schema_version_id FK）
    op.create_table('tasks',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('instruction_rich_text_json', sa.JSON(), nullable=True),
    sa.Column('tags_json', sa.JSON(), nullable=False),
    sa.Column('reward_rule_json', sa.JSON(), nullable=True),
    sa.Column('quota_json', sa.JSON(), nullable=False),
    sa.Column('deadline_at', sa.DateTime(), nullable=True),
    sa.Column('distribution_strategy_json', sa.JSON(), nullable=False),
    sa.Column('review_policy_json', sa.JSON(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('active_schema_version_id', sa.String(length=64), nullable=True),
    sa.Column('owner_id', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )

    # 第 3 步：建 schema_drafts（FK → tasks, users，此时两表已存在）
    op.create_table('schema_drafts',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('task_id', sa.String(length=64), nullable=False),
    sa.Column('schema_json', sa.JSON(), nullable=False),
    sa.Column('schema_draft_revision', sa.Integer(), nullable=False),
    sa.Column('updated_by', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ),
    sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )

    # 第 4 步：建 schema_versions（FK → schema_drafts, tasks，此时两表均已存在）
    op.create_table('schema_versions',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('task_id', sa.String(length=64), nullable=False),
    sa.Column('schema_id', sa.String(length=64), nullable=False),
    sa.Column('schema_version_no', sa.Integer(), nullable=False),
    sa.Column('contract_version', sa.String(length=10), nullable=False),
    sa.Column('schema_json', sa.JSON(), nullable=False),
    sa.Column('published_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['schema_id'], ['schema_drafts.id'], ),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('task_id', 'schema_version_no', name='uq_schema_versions_task_version')
    )

    # 第 5 步：补充 tasks.active_schema_version_id → schema_versions 的循环 FK
    # （schema_versions 已建完，可安全添加）
    op.create_foreign_key(
        "fk_tasks_active_schema_version_id",
        "tasks", "schema_versions",
        ["active_schema_version_id"], ["id"],
    )
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### 按 upgrade 逆序 drop，先移除循环 FK 再按依赖顺序删表 ###

    # 第 1 步：删除独立添加的循环 FK（必须在 drop schema_versions 之前）
    op.drop_constraint("fk_tasks_active_schema_version_id", "tasks", type_="foreignkey")

    # 第 2 步：按依赖逆序删表
    op.drop_table('schema_versions')
    op.drop_table('schema_drafts')
    op.drop_table('tasks')
    op.drop_table('users')
    # ### end Alembic commands ###
