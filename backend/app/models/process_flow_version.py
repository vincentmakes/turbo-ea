"""Process Flow Version — draft / published / archived workflow for BPMN diagrams."""

from __future__ import annotations

import uuid

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class ProcessFlowVersion(Base, UUIDMixin, TimestampMixin):
    """A versioned process flow with approval workflow.

    States:
        draft      — editable, only visible to privileged users
        pending    — submitted for approval, awaiting process_owner sign-off
        published  — approved and read-only, the current live version
        archived   — previously-published version, read-only
    """

    __tablename__ = "process_flow_versions"

    process_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="draft"
    )  # draft / pending / published / archived
    revision: Mapped[int] = mapped_column(Integer, default=1)

    bpmn_xml: Mapped[str] = mapped_column(Text, nullable=False)
    svg_thumbnail: Mapped[str | None] = mapped_column(Text)

    # Who created the draft
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    # Who submitted for approval
    submitted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    submitted_at: Mapped[str | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Approval details
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    approved_at: Mapped[str | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Archival timestamp (set when a newer version is published)
    archived_at: Mapped[str | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Base version this draft was created from (null = from scratch)
    based_on_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("process_flow_versions.id"), nullable=True
    )

    # Draft-stage element links: pre-linked EA references before publishing.
    # Dict keyed by bpmn_element_id:
    #   {"Task_1": {"application_id": "uuid", "data_object_id": "uuid",
    #               "it_component_id": "uuid", "custom_fields": {"tcode": "SE16"}}}
    draft_element_links: Mapped[dict | None] = mapped_column(JSONB, default=dict)

    process = relationship("Card", lazy="noload")
    creator = relationship("User", foreign_keys=[created_by], lazy="noload")
    submitter = relationship("User", foreign_keys=[submitted_by], lazy="noload")
    approver = relationship("User", foreign_keys=[approved_by], lazy="noload")
