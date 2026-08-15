"""Tell every user what changed, once, after the instance is upgraded.

The update-available check (``app/services/update_check.py``) tells
administrators that a newer release *exists*. This is the other half: once the
upgrade has actually landed, everyone who uses the instance gets one bell
notification saying so, and can read the changelog for the versions they
skipped without leaving the app.

Marker discipline mirrors ``run_dq_rescore_once`` in ``app/main.py`` — the
announcement is a one-shot keyed on a value in ``app_settings``, so a restart,
a crash loop, or ten boots on the same version all produce exactly one
notification. Four cases never notify:

* **Fresh install.** No marker at all means this instance has no history to
  announce; record the version and stay quiet.
* **Same version.** An ordinary restart.
* **Rollback.** Running an older image than the marker is a deliberate act by
  an operator, not news for users.
* **Announcements switched off.** The marker still advances — otherwise
  re-enabling the toggle months later would replay a long-past upgrade.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import APP_VERSION
from app.models.app_settings import AppSettings
from app.services.app_identity import get_app_title
from app.services.catalogue_common import version_tuple
from app.services.notification_service import notify_all_users

logger = logging.getLogger(__name__)

#: ``app_settings.general_settings`` keys owned by this module.
LAST_ANNOUNCED_KEY = "lastAnnouncedVersion"
ANNOUNCED_FROM_KEY = "announcedFromVersion"
ENABLED_SETTING = "announceUpgradesEnabled"

NOTIFICATION_TYPE = "app_updated"


async def _get_or_create_row(db: AsyncSession) -> AppSettings:
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    if row is None:
        row = AppSettings(id="default", email_settings={}, general_settings={})
        db.add(row)
        await db.flush()
    return row


def _store(row: AppSettings, **values: str | None) -> None:
    """Write keys onto ``general_settings``, reassigning so SQLAlchemy sees it."""
    general = dict(row.general_settings or {})
    general.update(values)
    row.general_settings = general


async def announce_upgrade_if_needed(db: AsyncSession) -> int | None:
    """Notify every user when this boot is the first on a newer version.

    Returns the number of users notified, or ``None`` when there was nothing to
    announce. Does not commit — the caller owns the transaction.
    """
    row = await _get_or_create_row(db)
    general = row.general_settings or {}
    previous = general.get(LAST_ANNOUNCED_KEY)

    if not previous:
        # First boot on this database: nothing happened *to* this instance yet.
        _store(row, **{LAST_ANNOUNCED_KEY: APP_VERSION})
        return None

    if version_tuple(APP_VERSION) <= version_tuple(previous):
        # Restart on the same version, or a deliberate rollback.
        _store(row, **{LAST_ANNOUNCED_KEY: APP_VERSION})
        return None

    if not general.get(ENABLED_SETTING, True):
        # Advance the marker anyway: re-enabling later must not replay this.
        _store(row, **{LAST_ANNOUNCED_KEY: APP_VERSION})
        logger.info("Upgrade to %s not announced — announcements are disabled", APP_VERSION)
        return None

    notified = await notify_all_users(
        db,
        notif_type=NOTIFICATION_TYPE,
        # The instance's own name, not the product's — see app_identity.
        title=f"{get_app_title()} was updated to {APP_VERSION}",
        message=f"Updated from {previous}. Open to see what changed in this release.",
        data={"from_version": previous, "to_version": APP_VERSION},
    )

    _store(
        row,
        **{LAST_ANNOUNCED_KEY: APP_VERSION, ANNOUNCED_FROM_KEY: previous},
    )
    return notified


async def read_whats_new(db: AsyncSession) -> dict:
    """The changelog span the current announcement covers.

    Reads the bundled changelog rather than any network source, so it answers
    the same on an air-gapped install. When no upgrade has been announced yet
    (a fresh install), it falls back to the notes for the running version alone
    — a user who opens the dialog from a stale notification still sees
    something sensible rather than an empty panel.
    """
    from app.services.changelog import read_changelog, section_for, sections_between

    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    came_from = general.get(ANNOUNCED_FROM_KEY)

    text = read_changelog()
    notes = (
        sections_between(text, after=came_from, upto=APP_VERSION)
        if came_from
        else section_for(text, APP_VERSION)
    )
    if not notes:
        # The span produced nothing — a changelog that predates those versions,
        # or a version with no section. Show the running version alone rather
        # than an empty panel.
        notes = section_for(text, APP_VERSION)

    return {
        "version": APP_VERSION,
        "from_version": came_from,
        "notes": notes,
    }
