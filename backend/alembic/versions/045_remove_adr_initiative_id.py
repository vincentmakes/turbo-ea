"""Remove initiative_id FK from architecture_decisions — initiatives are now linked via
architecture_decision_cards like any other card.

Revision ID: 045
Revises: 044
Create Date: 2026-03-08
"""

from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "045"
down_revision: Union[str, None] = "044"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    # Migrate existing initiative_id values into the junction table so no data
    # is lost.  Only insert rows that don't already exist (the ADR may already
    # have the initiative as a linked card).
    op.execute(
        sa.text("""
            INSERT INTO architecture_decision_cards (id, architecture_decision_id, card_id)
            SELECT gen_random_uuid(), ad.id, ad.initiative_id
            FROM architecture_decisions ad
            WHERE ad.initiative_id IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM architecture_decision_cards adc
                  WHERE adc.architecture_decision_id = ad.id
                    AND adc.card_id = ad.initiative_id
              )
        """)
    )

    # Drop the column (cascade drops the FK constraint and index automatically)
    op.drop_column("architecture_decisions", "initiative_id")


def downgrade() -> None:
    op.add_column(
        "architecture_decisions",
        sa.Column(
            "initiative_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_adr_initiative_id",
        "architecture_decisions",
        "cards",
        ["initiative_id"],
        ["id"],
        ondelete="SET NULL",
    )
