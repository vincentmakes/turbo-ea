from __future__ import annotations

import uuid

from sqlalchemy import Column, ForeignKey, Integer, String, Table
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin

# Many-to-many: diagrams <-> groups (a diagram can belong to several groups)
diagram_group_members = Table(
    "diagram_group_members",
    Base.metadata,
    Column(
        "diagram_id",
        UUID(as_uuid=True),
        ForeignKey("diagrams.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "group_id",
        UUID(as_uuid=True),
        ForeignKey("diagram_groups.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class DiagramGroup(Base, UUIDMixin, TimestampMixin):
    """Workspace-shared grouping for diagrams (label/tag style, multi-group)."""

    __tablename__ = "diagram_groups"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    color: Mapped[str | None] = mapped_column(String(20))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
