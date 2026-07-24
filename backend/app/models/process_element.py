from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class ProcessElement(Base, UUIDMixin, TimestampMixin):
    """An extracted BPMN element (task, subprocess, gateway, event) that can be linked
    to EA cards (applications, data objects, etc.).

    Auto-populated from BPMN XML on each diagram save. The bpmn_element_id is the
    id attribute from the BPMN XML, used to correlate back to the diagram.
    """

    __tablename__ = "process_elements"

    process_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    bpmn_element_id: Mapped[str] = mapped_column(String(200), nullable=False)
    element_type: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str | None] = mapped_column(String(500))
    documentation: Mapped[str | None] = mapped_column(Text)
    lane_name: Mapped[str | None] = mapped_column(String(200))
    is_automated: Mapped[bool] = mapped_column(Boolean, default=False)
    sequence_order: Mapped[int] = mapped_column(Integer, default=0)

    # EA cross-references (optional, set by user via UI)
    application_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="SET NULL"),
    )
    data_object_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="SET NULL"),
    )
    it_component_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="SET NULL"),
    )

    custom_fields: Mapped[dict | None] = mapped_column(JSONB, default=dict)

    process = relationship("Card", foreign_keys=[process_id], lazy="noload")
    application = relationship("Card", foreign_keys=[application_id], lazy="noload")
    data_object = relationship("Card", foreign_keys=[data_object_id], lazy="noload")
    it_component = relationship("Card", foreign_keys=[it_component_id], lazy="noload")
    organizations = relationship("Card", secondary="process_element_organizations", lazy="noload")


class ProcessElementOrganization(Base):
    """M:N junction between :class:`ProcessElement` and Organization cards.

    Unlike the single application/data-object/IT-component FKs, a step can be
    performed by / involve several Organizations. Composite PK on
    (element_id, organization_id); cascade-deleted in both directions.
    """

    __tablename__ = "process_element_organizations"

    element_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("process_elements.id", ondelete="CASCADE"),
        primary_key=True,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
