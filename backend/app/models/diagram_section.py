from __future__ import annotations

import uuid

from sqlalchemy import Column, ForeignKey, Integer, String, Table
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin

# Many-to-many: diagrams <-> sections (a diagram can belong to several sections)
diagram_section_members = Table(
    "diagram_section_members",
    Base.metadata,
    Column(
        "diagram_id",
        UUID(as_uuid=True),
        ForeignKey("diagrams.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "section_id",
        UUID(as_uuid=True),
        ForeignKey("diagram_sections.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class DiagramSection(Base, UUIDMixin, TimestampMixin):
    """Workspace-shared grouping for diagrams (label/tag style, multi-section)."""

    __tablename__ = "diagram_sections"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    color: Mapped[str | None] = mapped_column(String(20))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
