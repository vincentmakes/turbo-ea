"""add ea delivery: soaw table and diagram initiative_id

Revision ID: 004
Revises: 003
Create Date: 2026-02-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add initiative_id to diagrams
    op.add_column(
        "diagrams",
        sa.Column(
            "initiative_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("fact_sheets.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # Create statement_of_architecture_works table
    op.create_table(
        "statement_of_architecture_works",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column(
            "initiative_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("fact_sheets.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", sa.String(50), server_default="draft"),
        sa.Column("document_info", postgresql.JSONB(), server_default="{}"),
        sa.Column("version_history", postgresql.JSONB(), server_default="[]"),
        sa.Column("sections", postgresql.JSONB(), server_default="{}"),
        sa.Column(
            "created_by",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("statement_of_architecture_works")
    op.drop_column("diagrams", "initiative_id")
