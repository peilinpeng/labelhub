"""ai_assist_actions：AI Assist 建议动作审计表

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-06-10

手写迁移（非 autogenerate）：补建 `ai_assist_actions` 表。该表对应
app/models/ai_assist.py 的 AiAssistAction 模型与 contracts AiAssistActionRecord，
此前模型已存在但从未生成迁移，导致全新库缺表、ai-assist/suggestions 端点在
存在字段级 AI 建议（fieldIssues>0）时 500（缺表）。仅新增一张追加只写表，
不触碰任何现有表。
"""
from alembic import op
import sqlalchemy as sa


revision = 'c3d4e5f6a7b8'
down_revision = 'b2c3d4e5f6a7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'ai_assist_actions',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('suggestion_id', sa.String(length=128), nullable=False),
        sa.Column('submission_id', sa.String(length=64), nullable=False),
        sa.Column('action', sa.String(length=20), nullable=False),
        sa.Column('resulting_status', sa.String(length=20), nullable=False),
        sa.Column('applied_patch_field_names_json', sa.JSON(), nullable=True),
        sa.Column('patch_applied', sa.Boolean(), nullable=True),
        sa.Column('patch_failure_reason', sa.Text(), nullable=True),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('actor_json', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['submission_id'], ['submissions.id']),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('ai_assist_actions')
