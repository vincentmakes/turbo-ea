"""Add last_login column to users table.

Revision ID: 048
Revises: 047
"""

import sqlalchemy as sa

from alembic import op

revision = "048"
down_revision = "047"


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "last_login")
