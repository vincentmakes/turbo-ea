from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class ProcessLaneLink(Base, UUIDMixin, TimestampMixin):
    """Binds a BPMN lane (by its free-text name) to an Organization card.

    Lanes are not first-class entities — they are parsed out of the BPMN XML
    and stamped onto process elements as plain ``lane_name`` strings. This
    table optionally maps a lane name (per process) to an Organization card so
    every step in that lane inherits the organization without per-step
    duplication. A step's effective organization is its own explicit
    ``ProcessElement.organization_id`` if set, otherwise the binding here for
    its ``lane_name``.

    Rows are pruned when a diagram save removes the lane from the XML.
    """

    __tablename__ = "process_lane_links"
    __table_args__ = (UniqueConstraint("process_id", "lane_name", name="uq_process_lane"),)

    process_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    lane_name: Mapped[str] = mapped_column(String(200), nullable=False)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="SET NULL"),
    )

    process = relationship("Card", foreign_keys=[process_id], lazy="noload")
    organization = relationship("Card", foreign_keys=[organization_id], lazy="noload")
