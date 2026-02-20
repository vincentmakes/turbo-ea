"""Add archived_at column to cards table.

Supports the archive/restore workflow where cards can be soft-deleted
with a timestamp, enabling auto-purge after 30 days.

Revision ID: 027
Revises: 026
Create Date: 2026-02-17
"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "027"
down_revision: Union[str, None] = "026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "cards",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("cards", "archived_at")
