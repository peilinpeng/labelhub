"""固定 AI 工作流输入与配置，旧任务空快照安全转人工。"""
from alembic import op
import sqlalchemy as sa

revision = "a7b8c9d0e1f2"
down_revision = "f6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("ai_review_jobs", sa.Column("workflow_snapshot_json", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("ai_review_jobs", "workflow_snapshot_json")
