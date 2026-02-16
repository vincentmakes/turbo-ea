from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class ProcessAssessment(Base, UUIDMixin, TimestampMixin):
    """Periodic assessment of a business process."""

    __tablename__ = "process_assessments"

    process_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    assessor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    assessment_date: Mapped[date] = mapped_column(Date, nullable=False)
    overall_score: Mapped[int] = mapped_column(Integer, default=0)
    efficiency: Mapped[int] = mapped_column(Integer, default=0)
    effectiveness: Mapped[int] = mapped_column(Integer, default=0)
    compliance: Mapped[int] = mapped_column(Integer, default=0)
    automation: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str | None] = mapped_column(Text)
    action_items: Mapped[list | None] = mapped_column(JSONB, default=list)

    assessor = relationship("User", lazy="selectin")
    process = relationship("Card", lazy="selectin")
