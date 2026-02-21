from __future__ import annotations

import uuid

from sqlalchemy import Column, ForeignKey, String, Table, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin

# Association table for sharing reports with specific users
saved_report_shares = Table(
    "saved_report_shares",
    Base.metadata,
    Column(
        "saved_report_id",
        UUID(as_uuid=True),
        ForeignKey("saved_reports.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    ),
)


class SavedReport(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "saved_reports"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_type: Mapped[str] = mapped_column(String(50), nullable=False)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    thumbnail: Mapped[str | None] = mapped_column(Text, nullable=True)
    visibility: Mapped[str] = mapped_column(String(20), nullable=False, default="private")

    shared_with_users = relationship("User", secondary=saved_report_shares, lazy="noload")
