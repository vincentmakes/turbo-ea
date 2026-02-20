"""Rename stale permission keys in roles.permissions JSONB.

subscriptions.view   → stakeholders.view
subscriptions.manage → stakeholders.manage
inventory.quality_seal → inventory.approval_status

Revision ID: 033
Revises: 032
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "033"
down_revision = "032"
branch_labels = None
depends_on = None

# Old key → new key
_RENAMES = {
    "subscriptions.view": "stakeholders.view",
    "subscriptions.manage": "stakeholders.manage",
    "inventory.quality_seal": "inventory.approval_status",
}


def upgrade() -> None:
    conn = op.get_bind()
    roles_table = sa.table(
        "roles",
        sa.column("id", sa.Text),
        sa.column("permissions", JSONB),
    )
    rows = conn.execute(sa.select(roles_table.c.id, roles_table.c.permissions)).fetchall()

    for role_id, perms in rows:
        if not perms:
            continue
        updated = dict(perms)
        changed = False
        for old_key, new_key in _RENAMES.items():
            if old_key in updated:
                # Keep old value only if new key doesn't already exist
                if new_key not in updated:
                    updated[new_key] = updated[old_key]
                del updated[old_key]
                changed = True
        if changed:
            conn.execute(
                roles_table.update()
                .where(roles_table.c.id == role_id)
                .values(permissions=updated)
            )


def downgrade() -> None:
    # Reverse: new key → old key
    conn = op.get_bind()
    roles_table = sa.table(
        "roles",
        sa.column("id", sa.Text),
        sa.column("permissions", JSONB),
    )
    rows = conn.execute(sa.select(roles_table.c.id, roles_table.c.permissions)).fetchall()

    for role_id, perms in rows:
        if not perms:
            continue
        updated = dict(perms)
        changed = False
        for old_key, new_key in _RENAMES.items():
            if new_key in updated:
                if old_key not in updated:
                    updated[old_key] = updated[new_key]
                del updated[new_key]
                changed = True
        if changed:
            conn.execute(
                roles_table.update()
                .where(roles_table.c.id == role_id)
                .values(permissions=updated)
            )
