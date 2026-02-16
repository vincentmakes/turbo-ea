from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class SubscriptionRoleDefinition(Base, UUIDMixin, TimestampMixin):
    """Per-fact-sheet-type subscription role with granular permissions."""

    __tablename__ = "subscription_role_definitions"
    __table_args__ = (
        UniqueConstraint("fact_sheet_type_key", "key", name="uq_srd_type_key"),
    )

    fact_sheet_type_key: Mapped[str] = mapped_column(
        String(100),
        ForeignKey("fact_sheet_types.key", ondelete="CASCADE"),
        nullable=False,
    )
    key: Mapped[str] = mapped_column(String(50), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str] = mapped_column(String(20), default="#757575")
    permissions: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    archived_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
