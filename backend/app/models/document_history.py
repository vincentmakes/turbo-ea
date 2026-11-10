from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin
from app.models.provenance import current_origin


class DocumentHistoryEntry(Base, UUIDMixin):
    """One step on the timeline of a decision or a SoAW (migration 169).

    Exactly one owner is set (``ck_document_history_one_owner``). ``kind`` is
    a content step (``created``, ``baseline``, ``save``, ``restored``,
    ``revised``), which may carry a snapshot in ``content``, or a workflow
    step without content (``sent_for_review``, ``signature``, ``signed``,
    ``rejected``, ``recalled``, ``recorded``, ``sign_note``).
    ``signatories`` is ``[{user_id, display_name}]`` on ``sent_for_review``
    rows only — never an e-mail.

    Ordered by ``seq``, an identity column: ``created_at`` comes from
    ``clock_timestamp()`` for display, but a wall clock is not monotonic and
    the rows of one flush can share a value. ``via`` is the channel the step
    came from (the same resolver as ``ProvenanceMixin``); migration 171 marks
    the rows it backfilled with its own value.
    """

    __tablename__ = "document_history"
    __table_args__ = (
        CheckConstraint(
            "num_nonnulls(architecture_decision_id, soaw_id) = 1",
            name="ck_document_history_one_owner",
        ),
        Index("ix_document_history_adr_seq", "architecture_decision_id", "seq"),
        Index("ix_document_history_soaw_seq", "soaw_id", "seq"),
    )
    # ``seq`` and ``created_at`` come from the database: fetch them on insert
    # (RETURNING) so a fresh row can be read without a lazy load.
    __mapper_args__ = {"eager_defaults": True}

    seq: Mapped[int] = mapped_column(BigInteger, Identity(always=True), nullable=False)
    architecture_decision_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("architecture_decisions.id", ondelete="CASCADE"),
        nullable=True,
    )
    soaw_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("statement_of_architecture_works.id", ondelete="CASCADE"),
        nullable=True,
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    actor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    note: Mapped[str | None] = mapped_column(String(4000), nullable=True)
    content: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    signatories: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    via: Mapped[str | None] = mapped_column(String(20), default=current_origin)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.clock_timestamp()
    )
