"""Add configurable values to PML financial rows.

Revision ID: 199
Revises: 198

Downgrade discards the configured field values while preserving financial rows.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "199"
down_revision = "198"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("ppm_budget_lines", "ppm_cost_lines", "ppm_invoices"):
        op.add_column(
            table,
            sa.Column(
                "field_values",
                postgresql.JSONB(),
                nullable=False,
                server_default=sa.text("'{}'::jsonb"),
            ),
        )


def downgrade() -> None:
    for table in ("ppm_invoices", "ppm_cost_lines", "ppm_budget_lines"):
        op.drop_column(table, "field_values")
