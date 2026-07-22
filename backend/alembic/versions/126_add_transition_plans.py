"""Add the transition_plans table.

One row per manual transition plan (the no-AI planning tool in EA Delivery).
``plan_data`` JSONB holds the snapshotted baseline subgraph plus the ordered
change-operation list; ``scope`` records the snapshot provenance (scope card
ids, BFS depth, supported business-objective ids). ``initiative_id`` links a
committed plan to the Initiative card it created.

Revision ID: 126
Revises: 125
"""

from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "126"
down_revision: Union[str, None] = "125"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.create_table(
        "transition_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="draft"),
        sa.Column("scope", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("plan_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "initiative_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_transition_plans_initiative_id", "transition_plans", ["initiative_id"])


def downgrade() -> None:
    op.drop_index("ix_transition_plans_initiative_id", table_name="transition_plans")
    op.drop_table("transition_plans")
