"""add link and is_system columns to todos table

Revision ID: 008
Revises: 007
Create Date: 2026-02-13
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    cols = [c["name"] for c in inspector.get_columns("todos")]
    if "link" not in cols:
        op.add_column(
            "todos",
            sa.Column("link", sa.String(500), nullable=True),
        )
    if "is_system" not in cols:
        op.add_column(
            "todos",
            sa.Column("is_system", sa.Boolean(), server_default="false"),
        )


def downgrade() -> None:
    op.drop_column("todos", "is_system")
    op.drop_column("todos", "link")
