"""Add nullable plugin_id column to card_types and relation_types.

Enables the parallel metamodel plugin architecture (e.g., ArchiMate).
Rows seeded by a plugin carry plugin_id = "archimate" (or "uml", etc.).
All existing rows remain with plugin_id = NULL — no effect on existing data.

Revision ID: 093
Revises: 092
Create Date: 2026-05-25
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "093"
down_revision: Union[str, None] = "092"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("card_types", sa.Column("plugin_id", sa.String(100), nullable=True))
    op.add_column("relation_types", sa.Column("plugin_id", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("relation_types", "plugin_id")
    op.drop_column("card_types", "plugin_id")
