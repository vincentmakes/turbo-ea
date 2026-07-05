from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class OpsRequestNonce(Base):
    """Replay protection for the signed control-plane ops API.

    Every verified ops request records its nonce; a second request with the
    same nonce is rejected. Rows older than an hour (far beyond the 5-minute
    timestamp window) are purged by the hourly ops maintenance loop.
    """

    __tablename__ = "ops_request_nonces"

    nonce: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
