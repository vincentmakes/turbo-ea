"""Add section_config JSONB column to card_types.

Revision ID: 029
Revises: 028
Create Date: 2026-02-18
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "029"
down_revision: Union[str, None] = "028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("card_types", sa.Column("section_config", JSONB, server_default="{}"))


def downgrade() -> None:
    op.drop_column("card_types", "section_config")
