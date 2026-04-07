"""Rename ArchLens tables and indexes to TurboLens.

Revision ID: 061
Revises: 060
"""

from alembic import op

revision = "061"
down_revision = "060"
branch_labels = None
depends_on = None

# (old_table, new_table)
TABLE_RENAMES = [
    ("archlens_vendor_analysis", "turbolens_vendor_analysis"),
    ("archlens_vendor_hierarchy", "turbolens_vendor_hierarchy"),
    ("archlens_duplicate_clusters", "turbolens_duplicate_clusters"),
    ("archlens_modernization_assessments", "turbolens_modernization_assessments"),
    ("archlens_analysis_runs", "turbolens_analysis_runs"),
    ("archlens_assessments", "turbolens_assessments"),
]

# (old_index, new_index)
INDEX_RENAMES = [
    ("ix_archlens_assessments_created_by", "ix_turbolens_assessments_created_by"),
    ("ix_archlens_assessments_initiative_id", "ix_turbolens_assessments_initiative_id"),
]

# Permission key renames in roles.permissions JSONB
PERM_RENAMES = [
    ("archlens.view", "turbolens.view"),
    ("archlens.manage", "turbolens.manage"),
]


def upgrade() -> None:
    for old, new in TABLE_RENAMES:
        op.rename_table(old, new)

    for old, new in INDEX_RENAMES:
        op.execute(f"ALTER INDEX IF EXISTS {old} RENAME TO {new}")

    # Update stored permission keys in roles table
    for old_key, new_key in PERM_RENAMES:
        op.execute(
            f"""
            UPDATE roles
            SET permissions = (permissions - '{old_key}')
                || jsonb_build_object('{new_key}', permissions->'{old_key}')
            WHERE permissions ? '{old_key}'
            """
        )


def downgrade() -> None:
    for old, new in TABLE_RENAMES:
        op.rename_table(new, old)

    for old, new in INDEX_RENAMES:
        op.execute(f"ALTER INDEX IF EXISTS {new} RENAME TO {old}")

    for old_key, new_key in PERM_RENAMES:
        op.execute(
            f"""
            UPDATE roles
            SET permissions = (permissions - '{new_key}')
                || jsonb_build_object('{old_key}', permissions->'{new_key}')
            WHERE permissions ? '{new_key}'
            """
        )
