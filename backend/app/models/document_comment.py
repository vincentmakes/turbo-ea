from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin
from app.models.provenance import current_origin


class DocumentComment(Base, UUIDMixin, TimestampMixin):
    """A comment in the discussion of a decision or a SoAW (migration 169).

    Exactly one owner is set (``ck_document_comments_one_owner``): the
    decision revision or the SoAW revision the thread was started on. A reply
    points at a top-level comment through ``parent_id``. ``author_name`` is a
    snapshot, so a deleted user still reads correctly. ``kind`` is ``comment``,
    ``sign_note`` (a signer's note) or ``rejection`` (a rejection reason). A
    deleted comment keeps its row with ``deleted_at`` set and its body blanked.

    No ``ProvenanceMixin``: that mixin's table set is pinned to migration 157,
    so the channel the comment came from is stored here in ``created_via``,
    defaulting from the same origin resolver.
    """

    __tablename__ = "document_comments"
    __table_args__ = (
        CheckConstraint(
            "num_nonnulls(architecture_decision_id, soaw_id) = 1",
            name="ck_document_comments_one_owner",
        ),
    )

    architecture_decision_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("architecture_decisions.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    soaw_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("statement_of_architecture_works.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("document_comments.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    author_name: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    section: Mapped[str | None] = mapped_column(String(64), nullable=True)
    kind: Mapped[str] = mapped_column(
        String(20), nullable=False, default="comment", server_default="comment"
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_via: Mapped[str | None] = mapped_column(String(20), default=current_origin)
