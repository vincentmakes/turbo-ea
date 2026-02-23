"""Add locale column to users table

Revision ID: 036
Revises: 035
Create Date: 2026-02-23
"""

import sqlalchemy as sa
from alembic import op

revision = "036"
down_revision = "035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("locale", sa.String(10), server_default="en", nullable=False))


def downgrade() -> None:
    op.drop_column("users", "locale")
