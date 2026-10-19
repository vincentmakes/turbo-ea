from __future__ import annotations

from sqlalchemy import Boolean, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class CardTypeCategory(Base, UUIDMixin, TimestampMixin):
    """An architecture layer a card type sits in (``card_types.category``).

    ``key`` is the exact string a card type stores in its ``category`` column —
    the four built-in layers are keyed by their historical names
    ("Strategy & Transformation", …) so no card-type row had to change when the
    registry was introduced (migration 155). There is deliberately no foreign
    key: importers write strings, and a dangling value must still render.

    Built-in rows are seeded on every boot (insert-only) and locked: their
    label, colour and translations cannot be edited, and they cannot be
    deleted. Their position in the layer order can still move, because a custom
    layer may sit between two defaults.
    """

    __tablename__ = "card_type_categories"

    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="#999999")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    built_in: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    translations: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
