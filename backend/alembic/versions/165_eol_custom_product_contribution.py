"""Custom EOL products: the two fields the endoflife.date proposal needs.

``eol_category`` (one of endoflife.date's categories) and
``release_policy_note`` (the paragraph under the product file's front matter)
are saved on the product so a contributor can come back to a draft, and so
anyone who may view EOL data can reproduce the same file.

Revision ID: 165
Revises: 164
Create Date: 2026-11-05
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "165"
down_revision: Union[str, None] = "164"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("eol_custom_products", sa.Column("eol_category", sa.String(20), nullable=True))
    op.add_column("eol_custom_products", sa.Column("release_policy_note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("eol_custom_products", "release_policy_note")
    op.drop_column("eol_custom_products", "eol_category")
