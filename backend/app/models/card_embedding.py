from __future__ import annotations

import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

# Vector dimension used across every embedding provider. nomic-embed-text is
# natively 768; OpenAI text-embedding-3-* emit 768 via the `dimensions` param.
# Kept in sync with EMBEDDING_DIM in app.services.embedding_service. Changing it
# is a schema change (the column type is vector(768)) — see the reconciliation
# worker, which re-embeds any row whose stored model no longer matches config.
EMBEDDING_DIM = 768


class CardEmbedding(Base):
    """Sidecar vector for semantic card search — one row per card.

    Decoupled from the hot ``cards`` row so re-embedding never contends with card
    writes. ``card_id`` is the PK and a CASCADE FK, so archiving/deleting a card
    cleans up its embedding automatically (no per-handler hook needed).
    """

    __tablename__ = "card_embeddings"

    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        primary_key=True,
    )
    embedding: Mapped[list[float]] = mapped_column(Vector(EMBEDDING_DIM))
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    dim: Mapped[int] = mapped_column(Integer, nullable=False)
    # sha256 of the embedding document — the reconciliation worker re-embeds when
    # this (or `model`) drifts from the card's current content / configured model.
    content_hash: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
