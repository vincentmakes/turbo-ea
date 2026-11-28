"""Lifecycle phases a licensed extension maintains on a card.

One nullable JSONB column, ``cards.lifecycle_maintained``:
``{"ext": "<extension key>", "phases": ["active", "endOfLife"]}``. NULL (every
existing row) means nothing is maintained, so the upgrade changes nothing.

The claim only counts while the owning extension holds the
``core.cards.maintain_lifecycle`` grant (enabled and licensed); see
``app/services/extensions/lifecycle_gate.py``. It is instance-local and is not
carried by workspace transfer.

Downgrade drops the column; the lifecycle values themselves are untouched.

Revision ID: 183
Revises: 182
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "183"
down_revision: Union[str, None] = "182"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "cards",
        sa.Column("lifecycle_maintained", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("cards", "lifecycle_maintained")
