from __future__ import annotations

from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class EAPrinciple(Base, UUIDMixin, TimestampMixin):
    """An enterprise architecture principle that guides portfolio decisions."""

    __tablename__ = "ea_principles"

    # Human-readable reference (``P-001``), minted by
    # ``principle_service.next_principle_reference``. Nullable in the schema
    # only so a workspace bundle written before the column existed can land;
    # every writer calls ``ensure_principle_references`` before committing.
    reference_number: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    rationale: Mapped[str | None] = mapped_column(Text)
    implications: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    catalogue_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
