"""Drop the unused ``diagrams.type`` column.

The Data Flow / Free Draw diagram type was purely cosmetic (icon + label) and
was never leveraged by any feature, so the distinction is removed entirely.

Revision ID: 111
Revises: 110
Create Date: 2026-06-28
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "111"
down_revision: Union[str, None] = "110"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.drop_column("diagrams", "type")


def downgrade() -> None:
    op.add_column(
        "diagrams",
        sa.Column("type", sa.String(length=50), nullable=False, server_default="free_draw"),
    )
