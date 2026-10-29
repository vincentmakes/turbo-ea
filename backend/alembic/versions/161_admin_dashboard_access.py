"""State who sees the built-in Admin dashboard on installs seeded before it did.

The built-in ``admin`` dashboard carries ``access_permission = "admin.users"``
(``DEFAULT_DASHBOARDS``): ``seed_dashboards`` seeds its ``allowed_roles`` with
every active role holding that permission (or the wildcard), so its Settings
dialog names who sees it instead of "everyone". Seeding is insert-only, so an
install whose dashboards were seeded before that rule kept ``allowed_roles = []``
for good. This writes the seeded value onto that row.

**Value guard.** Only the built-in ``admin`` row whose ``allowed_roles`` is
still ``[]`` is rewritten, so an admin's own restriction survives. Nothing but
``allowed_roles`` is touched — ``dashboards.widgets`` is never rewritten by a
migration (an admin's layout is theirs). Idempotent. When no active role holds
``admin.users`` the row is left alone. Downgrade is a no-op — reverting would
hide again who sees the dashboard, and the access it states is the access the
widgets already grant.

Revision ID: 161
Revises: 160
Create Date: 2026-10-29
"""

import json
from typing import Any, Sequence, Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "161"
down_revision: Union[str, None] = "160"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DASHBOARD_KEY = "admin"
ACCESS_PERMISSION = "admin.users"


def plan_admin_access(
    current: Any, roles: list[tuple[str, dict | None, bool, int]]
) -> list[str] | None:
    """The Admin dashboard's new ``allowed_roles``, or ``None`` to leave it.

    ``roles`` are ``(key, permissions, is_archived, sort_order)`` rows. The rule
    is ``dashboard_service.roles_holding(ACCESS_PERMISSION, roles)`` written
    inline — a migration imports nothing from ``app``. Pure, so it is
    unit-tested without a database
    (``tests/services/test_alembic_161_admin_dashboard_access.py``).
    """
    if current:
        return None
    holders = sorted(
        (sort_order or 0, key)
        for key, permissions, archived, sort_order in roles
        if not archived
        and ((permissions or {}).get("*") or (permissions or {}).get(ACCESS_PERMISSION))
    )
    return [key for _, key in holders] or None


def upgrade() -> None:
    conn = op.get_bind()
    dashboards = conn.execute(
        text("SELECT id, allowed_roles FROM dashboards WHERE key = :key AND built_in = true"),
        {"key": DASHBOARD_KEY},
    ).fetchall()
    if not dashboards:
        return
    roles = [
        (r.key, r.permissions, bool(r.is_archived), r.sort_order)
        for r in conn.execute(
            text("SELECT key, permissions, is_archived, sort_order FROM roles")
        ).fetchall()
    ]
    for row in dashboards:
        planned = plan_admin_access(row.allowed_roles, roles)
        if planned is None:
            continue
        conn.execute(
            text(
                "UPDATE dashboards SET allowed_roles = CAST(:roles AS jsonb) "
                "WHERE id = :id AND allowed_roles = '[]'::jsonb"
            ),
            {"id": row.id, "roles": json.dumps(planned)},
        )


def downgrade() -> None:
    """No-op — clearing the list would hide again who sees the Admin dashboard."""
