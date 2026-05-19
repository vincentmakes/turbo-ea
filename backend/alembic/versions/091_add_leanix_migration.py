"""Add LeanIX migration tables.

Creates ``leanix_migrations``, ``leanix_staged_records``, and
``leanix_identity_map``. Together they back the admin workspace-snapshot
importer: one row per uploaded snapshot, polymorphic per-entity staged
rows pending review, and a persistent ``leanix_id -> target_id``
cross-reference so re-imports stay idempotent.

Mirrors the structural pattern from ``031_add_servicenow_integration.py``;
the safety profile is different — LeanIX import is create-and-update only
on first run, so there is no deletion-ratio threshold.

Revision ID: 091
Revises: 090
Create Date: 2026-05-18
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision: str = "091"
down_revision: Union[str, None] = "090"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "leanix_migrations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("file_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column("snapshot_version", sa.String(32), nullable=True),
        sa.Column("storage_path", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="uploaded"),
        sa.Column("stats", JSONB, nullable=True),
        sa.Column("metamodel_diff", JSONB, nullable=True),
        sa.Column("parsed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "leanix_staged_records",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "migration_id",
            UUID(as_uuid=True),
            sa.ForeignKey("leanix_migrations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("entity_kind", sa.String(30), nullable=False),
        sa.Column("leanix_id", sa.String(64), nullable=False),
        sa.Column("leanix_data", JSONB, nullable=True),
        sa.Column("card_type_key", sa.String(100), nullable=True),
        sa.Column("action", sa.String(20), nullable=False, server_default="create"),
        sa.Column("diff", JSONB, nullable=True),
        sa.Column("target_id", UUID(as_uuid=True), nullable=True),
        sa.Column("parent_leanix_id", sa.String(64), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_unique_constraint(
        "uq_leanix_staged_record_migration_kind_id",
        "leanix_staged_records",
        ["migration_id", "entity_kind", "leanix_id"],
    )
    op.create_index(
        "ix_leanix_staged_migration_kind",
        "leanix_staged_records",
        ["migration_id", "entity_kind"],
    )

    op.create_table(
        "leanix_identity_map",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("leanix_id", sa.String(64), nullable=False),
        sa.Column("entity_kind", sa.String(30), nullable=False),
        sa.Column("target_id", UUID(as_uuid=True), nullable=False),
        sa.Column(
            "migration_id",
            UUID(as_uuid=True),
            sa.ForeignKey("leanix_migrations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_unique_constraint(
        "uq_leanix_identity_id_kind",
        "leanix_identity_map",
        ["leanix_id", "entity_kind"],
    )


def downgrade() -> None:
    op.drop_table("leanix_identity_map")
    op.drop_index("ix_leanix_staged_migration_kind", table_name="leanix_staged_records")
    op.drop_table("leanix_staged_records")
    op.drop_table("leanix_migrations")
