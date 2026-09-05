"""Stamp events with the statement clock, not the transaction clock.

``events.created_at`` defaulted to ``now()``, which PostgreSQL defines as the
transaction start time — so every event a single request wrote carried the
same timestamp, and their order was whatever the planner returned. Two
consumers replay events in order: the mutation-batch rollback (which applies
inverses newest-first, so a role changed then removed in one batch must be
re-assigned before its role is restored) and the card History tab.
``clock_timestamp()`` is the wall clock at the moment of the INSERT, so rows
written by one request stay distinct and in write order. Changing a column
default rewrites nothing; existing rows keep their stamps.

Revision ID: 145
Revises: 144
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "145"
down_revision: Union[str, None] = "144"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.alter_column(
        "events",
        "created_at",
        server_default=sa.text("clock_timestamp()"),
        existing_type=sa.DateTime(timezone=True),
    )


def downgrade() -> None:
    op.alter_column(
        "events",
        "created_at",
        server_default=sa.text("now()"),
        existing_type=sa.DateTime(timezone=True),
    )
