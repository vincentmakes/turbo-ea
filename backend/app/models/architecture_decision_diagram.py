from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin


class ArchitectureDecisionDiagram(Base, UUIDMixin):
    """Junction table linking architecture decisions to free-draw diagrams.

    A live link: the decision shows the diagram as it is now, and deleting
    either side removes the row by cascade.
    """

    __tablename__ = "architecture_decision_diagrams"
    __table_args__ = (
        UniqueConstraint("architecture_decision_id", "diagram_id", name="uq_adr_diagram"),
    )

    architecture_decision_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("architecture_decisions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    diagram_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("diagrams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
