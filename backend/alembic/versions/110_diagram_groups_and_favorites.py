"""Create diagram favorites and diagram groups tables.

Backs the Diagrams gallery redesign: per-user diagram favorites and
workspace-shared, multi-group grouping (a diagram can belong to several
groups, label/tag style).

Revision ID: 110
Revises: 109
Create Date: 2026-06-27
"""

from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "110"
down_revision: Union[str, None] = "109"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.create_table(
        "diagram_favorites",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "diagram_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("diagrams.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("user_id", "diagram_id", name="uq_diagram_favorites_user_diagram"),
    )
    op.create_index("ix_diagram_favorites_user_id", "diagram_favorites", ["user_id"])
    op.create_index("ix_diagram_favorites_diagram_id", "diagram_favorites", ["diagram_id"])

    op.create_table(
        "diagram_groups",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("color", sa.String(length=20), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
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

    op.create_table(
        "diagram_group_members",
        sa.Column(
            "diagram_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("diagrams.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "group_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("diagram_groups.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("diagram_group_members")
    op.drop_table("diagram_groups")
    op.drop_index("ix_diagram_favorites_diagram_id", table_name="diagram_favorites")
    op.drop_index("ix_diagram_favorites_user_id", table_name="diagram_favorites")
    op.drop_table("diagram_favorites")
