from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class WebPortal(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "web_portals"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(200), nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    fact_sheet_type: Mapped[str] = mapped_column(String(100), nullable=False)
    filters: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    display_fields: Mapped[list | None] = mapped_column(JSONB, default=list)
    card_config: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
