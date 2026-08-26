"""Rename any pre-024 app permission keys still sitting in ``roles.permissions``.

Migration 033 already performs exactly this rename, and it works — so on an
install whose history runs straight through 033 this migration finds nothing and
issues no UPDATE. It exists for the rows 033 cannot have seen, because they
arrived *after* it ran::

    subscriptions.view     -> stakeholders.view
    subscriptions.manage   -> stakeholders.manage
    inventory.quality_seal -> inventory.approval_status

The workspace-transfer applier writes ``roles.permissions`` straight onto the
model from the bundle, bypassing the ``RoleCreate`` / ``RoleUpdate`` validators.
A bundle exported from an instance that never ran 033 therefore reintroduces the
old names into a repaired database, and no migration is watching that path. The
result is the app-level twin of the bug migration 140 fixes: the roles admin
renders only the keys ``GET /roles/permissions-schema`` returns but resends the
stored map verbatim, so a key it cannot display is invisible, un-removable, and
rejected on every save.

**These are renamed, not dropped** — the opposite of 140, and deliberately so.
Each old name maps onto a permission that still exists and still means the same
thing, so the stored ``true`` is a grant an admin made on purpose. Dropping it
would silently revoke access; renaming preserves exactly what the role had. (The
card-level keys 140 removes have no modern equivalent being read anywhere, which
is what makes dropping them safe there and wrong here.)

Where a role somehow carries both names, the modern one wins and the stale one is
simply removed — matching 033, so a deliberate newer value is never clobbered by
a stale one.

The rewrite is Python-side (fetch -> mutate -> ``CAST(:s AS jsonb)``) rather than
033's ``UPDATE ... WHERE permissions ? :old_key``. 033's form is verified to work
on this project's asyncpg migration path, but the ``?`` JSONB operator is exactly
what collides with SQLAlchemy's ``text()`` named-parameter scanner in the 099
incident, and 133 settled the safe pattern; there is no reason to reach for the
risky one in new code.

Revision ID: 141
Revises: 140
Create Date: 2026-08-26
"""

import json
from typing import Sequence, Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "141"
down_revision: Union[str, None] = "140"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# A literal rather than an import from ``app.core.permissions``, so the migration
# keeps describing the database as it was at this revision even if the
# application constant later changes. Kept in sync by a test.
RENAMES: dict[str, str] = {
    "subscriptions.view": "stakeholders.view",
    "subscriptions.manage": "stakeholders.manage",
    "inventory.quality_seal": "inventory.approval_status",
}


def plan_permissions(permissions, renames: dict[str, str]) -> dict | None:
    """Rewrite one permissions map, or ``None`` when nothing changes.

    Pure so it can be unit-tested without a database. Returning ``None`` for an
    untouched map is what makes this a no-op on the installs 033 already
    repaired — and what makes a re-run touch no rows.
    """
    if not isinstance(permissions, dict):
        return None
    if not renames.keys() & permissions.keys():
        return None
    updated: dict = {}
    for key, value in permissions.items():
        new_key = renames.get(key)
        if new_key is None:
            updated[key] = value
        elif new_key not in permissions:
            # Both present: keep the modern key's own value, drop the stale one.
            updated[new_key] = value
    return updated


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(text("SELECT key, permissions FROM roles")).fetchall()
    for row in rows:
        updated = plan_permissions(row.permissions, RENAMES)
        if updated is None:
            continue
        conn.execute(
            text("UPDATE roles SET permissions = CAST(:s AS jsonb) WHERE key = :key"),
            {"s": json.dumps(updated), "key": row.key},
        )


def downgrade() -> None:
    """Deliberately a no-op.

    Reversing the rename would hand back permission keys nothing reads, and
    would re-break every save in the roles admin for the sake of restoring names
    the application abandoned several releases ago. 033 owns the forward history
    of these keys; this revision only sweeps up stragglers, so there is nothing
    meaningful to undo.
    """
