"""llm_call_logs add token usage and latency columns (TC-AI-07)

Revision ID: a1b2c3d4e5f6
Revises: 2223d4ffd240
Create Date: 2026-06-05

手写迁移（非 autogenerate）：仅向现有 llm_call_logs 表追加 4 个可空列，
不重建表。新增列：prompt_tokens / completion_tokens / total_tokens / latency_ms。
"""
from alembic import op
import sqlalchemy as sa


revision = 'a1b2c3d4e5f6'
down_revision = '2223d4ffd240'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('llm_call_logs', sa.Column('prompt_tokens', sa.Integer(), nullable=True))
    op.add_column('llm_call_logs', sa.Column('completion_tokens', sa.Integer(), nullable=True))
    op.add_column('llm_call_logs', sa.Column('total_tokens', sa.Integer(), nullable=True))
    op.add_column('llm_call_logs', sa.Column('latency_ms', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('llm_call_logs', 'latency_ms')
    op.drop_column('llm_call_logs', 'total_tokens')
    op.drop_column('llm_call_logs', 'completion_tokens')
    op.drop_column('llm_call_logs', 'prompt_tokens')
