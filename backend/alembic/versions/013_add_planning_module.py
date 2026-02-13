"""Add Architecture & Roadmap Planning module tables

Revision ID: 013
Revises: 012
Create Date: 2026-02-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    # Transformation Templates
    if not inspector.has_table("transformation_templates"):
        op.create_table(
            "transformation_templates",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("name", sa.String(500), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("target_fact_sheet_type", sa.String(100), nullable=False),
            sa.Column("is_predefined", sa.Boolean(), server_default="false"),
            sa.Column("is_hidden", sa.Boolean(), server_default="false"),
            sa.Column(
                "implied_impacts_schema",
                postgresql.JSONB(),
                server_default="[]",
            ),
            sa.Column(
                "required_fields", postgresql.JSONB(), server_default="[]"
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

    # Transformations
    if not inspector.has_table("transformations"):
        op.create_table(
            "transformations",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("name", sa.String(500), nullable=False),
            sa.Column(
                "initiative_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("fact_sheets.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column(
                "template_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey(
                    "transformation_templates.id", ondelete="SET NULL"
                ),
                nullable=True,
            ),
            sa.Column(
                "status",
                sa.String(50),
                server_default="draft",
                nullable=False,
            ),
            sa.Column("completion_date", sa.Date(), nullable=True),
            sa.Column(
                "created_by",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "updated_by",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
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

    # Impacts
    if not inspector.has_table("impacts"):
        op.create_table(
            "impacts",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "transformation_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("transformations.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("impact_type", sa.String(50), nullable=False),
            sa.Column("action", sa.String(50), nullable=False),
            sa.Column(
                "source_fact_sheet_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("fact_sheets.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "target_fact_sheet_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("fact_sheets.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("field_name", sa.String(200), nullable=True),
            sa.Column("field_value", postgresql.JSONB(), nullable=True),
            sa.Column("relation_type", sa.String(200), nullable=True),
            sa.Column(
                "is_implied", sa.Boolean(), server_default="true", nullable=False
            ),
            sa.Column(
                "is_disabled",
                sa.Boolean(),
                server_default="false",
                nullable=False,
            ),
            sa.Column(
                "execution_order", sa.Integer(), server_default="0", nullable=False
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

    # Milestones
    if not inspector.has_table("milestones"):
        op.create_table(
            "milestones",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "initiative_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("fact_sheets.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("name", sa.String(500), nullable=False),
            sa.Column("target_date", sa.Date(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
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
    op.drop_table("impacts")
    op.drop_table("transformations")
    op.drop_table("transformation_templates")
    op.drop_table("milestones")
