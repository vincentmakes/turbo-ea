"""Relations: an optional lifecycle, and a per-relation-type switch for it.

``relations.lifecycle`` holds the same five phase dates a card's lifecycle
does (``plan`` / ``phaseIn`` / ``active`` / ``phaseOut`` / ``endOfLife`` →
``YYYY-MM-DD``). It is NOT NULL with a server default of ``{}``, and an empty
lifecycle means "always in effect" — so every existing relation keeps meaning
exactly what it meant, and no data is rewritten.

``relation_types.lifecycle_enabled`` (NOT NULL, default false) only decides
whether the UI offers the date editor on relations of that type; dates written
by any path are stored and honoured whatever it says. No built-in default
changes, so there is no seed update.

Downgrade drops both columns.

Revision ID: 179
Revises: 178
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "179"
down_revision: Union[str, None] = "178"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RELATIONS = "relations"
RELATION_TYPES = "relation_types"


def upgrade() -> None:
    op.add_column(
        RELATIONS,
        sa.Column(
            "lifecycle",
            postgresql.JSONB(),
            nullable=False,
            server_default="{}",
        ),
    )
    op.add_column(
        RELATION_TYPES,
        sa.Column(
            "lifecycle_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column(RELATION_TYPES, "lifecycle_enabled")
    op.drop_column(RELATIONS, "lifecycle")
