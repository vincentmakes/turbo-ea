"""Backfill: grant ``servicenow.view`` to roles that hold ``servicenow.manage``.

This release re-tiers the read-only ServiceNow endpoints (list/get
connections, mappings, sync runs, staged records) from
``servicenow.manage`` down to ``servicenow.view``. Permission checks are
exact-key lookups — ``manage`` does not imply ``view`` — so a custom
role configured before this release with ``servicenow.manage: true`` and
``servicenow.view`` unticked (a rational choice back when ``view`` was
unused) would suddenly get 403s on every read it could perform
yesterday, while the frontend still routes it to the ServiceNow admin
screen.

This migration walks every ``roles`` row in Python (mirroring the
``099_backfill_danish_enabled_locale.py`` pattern — CLAUDE.md warns off
the single-UPDATE JSONB ``?``-operator approach, which trips SQLAlchemy's
``text()`` bind-param scanner):

- if ``permissions`` is a dict with ``servicenow.manage == true`` and
  ``servicenow.view`` not already true, set ``servicenow.view: true``;
- otherwise (wildcard admin, no manage grant, or view already granted),
  leave the row alone.

Idempotent: re-running is a no-op.

Downgrade is intentionally a no-op: we cannot distinguish roles that had
``view`` granted deliberately from rows this migration touched, and
stripping ``view`` from the former would destroy admin configuration.

Revision ID: 116
Revises: 115
Create Date: 2026-07-01
"""

import json
from typing import Sequence, Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "116"
down_revision: Union[str, None] = "115"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MANAGE_KEY = "servicenow.manage"
VIEW_KEY = "servicenow.view"


def plan_patch(perms) -> dict | None:
    """Return the patched permissions dict, or ``None`` when no change is needed.

    Pure helper (no DB) so the guard logic is unit-testable — mirrors the
    ``plan_backfill`` pattern from migration 103.
    """
    if not isinstance(perms, dict):
        return None
    if perms.get(MANAGE_KEY) is not True or perms.get(VIEW_KEY) is True:
        return None
    return {**perms, VIEW_KEY: True}


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(text("SELECT id, permissions FROM roles")).fetchall()
    for row in rows:
        patched = plan_patch(row.permissions)
        if patched is None:
            continue
        conn.execute(
            text("UPDATE roles SET permissions = CAST(:p AS jsonb) WHERE id = :id"),
            {"p": json.dumps(patched), "id": row.id},
        )


def downgrade() -> None:
    # Intentional no-op — see module docstring.
    pass
