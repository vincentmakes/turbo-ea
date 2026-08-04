"""Persistent one-shot markers for the demo seeders.

``SEED_DEMO=true`` means *"populate this instance on first startup"*, not
*"re-assert the demo content on every boot"*. Without a durable marker each
seeder has to infer "have I run before?" from the data it created — and that
inference breaks the moment a user deletes that data. ``seed_demo_extras``
guarded on *comments*, which cascade-delete with their cards, so an install
that imported a real landscape and removed the NexaTech cards re-created the
demo diagrams, saved reports, surveys and bookmarks on **every** restart
(discussion #905).

The marker lives in the ``app_settings`` singleton's ``general_settings``
JSONB under ``demoSeeded`` as a ``{seeder_key: true}`` map, so:

* each seeder is tracked independently — adding ``SEED_BPM=true`` later to an
  existing demo environment still works;
* deleting seeded content never resurrects it;
* ``RESET_DB=true`` drops ``app_settings`` along with everything else, so a
  genuine reset re-seeds as expected;
* the marker travels with a workspace transfer, which is what you want — a
  cloned instance should not re-seed demo data over the clone.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_settings import AppSettings

MARKER_KEY = "demoSeeded"


async def _get_or_create_settings(db: AsyncSession) -> AppSettings:
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    if row is None:
        row = AppSettings(id="default")
        db.add(row)
        await db.flush()
    return row


async def demo_seed_completed(db: AsyncSession, seeder_key: str) -> bool:
    """True when ``seeder_key`` has already run to completion on this install."""
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    markers = general.get(MARKER_KEY) or {}
    return bool(markers.get(seeder_key))


async def mark_demo_seed_completed(db: AsyncSession, seeder_key: str) -> None:
    """Record that ``seeder_key`` has run, so it never runs again.

    Does **not** commit — the caller owns the transaction. Reassigns the JSONB
    column wholesale because SQLAlchemy does not track in-place mutation of a
    plain ``dict`` value.
    """
    row = await _get_or_create_settings(db)
    general = dict(row.general_settings or {})
    markers = dict(general.get(MARKER_KEY) or {})
    if markers.get(seeder_key):
        return
    markers[seeder_key] = True
    general[MARKER_KEY] = markers
    row.general_settings = general
    await db.flush()
