from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class WebPortal(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "web_portals"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(200), nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    card_type: Mapped[str] = mapped_column(String(100), nullable=False)
    filters: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    display_fields: Mapped[list | None] = mapped_column(JSONB, default=list)
    card_config: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False)
    # Which board this portal publishes. "cards" is the card-list grid every
    # portal rendered before this existed; "ppm_portfolio" is the read-only PPM
    # portfolio board. A validated column rather than a card_config key because
    # update_portal writes unknown fields with a bare setattr, so a typo'd JSONB
    # key would silently no-op instead of 400-ing.
    view: Mapped[str] = mapped_column(String(32), nullable=False, default="cards")
    # Access protection. "public" (world-readable when published, the historical
    # behaviour) or "sso" (visitor must authenticate against the org's configured
    # SSO IdP — an ephemeral, account-less portal session, no users row created).
    access_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="public")
    # Optional per-portal email-domain allowlist for "sso" mode. NULL / [] means
    # any user the IdP authenticates. Lowercase domains, e.g. ["company.com"].
    allowed_email_domains: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
