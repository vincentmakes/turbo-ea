"""add app_settings table for admin-configurable settings

Revision ID: 007
Revises: 006
Create Date: 2026-02-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    if not inspector.has_table("app_settings"):
        op.create_table(
            "app_settings",
            sa.Column("id", sa.String(50), primary_key=True),
            sa.Column("email_settings", postgresql.JSONB(), server_default="{}"),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
            ),
        )


def downgrade() -> None:
    op.drop_table("app_settings")
