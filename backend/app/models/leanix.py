"""LeanIX migration models — workspace-snapshot importer staging + identity map.

Mirrors the ServiceNow pattern in ``app/models/servicenow.py``:
``leanix_migrations`` (one row per uploaded snapshot, like ``snow_sync_runs``),
``leanix_staged_records`` (polymorphic per-entity rows pending apply, like
``snow_staged_records``), and ``leanix_identity_map`` (persistent
``(leanix_id, entity_kind) -> target_id`` cross-reference for idempotent
re-imports, like ``snow_identity_map``).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class LeanixMigration(UUIDMixin, TimestampMixin, Base):
    """One row per uploaded LeanIX workspace snapshot.

    Status workflow: ``uploaded`` -> ``parsed`` -> ``previewed`` ->
    ``applying`` -> ``applied`` | ``failed`` | ``aborted``.

    The snapshot binary itself lives on disk at
    ``data/leanix_snapshots/{id}.json.gz`` to keep Postgres lean; the path is
    captured in ``storage_path`` so cleanup on DELETE removes both.
    """

    __tablename__ = "leanix_migrations"

    name: Mapped[str] = mapped_column(String(255))
    file_hash: Mapped[str] = mapped_column(String(64), unique=True)
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    snapshot_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    storage_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="uploaded")
    stats: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    metamodel_diff: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    parsed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    staged_records: Mapped[list[LeanixStagedRecord]] = relationship(
        back_populates="migration", cascade="all, delete-orphan"
    )


class LeanixStagedRecord(UUIDMixin, Base):
    """Polymorphic staged-record row for one entity from the snapshot.

    ``entity_kind`` discriminates the row (``card`` / ``relation`` / ``tag`` /
    ``subscription`` / ``document`` / ``comment`` / ``metamodel_type`` /
    ``metamodel_field`` / ``metamodel_subtype`` / ``metamodel_relation_type``
    / ``user``); ``leanix_data`` carries the raw payload from the snapshot;
    ``action`` is what the apply pipeline will do (``create`` / ``update`` /
    ``skip`` / ``conflict``); ``target_id`` is back-filled with the resolved
    Turbo EA PK once apply succeeds. ``parent_leanix_id`` is used by the
    BusinessCapability topological-sort pass.
    """

    __tablename__ = "leanix_staged_records"

    migration_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("leanix_migrations.id", ondelete="CASCADE"),
        nullable=False,
    )
    entity_kind: Mapped[str] = mapped_column(String(30), nullable=False)
    # Real LeanIX UUIDs are 36 chars but the staging code synthesises
    # composite keys for joins LeanIX doesn't give us a stable id for
    # (card_tag, subscription, comment) — those reach 100+ chars.
    leanix_id: Mapped[str] = mapped_column(String(255), nullable=False)
    leanix_data: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    card_type_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
    action: Mapped[str] = mapped_column(String(20), default="create")
    diff: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    parent_leanix_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    migration: Mapped[LeanixMigration] = relationship(back_populates="staged_records")

    __table_args__ = (
        UniqueConstraint(
            "migration_id",
            "entity_kind",
            "leanix_id",
            name="uq_leanix_staged_record_migration_kind_id",
        ),
    )


class LeanixIdentityMap(UUIDMixin, TimestampMixin, Base):
    """Persistent ``(leanix_id, entity_kind) -> target_id`` cross-reference.

    Survives across imports so re-uploading the same snapshot becomes an
    update rather than a duplicate-create. Lookup precedence at staging
    time: identity-map hit -> ``cards.external_id`` fallback -> name+type
    fallback -> ``create``.
    """

    __tablename__ = "leanix_identity_map"

    leanix_id: Mapped[str] = mapped_column(String(255), nullable=False)
    entity_kind: Mapped[str] = mapped_column(String(30), nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    migration_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("leanix_migrations.id", ondelete="SET NULL"),
        nullable=True,
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("leanix_id", "entity_kind", name="uq_leanix_identity_id_kind"),
    )
