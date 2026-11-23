"""Add per-type lifecycle stages and a card's current stage.

Revision ID: 197
Revises: 196
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "197"
down_revision = "196"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "card_types",
        sa.Column("lifecycle_stages", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.add_column("cards", sa.Column("lifecycle_stage", sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column("cards", "lifecycle_stage")
    op.drop_column("card_types", "lifecycle_stages")
