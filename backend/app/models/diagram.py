from __future__ import annotations

import uuid

from sqlalchemy import Column, ForeignKey, String, Table, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin, TimestampMixin

# Many-to-many: diagrams <-> initiatives (cards)
diagram_initiatives = Table(
    "diagram_initiatives",
    Base.metadata,
    Column(
        "diagram_id",
        UUID(as_uuid=True),
        ForeignKey("diagrams.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "initiative_id",
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class Diagram(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "diagrams"

    name: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    type: Mapped[str] = mapped_column(String(50), default="free_draw")
    data: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
