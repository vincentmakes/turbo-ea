"""Working out who should receive a notification, by permission.

Background checks that notify "the administrators" must not resolve them as
``user.role == "admin"``: a custom role holding the relevant permission is just
as much an operator, and hardcoding the role key would silently skip them. The
lookup is always the same shape — non-archived roles carrying the permission or
the ``"*"`` wildcard, then the *active* users holding those role keys — so it
lives here once rather than being copied into every checker.

Targeting is a notification concern, which is why this sits beside
``notification_service`` rather than inside whichever feature happens to need it
first.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.role import Role
from app.models.user import User


async def _active_users_for_roles(db: AsyncSession, keys: list[str]) -> list[uuid.UUID]:
    if not keys:
        return []
    users = (
        (
            await db.execute(
                select(User).where(
                    User.role.in_(keys),
                    User.is_active == True,  # noqa: E712
                )
            )
        )
        .scalars()
        .all()
    )
    return [u.id for u in users]


async def users_with_permission_prefix(db: AsyncSession, prefix: str) -> list[uuid.UUID]:
    """Active users whose role grants ANY permission under ``prefix`` (or ``"*"``).

    ``users_with_permission`` matches one exact key, which cannot answer "who
    can use this extension?" — an extension declares several keys
    (``ext.acme.view``, ``ext.acme.manage``, …) and holding any one of them
    counts. Unioning N exact calls would re-scan the role table N times; the
    scan is already in Python, so the predicate widens for free.
    """
    roles = (
        (await db.execute(select(Role).where(Role.is_archived == False)))  # noqa: E712
        .scalars()
        .all()
    )
    keys = [
        r.key
        for r in roles
        if (r.permissions or {}).get("*")
        or any(k.startswith(prefix) and v for k, v in (r.permissions or {}).items())
    ]
    return await _active_users_for_roles(db, keys)


async def users_with_permission(db: AsyncSession, permission: str) -> list[uuid.UUID]:
    """Active users whose non-archived role grants ``permission`` (or ``"*"``)."""
    roles = (
        (await db.execute(select(Role).where(Role.is_archived == False)))  # noqa: E712
        .scalars()
        .all()
    )
    keys = [
        r.key
        for r in roles
        if (r.permissions or {}).get("*") or (r.permissions or {}).get(permission)
    ]
    return await _active_users_for_roles(db, keys)
