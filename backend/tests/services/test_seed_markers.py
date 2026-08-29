"""Guard tests for the one-shot demo-seed markers.

``SEED_DEMO=true`` means *"populate this instance on first startup"*, not
*"re-assert the demo content on every boot"*. Before the marker existed each
seeder inferred "have I run before?" from the data it had created, and that
inference broke the moment a user deleted that data:

``seed_extras_demo_data`` guarded on **comments**, which cascade-delete with
their cards. An install that imported a real landscape and removed the NexaTech
demo cards therefore had no comments, could create none (the seeder's comment
loop is card-keyed and found no targets), and so re-created the three demo
diagrams — plus the saved reports, surveys and bookmarks — on **every single
restart**, accumulating a fresh copy each time (discussion #905).

These tests pin the two properties that make that impossible now:

1. the marker survives deletion of the seeded content, and
2. an install that seeded *before* the marker existed adopts it rather than
   seeding a second copy.
"""

from __future__ import annotations

from sqlalchemy import delete, select

from app.models.app_settings import AppSettings
from app.models.comment import Comment
from app.models.diagram import Diagram
from app.models.saved_report import SavedReport
from app.services.seed_demo_extras import SEEDER_KEY, seed_extras_demo_data
from app.services.seed_demo_logos import SEEDER_KEY as LOGOS_SEEDER_KEY
from app.services.seed_demo_logos import seed_logo_demo_data
from app.services.seed_demo_workspace import SEEDER_KEY as WORKSPACE_SEEDER_KEY
from app.services.seed_demo_workspace import seed_workspace_demo_data
from app.services.seed_markers import (
    MARKER_KEY,
    demo_seed_completed,
    mark_demo_seed_completed,
)
from tests.conftest import create_user


async def _marker_map(db) -> dict:
    row = (await db.execute(select(AppSettings).where(AppSettings.id == "default"))).scalar_one()
    return (row.general_settings or {}).get(MARKER_KEY) or {}


# ---------------------------------------------------------------------------
# The marker primitive
# ---------------------------------------------------------------------------


async def test_marker_round_trips(db) -> None:
    assert await demo_seed_completed(db, "base") is False
    await mark_demo_seed_completed(db, "base")
    assert await demo_seed_completed(db, "base") is True


async def test_marker_is_per_seeder(db) -> None:
    """Adding SEED_BPM=true to an existing demo environment must still work —
    each seeder is tracked independently."""
    await mark_demo_seed_completed(db, "base")
    assert await demo_seed_completed(db, "bpm") is False


async def test_marker_write_is_idempotent_and_preserves_siblings(db) -> None:
    row = AppSettings(id="default", general_settings={"currency": "EUR"})
    db.add(row)
    await db.flush()

    await mark_demo_seed_completed(db, "base")
    await mark_demo_seed_completed(db, "base")
    await mark_demo_seed_completed(db, "extras")

    assert await _marker_map(db) == {"base": True, "extras": True}
    # Unrelated settings must survive the JSONB reassignment.
    refreshed = (
        await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    ).scalar_one()
    assert refreshed.general_settings["currency"] == "EUR"


# ---------------------------------------------------------------------------
# The extras seeder — the one that actually shipped the bug
# ---------------------------------------------------------------------------


async def test_extras_seeder_marks_itself_on_success(db) -> None:
    await create_user(db, email="admin@test.com", role="admin")
    result = await seed_extras_demo_data(db)
    assert not result.get("skipped"), result
    assert await demo_seed_completed(db, SEEDER_KEY) is True


async def test_extras_seeder_does_not_re_create_deleted_content(db) -> None:
    """The #905 scenario, end to end.

    Seed, then delete every comment (what a cascade-delete of the demo cards
    does) and every diagram the seeder created — exactly the state the customer
    was in. A second run must be a no-op, not a fresh copy.
    """
    await create_user(db, email="admin@test.com", role="admin")
    first = await seed_extras_demo_data(db)
    assert not first.get("skipped"), first
    assert first["diagrams"] > 0

    await db.execute(delete(Comment))
    await db.execute(delete(Diagram))
    await db.flush()

    second = await seed_extras_demo_data(db)
    assert second.get("skipped") is True
    assert second["reason"] == "already seeded"
    assert (await db.execute(select(Diagram))).scalars().all() == []


async def test_pre_marker_install_adopts_the_marker_without_reseeding(db) -> None:
    """An install that seeded before this fix shipped has content but no marker.

    Its next boot must adopt the marker and add nothing — the run is allowed to
    proceed (the legacy comment inference cannot fire on a landscape whose demo
    cards are gone, which is the whole bug), but the per-section guards make it
    a no-op and the marker it records ends the cycle for good.
    """
    await create_user(db, email="admin@test.com", role="admin")
    await seed_extras_demo_data(db)
    diagrams_before = len((await db.execute(select(Diagram))).scalars().all())
    reports_before = len((await db.execute(select(SavedReport))).scalars().all())

    # Roll back to the pre-fix world: content present, marker absent.
    row = (await db.execute(select(AppSettings).where(AppSettings.id == "default"))).scalar_one()
    general = dict(row.general_settings or {})
    general.pop(MARKER_KEY, None)
    row.general_settings = general
    await db.flush()

    result = await seed_extras_demo_data(db)
    # Nothing new landed, and the marker is now recorded...
    assert result.get("diagrams") == 0
    assert result.get("saved_reports") == 0
    assert await demo_seed_completed(db, SEEDER_KEY) is True
    assert len((await db.execute(select(Diagram))).scalars().all()) == diagrams_before
    assert len((await db.execute(select(SavedReport))).scalars().all()) == reports_before

    # ...so the boot after that skips outright — the loop is broken.
    assert (await seed_extras_demo_data(db)).get("skipped") is True


async def test_partial_reseed_tops_up_without_duplicating(db) -> None:
    """Belt-and-braces for an install already carrying duplicates: with the
    marker cleared AND the comments gone (the exact broken state), the
    name-keyed per-section guards must not add a second copy of a diagram or
    saved report that is already present."""
    await create_user(db, email="admin@test.com", role="admin")
    await seed_extras_demo_data(db)
    names_before = sorted(n for (n,) in (await db.execute(select(Diagram.name))).all())

    row = (await db.execute(select(AppSettings).where(AppSettings.id == "default"))).scalar_one()
    general = dict(row.general_settings or {})
    general.pop(MARKER_KEY, None)
    row.general_settings = general
    await db.execute(delete(Comment))
    await db.flush()

    result = await seed_extras_demo_data(db)
    assert result.get("diagrams") == 0
    assert result.get("saved_reports") == 0
    names_after = sorted(n for (n,) in (await db.execute(select(Diagram.name))).all())
    assert names_after == names_before


# ---------------------------------------------------------------------------
# Every seeder key is distinct, and the newer seeders honour the same contract
# ---------------------------------------------------------------------------


def test_seeder_keys_are_distinct() -> None:
    """Two seeders sharing a key would silently disable one of them: whichever
    ran second would find the marker already set and skip for good."""
    from app.services.seed_demo import SEEDER_KEY as BASE
    from app.services.seed_demo_bpm import SEEDER_KEY as BPM
    from app.services.seed_demo_ppm import SEEDER_KEY as PPM
    from app.services.seed_demo_security import SEEDER_KEY as SECURITY

    keys = [BASE, BPM, PPM, SEEDER_KEY, SECURITY, LOGOS_SEEDER_KEY, WORKSPACE_SEEDER_KEY]
    assert len(keys) == len(set(keys)), f"duplicate seeder keys: {keys}"


async def test_logo_seeder_does_not_re_create_deleted_logos(db) -> None:
    """Deleting a demo logo is permanent, like every other piece of demo data."""
    from app.models.card_logo import CardLogo
    from app.services.seed_demo_logos import BRAND_LOGOS

    await create_user(db, role="admin")
    await _card_type_with_logos(db)
    await _card(db, BRAND_LOGOS[0][0])
    await db.commit()

    first = await seed_logo_demo_data(db)
    assert first.get("skipped") is not True
    assert LOGOS_SEEDER_KEY in await _marker_map(db)

    await db.execute(delete(CardLogo))
    await db.commit()

    again = await seed_logo_demo_data(db)
    assert again["skipped"] is True
    assert (await db.execute(select(CardLogo))).scalars().all() == []


async def test_workspace_seeder_does_not_re_create_deleted_portals(db) -> None:
    from app.models.web_portal import WebPortal

    await create_user(db, role="admin")
    await db.commit()

    first = await seed_workspace_demo_data(db)
    assert first.get("skipped") is not True
    assert WORKSPACE_SEEDER_KEY in await _marker_map(db)

    await db.execute(delete(WebPortal))
    await db.commit()

    again = await seed_workspace_demo_data(db)
    assert again["skipped"] is True
    assert (await db.execute(select(WebPortal))).scalars().all() == []


async def _card_type_with_logos(db):
    from tests.conftest import create_card_type

    return await create_card_type(db, key="Application", label="Application", allow_card_logo=True)


async def _card(db, name: str):
    from tests.conftest import create_card

    return await create_card(db, card_type="Application", name=name)
