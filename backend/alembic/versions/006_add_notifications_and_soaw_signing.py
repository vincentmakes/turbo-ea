"""add notifications table, user notification_preferences, soaw signing fields

Revision ID: 006
Revises: 005
Create Date: 2026-02-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    # --- notifications table ---
    if not inspector.has_table("notifications"):
        op.create_table(
            "notifications",
            sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "user_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("type", sa.String(50), nullable=False),
            sa.Column("title", sa.String(500), nullable=False),
            sa.Column("message", sa.Text(), nullable=False, server_default=""),
            sa.Column("link", sa.String(500), nullable=True),
            sa.Column("is_read", sa.Boolean(), server_default="false", index=True),
            sa.Column("is_emailed", sa.Boolean(), server_default="false"),
            sa.Column("data", postgresql.JSONB(), server_default="{}"),
            sa.Column(
                "fact_sheet_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("fact_sheets.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "actor_id",
                sa.UUID(as_uuid=True),
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

    # --- user notification_preferences ---
    user_cols = [c["name"] for c in inspector.get_columns("users")]
    if "notification_preferences" not in user_cols:
        op.add_column(
            "users",
            sa.Column("notification_preferences", postgresql.JSONB(), nullable=True),
        )

    # --- soaw signing/revision fields ---
    soaw_cols = [c["name"] for c in inspector.get_columns("statement_of_architecture_works")]
    if "revision_number" not in soaw_cols:
        op.add_column(
            "statement_of_architecture_works",
            sa.Column("revision_number", sa.Integer(), server_default="1"),
        )
    if "parent_id" not in soaw_cols:
        op.add_column(
            "statement_of_architecture_works",
            sa.Column(
                "parent_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("statement_of_architecture_works.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
    if "signatories" not in soaw_cols:
        op.add_column(
            "statement_of_architecture_works",
            sa.Column("signatories", postgresql.JSONB(), server_default="[]"),
        )
    if "signed_at" not in soaw_cols:
        op.add_column(
            "statement_of_architecture_works",
            sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    op.drop_column("statement_of_architecture_works", "signed_at")
    op.drop_column("statement_of_architecture_works", "signatories")
    op.drop_column("statement_of_architecture_works", "parent_id")
    op.drop_column("statement_of_architecture_works", "revision_number")
    op.drop_column("users", "notification_preferences")
    op.drop_table("notifications")
