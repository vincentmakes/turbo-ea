"""Add sharing and OData support to bookmarks.

Adds visibility, odata_enabled columns to bookmarks table.
Creates bookmark_shares junction table for user-level sharing with can_edit flag.

Revision ID: 030
Revises: 029
Create Date: 2026-02-19
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = "030"
down_revision: Union[str, None] = "029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bookmarks",
        sa.Column("visibility", sa.String(20), nullable=False, server_default="private"),
    )
    op.add_column(
        "bookmarks",
        sa.Column("odata_enabled", sa.Boolean(), nullable=False, server_default="false"),
    )

    op.create_table(
        "bookmark_shares",
        sa.Column(
            "bookmark_id",
            UUID(as_uuid=True),
            sa.ForeignKey("bookmarks.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("can_edit", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_table("bookmark_shares")
    op.drop_column("bookmarks", "odata_enabled")
    op.drop_column("bookmarks", "visibility")
