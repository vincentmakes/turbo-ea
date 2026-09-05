"""Telling the people who use an extension that it changed.

Core already announces its own upgrades to every active user
(``app.services.upgrade_announce``). This is the same idea scoped to one
extension, and the scoping is the whole design question: an extension is not
the platform, so "everyone" is usually the wrong audience, while "administrators
only" leaves the people who actually use the thing to discover the change by
bumping into it.

The rule, in order:

1. **A first install is not an update.** With no previous version there is no
   "what changed" to tell anyone.
2. **A lapsed or unlicensed extension announces nothing.** It is not running,
   so a release note about it is noise.
3. **If the extension declares permissions, its holders are the audience** —
   anyone whose role grants at least one ``ext.{key}.*`` key, plus every
   ``"*"`` role. Those keys are what gate its pages and its API, so holding one
   is the operational definition of "can use it".
4. **If it declares none, everyone is.** Content packs and metamodel
   contributions have no permission surface at all — their card types, fields
   and tags are simply part of the inventory — so the honest audience is every
   active user.

One asymmetry worth knowing about, because it looks like a bug and is not:
only a **backend** extension's permissions reach the core registry
(``loader.merge_extension_permissions``). A frontend-only extension's manifest
keys are never registered and are not grantable in the Roles admin, so it falls
into case 4 and tells everyone. That is the better failure direction — a
missable announcement beats a silent one — but it does mean "declares
permissions" here means *registered*, not *written in the manifest*.

Delivery is not done here. The digest is built inside the caller's session and
sent afterwards through ``deliver_notification_batch``, because the send ends in
notification rows for potentially every active user and must not hold the
install transaction open (CLAUDE.md; ``tests/services/test_db_session_holding.py``).
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.extensions.registry import extension_registry
from app.services.extensions.store_catalog import store_update_available
from app.services.notification_recipients import users_with_permission_prefix

logger = logging.getLogger(__name__)

NOTIFICATION_TYPE = "extension_updated"

#: Where the bell sends someone who clicks through. The dialog opens over it,
#: so this is the fallback for a client that does not know the type.
EXTENSIONS_LINK = "/admin/extensions"


def _permission_prefix(key: str) -> str:
    return f"ext.{key}."


def _has_registered_permissions(key: str) -> bool:
    """Whether this extension registered any ``ext.{key}.*`` permission key."""
    from app.core import permissions as perm_registry

    prefix = _permission_prefix(key)
    return any(k.startswith(prefix) for k in perm_registry.ALL_APP_PERMISSION_KEYS)


async def _all_active_user_ids(db: AsyncSession) -> list[uuid.UUID]:
    rows = (
        (
            await db.execute(
                select(User.id).where(User.is_active == True)  # noqa: E712
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def resolve_audience(db: AsyncSession, key: str) -> list[uuid.UUID]:
    """Who can use this extension — see the module docstring for the rule."""
    if _has_registered_permissions(key):
        return await users_with_permission_prefix(db, _permission_prefix(key))
    return await _all_active_user_ids(db)


async def build_update_digest(
    db: AsyncSession,
    *,
    key: str,
    name: str,
    from_version: str | None,
    to_version: str,
) -> list[dict]:
    """Recipient payloads for ``deliver_notification_batch``, or ``[]``.

    Empty for a first install, a version that is not strictly newer, an
    extension that is not usable, and an extension nobody can reach. The
    payload carries **versions only** — the markdown is resolved on read via
    ``GET /extensions/{key}/release-notes``, so the notifications table does
    not grow by release notes × users × release.
    """
    if not from_version or not store_update_available(to_version, from_version):
        return []
    if not extension_registry.entitlement(key).usable:
        return []

    recipients = await resolve_audience(db, key)
    if not recipients:
        return []

    title = f"{name} was updated to {to_version}"
    message = f"Updated from {from_version}. Open to see what changed in this release."
    payload = {
        "key": key,
        "name": name,
        "from_version": from_version,
        "to_version": to_version,
    }
    logger.info(
        "Extension %s %s -> %s announced to %d user(s)",
        key,
        from_version,
        to_version,
        len(recipients),
    )
    return [
        {
            "user_id": user_id,
            "title": title,
            "message": message,
            "link": EXTENSIONS_LINK,
            "data": dict(payload),
        }
        for user_id in recipients
    ]
