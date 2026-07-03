"""Workspace-transfer model — tracks the async preview/apply lifecycle of a
full-workspace import bundle.

One row per uploaded bundle. Status workflow:
``uploaded`` -> ``parsing`` -> ``previewed`` -> ``applying`` ->
``applied`` | ``failed``.

The bundle binary lives on disk under ``data/workspace_transfers/{id}.bin`` so
Postgres stays lean; ``storage_path`` captures the absolute path for cleanup on
DELETE. ``diff`` holds the dry-run preview; ``result`` holds the apply outcome.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class WorkspaceTransfer(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "workspace_transfers"

    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    storage_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="uploaded", nullable=False)
    format_version: Mapped[str | None] = mapped_column(String(16), nullable=True)
    source_app_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    diff: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    result: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    previewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
