"""add BPM tables: process_diagrams, process_elements, process_assessments

Revision ID: 014
Revises: 013
Create Date: 2026-02-14
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    if not inspector.has_table("process_diagrams"):
        op.create_table(
            "process_diagrams",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "process_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("fact_sheets.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("bpmn_xml", sa.Text(), nullable=False),
            sa.Column("svg_thumbnail", sa.Text(), nullable=True),
            sa.Column("version", sa.Integer(), default=1),
            sa.Column(
                "created_by",
                postgresql.UUID(as_uuid=True),
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

    if not inspector.has_table("process_elements"):
        op.create_table(
            "process_elements",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "process_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("fact_sheets.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("bpmn_element_id", sa.String(200), nullable=False),
            sa.Column("element_type", sa.String(50), nullable=False),
            sa.Column("name", sa.String(500), nullable=True),
            sa.Column("documentation", sa.Text(), nullable=True),
            sa.Column("lane_name", sa.String(200), nullable=True),
            sa.Column("is_automated", sa.Boolean(), default=False),
            sa.Column("sequence_order", sa.Integer(), default=0),
            sa.Column(
                "application_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("fact_sheets.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "data_object_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("fact_sheets.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "it_component_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("fact_sheets.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("custom_fields", postgresql.JSONB(), nullable=True),
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

    if not inspector.has_table("process_assessments"):
        op.create_table(
            "process_assessments",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "process_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("fact_sheets.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column(
                "assessor_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id"),
                nullable=False,
            ),
            sa.Column("assessment_date", sa.Date(), nullable=False),
            sa.Column("overall_score", sa.Integer(), default=0),
            sa.Column("efficiency", sa.Integer(), default=0),
            sa.Column("effectiveness", sa.Integer(), default=0),
            sa.Column("compliance", sa.Integer(), default=0),
            sa.Column("automation", sa.Integer(), default=0),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("action_items", postgresql.JSONB(), nullable=True),
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
    op.drop_table("process_assessments")
    op.drop_table("process_elements")
    op.drop_table("process_diagrams")
