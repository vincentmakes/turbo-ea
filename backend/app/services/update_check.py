"""Daily probe for a newer published Turbo EA release.

Awareness only. This module never pulls an image, never restarts anything and
never touches the host — the backend container has no Docker socket and must
not get one. All it does is compare the running ``APP_VERSION`` against the
newest release published by ``.github/workflows/github-release.yml`` and, when
that release is newer, drop one in-app notification into the bell of every user
whose role can act on it. Upgrading stays the reviewed, backed-up, maintenance
-window change described in ``docs/admin/operations.md``.

Three properties worth preserving:

* **Once per version, not once per day.** The version last notified about is
  persisted, so a landscape that stays a release behind for a month produces
  one notification, not thirty.
* **Silent when it cannot reach GitHub.** Air-gapped and egress-restricted
  installs record the error and carry on, exactly like
  ``extensions.license_refresh`` does with an unreachable store.
* **Off means off.** ``updateCheckEnabled`` is read *before* the HTTP call, so
  disabling it stops the outbound request itself rather than just muting the
  notification.

Session discipline matters here (see CLAUDE.md, guarded by
``tests/services/test_db_session_holding.py``): read the settings on a short
session, close it, make the network round-trip holding nothing, then reopen a
session for the writes. A single session wrapped around the fetch would pin one
of the pool's ~30 connections inside an open transaction for the length of a
network timeout.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import APP_VERSION
from app.models.app_settings import AppSettings
from app.services.app_identity import get_app_title
from app.services.catalogue_common import now_iso, version_tuple
from app.services.notification_recipients import users_with_permission
from app.services.notification_service import create_notification

logger = logging.getLogger(__name__)

# Baked-in on purpose: the release feed of the product itself, not a per-install
# choice. Operators who want the probe gone turn it off with the setting below
# rather than repointing it somewhere else.
GITHUB_LATEST_RELEASE_URL = "https://api.github.com/repos/vincentmakes/turbo-ea/releases/latest"

RELEASE_FETCH_TIMEOUT_SECONDS = 10.0

#: The release body lands in the singleton settings row, which every settings
#: read touches, so it is capped rather than stored at whatever length GitHub
#: returns. Real Turbo EA release notes run to a few KB.
MAX_RELEASE_NOTES_CHARS = 20_000

#: ``app_settings.general_settings`` keys owned by this module.
ENABLED_SETTING = "updateCheckEnabled"
STATE_SETTING = "updateCheck"

NOTIFICATION_TYPE = "app_update_available"

#: The permission that defines "someone who can act on an available update".
#: Deliberately an RBAC lookup rather than ``user.role == "admin"`` — a custom
#: role holding ``admin.settings`` is just as much an operator.
ADMIN_PERMISSION = "admin.settings"


@dataclass(frozen=True)
class ReleaseInfo:
    """What we keep out of a GitHub release.

    ``notes`` is the release body — the CHANGELOG section for that version,
    cut by ``.github/workflows/github-release.yml``. It is stored alongside the
    version so the in-app release-notes dialog renders from cache: an admin
    reading the notes costs no outbound request, and the notes stay readable
    after the feed becomes unreachable.
    """

    version: str
    url: str
    notes: str = ""


async def _settings_row(db: AsyncSession) -> AppSettings | None:
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    return result.scalar_one_or_none()


async def update_check_enabled(db: AsyncSession) -> bool:
    """Whether the instance is allowed to probe for updates. Defaults to on."""
    row = await _settings_row(db)
    general = (row.general_settings if row else None) or {}
    return bool(general.get(ENABLED_SETTING, True))


async def fetch_latest_release() -> tuple[ReleaseInfo | None, str | None]:
    """Ask GitHub for the newest published release.

    Returns ``(release, error)`` — never raises, because a background loop that
    dies on a DNS hiccup is worse than one that records the hiccup. The
    ``/releases/latest`` endpoint already excludes drafts and pre-releases, so
    no filtering is needed here.
    """
    try:
        async with httpx.AsyncClient(
            timeout=RELEASE_FETCH_TIMEOUT_SECONDS, follow_redirects=True
        ) as client:
            resp = await client.get(
                GITHUB_LATEST_RELEASE_URL,
                headers={
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            )
            resp.raise_for_status()
            payload = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.debug("Update check could not reach GitHub: %s", exc)
        return None, "Could not reach GitHub"

    tag = payload.get("tag_name") if isinstance(payload, dict) else None
    if not isinstance(tag, str) or not tag.strip():
        return None, "Malformed release payload"

    version = tag.strip().lstrip("vV")
    url = payload.get("html_url")
    if not isinstance(url, str) or not url.startswith("https://"):
        # Fall back to the repository's releases page rather than dropping a
        # notification with no changelog to point at.
        url = "https://github.com/vincentmakes/turbo-ea/releases"

    notes = payload.get("body")
    notes = notes.strip() if isinstance(notes, str) else ""
    if len(notes) > MAX_RELEASE_NOTES_CHARS:
        notes = notes[:MAX_RELEASE_NOTES_CHARS].rstrip() + "\n\n…"

    return ReleaseInfo(version=version, url=url, notes=notes), None


def is_newer(latest: str, current: str | None = None) -> bool:
    """``True`` when ``latest`` is a strictly newer version than ``current``.

    ``current`` defaults to the running version, resolved at call time rather
    than bound as a default argument — a default would freeze the value at
    import and could disagree with the ``APP_VERSION`` the notification body
    quotes. ``version_tuple`` degrades unparseable chunks to ``0``, so a
    nonsense tag can never read as an upgrade.
    """
    return version_tuple(latest) > version_tuple(current if current is not None else APP_VERSION)


async def admin_recipient_ids(db: AsyncSession) -> list[uuid.UUID]:
    """Active users whose role grants ``admin.settings`` (or the wildcard)."""
    return await users_with_permission(db, ADMIN_PERMISSION)


async def read_status(db: AsyncSession) -> dict:
    """The cached probe result, shaped for the release-notes dialog.

    Reads only what the last check stored — it never triggers a fetch, so
    opening the dialog costs nothing outbound and works unchanged on an
    instance that has since lost network access.
    """
    row = await _settings_row(db)
    general = (row.general_settings if row else None) or {}
    state = general.get(STATE_SETTING) or {}

    # This comes back out of JSONB, so it is only a version string by
    # convention — anything could be in there. Narrow before comparing.
    raw_latest = state.get("latestVersion")
    latest = raw_latest if isinstance(raw_latest, str) and raw_latest else None

    return {
        "current_version": APP_VERSION,
        "latest_version": latest,
        "release_url": state.get("releaseUrl"),
        "release_notes": state.get("releaseNotes") or "",
        "checked_at": state.get("checkedAt"),
        "error": state.get("error"),
        "update_available": latest is not None and is_newer(latest),
        "enabled": bool(general.get(ENABLED_SETTING, True)),
    }


async def record_result(
    db: AsyncSession,
    *,
    release: ReleaseInfo | None,
    error: str | None,
) -> int:
    """Persist the probe result and notify admins about a newly seen version.

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
    if release is not None:
        state["latestVersion"] = release.version
        state["releaseUrl"] = release.url
        state["releaseNotes"] = release.notes

    created = 0
    if (
        release is not None
        and is_newer(release.version)
        and state.get("notifiedVersion") != release.version
    ):
        for user_id in await admin_recipient_ids(db):
            notif = await create_notification(
                db,
                user_id=user_id,
                notif_type=NOTIFICATION_TYPE,
                # The instance's own name, not the product's — a white-labelled
                # install should not suddenly say "Turbo EA" once a year.
                title=f"{get_app_title()} {release.version} is available",
                # Kept under the 100 characters the notification bell shows
                # before truncating, so the whole message reads in the popover.
                message=(
                    f"This instance is running {APP_VERSION}. "
                    "Open the release notes to see what changed."
                ),
                link=release.url,
                data={
                    "current_version": APP_VERSION,
                    "latest_version": release.version,
                    "release_url": release.url,
                },
            )
            if notif:
                created += 1
        # Stamped even when every admin has muted the type: the version has
        # been announced as far as this instance is concerned, and re-running
        # the check tomorrow should not retry them.
        state["notifiedVersion"] = release.version

    general[STATE_SETTING] = state
    # Reassign rather than mutate — SQLAlchemy does not track in-place JSONB edits.
    row.general_settings = general
    return created


async def run_update_check() -> None:
    """One full probe cycle. Opens its own short-lived sessions."""
    from app.database import async_session

    async with async_session() as db:
        if not await update_check_enabled(db):
            return

    # No session held across the network round-trip.
    release, error = await fetch_latest_release()

    async with async_session() as db:
        created = await record_result(db, release=release, error=error)
        await db.commit()

    if created:
        logger.info(
            "Update available: %s (running %s) — notified %d administrator(s)",
            release.version if release else "?",
            APP_VERSION,
            created,
        )
