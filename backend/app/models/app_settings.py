from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, LargeBinary, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AppSettings(Base):
    """Singleton application-level settings. Single row with id='default'."""

    __tablename__ = "app_settings"

    id: Mapped[str] = mapped_column(String(50), primary_key=True, default="default")
    email_settings: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    general_settings: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    # The branding binaries are up to 5 MB each and live on the same singleton
    # row as every scalar setting, so a plain ``select(AppSettings)`` — of which
    # there are 40-odd, one per settings endpoint — used to haul both blobs out
    # of Postgres just to read a currency code. Deferring them means the bytes
    # are fetched only where they are actually needed: the two serving
    # endpoints and the workspace exporter, which select the column explicitly
    # or undefer it. Same rule the resources list follows for file attachments.
    custom_logo: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    custom_logo_mime: Mapped[str | None] = mapped_column(Text, nullable=True)
    custom_favicon: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    custom_favicon_mime: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
