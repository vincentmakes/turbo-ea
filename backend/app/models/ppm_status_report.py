from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class PpmStatusReport(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "ppm_status_reports"

    initiative_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    reporter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    report_date: Mapped[date] = mapped_column(Date, nullable=False)
    schedule_health: Mapped[str] = mapped_column(Text, nullable=False, default="onTrack")
    cost_health: Mapped[str] = mapped_column(Text, nullable=False, default="onTrack")
    scope_health: Mapped[str] = mapped_column(Text, nullable=False, default="onTrack")
    summary: Mapped[str | None] = mapped_column(Text)
    accomplishments: Mapped[str | None] = mapped_column(Text)
    next_steps: Mapped[str | None] = mapped_column(Text)
