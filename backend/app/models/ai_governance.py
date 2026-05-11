"""AI Governance — cache of semantic AI-bearing classification.

Stores the per-card output of ``turbolens_security.detect_ai_bearing_cards``
so the GRC ``AI Inventory`` dashboard can load instantly between discovery
runs. One row per card that was flagged as AI-bearing (either by subtype
match or LLM semantic detection). Cards that the manual override marks as
``aiClassificationOverride="no"`` are filtered at query time, not deleted
here — so a future re-discovery can re-include them if the override changes.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class AiGovernanceClassification(UUIDMixin, TimestampMixin, Base):
    """One row per card detected as AI-bearing. Refreshed by the GRC discovery run."""

    __tablename__ = "ai_governance_classifications"

    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    # provider | consumer | embedded — matches the role taxonomy in
    # turbolens_security.detect_ai_bearing_cards and the AI_SYSTEM_ROLE_OPTIONS
    # enum on the card type metamodel.
    detected_role: Mapped[str] = mapped_column(String(50), default="embedded")
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    # True when the card carries an AI subtype (AI Agent / AI Model / MCP Server);
    # False when the LLM flagged it by name/description/vendor signal.
    subtype_match: Mapped[bool] = mapped_column(Boolean, default=False)
    # Free-text note explaining what the detector noticed. Empty for subtype matches.
    signal: Mapped[str] = mapped_column(Text, default="")
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
