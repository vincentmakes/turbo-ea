"""Add ``description`` to tags.

Tags gain an optional free-text description (tag groups already had one),
surfaced in the metamodel Tags admin and carried through workspace transfer.

Revision ID: 109
Revises: 108
Create Date: 2026-06-26
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "109"
down_revision: Union[str, None] = "108"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column("tags", sa.Column("description", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("tags", "description")
