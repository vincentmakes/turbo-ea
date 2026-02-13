"""Add milestone_links JSONB column to fact_sheets for lifecycle-milestone binding

Revision ID: 014
Revises: 013
Create Date: 2026-02-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add milestone_links JSONB column to fact_sheets
    # Maps lifecycle phase key -> milestone_id, e.g. {"plan": "uuid-1", "active": "uuid-2"}
    op.add_column(
        "fact_sheets",
        sa.Column(
            "milestone_links",
            postgresql.JSONB(),
            server_default="{}",
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("fact_sheets", "milestone_links")
