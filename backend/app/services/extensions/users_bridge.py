"""The SDK users bridge — extensions' read-only view of the user directory
(SDK 1.3).

Built for connector extensions that map assignees to an external tracker's
accounts: they need id ↔ email resolution server-side, without a
frontend-fed workaround and without touching core internals.

Design invariants:

* **Grant-gated per call.** Every method re-evaluates
  ``extension_registry.grants_for(key)`` against ``core.users.read`` —
  access revokes the moment the extension is disabled, removed, pending
  restart, or its license entitlement stops being usable (same model as the
  todos bridge).
* **Least-privilege payload.** :class:`ExtUser` mirrors the lite shape
  core's own user pickers receive (``_user_response_lite`` in the users
  API): id, email, display name, active flag. No role, no login/security
  fields, no preferences — the bridge must never widen what a non-admin
  surface can already see.
* **Read-only.** There is no write surface; user management stays
  core-only. No mutation batch is opened because nothing mutates.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select

from app.database import async_session
from app.models.user import User
from app.services.extensions.registry import extension_registry
from app.services.extensions.sdk import ExtensionPermissionError, ExtUser, UsersBridge

READ_GRANT = "core.users.read"


def _to_ext_user(u: User) -> ExtUser:
    # Keep in sync with the key set of ``_user_response_lite`` in
    # ``app/api/v1/users.py`` — pinned by test_extension_users_bridge.
    return ExtUser(
        id=str(u.id),
        email=u.email,
        display_name=u.display_name,
        is_active=u.is_active,
    )


class ExtensionUsers(UsersBridge):
    """Per-extension bridge instance attached to ``ExtensionContext.users``."""

    def __init__(self, key: str):
        self._key = key

    def _require(self) -> None:
        if READ_GRANT not in set(extension_registry.grants_for(self._key)):
            raise ExtensionPermissionError(
                f"Extension {self._key} requires the {READ_GRANT} grant "
                "(and an enabled, licensed install) for this call"
            )

    async def list(self, *, include_inactive: bool = False) -> list[ExtUser]:
        self._require()
        async with async_session() as db:
            q = select(User).order_by(User.display_name)
            if not include_inactive:
                q = q.where(User.is_active.is_(True))
            result = await db.execute(q)
            return [_to_ext_user(u) for u in result.scalars().all()]

    async def get(self, user_id: str) -> ExtUser | None:
        self._require()
        try:
            uid = uuid.UUID(user_id)
        except ValueError:
            return None
        async with async_session() as db:
            user = (await db.execute(select(User).where(User.id == uid))).scalar_one_or_none()
            return _to_ext_user(user) if user else None

    async def find_by_email(self, email: str) -> ExtUser | None:
        self._require()
        cleaned = (email or "").strip().lower()
        if not cleaned:
            return None
        async with async_session() as db:
            user = (
                await db.execute(select(User).where(func.lower(User.email) == cleaned))
            ).scalar_one_or_none()
            return _to_ext_user(user) if user else None
