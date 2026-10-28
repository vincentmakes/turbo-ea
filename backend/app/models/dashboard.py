from __future__ import annotations

from datetime import date

from sqlalchemy import Boolean, Date, Float, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Dashboard(Base, UUIDMixin, TimestampMixin):
    """A homepage dashboard: one tab on ``/``, made of widgets on a 12-column grid.

    The three built-in rows (``overview``, ``workspace``, ``admin``) are seeded
    insert-only on every boot and are never deleted — only hidden — so *Reset to
    default* always has a row to rewrite. ``allowed_roles`` lists role keys;
    an empty list means every role.

    ``widgets`` never holds a card, relation or tag id: a widget query names
    card-type, field and status keys only, which is what lets a workspace
    transfer copy the column verbatim with no id remap.
    """

    __tablename__ = "dashboards"

    key: Mapped[str] = mapped_column(String(60), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    translations: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon: Mapped[str | None] = mapped_column(String(80), nullable=True)
    built_in: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    allowed_roles: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    widgets: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")


class DashboardKpiSnapshot(Base, UUIDMixin, TimestampMixin):
    """Daily value of one generic dashboard KPI, for its trend indicator.

    ``metric_key`` is the canonical query string of the KPI's query
    (``dashboard_query.metric_key``), so the row a widget reads back matches
    the row the capture wrote by construction. Instance-local history: like
    ``kpi_snapshots`` it is not part of a workspace transfer.
    """

    __tablename__ = "dashboard_kpi_snapshots"
    __table_args__ = (
        UniqueConstraint("snapshot_date", "metric_key", name="uq_dashboard_kpi_snapshot"),
    )

    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    metric_key: Mapped[str] = mapped_column(String(300), nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
