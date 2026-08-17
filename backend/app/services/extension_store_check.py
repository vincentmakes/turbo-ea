"""Daily probe for new and updated extensions in the store catalogue.

The app-update check (``app/services/update_check.py``) tells administrators
that a newer release of Turbo EA itself exists. This is the same idea one level
down: the extension store publishes new extensions and new versions of existing
ones, and until now the only place that surfaced was a button label on
Admin → Extensions → Store — visible only to an administrator who happened to
open the page. A security fix to an installed extension could sit unnoticed
indefinitely.

Awareness only. Nothing is downloaded, installed or restarted; the one-click
install on the Store tab stays the action surface.

Two things are announced, as two separate notification types so an
administrator can mute store announcements without also muting update alerts:

* ``extension_available`` — an extension we have never seen in the catalogue
  before, and which is not installed.
* ``extension_update_available`` — an installed extension whose catalogue
  version is strictly newer than the installed one.

Four properties worth preserving:

* **Once per thing, not once per day.** Seen keys and announced versions are
  persisted, so a catalogue that sits unchanged for a month produces one
  notification, not thirty.
* **One digest, not one row per extension.** A catalogue release day that adds
  five extensions must not drop five rows into every administrator's bell.
* **Quiet on the first successful fetch.** An instance meeting the catalogue for
  the first time would otherwise announce every extension in it. The seeding
  flag is set on the first *successful* fetch rather than the first *run*, so an
  install that cannot reach the store stays un-seeded and seeds silently
  whenever it first gets through, rather than announcing forty extensions then.
* **Off means off.** The toggle is read *before* the HTTP call, so disabling it
  stops the outbound request rather than just muting the notification.

Session discipline matters here exactly as it does in ``update_check`` (see
CLAUDE.md, guarded by ``tests/services/test_db_session_holding.py``): read the
settings on a short session, close it, make the network round-trip holding
nothing, then reopen a session for the writes.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.app_settings import AppSettings
from app.models.extension import Extension
from app.services.catalogue_common import now_iso
from app.services.extensions.store_catalog import fetch_store_catalog_safe, store_update_available
from app.services.notification_recipients import users_with_permission
from app.services.notification_service import create_notification

logger = logging.getLogger(__name__)

#: ``app_settings.general_settings`` keys owned by this module.
ENABLED_SETTING = "extensionNoticesEnabled"
STATE_SETTING = "extensionStoreCheck"

NEW_NOTIFICATION_TYPE = "extension_available"
UPDATE_NOTIFICATION_TYPE = "extension_update_available"

#: Who can act on this — the permission gating both the Store tab and the
#: ``/admin/extensions`` route, so a notification never points somewhere its
#: recipient cannot open.
ADMIN_PERMISSION = "admin.manage_extensions"

#: Relative, so the bell navigates in-app rather than opening a tab, and so an
#: emailed copy still resolves (``email_service`` prefixes the instance URL).
STORE_LINK = "/admin/extensions?tab=store"

#: The state blob lives on the singleton settings row that every settings read
#: touches, so both collections are bounded.
MAX_TRACKED_KEYS = 500
MAX_LISTED_ITEMS = 20


@dataclass(frozen=True)
class NewExtension:
    key: str
    name: str
    version: str


@dataclass(frozen=True)
class ExtensionUpdate:
    key: str
    name: str
    installed_version: str
    store_version: str


@dataclass(frozen=True)
class StoreChanges:
    """What is worth telling an administrator about a given catalogue."""

    new: list[NewExtension]
    updates: list[ExtensionUpdate]

    def __bool__(self) -> bool:
        return bool(self.new or self.updates)


async def _settings_row(db: AsyncSession) -> AppSettings | None:
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    return result.scalar_one_or_none()


async def extension_notices_enabled(db: AsyncSession) -> bool:
    """Whether the instance may probe the store catalogue. Defaults to on."""
    row = await _settings_row(db)
    general = (row.general_settings if row else None) or {}
    return bool(general.get(ENABLED_SETTING, True))


async def installed_versions(db: AsyncSession) -> dict[str, str]:
    """``{key: version}`` for every extension row that is not ``removed``.

    A *disabled* extension is still installed and its update is still worth
    knowing about, so only ``removed`` is excluded — matching what the Store
    tab's catalogue endpoint considers installed.
    """
    rows = (
        (await db.execute(select(Extension).where(Extension.status != "removed"))).scalars().all()
    )
    return {row.key: row.version for row in rows}


def _entry(item: dict) -> tuple[str, str, str]:
    """``(key, name, version)`` from a catalogue row, all narrowed to strings."""
    key = str(item.get("key") or "")
    return key, str(item.get("name") or key), str(item.get("version") or "")


def classify(
    items: list[dict],
    *,
    installed: dict[str, str],
    known_keys: set[str],
    notified_versions: dict[str, str],
    seeded: bool,
) -> StoreChanges:
    """Pure: decide what in this catalogue is news.

    The two branches are mutually exclusive by construction — the new-extension
    branch requires the extension *not* to be installed — so an extension
    installed from a file that later shows up in the store is never announced as
    new, and only its updates are reported.
    """
    new: list[NewExtension] = []
    updates: list[ExtensionUpdate] = []

    for item in items:
        key, name, version = _entry(item)
        if not key:
            continue

        current = installed.get(key)
        if current is not None:
            # Installed: report a strictly newer catalogue version, once.
            if store_update_available(version, current) and notified_versions.get(key) != version:
                updates.append(
                    ExtensionUpdate(
                        key=key, name=name, installed_version=current, store_version=version
                    )
                )
            continue

        # Not installed: news only the first time we ever see the key, and only
        # once this instance has seen a catalogue at all.
        if seeded and key not in known_keys:
            new.append(NewExtension(key=key, name=name, version=version))

    return StoreChanges(new=new, updates=updates)


def _names(entries: Sequence[NewExtension] | Sequence[ExtensionUpdate]) -> str:
    """``"A, B and 2 more"`` — keeps a digest message inside the bell's width."""
    names = [e.name for e in entries]
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} and {names[1]}"
    return f"{names[0]}, {names[1]} and {len(names) - 2} more"


def _new_summary(new: list[NewExtension]) -> tuple[str, str]:
    if len(new) == 1:
        item = new[0]
        return (
            f"{item.name} is available in the extension store",
            "A new extension was published. Open the store to take a look.",
        )
    return (
        f"{len(new)} new extensions in the extension store",
        f"{_names(new)}. Open the store to take a look.",
    )


def _update_summary(updates: list[ExtensionUpdate]) -> tuple[str, str]:
    if len(updates) == 1:
        item = updates[0]
        return (
            f"{item.name} {item.store_version} is available",
            f"You have {item.installed_version} installed. Open the store to update.",
        )
    return (
        f"{len(updates)} extension updates are available",
        f"{_names(updates)} have a newer version in the store.",
    )


def _pending_versions(items: list[dict], installed: dict[str, str]) -> dict[str, str]:
    """``{key: store_version}`` for every update that is *currently* pending.

    Recomputed from scratch each run rather than accumulated, so the map cleans
    itself the moment an administrator installs the update and can never grow
    past the number of installed extensions.
    """
    pending: dict[str, str] = {}
    for item in items:
        key, _, version = _entry(item)
        current = installed.get(key)
        if key and current is not None and store_update_available(version, current):
            pending[key] = version
    return pending


async def record_result(
    db: AsyncSession,
    *,
    items: list[dict] | None,
    error: str | None,
) -> int:
    """Persist the probe result and notify administrators about what changed.

    Returns the number of notifications created. Does **not** commit — the
    caller owns the session and knows what else it has pending.
    """
    row = await _settings_row(db)
    if row is None:
        row = AppSettings(id="default", email_settings={}, general_settings={})
        db.add(row)

    general = dict(row.general_settings or {})
    state = dict(general.get(STATE_SETTING) or {})

    state["checkedAt"] = now_iso()
    state["error"] = error

    created = 0
    if items is not None:
        installed = await installed_versions(db)
        # Both come back out of JSONB, so they are only the right shape by
        # convention — narrow before use.
        known = {k for k in (state.get("knownKeys") or []) if isinstance(k, str)}
        notified = {
            k: v
            for k, v in (state.get("notifiedVersions") or {}).items()
            if isinstance(k, str) and isinstance(v, str)
        }

        changes = classify(
            items,
            installed=installed,
            known_keys=known,
            notified_versions=notified,
            seeded=bool(state.get("seeded")),
        )

        if changes:
            recipients = await users_with_permission(db, ADMIN_PERMISSION)
            created += await _notify(db, recipients, changes)

        # Stamped even when every administrator has muted the types: as far as
        # this instance is concerned the catalogue has been seen, and tomorrow's
        # run must not retry them. `knownKeys` is a *union* — an outage that
        # returns an empty or partial catalogue must not make everything look
        # new again when the store recovers.
        catalog_keys = {key for key, _, _ in map(_entry, items) if key}
        state["knownKeys"] = sorted(known | catalog_keys)[:MAX_TRACKED_KEYS]
        state["notifiedVersions"] = _pending_versions(items, installed)
        state["seeded"] = True

    general[STATE_SETTING] = state
    # Reassign rather than mutate — SQLAlchemy does not track in-place JSONB edits.
    row.general_settings = general
    return created


async def _notify(db: AsyncSession, recipients: list[uuid.UUID], changes: StoreChanges) -> int:
    """One digest per type per recipient — never one row per extension."""
    created = 0
    for user_id in recipients:
        if changes.new:
            title, message = _new_summary(changes.new)
            notif = await create_notification(
                db,
                user_id=user_id,
                notif_type=NEW_NOTIFICATION_TYPE,
                title=title,
                message=message,
                link=STORE_LINK,
                data={
                    "count": len(changes.new),
                    "extensions": [
                        {"key": e.key, "name": e.name, "version": e.version}
                        for e in changes.new[:MAX_LISTED_ITEMS]
                    ],
                },
            )
            if notif:
                created += 1
        if changes.updates:
            title, message = _update_summary(changes.updates)
            notif = await create_notification(
                db,
                user_id=user_id,
                notif_type=UPDATE_NOTIFICATION_TYPE,
                title=title,
                message=message,
                link=STORE_LINK,
                data={
                    "count": len(changes.updates),
                    "extensions": [
                        {
                            "key": e.key,
                            "name": e.name,
                            "installed_version": e.installed_version,
                            "store_version": e.store_version,
                        }
                        for e in changes.updates[:MAX_LISTED_ITEMS]
                    ],
                },
            )
            if notif:
                created += 1
    return created


async def read_status(db: AsyncSession) -> dict:
    """The cached probe result. Never fetches."""
    row = await _settings_row(db)
    general = (row.general_settings if row else None) or {}
    state = general.get(STATE_SETTING) or {}
    return {
        "checked_at": state.get("checkedAt"),
        "error": state.get("error"),
        "seeded": bool(state.get("seeded")),
        "known_count": len(state.get("knownKeys") or []),
        "pending_updates": dict(state.get("notifiedVersions") or {}),
        "enabled": bool(general.get(ENABLED_SETTING, True)),
    }


async def run_extension_store_check() -> None:
    """One full probe cycle. Opens its own short-lived sessions."""
    from app.database import async_session

    base_url = settings.EXTENSION_STORE_URL.strip()
    if not base_url:
        # No store configured — no request to make and no state worth churning.
        return

    async with async_session() as db:
        if not await extension_notices_enabled(db):
            return

    # No session held across the network round-trip.
    items, error = await fetch_store_catalog_safe(base_url)

    async with async_session() as db:
        created = await record_result(db, items=items, error=error)
        await db.commit()

    if created:
        logger.info("Extension store changes notified to %d administrator(s)", created)
