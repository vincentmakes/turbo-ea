"""Rename stale permission keys in roles.permissions JSONB.

Migration 022 seeded roles with the pre-024 permission key names.
Migration 024 renamed tables/columns but did not update the app-level
permission keys inside roles.permissions.  This migration fixes that:

  subscriptions.view   → stakeholders.view
  subscriptions.manage → stakeholders.manage
  inventory.quality_seal → inventory.approval_status

Revision ID: 033
Revises: 032
"""

import sqlalchemy as sa

from alembic import op

revision = "033"
down_revision = "032"
branch_labels = None
depends_on = None

# Each rename expressed as: remove old key, add new key (preserving value).
# Done via pure SQL on the JSONB column to avoid Python ↔ UUID type issues.
_RENAMES = [
    ("subscriptions.view", "stakeholders.view"),
    ("subscriptions.manage", "stakeholders.manage"),
    ("inventory.quality_seal", "inventory.approval_status"),
]


def upgrade() -> None:
    conn = op.get_bind()
    for old_key, new_key in _RENAMES:
        # For each role that has the old key: copy value to new key, remove old key.
        # Only sets the new key if it doesn't already exist.
        conn.execute(
            sa.text("""
            UPDATE roles
            SET permissions = (permissions - :old_key) ||
                              jsonb_build_object(:new_key, permissions->:old_key)
            WHERE permissions ? :old_key
              AND NOT (permissions ? :new_key)
        """),
            {"old_key": old_key, "new_key": new_key},
        )

        # If both old and new key exist, just remove the old one.
        conn.execute(
            sa.text("""
            UPDATE roles
            SET permissions = permissions - :old_key
            WHERE permissions ? :old_key
              AND permissions ? :new_key
        """),
            {"old_key": old_key, "new_key": new_key},
        )


def downgrade() -> None:
    conn = op.get_bind()
    for old_key, new_key in _RENAMES:
        conn.execute(
            sa.text("""
            UPDATE roles
            SET permissions = (permissions - :new_key) ||
                              jsonb_build_object(:old_key, permissions->:new_key)
            WHERE permissions ? :new_key
              AND NOT (permissions ? :old_key)
        """),
            {"old_key": old_key, "new_key": new_key},
        )

        conn.execute(
            sa.text("""
            UPDATE roles
            SET permissions = permissions - :new_key
            WHERE permissions ? :new_key
              AND permissions ? :old_key
        """),
            {"old_key": old_key, "new_key": new_key},
        )
