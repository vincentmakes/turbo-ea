from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class ArchitecturePlan(Base, UUIDMixin, TimestampMixin):
    """A manual architecture plan — a before/after landscape change proposal.

    ``plan_data`` holds a snapshotted baseline subgraph plus an ordered list of
    change operations; the merged before/after Layered Dependency View is
    rendered client-side from these. Committing a plan creates an Initiative,
    the proposed cards/relations, an optional draft ADR, and stamps an
    end-of-life lifecycle date on removed/replaced cards.
    """

    __tablename__ = "architecture_plans"

    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="draft")
    # Statuses: draft, committed
    scope: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    # {"cardIds": [...], "depth": 2, "objectiveIds": [...]} — snapshot provenance
    plan_data: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    # {"baseline": {"nodes": [...], "edges": [...]},
    #  "changes": [ChangeOp...], "baselineCapturedAt": iso}
    initiative_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="SET NULL"), index=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
