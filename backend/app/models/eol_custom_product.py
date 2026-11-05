from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class EolCustomProduct(Base, UUIDMixin, TimestampMixin):
    """A product an organisation tracks end-of-life dates for itself.

    endoflife.date covers popular software; an in-house platform, a niche
    vendor product or a licensed appliance is not on it. A custom product
    fills that gap: it is defined once, carries its own release cycles
    (``eol_custom_cycles``) and is linked from cards exactly like an
    endoflife.date product — ``attributes.eol_product = "custom:<key>"`` —
    so every EOL surface resolves it without a special case.

    ``key`` is the slug a card's link stores. It is immutable after creation
    (renaming it would orphan every link), which is why ``title`` exists.
    """

    __tablename__ = "eol_custom_products"

    key: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(500))
    #: Only what the endoflife.date proposal file needs beyond the cycles:
    #: its category and the release-policy paragraph under the front matter.
    eol_category: Mapped[str | None] = mapped_column(String(20))
    release_policy_note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
