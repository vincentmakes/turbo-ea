"""add process_flow_versions table for draft/published/archived workflow

Revision ID: 016
Revises: 015
Create Date: 2026-02-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "016"
down_revision: Union[str, None] = "015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    if not inspector.has_table("process_flow_versions"):
        op.create_table(
            "process_flow_versions",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "process_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("fact_sheets.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("status", sa.String(20), nullable=False, default="draft"),
            sa.Column("revision", sa.Integer(), default=1),
            sa.Column("bpmn_xml", sa.Text(), nullable=False),
            sa.Column("svg_thumbnail", sa.Text(), nullable=True),
            sa.Column(
                "created_by",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id"),
                nullable=True,
            ),
            sa.Column(
                "submitted_by",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id"),
                nullable=True,
            ),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "approved_by",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id"),
                nullable=True,
            ),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "based_on_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("process_flow_versions.id"),
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

    # Migrate existing process_diagrams into process_flow_versions as drafts.
    # Only run if the process_flow_versions table is empty (idempotent).
    if inspector.has_table("process_diagrams"):
        count = conn.execute(
            sa.text("SELECT COUNT(*) FROM process_flow_versions")
        ).scalar()
        if count == 0:
            conn.execute(
                sa.text(
                    """
                    INSERT INTO process_flow_versions
                        (id, process_id, status, revision, bpmn_xml,
                         svg_thumbnail, created_by, created_at, updated_at)
                    SELECT
                        gen_random_uuid(), process_id, 'draft', version, bpmn_xml,
                        svg_thumbnail, created_by, created_at, updated_at
                    FROM process_diagrams
                    """
                )
            )


def downgrade() -> None:
    op.drop_table("process_flow_versions")
