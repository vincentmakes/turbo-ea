from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDMixin


class Event(Base, UUIDMixin):
    __tablename__ = "events"

    card_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="SET NULL"), index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    data: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    batch_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("mutation_batches.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # ``clock_timestamp()``, not ``now()``: ``now()`` is the transaction's start
    # time, so every event one request writes would carry the same stamp and
    # their order — what a rollback replays in reverse and what History shows —
    # would be whatever the planner returned. The statement clock keeps them
    # distinct and in write order (migration 145).
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )

    user = relationship("User", lazy="noload")
