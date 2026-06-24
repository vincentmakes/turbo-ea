"""Create the ``workspace_transfers`` table.

Backs the async preview/apply lifecycle of the full-workspace import bundle
(Admin → Settings → Workspace Transfer). One row per uploaded bundle; the
binary lives on disk under ``data/workspace_transfers/{id}.bin``.

Revision ID: 107
Revises: 106
Create Date: 2026-06-24
"""

from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "107"
down_revision: Union[str, None] = "106"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.create_table(
        "workspace_transfers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("filename", sa.String(length=500), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column("storage_path", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="uploaded"),
        sa.Column("format_version", sa.String(length=16), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("diff", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("previewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("workspace_transfers")
