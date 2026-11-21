"""Diagrams on decisions: the ``architecture_decision_diagrams`` table.

A live link from a decision to an existing free-draw diagram: one row per
(decision, diagram) pair, unique (``uq_adr_diagram``), both foreign keys
``CASCADE`` and indexed, so deleting the diagram or the decision removes the
link. ``created_at`` defaults to ``now()``.

Names (constraint, indexes) are exactly the model's own, so a schema built by
``create_all`` downgrades cleanly. Downgrade drops the table.

Revision ID: 194
Revises: 193
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "194"
down_revision: Union[str, None] = "193"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "architecture_decision_diagrams"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "architecture_decision_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("architecture_decisions.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "diagram_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("diagrams.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("architecture_decision_id", "diagram_id", name="uq_adr_diagram"),
    )


def downgrade() -> None:
    op.drop_table(TABLE)
