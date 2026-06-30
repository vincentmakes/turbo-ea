"""Add ``column_state`` to bookmarks.

Saved views (bookmarks) gain a JSONB ``column_state`` carrying the AG Grid
column layout (order, width, pinning, visibility) captured via
``api.getColumnState()``, so reopening a view restores exactly how the
inventory grid looked when it was saved. The existing ``columns`` list still
drives the column-picker visibility set; this column adds the richer
positional layout.

Revision ID: 113
Revises: 112
Create Date: 2026-06-30
"""

from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "113"
down_revision: Union[str, None] = "112"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column("bookmarks", sa.Column("column_state", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("bookmarks", "column_state")
