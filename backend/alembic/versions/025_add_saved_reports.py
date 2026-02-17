"""Add saved_reports and saved_report_shares tables.

Revision ID: 025
Revises: 024
Create Date: 2026-02-17
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "025"
down_revision: Union[str, None] = "024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "saved_reports",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("report_type", sa.String(50), nullable=False),
        sa.Column("config", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("thumbnail", sa.Text(), nullable=True),
        sa.Column("visibility", sa.String(20), nullable=False, server_default="private"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_saved_reports_owner_id", "saved_reports", ["owner_id"])
    op.create_index("ix_saved_reports_visibility", "saved_reports", ["visibility"])

    op.create_table(
        "saved_report_shares",
        sa.Column("saved_report_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("saved_reports.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    )


def downgrade() -> None:
    op.drop_table("saved_report_shares")
    op.drop_index("ix_saved_reports_visibility", table_name="saved_reports")
    op.drop_index("ix_saved_reports_owner_id", table_name="saved_reports")
    op.drop_table("saved_reports")
