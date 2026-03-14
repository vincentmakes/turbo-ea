"""Fix archlens tables: add missing timestamp columns, make connection_id nullable.

Revision ID: 058
Revises: 057
Create Date: 2026-03-14
"""

from alembic import op

revision = "058"
down_revision = "057"
branch_labels = None
depends_on = None

_TABLES = [
    "archlens_vendor_analysis",
    "archlens_vendor_hierarchy",
    "archlens_duplicate_clusters",
    "archlens_modernization_assessments",
    "archlens_analysis_runs",
]


def upgrade() -> None:
    for table in _TABLES:
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()"
        )
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()"
        )

    # connection_id is unused (ArchLens runs natively, no external connection).
    # The original migration created it as NOT NULL; make it nullable.
    op.execute("ALTER TABLE archlens_analysis_runs ALTER COLUMN connection_id DROP NOT NULL")


def downgrade() -> None:
    pass
