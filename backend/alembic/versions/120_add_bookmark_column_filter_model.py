"""Add ``column_filter_model`` to bookmarks.

Saved inventory views now persist the AG Grid column-filter model
(``api.getFilterModel()`` output, shape ``{ [colId]: filterState }``) so
applying a view restores the grid's column filters, not just the sidebar
filters, column visibility and layout. Stored as JSONB; nullable, no backfill
(existing views simply carry no column filters).

Revision ID: 120
Revises: 119
Create Date: 2026-07-07
"""

from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "120"
down_revision: Union[str, None] = "119"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column(
        "bookmarks",
        sa.Column("column_filter_model", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("bookmarks", "column_filter_model")
