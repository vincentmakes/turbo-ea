from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin, TimestampMixin


class SoAW(Base, UUIDMixin, TimestampMixin):
    """Statement of Architecture Work — a TOGAF artefact linked to an Initiative."""

    __tablename__ = "statement_of_architecture_works"

    name: Mapped[str] = mapped_column(String(500), nullable=False)
    initiative_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fact_sheets.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(50), default="draft")
    document_info: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    version_history: Mapped[list | None] = mapped_column(JSONB, default=list)
    sections: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
