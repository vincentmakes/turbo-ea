from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, LargeBinary, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin


class CardLogo(Base, UUIDMixin):
    """Optional custom logo for a single card, stored as bytes in the database.

    A side table rather than a column on ``cards`` for two reasons. First,
    ``GET /cards`` routinely returns full pages of cards, and a blob on the card
    row would be dragged through every one of those queries. Second — and this
    is the invariant that matters — writing a logo never touches the card row,
    so ``cards.updated_at`` cannot move and the Modified column keeps meaning
    "content last changed" without a card event having to compensate.

    ``data`` is deferred for the same reason the branding blobs on
    ``app_settings`` are: only the serving endpoint and the workspace exporter
    need the bytes, while everything else needs presence and ``updated_at``.
    """

    __tablename__ = "card_logos"

    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False, deferred=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    # Doubles as the frontend cache-buster (`?v=`), so it is set explicitly on
    # every replace rather than relying on an onupdate default.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
