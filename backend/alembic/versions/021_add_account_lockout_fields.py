"""add account lockout fields to users

Revision ID: 021
Revises: 020
Create Date: 2026-02-15
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "021"
down_revision: Union[str, None] = "020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    existing_columns = {col["name"] for col in inspector.get_columns("users")}

    if "failed_login_attempts" not in existing_columns:
        op.add_column(
            "users",
            sa.Column(
                "failed_login_attempts",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
        )

    if "locked_until" not in existing_columns:
        op.add_column(
            "users",
            sa.Column(
                "locked_until",
                sa.DateTime(timezone=True),
                nullable=True,
            ),
        )


def downgrade() -> None:
    op.drop_column("users", "locked_until")
    op.drop_column("users", "failed_login_attempts")
