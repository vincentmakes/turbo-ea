"""Preserve existing stakeholder license grants except self-assignable Observer.

Revision ID: 196
Revises: 195
"""

import json
from typing import Sequence, Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "196"
down_revision: Union[str, None] = "195"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Literals rather than imports from ``app.core.permissions``, so the migration
# keeps describing the database as it was when this revision ran.
VIEW_LICENSES_KEY = "card.view_licenses"
SELF_ASSIGNABLE_ROLE = "observer"


def plan_permissions(role_key: str, permissions) -> dict | None:
    """One role's permissions with the key filled in, or ``None`` when unchanged.

    Pure so it can be unit-tested without a database. ``None`` for a map that
    already has the key is what makes the migration idempotent and keeps an
    admin's own choice.
    """
    if permissions is None:
        permissions = {}
    if not isinstance(permissions, dict) or VIEW_LICENSES_KEY in permissions:
        return None
    return {**permissions, VIEW_LICENSES_KEY: role_key != SELF_ASSIGNABLE_ROLE}


def unplan_permissions(permissions) -> dict | None:
    """One role's permissions without the key, or ``None`` when unchanged."""
    if not isinstance(permissions, dict) or VIEW_LICENSES_KEY not in permissions:
        return None
    return {k: v for k, v in permissions.items() if k != VIEW_LICENSES_KEY}


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
