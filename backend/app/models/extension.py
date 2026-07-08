"""Extension Store models.

Four tables back the store:

- ``extension_licenses`` — every uploaded license envelope (audit trail;
  exactly one row has ``is_active=True``). ``raw_text`` preserves the
  signed envelope byte-exact so it can be re-verified at any time.
- ``extensions`` — one row per installed extension (the registry).
- ``extension_schema_versions`` — core-owned ledger of applied
  per-extension migrations. Extension tables (``ext_{key}_*``) are never
  managed by core Alembic.
- ``extension_installs`` — async upload → verify → preview → apply
  lifecycle of a ``.teax`` bundle (mirrors ``workspace_transfers``).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class ExtensionLicense(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "extension_licenses"

    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    key_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    licensee: Mapped[str] = mapped_column(String(255), nullable=False)
    customer_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    grace_days: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    entitlements: Mapped[list | None] = mapped_column(JSONB, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class Extension(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "extensions"

    key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    manifest: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    capabilities: Mapped[list | None] = mapped_column(JSONB, default=list)
    # installed | needs_restart | disabled | failed | removed
    status: Mapped[str] = mapped_column(String(20), default="installed", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    installed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class ExtensionSchemaVersion(Base):
    __tablename__ = "extension_schema_versions"

    extension_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    applied_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=None, nullable=True
    )


class ExtensionInstall(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "extension_installs"

    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    storage_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    # uploaded -> verifying -> previewed -> applying -> installed | failed
    status: Mapped[str] = mapped_column(String(20), default="uploaded", nullable=False)
    extension_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    extension_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    format_version: Mapped[str | None] = mapped_column(String(16), nullable=True)
    diff: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    result: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    previewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
