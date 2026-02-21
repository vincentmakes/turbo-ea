from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class Relation(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "relations"

    type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    attributes: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    description: Mapped[str | None] = mapped_column(Text)

    source = relationship("Card", foreign_keys=[source_id], lazy="noload")
    target = relationship("Card", foreign_keys=[target_id], lazy="noload")
