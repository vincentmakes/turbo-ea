from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import Date, Float, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class KpiSnapshot(Base, TimestampMixin):
    """Daily snapshot of dashboard KPI values for trend computation.

    A background task captures one row per day (UPSERT keyed on snapshot_date),
    so the dashboard endpoint can compare today's values against any prior date.
    """

    __tablename__ = "kpi_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    snapshot_date: Mapped[date] = mapped_column(Date, unique=True, nullable=False, index=True)
    total_cards: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    avg_data_quality: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    approved_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    broken_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
