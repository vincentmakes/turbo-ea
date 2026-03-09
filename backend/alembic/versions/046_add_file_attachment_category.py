"""Add category column to file_attachments table.

Revision ID: 046
Revises: 045
Create Date: 2026-03-09
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "046"
down_revision: Union[str, None] = "045"
branch_labels: Union[str, tuple[str, ...], None] = None
depends_on: Union[str, tuple[str, ...], None] = None


def upgrade() -> None:
    op.add_column(
        "file_attachments",
        sa.Column("category", sa.String(50), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("file_attachments", "category")
