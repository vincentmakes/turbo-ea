"""Resolve the release notes for *a specific version*, not for "now".

Both update notifications carry the versions they announced in their ``data``
payload — ``{from_version, to_version}`` for ``app_updated``,
``{latest_version}`` for ``app_update_available``. This module turns that pair
back into markdown, so clicking a notification from last spring shows what that
release contained rather than whatever shipped most recently. Before it existed
the dialog asked only "what is the newest thing?", which is right exactly once
and wrong for every notification the bell keeps afterwards.

Notes are **not** frozen into the notification row: ``app_updated`` fans out one
row per user, and a few KB of markdown multiplied by every user and every
upgrade is a table that grows without bound. Resolving on read from the
changelog bundled in the image costs nothing and is what makes shipping that
changelog worthwhile.

Source order, and why:

1. **The bundled changelog** whenever it has the requested version. This covers
   every ``app_updated`` notice (you cannot have upgraded *to* a version the
   image does not describe) and any ``app_update_available`` notice whose
   version has since been installed. No network, so an air-gapped install
   answers identically.
2. **The cached GitHub release body**, only for a version that is not yet
   installed — the one case the local changelog cannot cover, because the file
   on disk describes the running image and nothing newer.
3. **Nothing**, said plainly. A stale notice for a version this instance never
   took and no longer has cached gets an honest empty state rather than some
   other release's notes wearing its version number.
"""

from __future__ import annotations

import re

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import APP_VERSION
from app.services.catalogue_common import version_tuple
from app.services.changelog import read_changelog, section_for, sections_between

#: Versions arrive as query parameters, so they are attacker-controlled text.
#: ``version_tuple`` is deliberately forgiving (it parses "banana" as ``(0,)``),
#: which is right for reading our own changelog and wrong as an input filter —
#: so the shape is pinned here instead, before anything else touches the value.
VERSION_RE = re.compile(r"^\d{1,5}(\.\d{1,5}){0,3}$")


def valid_version(value: str | None) -> bool:
    """True when ``value`` looks like a version we could have published."""
    return bool(value) and bool(VERSION_RE.match(value or ""))


async def resolve_release_notes(
    db: AsyncSession,
    *,
    version: str | None,
    from_version: str | None,
    allow_cached_github: bool,
) -> dict:
    """Notes for ``version`` (spanning back to ``from_version`` when given).

    ``version=None`` reproduces the pre-existing behaviour — the span the most
    recent upgrade covered — so a dialog opened without notification context
    still shows something sensible.

    ``allow_cached_github`` decides whether step 2 above is available to this
    caller; it mirrors the ``admin.settings`` gate on ``/settings/update-status``,
    which is where the cached body is otherwise readable.
    """
    if not version:
        from app.services.upgrade_announce import read_whats_new

        whats_new = await read_whats_new(db)
        return {
            "version": whats_new["version"],
            "from_version": whats_new["from_version"],
            "notes": whats_new["notes"],
            "source": "changelog" if whats_new["notes"] else "none",
            "release_url": None,
            "is_installed": True,
            "current_version": APP_VERSION,
        }

    text = read_changelog()

    # Ask for the landing version's own section *first*, as the test of whether
    # the changelog knows this version at all. `sections_between` treats `upto`
    # as a bound rather than a lookup, so a version the file has never heard of
    # (a release this instance never took) matches everything below it and would
    # hand back the whole changelog — the very failure this module exists to fix.
    landing = section_for(text, version)
    # Then widen to the span: an upgrade usually crosses several releases, and
    # showing only the landing version would hide most of what was announced.
    notes = (sections_between(text, after=from_version, upto=version) or landing) if landing else ""

    release_url: str | None = None
    source = "changelog" if notes else "none"

    if not notes and allow_cached_github:
        from app.services.update_check import read_status

        status = await read_status(db)
        # Only for the exact version the cache holds. Serving the cached body
        # for any other version is precisely the bug this module fixes.
        if status["latest_version"] == version and status["release_notes"]:
            notes = status["release_notes"]
            release_url = status["release_url"]
            source = "github"

    return {
        "version": version,
        "from_version": from_version,
        "notes": notes,
        "source": source,
        "release_url": release_url,
        "is_installed": version_tuple(version) <= version_tuple(APP_VERSION),
        "current_version": APP_VERSION,
    }
