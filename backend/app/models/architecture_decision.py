from __future__ import annotations

import uuid

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class ArchitectureDecision(Base, UUIDMixin, TimestampMixin):
    """Architecture Decision Record (ADR) — documents key architecture decisions."""

    __tablename__ = "architecture_decisions"

    reference_number: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="draft")
    # Statuses: draft, in_review, signed

    context: Mapped[str | None] = mapped_column(Text)
    decision: Mapped[str | None] = mapped_column(Text)
    consequences: Mapped[str | None] = mapped_column(Text)
    alternatives_considered: Mapped[str | None] = mapped_column(Text)
    related_decisions: Mapped[list | None] = mapped_column(JSONB, default=list)

    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    # Revision chain
    revision_number: Mapped[int] = mapped_column(Integer, default=1)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("architecture_decisions.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Signatories: [{user_id, display_name, email, status, signed_at}]
    signatories: Mapped[list | None] = mapped_column(JSONB, default=list)
    signed_at = mapped_column(DateTime(timezone=True), nullable=True)

    parent = relationship(
        "ArchitectureDecision", remote_side="ArchitectureDecision.id", lazy="noload"
    )
