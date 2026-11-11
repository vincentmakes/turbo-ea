"""Grant the new comment permissions to the stored roles that can already work on documents.

``adr.comment`` and ``soaw.comment`` arrive with the discussion on decisions
and SoAWs. The seeded defaults (``core/permissions.py``) give them to members
and BPM admins and keep them off for viewers, but seeding never rewrites a
stored role, so every existing role would otherwise lack both keys — and a
missing key reads as "no". This writes each key explicitly onto every stored
role: ``adr.comment`` is granted to a role that holds ``adr.manage`` or
``adr.sign``, ``soaw.comment`` to one that holds ``soaw.manage`` or
``soaw.sign``; every other role gets the key written as ``false`` so the
roles admin shows a deliberate value.

**Value guard.** A role that already carries a key (an admin set it after an
earlier upgrade, or the role was created with it) keeps its value; the
wildcard role (``{"*": true}``) is left alone, it already holds everything.
Idempotent. Downgrade removes both keys from every role.

Revision ID: 170
Revises: 169
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "170"
down_revision: Union[str, None] = "169"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: Each new key and the permissions whose holders receive it.
GRANTS: dict[str, tuple[str, ...]] = {
    "adr.comment": ("adr.manage", "adr.sign"),
    "soaw.comment": ("soaw.manage", "soaw.sign"),
}


def plan_comment_grants(permissions: Any) -> dict | None:
    """The role's new permissions map, or ``None`` to leave the role alone.

    Pure, so it is unit-tested without a database
    (``tests/services/test_alembic_170_document_comment_permissions.py``). A
    non-dict map, the wildcard role and a role that already holds both keys
    answer ``None``; otherwise each missing key is written explicitly, ``True``
    when the role holds one of its source permissions.
    """
    if not isinstance(permissions, dict) or permissions.get("*"):
        return None
    missing = [key for key in GRANTS if key not in permissions]
    if not missing:
        return None
    updated = dict(permissions)
    for key in missing:
        updated[key] = any(bool(permissions.get(source)) for source in GRANTS[key])
    return updated


def _roles() -> sa.TableClause:
    return sa.table(
        "roles",
        sa.column("key", sa.String),
        sa.column("permissions", postgresql.JSONB),
    )


def upgrade() -> None:
    conn = op.get_bind()
    roles = _roles()
    for key, permissions in conn.execute(sa.select(roles.c.key, roles.c.permissions)).all():
        updated = plan_comment_grants(permissions)
        if updated is None:
            continue
        conn.execute(roles.update().where(roles.c.key == key).values(permissions=updated))


def plan_removal(permissions: Any) -> dict | None:
    """The role's permissions without the two keys, or ``None`` when it has neither."""
    if not isinstance(permissions, dict) or not GRANTS.keys() & permissions.keys():
        return None
    return {k: v for k, v in permissions.items() if k not in GRANTS}


def downgrade() -> None:
    conn = op.get_bind()
    roles = _roles()
    for key, permissions in conn.execute(sa.select(roles.c.key, roles.c.permissions)).all():
        updated = plan_removal(permissions)
        if updated is None:
            continue
        conn.execute(roles.update().where(roles.c.key == key).values(permissions=updated))
