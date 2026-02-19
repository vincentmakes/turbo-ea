"""ServiceNow integration models — connections, mappings, sync runs, staging."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class SnowConnection(UUIDMixin, TimestampMixin, Base):
    """A configured ServiceNow instance connection."""

    __tablename__ = "servicenow_connections"

    name: Mapped[str] = mapped_column(String(255))
    instance_url: Mapped[str] = mapped_column(String(500))
    auth_type: Mapped[str] = mapped_column(String(20), default="basic")
    credentials: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_tested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    test_status: Mapped[str | None] = mapped_column(String(20), nullable=True)

    mappings: Mapped[list[SnowMapping]] = relationship(
        back_populates="connection", cascade="all, delete-orphan"
    )


class SnowMapping(UUIDMixin, TimestampMixin, Base):
    """Type-level mapping: which Turbo EA card type maps to which ServiceNow table."""

    __tablename__ = "servicenow_mappings"

    connection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("servicenow_connections.id", ondelete="CASCADE")
    )
    card_type_key: Mapped[str] = mapped_column(String(100))
    snow_table: Mapped[str] = mapped_column(String(200))
    sync_direction: Mapped[str] = mapped_column(String(20), default="snow_to_turbo")
    sync_mode: Mapped[str] = mapped_column(String(20), default="conservative")
    max_deletion_ratio: Mapped[float] = mapped_column(Float, default=0.5)
    filter_query: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    skip_staging: Mapped[bool] = mapped_column(Boolean, default=False)

    connection: Mapped[SnowConnection] = relationship(back_populates="mappings")
    field_mappings: Mapped[list[SnowFieldMapping]] = relationship(
        back_populates="mapping", cascade="all, delete-orphan"
    )


class SnowFieldMapping(UUIDMixin, TimestampMixin, Base):
    """Field-level mapping between a card attribute and a ServiceNow column."""

    __tablename__ = "servicenow_field_mappings"

    mapping_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("servicenow_mappings.id", ondelete="CASCADE")
    )
    turbo_field: Mapped[str] = mapped_column(String(200))
    snow_field: Mapped[str] = mapped_column(String(200))
    direction: Mapped[str] = mapped_column(String(20), default="snow_leads")
    transform_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    transform_config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    is_identity: Mapped[bool] = mapped_column(Boolean, default=False)

    mapping: Mapped[SnowMapping] = relationship(back_populates="field_mappings")


class SnowSyncRun(UUIDMixin, Base):
    """A single sync execution record with stats and status."""

    __tablename__ = "servicenow_sync_runs"

    connection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("servicenow_connections.id", ondelete="CASCADE")
    )
    mapping_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("servicenow_mappings.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(20), default="running")
    direction: Mapped[str] = mapped_column(String(20), default="pull")
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    stats: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class SnowStagedRecord(UUIDMixin, Base):
    """A staged record from a sync run, pending review/application."""

    __tablename__ = "servicenow_staged_records"

    sync_run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("servicenow_sync_runs.id", ondelete="CASCADE")
    )
    mapping_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("servicenow_mappings.id", ondelete="CASCADE")
    )
    snow_sys_id: Mapped[str] = mapped_column(String(32))
    snow_data: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    card_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    action: Mapped[str] = mapped_column(String(20), default="skip")
    diff: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class SnowIdentityMap(UUIDMixin, TimestampMixin, Base):
    """Persistent cross-reference between a Turbo EA card and a ServiceNow CI."""

    __tablename__ = "servicenow_identity_map"

    connection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("servicenow_connections.id", ondelete="CASCADE")
    )
    mapping_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("servicenow_mappings.id", ondelete="CASCADE")
    )
    card_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    snow_sys_id: Mapped[str] = mapped_column(String(32))
    snow_table: Mapped[str] = mapped_column(String(200))
    created_by_sync: Mapped[bool] = mapped_column(Boolean, default=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
