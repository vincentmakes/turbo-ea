"""Add kpi_snapshots table for dashboard trend indicators.

Revision ID: 062
Revises: 061
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "062"
down_revision = "061"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "kpi_snapshots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("total_cards", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("avg_data_quality", sa.Float(), nullable=False, server_default="0"),
        sa.Column("approved_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("broken_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("snapshot_date", name="uq_kpi_snapshots_snapshot_date"),
    )
    op.create_index("ix_kpi_snapshots_snapshot_date", "kpi_snapshots", ["snapshot_date"])


def downgrade() -> None:
    op.drop_index("ix_kpi_snapshots_snapshot_date", table_name="kpi_snapshots")
    op.drop_table("kpi_snapshots")
