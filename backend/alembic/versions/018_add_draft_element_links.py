"""add draft_element_links JSONB to process_flow_versions

Revision ID: 018
Revises: 017
Create Date: 2026-02-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "018"
down_revision: Union[str, None] = "017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "process_flow_versions",
        sa.Column("draft_element_links", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("process_flow_versions", "draft_element_links")
