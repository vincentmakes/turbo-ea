"""Make connection_id nullable on archlens_analysis_runs.

Migration 058 included this fix but may have been stamped without
executing (create_all + stamp path).  This migration is idempotent.

Revision ID: 059
Revises: 058
Create Date: 2026-03-14
"""

from alembic import op

revision = "059"
down_revision = "058"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE archlens_analysis_runs ALTER COLUMN connection_id DROP NOT NULL")


def downgrade() -> None:
    pass
