from __future__ import annotations

from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class EAStandard(Base, UUIDMixin, TimestampMixin):
    """An enterprise architecture standard defining a requirement or best practice."""

    __tablename__ = "ea_standards"

    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    rationale: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(50), default="technical")
    compliance_level: Mapped[str] = mapped_column(String(20), default="recommended")
    reference_url: Mapped[str | None] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    catalogue_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
