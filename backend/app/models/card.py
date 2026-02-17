from __future__ import annotations

import uuid

from sqlalchemy import Float, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDMixin, TimestampMixin


class Card(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "cards"

    type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    subtype: Mapped[str | None] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id"), index=True
    )
    lifecycle: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    attributes: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    approval_status: Mapped[str] = mapped_column(String(20), default="DRAFT")
    data_quality: Mapped[float] = mapped_column(Float, default=0.0)
    external_id: Mapped[str | None] = mapped_column(String(500))
    alias: Mapped[str | None] = mapped_column(String(500))
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    parent = relationship("Card", remote_side="Card.id", lazy="selectin")
    children = relationship(
        "Card",
        back_populates="parent",
        remote_side="Card.parent_id",
        lazy="selectin",
        viewonly=True,
    )
    tags = relationship("Tag", secondary="card_tags", lazy="selectin")
    stakeholders = relationship("Stakeholder", back_populates="card", lazy="selectin")
