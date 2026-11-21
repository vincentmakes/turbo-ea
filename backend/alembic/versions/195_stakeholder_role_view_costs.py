"""Record which stakeholder roles show a card's costs.

Until this release *any* stakeholder role on a card showed that card's cost
fields to a user without the app-level ``costs.view`` permission. Anyone who can
view a card can make themselves its Observer with one click
(``POST /cards/{id}/me/observe``), so every user could reveal the costs of any
card they could open (#1412).

From this release a role shows costs only when its definition grants the new
card permission ``card.view_costs``. This migration writes that key into every
existing role definition so an upgrade changes nothing except the hole itself:

- every role keeps showing costs (``true``) — owners, custom roles, archived
  roles (so restoring one brings back what it had);
- ``observer`` stops (``false``): it is the role anyone who can view a card can
  give themselves, without the right to manage stakeholders.

A row that already carries the key is left alone, either value, so a re-run —
or a row an admin edited on a newer build before this revision ran — is never
overwritten. A role created after the upgrade starts without the key, which
means "does not show costs" until an admin ticks it.

Not touched: a stakeholder assignment whose role has **no definition row** (the
fallback Responsible / Observer of a custom card type nobody defined roles for).
Such a role grants no card permission at all, and now no cost access either;
defining the role under Admin > Metamodel gives it back.

The rewrite is Python-side (fetch -> mutate -> ``CAST(:s AS jsonb)``), the
convention migrations 099, 133 and 140 document: PostgreSQL's ``?`` JSONB
operator collides with SQLAlchemy's ``text()`` named-parameter scanner.

Revision ID: 195
Revises: 194
Create Date: 2026-11-19
"""

import json
from typing import Sequence, Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "195"
down_revision: Union[str, None] = "194"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Literals rather than imports from ``app.core.permissions``, so the migration
# keeps describing the database as it was when this revision ran.
VIEW_COSTS_KEY = "card.view_costs"
SELF_ASSIGNABLE_ROLE = "observer"


def plan_permissions(role_key: str, permissions) -> dict | None:
    """One role's permissions with the key filled in, or ``None`` when unchanged.

    Pure so it can be unit-tested without a database. ``None`` for a map that
    already has the key is what makes the migration idempotent and keeps an
    admin's own choice.
    """
    if permissions is None:
        permissions = {}
    if not isinstance(permissions, dict) or VIEW_COSTS_KEY in permissions:
        return None
    return {**permissions, VIEW_COSTS_KEY: role_key != SELF_ASSIGNABLE_ROLE}


def unplan_permissions(permissions) -> dict | None:
    """One role's permissions without the key, or ``None`` when unchanged."""
    if not isinstance(permissions, dict) or VIEW_COSTS_KEY not in permissions:
        return None
    return {k: v for k, v in permissions.items() if k != VIEW_COSTS_KEY}


def _write(conn, row_id, permissions: dict) -> None:
    conn.execute(
        text(
            "UPDATE stakeholder_role_definitions SET permissions = CAST(:s AS jsonb) WHERE id = :id"
        ),
        {"s": json.dumps(permissions), "id": row_id},
    )


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        text("SELECT id, key, permissions FROM stakeholder_role_definitions")
    ).fetchall()
    for row in rows:
        updated = plan_permissions(row.key, row.permissions)
        if updated is not None:
            _write(conn, row.id, updated)


def downgrade() -> None:
    """Drop the key again: the older code does not know it and would reject it
    on the next save of the role."""
    conn = op.get_bind()
    rows = conn.execute(text("SELECT id, permissions FROM stakeholder_role_definitions")).fetchall()
    for row in rows:
        updated = unplan_permissions(row.permissions)
        if updated is not None:
            _write(conn, row.id, updated)
