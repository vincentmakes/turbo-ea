"""Add is_milestone and completion columns to ppm_wbs."""

import sqlalchemy as sa

from alembic import op

revision = "054"
down_revision = "053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ppm_wbs",
        sa.Column("is_milestone", sa.Boolean, server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "ppm_wbs",
        sa.Column("completion", sa.Float, server_default=sa.text("0"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("ppm_wbs", "completion")
    op.drop_column("ppm_wbs", "is_milestone")
