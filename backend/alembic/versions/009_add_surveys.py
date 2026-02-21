"""add surveys and survey_responses tables

Revision ID: 009
Revises: 008
Create Date: 2026-02-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    if not inspector.has_table("surveys"):
        op.create_table(
            "surveys",
            sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
            sa.Column("name", sa.String(500), nullable=False),
            sa.Column("description", sa.Text(), server_default=""),
            sa.Column("message", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(20), server_default="draft"),
            sa.Column("target_type_key", sa.String(100), nullable=False),
            sa.Column("target_filters", postgresql.JSONB(), server_default="{}"),
            sa.Column("target_roles", postgresql.JSONB(), server_default="[]"),
            sa.Column("fields", postgresql.JSONB(), server_default="[]"),
            sa.Column(
                "created_by",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if not inspector.has_table("survey_responses"):
        op.create_table(
            "survey_responses",
            sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "survey_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("surveys.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column(
                "fact_sheet_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("fact_sheets.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column(
                "user_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("status", sa.String(20), server_default="pending"),
            sa.Column("responses", postgresql.JSONB(), server_default="{}"),
            sa.Column("applied", sa.Boolean(), server_default="false"),
            sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("survey_id", "fact_sheet_id", "user_id", name="uq_survey_response"),
        )


def downgrade() -> None:
    op.drop_table("survey_responses")
    op.drop_table("surveys")
