from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class ProcessMessageFlow(Base, UUIDMixin, TimestampMixin):
    """A BPMN message flow — a message exchanged between two pools.

    Extracted from the BPMN XML alongside :class:`ProcessElement` on every
    diagram save / publish and upserted on ``(process_id, bpmn_element_id)``,
    so the one EA link it carries (``interface_id``) survives re-publishing.
    Unlike a flow node it is an *edge*: it has no lane, no automation flag and
    no place in the causal step order — ``sequence_order`` is document order.

    ``source_name`` / ``target_name`` are resolved at parse time (flow-node
    name first, then participant name) so the row is readable without
    re-parsing the XML.
    """

    __tablename__ = "process_message_flows"

    process_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    bpmn_element_id: Mapped[str] = mapped_column(String(200), nullable=False)
    name: Mapped[str | None] = mapped_column(String(500))
    source_ref: Mapped[str] = mapped_column(String(200), nullable=False)
    target_ref: Mapped[str] = mapped_column(String(200), nullable=False)
    source_name: Mapped[str | None] = mapped_column(String(500))
    target_name: Mapped[str | None] = mapped_column(String(500))
    sequence_order: Mapped[int] = mapped_column(Integer, default=0)

    # The Interface card this message exchange realises (optional, set by the
    # user via the Message flows table). No card-to-card relation is derived
    # from it — the link is informative, like a step's Organization links.
    interface_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="SET NULL"),
    )

    process = relationship("Card", foreign_keys=[process_id], lazy="noload")
    interface = relationship("Card", foreign_keys=[interface_id], lazy="noload")
