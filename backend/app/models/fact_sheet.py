from __future__ import annotations

import uuid

from sqlalchemy import Float, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDMixin, TimestampMixin


class FactSheet(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "fact_sheets"

    type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    subtype: Mapped[str | None] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fact_sheets.id"), index=True
    )
    lifecycle: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    attributes: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    quality_seal: Mapped[str] = mapped_column(String(20), default="DRAFT")
    completion: Mapped[float] = mapped_column(Float, default=0.0)
    external_id: Mapped[str | None] = mapped_column(String(500))
    alias: Mapped[str | None] = mapped_column(String(500))
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    parent = relationship("FactSheet", remote_side="FactSheet.id", lazy="selectin")
    children = relationship(
        "FactSheet",
        back_populates="parent",
        remote_side="FactSheet.parent_id",
        lazy="selectin",
        viewonly=True,
    )
    tags = relationship("Tag", secondary="fact_sheet_tags", lazy="selectin")
    subscriptions = relationship("Subscription", back_populates="fact_sheet", lazy="selectin")
