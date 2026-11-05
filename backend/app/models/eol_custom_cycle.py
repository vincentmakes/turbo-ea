from __future__ import annotations

from typing import Any

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class EolCustomCycle(Base, UUIDMixin, TimestampMixin):
    """One release cycle of a custom EOL product.

    Shaped after an endoflife.date cycle so the same classifier reads both:
    ``eol`` and ``support`` hold exactly what upstream holds — an ISO date
    string, ``true`` (already ended), ``false`` (no end announced) or null —
    which is why they are JSONB scalars rather than a date column. Dates are
    ISO strings for the same reason, and because a workspace transfer copies
    a string cell verbatim where a date would need coercing.

    Keyed to its product by ``product_key`` (the product's immutable slug), so
    a workspace transfer can upsert both tables by natural key with no id
    remap.
    """

    __tablename__ = "eol_custom_cycles"

    product_key: Mapped[str] = mapped_column(
        String(100),
        ForeignKey("eol_custom_products.key", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    cycle: Mapped[str] = mapped_column(String(100), nullable=False)
    release_date: Mapped[str | None] = mapped_column(String(10))
    support: Mapped[Any] = mapped_column(JSONB, nullable=True)
    eol: Mapped[Any] = mapped_column(JSONB, nullable=True)
    latest: Mapped[str | None] = mapped_column(String(100))
    latest_release_date: Mapped[str | None] = mapped_column(String(10))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (
        UniqueConstraint("product_key", "cycle", name="uq_eol_custom_cycles_product_cycle"),
    )
