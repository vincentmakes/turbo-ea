"""Add skip_staging to servicenow_mappings.

Revision ID: 032
Revises: 031
"""

import sqlalchemy as sa

from alembic import op

revision = "032"
down_revision = "031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "servicenow_mappings",
        sa.Column("skip_staging", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("servicenow_mappings", "skip_staging")
