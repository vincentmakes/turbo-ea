from __future__ import annotations

import uuid

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class SoAW(Base, UUIDMixin, TimestampMixin):
    """Statement of Architecture Work — a TOGAF artefact linked to an Initiative."""

    __tablename__ = "statement_of_architecture_works"

    name: Mapped[str] = mapped_column(String(500), nullable=False)
    initiative_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(50), default="draft")
    # Statuses: draft, in_review, approved, signed
    document_info: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    version_history: Mapped[list | None] = mapped_column(JSONB, default=list)
    sections: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    # Revision chain: revision_number tracks which version this is;
    # parent_id links to the previous revision of the same SoAW
    revision_number: Mapped[int] = mapped_column(Integer, default=1)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("statement_of_architecture_works.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Signatories: [{user_id, display_name, status, signed_at}]
    signatories: Mapped[list | None] = mapped_column(JSONB, default=list)
    signed_at = mapped_column(DateTime(timezone=True), nullable=True)

    parent = relationship("SoAW", remote_side="SoAW.id", lazy="noload")
