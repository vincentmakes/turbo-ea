"""Admin-editable homepage dashboards.

Two tables:

* ``dashboards`` — one row per homepage tab, each a list of widgets on a
  12-column grid. The three built-in rows (``overview``, ``workspace``,
  ``admin``) are not inserted here: ``seed_dashboards`` (called from
  ``seed_metamodel`` on every boot) inserts them by key, so a fresh install and
  an upgraded one get the same rows from the same code.
* ``dashboard_kpi_snapshots`` — the daily value of every generic KPI widget,
  keyed by the KPI's canonical query string, so a KPI an admin adds shows a
  trend like the four built-in ones (which keep ``kpi_snapshots``).

Revision ID: 160
Revises: 159
Create Date: 2026-10-28
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "160"
down_revision: Union[str, None] = "159"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _timestamps() -> list[sa.Column]:
    # The ORM leaves both stamps out of the INSERT and relies on these
    # defaults (TimestampMixin), so they must exist on an upgraded install.
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "dashboards",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(length=60), nullable=False, unique=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column(
            "translations",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("icon", sa.String(length=80), nullable=True),
        sa.Column("built_in", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "allowed_roles",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "widgets",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        *_timestamps(),
    )
    op.create_table(
        "dashboard_kpi_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("metric_key", sa.String(length=300), nullable=False),
        sa.Column("value", sa.Float(), nullable=False, server_default="0"),
        *_timestamps(),
        sa.UniqueConstraint("snapshot_date", "metric_key", name="uq_dashboard_kpi_snapshot"),
    )
    op.create_index(
        "ix_dashboard_kpi_snapshots_snapshot_date",
        "dashboard_kpi_snapshots",
        ["snapshot_date"],
    )


def downgrade() -> None:
    op.drop_index("ix_dashboard_kpi_snapshots_snapshot_date", table_name="dashboard_kpi_snapshots")
    op.drop_table("dashboard_kpi_snapshots")
    op.drop_table("dashboards")
