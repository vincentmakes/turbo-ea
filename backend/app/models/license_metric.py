from __future__ import annotations

from sqlalchemy import Boolean, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class LicenseMetric(Base, UUIDMixin, TimestampMixin):
    """What licenses are counted in (Users, Installations, ...). ``key`` is what
    ``card_licenses.items`` is keyed by at the first level; it never changes and a row is
    archived, never deleted."""

    __tablename__ = "license_metrics"

    key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    archived: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    translations: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
