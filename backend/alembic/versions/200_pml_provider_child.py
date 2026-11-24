"""Record an optional Provider child on PML cost items.

Revision ID: 200
Revises: 199

Downgrade discards the selection and keeps the cost items.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "200"
down_revision = "199"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ppm_cost_lines",
        sa.Column("provider_child_id", postgresql.UUID(as_uuid=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ppm_cost_lines", "provider_child_id")
