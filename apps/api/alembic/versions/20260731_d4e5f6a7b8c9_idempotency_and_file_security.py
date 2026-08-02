"""idempotency expiry index and verified upload metadata

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-07-31
"""

from alembic import op
import sqlalchemy as sa


revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_idempotency_records_expires_at",
        "idempotency_records",
        ["expires_at"],
        unique=False,
    )
    op.add_column(
        "files",
        sa.Column("uploaded_size", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "files",
        sa.Column("checksum_sha256", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "files",
        sa.Column("failure_reason", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("files", "failure_reason")
    op.drop_column("files", "checksum_sha256")
    op.drop_column("files", "uploaded_size")
    op.drop_index(
        "ix_idempotency_records_expires_at",
        table_name="idempotency_records",
    )
