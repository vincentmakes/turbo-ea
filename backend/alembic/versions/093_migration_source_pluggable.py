"""Make the migration importer source-pluggable.

Renames the three LeanIX-specific tables to source-neutral names,
renames the ``leanix_id`` / ``leanix_data`` / ``parent_leanix_id``
columns to ``source_id`` / ``source_data`` / ``parent_source_id``,
and adds a ``source_type`` discriminator column on all three tables
so a single uniform schema can serve every source platform (LeanIX
today; Ardoq / HOPEX / BiZZdesign / Avolution on the future roadmap).

Schema diff:

- ``leanix_migrations`` → ``migrations``
  - + ``source_type String(20) NOT NULL DEFAULT 'leanix'``
  - drop unique on ``file_hash``; add composite unique
    ``(file_hash, source_type)``.
- ``leanix_staged_records`` → ``staged_records``
  - rename ``leanix_id`` → ``source_id``
  - rename ``leanix_data`` → ``source_data``
  - rename ``parent_leanix_id`` → ``parent_source_id``
  - + ``source_type String(20) NOT NULL DEFAULT 'leanix'``
  - drop unique ``uq_leanix_staged_record_migration_kind_id`` →
    add ``uq_staged_record_migration_kind_source_id`` on
    ``(migration_id, entity_kind, source_id)``.
  - rename the supporting index ``ix_leanix_staged_migration_kind`` →
    ``ix_staged_record_migration_kind``.
- ``leanix_identity_map`` → ``migration_identity_map``
  - rename ``leanix_id`` → ``source_id``
  - + ``source_type String(20) NOT NULL DEFAULT 'leanix'``
  - drop unique ``uq_leanix_identity_id_kind`` →
    add ``uq_identity_source_id_kind_source_type`` on
    ``(source_id, entity_kind, source_type)`` so the same external id
    can legitimately exist in both an Ardoq and a LeanIX import
    without colliding.

Postgres FK targets follow ``rename_table`` automatically (FKs
reference table OIDs, not names), so no manual FK drop/recreate is
needed for ``staged_records.migration_id`` →
``migrations.id`` or ``migration_identity_map.migration_id`` →
``migrations.id``. Constraint *names* still carry the old
``leanix_`` prefix after the rename; that's cosmetic and left as-is.

Pre-refactor migration snapshot files still live under
``data/leanix_snapshots/`` on disk. The ``migrations.storage_path``
column is absolute and keeps working — new uploads land under
``data/migration_snapshots/``.

Revision ID: 093
Revises: 092
Create Date: 2026-05-23
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "093"
down_revision: Union[str, None] = "093a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---- Rename the three tables. FK targets follow automatically. ----
    op.rename_table("leanix_migrations", "migrations")
    op.rename_table("leanix_staged_records", "staged_records")
    op.rename_table("leanix_identity_map", "migration_identity_map")

    # ---- Rename data columns. ----
    op.alter_column("staged_records", "leanix_id", new_column_name="source_id")
    op.alter_column("staged_records", "leanix_data", new_column_name="source_data")
    op.alter_column("staged_records", "parent_leanix_id", new_column_name="parent_source_id")
    op.alter_column("migration_identity_map", "leanix_id", new_column_name="source_id")

    # ---- Add the source_type discriminator on every table.
    # Default ``'leanix'`` backfills existing rows; the default is
    # dropped after the backfill so future inserts must declare an
    # explicit source. ----
    for table in ("migrations", "staged_records", "migration_identity_map"):
        op.add_column(
            table,
            sa.Column(
                "source_type",
                sa.String(length=20),
                nullable=False,
                server_default="leanix",
            ),
        )
        op.alter_column(table, "source_type", server_default=None)

    # ---- migrations: widen file_hash uniqueness to (file_hash, source_type). ----
    # The original schema set ``unique=True`` directly on the column,
    # which Postgres named ``leanix_migrations_file_hash_key`` — after
    # the table rename it's still findable under that name.
    op.drop_constraint("leanix_migrations_file_hash_key", "migrations", type_="unique")
    op.create_unique_constraint(
        "uq_migration_file_hash_source",
        "migrations",
        ["file_hash", "source_type"],
    )

    # ---- staged_records: rename the composite unique. ----
    op.drop_constraint(
        "uq_leanix_staged_record_migration_kind_id",
        "staged_records",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_staged_record_migration_kind_source_id",
        "staged_records",
        ["migration_id", "entity_kind", "source_id"],
    )

    # ---- staged_records: rename the supporting index. ----
    op.execute(
        "ALTER INDEX IF EXISTS ix_leanix_staged_migration_kind RENAME TO ix_staged_record_migration_kind"
    )

    # ---- migration_identity_map: widen unique to include source_type. ----
    op.drop_constraint(
        "uq_leanix_identity_id_kind",
        "migration_identity_map",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_identity_source_id_kind_source_type",
        "migration_identity_map",
        ["source_id", "entity_kind", "source_type"],
    )


def downgrade() -> None:
    # ---- Reverse identity-map unique. ----
    op.drop_constraint(
        "uq_identity_source_id_kind_source_type",
        "migration_identity_map",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_leanix_identity_id_kind",
        "migration_identity_map",
        ["source_id", "entity_kind"],
    )

    # ---- Reverse staged_records index name. ----
    op.execute(
        "ALTER INDEX IF EXISTS ix_staged_record_migration_kind RENAME TO ix_leanix_staged_migration_kind"
    )

    # ---- Reverse staged_records unique. ----
    op.drop_constraint(
        "uq_staged_record_migration_kind_source_id",
        "staged_records",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_leanix_staged_record_migration_kind_id",
        "staged_records",
        ["migration_id", "entity_kind", "source_id"],
    )

    # ---- Reverse migrations file_hash unique. ----
    op.drop_constraint("uq_migration_file_hash_source", "migrations", type_="unique")
    op.create_unique_constraint("leanix_migrations_file_hash_key", "migrations", ["file_hash"])

    # ---- Drop the source_type discriminator on every table. ----
    for table in ("migration_identity_map", "staged_records", "migrations"):
        op.drop_column(table, "source_type")

    # ---- Rename data columns back. ----
    op.alter_column("migration_identity_map", "source_id", new_column_name="leanix_id")
    op.alter_column("staged_records", "parent_source_id", new_column_name="parent_leanix_id")
    op.alter_column("staged_records", "source_data", new_column_name="leanix_data")
    op.alter_column("staged_records", "source_id", new_column_name="leanix_id")

    # ---- Rename the three tables back. ----
    op.rename_table("migration_identity_map", "leanix_identity_map")
    op.rename_table("staged_records", "leanix_staged_records")
    op.rename_table("migrations", "leanix_migrations")
