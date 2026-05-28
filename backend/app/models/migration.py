"""Platform-migration models — source-pluggable importer staging + identity map.

Mirrors the ServiceNow pattern in ``app/models/servicenow.py``:
``migrations`` (one row per uploaded snapshot, like ``snow_sync_runs``),
``staged_records`` (polymorphic per-entity rows pending apply, like
``snow_staged_records``), and ``migration_identity_map`` (persistent
``(source_id, entity_kind, source_type) -> target_id`` cross-reference
for idempotent re-imports, like ``snow_identity_map``).

The ``source_type`` discriminator (``"leanix"``, future ``"ardoq"``,
``"hopex"``, …) tells the staging + apply pipeline which adapter from
``app.services.migration.registry`` to dispatch to. The schema itself
stays uniform — the per-source quirks live on the adapter, not on
the row.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class Migration(UUIDMixin, TimestampMixin, Base):
    """One row per uploaded platform snapshot.

    Status workflow: ``uploaded`` -> ``parsed`` -> ``previewed`` ->
    ``applying`` -> ``applied`` | ``failed`` | ``aborted``.

    The snapshot binary lives on disk under
    ``data/migration_snapshots/{id}.bin`` to keep Postgres lean; the
    path is captured in ``storage_path`` so cleanup on DELETE removes
    both. Pre-rename rows that landed under
    ``data/leanix_snapshots/`` keep working because ``storage_path`` is
    absolute.
    """

    __tablename__ = "migrations"

    name: Mapped[str] = mapped_column(String(255))
    source_type: Mapped[str] = mapped_column(String(20), default="leanix", nullable=False)
    file_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    snapshot_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    storage_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="uploaded")
    stats: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    metamodel_diff: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    # Admin-configured override of how source platform fields map to
    # Turbo EA card-type fields. Shape:
    # ``{<source_native_type>: {<source_field_key>: <tea_field_key>}}``.
    # Empty/``None`` means "fall through to the default — every custom
    # field becomes a new attribute under the synthetic ``Imported
    # from {source}`` section." Set per migration via the
    # ``PUT /migration/{id}/field-mappings`` endpoint.
    field_mappings: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    parsed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    staged_records: Mapped[list[StagedRecord]] = relationship(
        back_populates="migration", cascade="all, delete-orphan"
    )

    __table_args__ = (
        # File-hash uniqueness is scoped per source — different platforms
        # could in principle produce an identical SHA-256 (vanishingly
        # unlikely, but the constraint reflects intent: one upload of a
        # given snapshot per source).
        UniqueConstraint("file_hash", "source_type", name="uq_migration_file_hash_source"),
    )


class StagedRecord(UUIDMixin, Base):
    """Polymorphic staged-record row for one entity from the snapshot.

    ``entity_kind`` discriminates the row (``card`` / ``relation`` / ``tag`` /
    ``subscription`` / ``document`` / ``comment`` / ``metamodel_type`` /
    ``metamodel_field`` / ``metamodel_subtype`` / ``metamodel_relation_type``
    / ``user``); ``source_data`` carries the raw payload from the snapshot;
    ``action`` is what the apply pipeline will do (``create`` / ``update`` /
    ``skip`` / ``conflict``); ``target_id`` is back-filled with the resolved
    Turbo EA PK once apply succeeds. ``parent_source_id`` is used by the
    BusinessCapability topological-sort pass.

    ``source_type`` mirrors the parent ``migrations.source_type`` and is
    denormalised onto the row so identity-map lookups (which are keyed
    by ``(source_id, entity_kind, source_type)``) can resolve without an
    extra join.
    """

    __tablename__ = "staged_records"

    migration_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("migrations.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_type: Mapped[str] = mapped_column(String(20), default="leanix", nullable=False)
    entity_kind: Mapped[str] = mapped_column(String(30), nullable=False)
    # Real platform UUIDs are typically 36 chars but the staging code
    # synthesises composite keys for joins the source doesn't give us a
    # stable id for (card_tag, subscription, comment, document) — those
    # routinely exceed 255 chars on real snapshots, so this is TEXT.
    source_id: Mapped[str] = mapped_column(Text, nullable=False)
    source_data: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    # Stores either a TEA card type key (short, controlled) or a relation
    # type key (free-form, derived from the source platform). Custom
    # tenant-defined relation types on real exports routinely produce
    # concatenated synthetic names longer than 100 chars, so TEXT — same
    # rationale as ``source_id`` in migration 095.
    card_type_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    action: Mapped[str] = mapped_column(String(20), default="create")
    diff: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    parent_source_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    migration: Mapped[Migration] = relationship(back_populates="staged_records")

    __table_args__ = (
        UniqueConstraint(
            "migration_id",
            "entity_kind",
            "source_id",
            name="uq_staged_record_migration_kind_source_id",
        ),
    )


class IdentityMap(UUIDMixin, TimestampMixin, Base):
    """Persistent ``(source_id, entity_kind, source_type) -> target_id`` cross-reference.

    Survives across imports so re-uploading the same snapshot becomes an
    update rather than a duplicate-create. Lookup precedence at staging
    time: identity-map hit -> ``cards.external_id`` fallback -> name+type
    fallback -> ``create``.

    The triple-column unique allows the same external id to legitimately
    exist across sources — Ardoq component ``abc-123`` and a LeanIX fact
    sheet ``abc-123`` map to different Turbo EA cards.
    """

    __tablename__ = "migration_identity_map"

    source_type: Mapped[str] = mapped_column(String(20), default="leanix", nullable=False)
    source_id: Mapped[str] = mapped_column(Text, nullable=False)
    entity_kind: Mapped[str] = mapped_column(String(30), nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    migration_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("migrations.id", ondelete="SET NULL"),
        nullable=True,
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "source_id",
            "entity_kind",
            "source_type",
            name="uq_identity_source_id_kind_source_type",
        ),
    )
