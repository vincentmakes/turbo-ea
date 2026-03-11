from __future__ import annotations

import uuid
from datetime import date as date_type

from sqlalchemy import Date, Float, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class PpmCostLine(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "ppm_cost_lines"

    initiative_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False)
    planned: Mapped[float] = mapped_column(Float, default=0)
    actual: Mapped[float] = mapped_column(Float, default=0)
    date: Mapped[date_type | None] = mapped_column(Date, nullable=True)


class PpmBudgetLine(Base, UUIDMixin, TimestampMixin):
    """Planned budget for an initiative, linked to a fiscal year."""

    __tablename__ = "ppm_budget_lines"

    initiative_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    fiscal_year: Mapped[int] = mapped_column(Integer, nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False)  # capex | opex
    amount: Mapped[float] = mapped_column(Float, default=0)
