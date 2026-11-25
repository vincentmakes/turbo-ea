from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class CustomLocale(Base, UUIDMixin, TimestampMixin):
    """A UI language an administrator added (it does not ship with the app).

    Built-in locales are bundled with the frontend and never appear here. A
    custom locale is data: its strings live in ``custom_locale_strings``, one
    row per i18next namespace, and are served to the browser as a bundle by
    ``GET /custom-locales/{code}/bundle`` (``services/custom_locale_store.py``).

    ``english_name`` is the language's name in English ("Dutch"); it is what
    the AI translation job and AI suggestions write into a prompt, so it is
    validated to letters, spaces, brackets and hyphens. ``translate_job`` is
    the state of the last AI translation run (transient: never transferred).
    """

    __tablename__ = "custom_locales"

    code: Mapped[str] = mapped_column(String(10), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    english_name: Mapped[str] = mapped_column(String(100), nullable=False)
    rtl: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    translate_job: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class CustomLocaleString(Base, UUIDMixin, TimestampMixin):
    """The translated strings of one namespace of a custom locale.

    ``strings`` is ``{flat_key: translation}`` (the English JSON path joined
    with "."), ``meta`` is ``{flat_key: {"h": <hash of the English source the
    translation was made from>, "o": "manual" | "ai" | "import" | "mcp"}}`` —
    the hash is what tells a still-valid translation from one whose English
    changed since (``services/language_pack.py``).
    """

    __tablename__ = "custom_locale_strings"
    __table_args__ = (
        UniqueConstraint("locale_id", "namespace", name="uq_custom_locale_strings_locale_ns"),
    )

    locale_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("custom_locales.id", ondelete="CASCADE"),
        nullable=False,
    )
    namespace: Mapped[str] = mapped_column(String(50), nullable=False)
    strings: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    meta: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
