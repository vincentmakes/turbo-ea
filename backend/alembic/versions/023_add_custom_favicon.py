"""Add custom_favicon and custom_favicon_mime columns to app_settings.

Revision ID: 023
Revises: 022
Create Date: 2026-02-16
"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "023"
down_revision: Union[str, None] = "022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("app_settings", sa.Column("custom_favicon", sa.LargeBinary(), nullable=True))
    op.add_column("app_settings", sa.Column("custom_favicon_mime", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("app_settings", "custom_favicon_mime")
    op.drop_column("app_settings", "custom_favicon")
