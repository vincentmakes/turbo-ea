from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin


class ArchitectureDecisionLink(Base, UUIDMixin):
    """A typed link from one architecture decision to another.

    ``kind`` is one of ``relates``, ``replaces``, ``amends``, ``revokes`` or
    ``consolidates``. A link belongs to the revision that authored it (its
    ``source_id``); it acts on the target's revision chain. One link per
    ordered pair, never a link from a decision to itself.
    """

    __tablename__ = "architecture_decision_links"
    __table_args__ = (
        UniqueConstraint("source_id", "target_id", name="uq_adr_link_pair"),
        CheckConstraint("source_id <> target_id", name="ck_adr_link_not_self"),
    )

    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("architecture_decisions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    target_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("architecture_decisions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
