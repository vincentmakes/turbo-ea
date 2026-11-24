from __future__ import annotations

import uuid
from datetime import date as date_type
from typing import Any

from sqlalchemy import (
    Date,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class PpmCostLine(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "ppm_cost_lines"
    __table_args__ = (
        UniqueConstraint("initiative_id", "id", name="uq_ppm_cost_initiative_id"),
        ForeignKeyConstraint(
            ["initiative_id", "budget_line_id"],
            ["ppm_budget_lines.initiative_id", "ppm_budget_lines.id"],
            name="fk_ppm_cost_budget",
            deferrable=True,
            initially="DEFERRED",
        ),
        Index("ix_ppm_cost_initiative_budget", "initiative_id", "budget_line_id"),
    )

    budget_line_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    # Keep the recorded identity when the Provider card is deleted.
    provider_child_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    field_values: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )

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
    __table_args__ = (UniqueConstraint("initiative_id", "id", name="uq_ppm_budget_initiative_id"),)

    initiative_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    fiscal_year: Mapped[int] = mapped_column(Integer, nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False)  # capex | opex
    # Optional: FY + category already names a line, and several lines may share
    # the pair (one per licence, partner, hardware lot), told apart by this.
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    amount: Mapped[float] = mapped_column(Float, default=0)
    field_values: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
