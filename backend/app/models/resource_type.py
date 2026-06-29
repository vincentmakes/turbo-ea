from __future__ import annotations

from sqlalchemy import Boolean, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class ResourceType(Base, UUIDMixin, TimestampMixin):
    """Admin-managed link type / file category used on a card's Resources tab.

    A single table backs two distinct global lists, discriminated by ``kind``:

    * ``link_type`` — the "type" of a document link (documentation, contract,
      security, …); rendered with an optional Material Symbol ``icon``.
    * ``file_category`` — the category of an uploaded file attachment.

    Mirrors the ``ComplianceRegulation`` pattern: built-in rows are seeded and
    can be edited/disabled but never deleted; ``translations`` carries per-locale
    labels so display matches the user's locale.
    """

    __tablename__ = "resource_types"

    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    key: Mapped[str] = mapped_column(String(100), nullable=False)
    label: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(String(100))
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    built_in: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    translations: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")

    __table_args__ = (UniqueConstraint("kind", "key", name="uq_resource_types_kind_key"),)
