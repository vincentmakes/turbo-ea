from __future__ import annotations

from sqlalchemy import Boolean, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class LicenseType(Base, UUIDMixin, TimestampMixin):
    """A line of the license-type catalogue (e.g. "Admin") of one metric. ``key`` is what
    ``card_licenses.items`` is keyed by; it never changes and a row is archived,
    never deleted, so recorded counts keep a name."""

    __tablename__ = "license_types"
    __table_args__ = (UniqueConstraint("metric_key", "key", name="uq_license_types_metric_key"),)

    # The metric (``license_metrics.key``) the type belongs to; never changes. A key is
    # unique per metric, so "Prod" can exist under two metrics.
    metric_key: Mapped[str] = mapped_column(String(64), nullable=False)
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    archived: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    translations: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
