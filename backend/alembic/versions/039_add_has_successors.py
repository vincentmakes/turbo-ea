"""Add has_successors column to card_types.

Mirrors the existing ``has_hierarchy`` boolean flag.  When enabled on a card
type, the card detail page shows a dedicated Successors / Predecessors section.

Revision ID: 039
Revises: 038
Create Date: 2026-02-24
"""

import sqlalchemy as sa

from alembic import op

revision = "039"
down_revision = "038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "card_types",
        sa.Column("has_successors", sa.Boolean(), server_default="false", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("card_types", "has_successors")
