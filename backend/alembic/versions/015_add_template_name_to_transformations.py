"""Add template_name column to transformations for predefined template tracking

Revision ID: 015
Revises: 014
Create Date: 2026-02-13
"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "015"
down_revision: Union[str, None] = "014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "transformations",
        sa.Column("template_name", sa.String(500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("transformations", "template_name")
