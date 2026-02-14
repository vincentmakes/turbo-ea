from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class ProcessDiagram(Base, UUIDMixin, TimestampMixin):
    """BPMN 2.0 diagram associated with a BusinessProcess fact sheet.
    One process has at most one active diagram (latest version).
    """

    __tablename__ = "process_diagrams"

    process_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("fact_sheets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    bpmn_xml: Mapped[str] = mapped_column(Text, nullable=False)
    svg_thumbnail: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
    )

    process = relationship("FactSheet", lazy="selectin")
