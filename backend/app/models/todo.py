from __future__ import annotations

import uuid

from sqlalchemy import Date, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class Todo(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "todos"

    card_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), index=True
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    # open / done — plus "scheduled" for a recurring todo's next occurrence
    # that is still outside its lead-time window (dormant: no notification,
    # hidden from the default open list until the daily promotion loop or a
    # manual promote flips it to "open").
    status: Mapped[str] = mapped_column(String(20), default="open")
    link: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_system: Mapped[bool] = mapped_column(default=False)
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    due_date = mapped_column(Date, nullable=True)

    # --- Recurrence (lightweight series) ---------------------------------
    # A recurring todo is a self-perpetuating chain of plain Todo rows sharing
    # one ``series_id``. When a recurring todo is marked done, the next row is
    # spawned with ``due_date`` shifted by the recurrence rule. Completed rows
    # stay as history. ``recurrence_unit == "none"`` (the default) means a
    # plain one-shot todo — system todos always stay one-shot.
    series_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    recurrence_unit: Mapped[str] = mapped_column(String(8), default="none", server_default="none")
    recurrence_interval: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    # Days before ``due_date`` that a rolled-forward occurrence is promoted
    # from "scheduled" to "open". 0 for one-shot todos.
    lead_time_days: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    card = relationship("Card", lazy="noload")
    assignee = relationship("User", foreign_keys=[assigned_to], lazy="noload")
    creator = relationship("User", foreign_keys=[created_by], lazy="noload")

    __table_args__ = (
        Index("ix_todos_series_id", "series_id"),
        # Drives the daily promotion query (scheduled rows due soon).
        Index("ix_todos_status_due_date", "status", "due_date"),
    )
