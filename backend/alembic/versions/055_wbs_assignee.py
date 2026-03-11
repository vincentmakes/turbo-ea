"""Add assignee_id to ppm_wbs table.

Revision ID: 055
Revises: 054
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "055"
down_revision = "054"


def upgrade() -> None:
    op.add_column(
        "ppm_wbs",
        sa.Column(
            "assignee_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("ppm_wbs", "assignee_id")
