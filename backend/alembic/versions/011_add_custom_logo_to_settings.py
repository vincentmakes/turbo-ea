"""add custom_logo columns to app_settings

Revision ID: 011
Revises: 010
Create Date: 2026-02-13
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "011"
down_revision: Union[str, None] = "010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    if inspector.has_table("app_settings"):
        columns = [c["name"] for c in inspector.get_columns("app_settings")]
        if "custom_logo" not in columns:
            op.add_column(
                "app_settings",
                sa.Column("custom_logo", sa.LargeBinary(), nullable=True),
            )
        if "custom_logo_mime" not in columns:
            op.add_column(
                "app_settings",
                sa.Column("custom_logo_mime", sa.Text(), nullable=True),
            )


def downgrade() -> None:
    op.drop_column("app_settings", "custom_logo_mime")
    op.drop_column("app_settings", "custom_logo")
