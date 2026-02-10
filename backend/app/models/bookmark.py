from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin, TimestampMixin


class Bookmark(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "bookmarks"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    fact_sheet_type: Mapped[str | None] = mapped_column(String(100))
    filters: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    columns: Mapped[list | None] = mapped_column(JSONB, default=list)
    sort: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
