from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Column, ForeignKey, String, Table, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin

# Many-to-many: diagrams <-> cards
diagram_cards = Table(
    "diagram_cards",
    Base.metadata,
    Column(
        "diagram_id",
        UUID(as_uuid=True),
        ForeignKey("diagrams.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "card_id",
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class Diagram(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "diagrams"

    name: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    # ---- Publishing (read-only embed outside the app) --------------------
    # A published diagram is reachable at /embed/diagram/{public_slug} with no
    # app session, so it can be iframed into Confluence and friends. The slug is
    # a generated, unguessable token rather than a slugified name: for a
    # `public` diagram the URL *is* the capability, so it must not be guessable
    # from the diagram's title.
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    public_slug: Mapped[str | None] = mapped_column(
        String(64), unique=True, index=True, nullable=True
    )
    # "public" (anyone with the link) or "sso" (visitor authenticates against
    # the org IdP for an ephemeral, account-less session). Mirrors WebPortal.
    access_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="public")
    # Optional email-domain allowlist for "sso" mode. NULL / [] means any user
    # the IdP authenticates. Lowercase domains, e.g. ["company.com"].
    allowed_email_domains: Mapped[list | None] = mapped_column(JSONB, nullable=True)
