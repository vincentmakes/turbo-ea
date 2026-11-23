from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin
from app.models.provenance import ProvenanceMixin


class Comment(Base, UUIDMixin, TimestampMixin, ProvenanceMixin):
    __tablename__ = "comments"

    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("comments.id", ondelete="CASCADE")
    )

    user = relationship("User", lazy="selectin")
    # Deleting a comment deletes its replies. The ORM deletes the replies it
    # has loaded; ``passive_deletes`` leaves any deeper, unloaded level to the
    # ``ON DELETE CASCADE`` on ``parent_id``. Without the cascade the ORM nulled
    # the loaded replies' ``parent_id``, turning them into top-level comments.
    replies = relationship(
        "Comment",
        lazy="selectin",
        join_depth=3,
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
