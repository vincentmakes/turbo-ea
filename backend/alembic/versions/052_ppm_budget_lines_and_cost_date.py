"""Add ppm_budget_lines table and date column to ppm_cost_lines."""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "052"
down_revision = "051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ppm_budget_lines",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "initiative_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("fiscal_year", sa.Integer, nullable=False),
        sa.Column("category", sa.Text, nullable=False),
        sa.Column("amount", sa.Float, default=0),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    op.add_column("ppm_cost_lines", sa.Column("date", sa.Date, nullable=True))


def downgrade() -> None:
    op.drop_column("ppm_cost_lines", "date")
    op.drop_table("ppm_budget_lines")
