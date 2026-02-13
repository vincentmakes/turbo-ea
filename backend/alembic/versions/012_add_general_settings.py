"""add general_settings column to app_settings

Revision ID: 012
Revises: 011
Create Date: 2026-02-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    if inspector.has_table("app_settings"):
        columns = [c["name"] for c in inspector.get_columns("app_settings")]
        if "general_settings" not in columns:
            op.add_column(
                "app_settings",
                sa.Column(
                    "general_settings",
                    postgresql.JSONB(),
                    server_default="{}",
                    nullable=True,
                ),
            )


def downgrade() -> None:
    op.drop_column("app_settings", "general_settings")
