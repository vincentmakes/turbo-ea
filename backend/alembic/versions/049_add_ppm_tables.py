"""Add PPM status reports and tasks tables.

Revision ID: 049
Revises: 048
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision = "049"
down_revision = "048"


def upgrade() -> None:
    op.create_table(
        "ppm_status_reports",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "initiative_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "reporter_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("report_date", sa.Date, nullable=False),
        sa.Column("schedule_health", sa.Text, nullable=False, server_default="onTrack"),
        sa.Column("cost_health", sa.Text, nullable=False, server_default="onTrack"),
        sa.Column("scope_health", sa.Text, nullable=False, server_default="onTrack"),
        sa.Column("percent_complete", sa.Integer, server_default="0"),
        sa.Column("cost_lines", JSONB, server_default="[]"),
        sa.Column("summary", sa.Text),
        sa.Column("risks", JSONB, server_default="[]"),
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

    op.create_table(
        "ppm_tasks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "initiative_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("status", sa.Text, nullable=False, server_default="todo"),
        sa.Column("priority", sa.Text, nullable=False, server_default="medium"),
        sa.Column(
            "assignee_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("due_date", sa.Date, nullable=True),
        sa.Column("start_date", sa.Date, nullable=True),
        sa.Column("sort_order", sa.Integer, server_default="0"),
        sa.Column("tags", JSONB, server_default="[]"),
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
    op.drop_table("ppm_tasks")
    op.drop_table("ppm_status_reports")
