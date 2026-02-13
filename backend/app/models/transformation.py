from __future__ import annotations

import uuid

from sqlalchemy import Date, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class Transformation(Base, UUIDMixin, TimestampMixin):
    """A structured architectural change within an Initiative."""

    __tablename__ = "transformations"

    name: Mapped[str] = mapped_column(String(500), nullable=False)
    initiative_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("fact_sheets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("transformation_templates.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        String(50), default="draft", nullable=False
    )  # draft, planned, executed
    completion_date: Mapped[str | None] = mapped_column(Date, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    initiative = relationship("FactSheet", foreign_keys=[initiative_id], lazy="selectin")
    template = relationship("TransformationTemplate", lazy="selectin")
    impacts = relationship(
        "Impact",
        back_populates="transformation",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    creator = relationship("User", foreign_keys=[created_by], lazy="selectin")
