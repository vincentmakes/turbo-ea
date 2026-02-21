from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Column, ForeignKey, String, Table
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin

# Association table for sharing bookmarks with specific users
bookmark_shares = Table(
    "bookmark_shares",
    Base.metadata,
    Column(
        "bookmark_id",
        UUID(as_uuid=True),
        ForeignKey("bookmarks.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("can_edit", Boolean, nullable=False, server_default="false"),
)


class Bookmark(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "bookmarks"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    card_type: Mapped[str | None] = mapped_column(String(100))
    filters: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    columns: Mapped[list | None] = mapped_column(JSONB, default=list)
    sort: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    visibility: Mapped[str] = mapped_column(String(20), nullable=False, server_default="private")
    odata_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    shared_with_users = relationship("User", secondary=bookmark_shares, lazy="noload")
