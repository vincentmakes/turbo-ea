"""add password_setup_token to users

Revision ID: 020
Revises: 019
Create Date: 2026-02-15
"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "020"
down_revision: Union[str, None] = "019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    existing_columns = {col["name"] for col in inspector.get_columns("users")}

    if "password_setup_token" not in existing_columns:
        op.add_column(
            "users",
            sa.Column(
                "password_setup_token",
                sa.String(128),
                nullable=True,
                unique=True,
            ),
        )


def downgrade() -> None:
    op.drop_column("users", "password_setup_token")
