"""Drop the two stale card permission keys migration 024 left behind.

Migration 022 seeded the stakeholder role definitions with the pre-rename
``fs.*`` permission names, among them ``fs.quality_seal`` and
``fs.manage_subscriptions``. Migration 024 then rewrote the *prefix* of every
key in ``stakeholder_role_definitions.permissions`` (``fs.`` -> ``card.``) but
never applied the semantic half of the very rename it was named after::

    fs.quality_seal         -> card.quality_seal          (wanted: card.approval_status)
    fs.manage_subscriptions -> card.manage_subscriptions  (wanted: card.manage_stakeholders)

Migration 033 repaired exactly this class of staleness for the app-level keys in
``roles.permissions`` and stopped there, so every install upgraded through 024
still carries two card permission keys that ``core/permissions.py`` does not
define. ``seed.py`` cannot heal them either: for an existing
``(card_type_key, key)`` it merges translations and moves on, never touching
``permissions``.

The visible damage was that the stakeholder role editor could not save at all.
The admin UI renders only the keys in ``CARD_PERMISSIONS`` — so these were
invisible and un-removable — yet it round-trips the stored map verbatim on every
save, and the API's validator rejected the request with ``Unknown permission
keys: card.manage_subscriptions, card.quality_seal``. Because the validator runs
before the handler body, the whole PATCH died: colour, label and translation
edits were all discarded along with it.

**The keys are dropped, not remapped.**
``PermissionService.get_effective_card_permissions`` only ever reads the modern
``card.approval_status`` / ``card.manage_stakeholders`` names, so these keys have
granted nothing since 024. Removing them is therefore strictly
behaviour-preserving, which is the point: remapping would silently *grant*
approve/reject and stakeholder-management rights to every existing holder of
``responsible``, ``processOwner`` and friends — a privilege escalation shipped
as a bug fix. An admin who wants those rights can now tick the boxes, which is
what the repaired editor is for.

Only ``stakeholder_role_definitions.permissions`` is touched. The legacy
``card_types.stakeholder_roles`` JSONB mirror stores ``[{key, label}]`` and
carries no permissions at all, and ``roles.permissions`` holds app-level keys
that 033 already fixed.

The rewrite is Python-side (fetch -> mutate -> ``CAST(:s AS jsonb)``) rather
than a single SQL ``UPDATE ... WHERE permissions ? 'card.quality_seal'``:
PostgreSQL's ``?`` JSONB operator collides with SQLAlchemy's ``text()``
named-parameter scanner and silently rolls the migration back (the incident
behind 099; 133 documents the same convention). Note that 033 uses precisely
that unsafe pattern — it is not a template to copy.

Revision ID: 140
Revises: 139
Create Date: 2026-08-25
"""

import json
from typing import Sequence, Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "140"
down_revision: Union[str, None] = "139"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Kept as a literal rather than imported from ``app.core.permissions`` so the
# migration keeps describing the database as it was when this revision ran, even
# if the application constant is later changed or removed.
STALE_KEYS: frozenset[str] = frozenset({"card.quality_seal", "card.manage_subscriptions"})


def plan_permissions(permissions, stale: frozenset[str]) -> dict | None:
    """Rewrite one permissions map, or ``None`` when nothing changes.

    Pure so it can be unit-tested without a database. Returning ``None`` for an
    unchanged map is what keeps the migration idempotent and lets the caller skip
    the write entirely — a re-run touches no rows.
    """
    if not isinstance(permissions, dict):
        return None
    updated = {k: v for k, v in permissions.items() if k not in stale}
    return None if updated == permissions else updated


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(text("SELECT id, permissions FROM stakeholder_role_definitions")).fetchall()
    for row in rows:
        updated = plan_permissions(row.permissions, STALE_KEYS)
        if updated is None:
            continue
        conn.execute(
            text(
                "UPDATE stakeholder_role_definitions "
                "SET permissions = CAST(:s AS jsonb) WHERE id = :id"
            ),
            {"s": json.dumps(updated), "id": row.id},
        )


def downgrade() -> None:
    """Deliberately a no-op.

    The dropped keys' original boolean values are not recoverable, and restoring
    them would re-create a map that grants nothing while breaking every save in
    the stakeholder role editor again. Re-adding them under a guessed value would
    be worse than leaving them out, so this migration is one-way by design.
    """
