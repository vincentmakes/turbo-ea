"""Risk register — TOGAF-aligned landscape-level risk model.

A :class:`Risk` captures a risk through the full TOGAF Phase G lifecycle:
identification → analysis → mitigation planning → residual assessment →
monitoring / acceptance / closure. Risks are landscape-level (not tied
to a single initiative) and link to zero-or-many Cards via the
``risk_cards`` junction, so a single risk can aggregate impact across
multiple applications or IT components.

Risks can be created manually or **promoted** from a TurboLens CVE /
compliance finding (see ``app.services.risk_service.promote_*``). The
originating finding carries an optional ``risk_id`` back-link so the UI
can show "Open risk R-000123" instead of "Create risk" once promoted.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Index,
    PrimaryKeyConstraint,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Risk(UUIDMixin, TimestampMixin, Base):
    """A single risk, across its full TOGAF lifecycle."""

    __tablename__ = "risks"

    reference: Mapped[str] = mapped_column(String(16), unique=True)
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(32), default="operational")
    source_type: Mapped[str] = mapped_column(String(32), default="manual")
    source_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)

    initial_probability: Mapped[str] = mapped_column(String(16), default="medium")
    initial_impact: Mapped[str] = mapped_column(String(16), default="medium")
    initial_level: Mapped[str] = mapped_column(String(16), default="medium")

    mitigation: Mapped[str | None] = mapped_column(Text, nullable=True)
    residual_probability: Mapped[str | None] = mapped_column(String(16), nullable=True)
    residual_impact: Mapped[str | None] = mapped_column(String(16), nullable=True)
    residual_level: Mapped[str | None] = mapped_column(String(16), nullable=True)

    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    target_resolution_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    status: Mapped[str] = mapped_column(String(24), default="identified")
    acceptance_rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    accepted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    __table_args__ = (
        Index("ix_risks_status", "status"),
        Index("ix_risks_category_status", "category", "status"),
        Index("ix_risks_initial_level", "initial_level"),
        Index("ix_risks_residual_level", "residual_level"),
        Index("ix_risks_owner_id", "owner_id"),
        Index("ix_risks_source_type", "source_type"),
    )


class RiskCard(Base):
    """M:N junction between :class:`Risk` and :class:`Card`.

    Composite PK on (risk_id, card_id). Cascade-deleted in both
    directions so orphan links never linger.
    """

    __tablename__ = "risk_cards"

    risk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("risks.id", ondelete="CASCADE"),
    )
    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
    )
    role: Mapped[str] = mapped_column(String(32), default="affected")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        PrimaryKeyConstraint("risk_id", "card_id", name="pk_risk_cards"),
        Index("ix_risk_cards_card_id", "card_id"),
        Index("ix_risk_cards_risk_id", "risk_id"),
    )
