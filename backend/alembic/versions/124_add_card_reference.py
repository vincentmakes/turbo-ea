"""Add human-readable card references (discussion #811).

Two additive columns, no data backfill:

1. ``cards.reference`` — a nullable, globally-unique, human-readable identifier
   (e.g. ``APP-10000``). NULL for card types with the feature off. A UNIQUE index
   backs the generator's ``max + 1`` allocation and rejects duplicate manual IDs.
2. ``card_types.reference_config`` — per-type JSONB config
   ``{mode, prefix, start, padding}`` driving generation. Defaults to ``{}``
   (feature off).

No backfill runs here: at migration time no type has the feature enabled, so
there is nothing to number. Backfill happens at the application layer when an
admin switches a type into ``auto`` mode (``backfill_references_for_type``).

Revision ID: 124
Revises: 123
"""

from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "124"
down_revision: Union[str, None] = "123"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column("cards", sa.Column("reference", sa.String(length=64), nullable=True))
    op.create_index("ix_cards_reference", "cards", ["reference"], unique=True)
    op.add_column(
        "card_types",
        sa.Column(
            "reference_config",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("card_types", "reference_config")
    op.drop_index("ix_cards_reference", table_name="cards")
    op.drop_column("cards", "reference")
