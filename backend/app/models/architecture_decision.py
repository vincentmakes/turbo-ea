from __future__ import annotations

import uuid

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin
from app.models.provenance import ProvenanceMixin


class ArchitectureDecision(Base, UUIDMixin, TimestampMixin, ProvenanceMixin):
    """Architecture Decision Record (ADR) — documents key architecture decisions."""

    __tablename__ = "architecture_decisions"
    # A revision keeps its decision's reference: the reference and the
    # revision number are unique together (migration 168).
    __table_args__ = (
        UniqueConstraint("reference_number", "revision_number", name="uq_adr_reference_revision"),
    )

    reference_number: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="draft")
    # Statuses: draft, in_review, signed

    context: Mapped[str | None] = mapped_column(Text)
    decision: Mapped[str | None] = mapped_column(Text)
    consequences: Mapped[str | None] = mapped_column(Text)
    alternatives_considered: Mapped[str | None] = mapped_column(Text)

    # Extension attributes bag. ADRs are not cards, so extensions cannot use the
    # metamodel field-contribution capability here; instead they stash their own
    # data under ``ext.<key>.*`` top-level keys (an extension writes, e.g.,
    # ``ext.savings``). Frozen automatically once the ADR is signed
    # (update_adr blocks edits on signed decisions) and carried into revisions.
    attributes: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    # Revision chain
    revision_number: Mapped[int] = mapped_column(Integer, default=1)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("architecture_decisions.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Signatories: [{user_id, display_name, email, status, signed_at}]
    signatories: Mapped[list | None] = mapped_column(JSONB, default=list)
    signed_at = mapped_column(DateTime(timezone=True), nullable=True)

    # Decision register (migration 167). ``decided_on`` is when the decision was
    # taken, ``effective_from`` when it takes effect (null on a locked row means
    # effective), ``valid_until`` the last day it is in force.
    decided_on = mapped_column(Date, nullable=True)
    effective_from = mapped_column(Date, nullable=True)
    valid_until = mapped_column(Date, nullable=True)
    # What a revision changes compared with the one before it.
    change_summary: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    # A decision recorded as already decided (taken outside the tool) rather
    # than signed here: who recorded it and when. ``signed_at`` stays null.
    recorded_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    recorded_at = mapped_column(DateTime(timezone=True), nullable=True)

    parent = relationship(
        "ArchitectureDecision", remote_side="ArchitectureDecision.id", lazy="noload"
    )
