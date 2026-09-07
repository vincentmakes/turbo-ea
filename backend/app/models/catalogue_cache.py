from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class CatalogueCache(Base):
    """One row per reference catalogue fetched from PyPI (capabilities,
    processes, value streams) — the wheel-extracted payload with its i18n.

    These payloads are megabytes each and used to live as keys inside
    ``app_settings.general_settings``, the one JSONB blob every setting in the
    product — core's and every extension's — is read-modify-written through.
    A cached catalogue made every settings save round-trip several megabytes
    of nested JSON while reads never noticed: measured at 21 ms → ~500 ms for
    one extension's PUT and the same slope on core's own PATCHes, and reported
    at 3.5 s on an instance with every extension installed (2.133.1). A cache
    is not a setting: it has its own row here, is refreshed from the network,
    and is deliberately NOT part of workspace transfer.
    """

    __tablename__ = "catalogue_cache"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
