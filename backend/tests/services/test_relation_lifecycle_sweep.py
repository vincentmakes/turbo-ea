"""The daily relation lifecycle sweep (``services/relation_lifecycle_sweep.py``).

Time passing is not a write: a relation whose ``active`` or ``endOfLife`` date
arrives changes what a formula's ``relation_count`` and a card's data-quality
score read, and nobody saves anything. The sweep finds those relations and
recalculates both end cards as derived maintenance — no card event, no move
of ``updated_at``.

The window helpers are pure; the rest runs on the test database.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.app_settings import AppSettings
from app.models.calculation import Calculation
from app.models.event import Event
from app.models.relation import Relation
from app.services import relation_lifecycle_sweep as sweep
from app.services.data_quality import calc_data_quality
from tests.conftest import create_card, create_card_type, create_relation, create_relation_type
from tests.seams import session_factory_for

DAY = date(2026, 6, 15)


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


# ── the window (pure) ────────────────────────────────────────────────────────


class TestSweepWindow:
    def test_a_first_run_sweeps_today_only(self):
        assert sweep.sweep_window(None, DAY) == (date(2026, 6, 14), DAY)

    def test_a_daily_run_sweeps_one_day(self):
        assert sweep.sweep_window(date(2026, 6, 14), DAY) == (date(2026, 6, 14), DAY)

    def test_a_missed_week_is_caught_up(self):
        assert sweep.sweep_window(date(2026, 6, 8), DAY) == (date(2026, 6, 8), DAY)

    def test_the_catch_up_is_capped(self):
        cap = DAY - timedelta(days=sweep.MAX_CATCH_UP_DAYS)
        assert sweep.MAX_CATCH_UP_DAYS == 366
        assert sweep.sweep_window(date(2020, 1, 1), DAY) == (cap, DAY)
        assert sweep.sweep_window(cap, DAY) == (cap, DAY)
        later = cap + timedelta(days=1)
        assert sweep.sweep_window(later, DAY) == (later, DAY)

    def test_nothing_when_today_is_already_swept(self):
        assert sweep.sweep_window(DAY, DAY) is None

    def test_nothing_when_the_marker_is_ahead_of_the_clock(self):
        assert sweep.sweep_window(DAY + timedelta(days=1), DAY) is None


class TestNextRun:
    def test_five_past_midnight_tomorrow(self):
        now = datetime(2026, 6, 15, 13, 0, tzinfo=timezone.utc)
        assert sweep.seconds_until_next_run(now) == 11 * 3600 + 5 * 60

    def test_before_the_slot_runs_today(self):
        now = datetime(2026, 6, 15, 0, 1, tzinfo=timezone.utc)
        assert sweep.seconds_until_next_run(now) == 4 * 60

    def test_at_the_slot_waits_a_whole_day(self):
        now = datetime(2026, 6, 15, 0, 5, tzinfo=timezone.utc)
        assert sweep.seconds_until_next_run(now) == 86400


# ── the landscape ────────────────────────────────────────────────────────────


@pytest.fixture
async def land(db):
    """Applications counting their IT Components with a formula, and a set of
    relations dated around ``DAY``."""
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_relation_type(
        db, key="relAppToITC", source_type_key="Application", target_type_key="ITComponent"
    )
    db.add(
        Calculation(
            name="ITC count",
            formula="relation_count.relAppToITC",
            target_type_key="Application",
            target_field_key="itcCount",
            is_active=True,
        )
    )
    await db.flush()
    return db


async def _link(db, name, lifecycle, *, status="ACTIVE"):
    app = await create_card(db, card_type="Application", name=f"app-{name}", status=status)
    itc = await create_card(db, card_type="ITComponent", name=f"itc-{name}")
    await create_relation(
        db, type_key="relAppToITC", source_id=app.id, target_id=itc.id, lifecycle=lifecycle
    )
    return app, itc


class TestAffectedCards:
    async def test_the_window_is_open_below_and_closed_above(self, land):
        db = land
        after, through = date(2026, 6, 10), DAY
        hits = {
            "starts-on-the-last-day": {"active": "2026-06-15"},
            "starts-the-day-after-the-marker": {"active": "2026-06-11"},
            "ends-in-the-window": {"active": "2020-01-01", "endOfLife": "2026-06-12"},
            "ends-with-a-time": {"endOfLife": "2026-06-13T08:00:00"},
        }
        misses = {
            "started-on-the-marker-day": {"active": "2026-06-10"},
            "starts-tomorrow": {"active": "2026-06-16"},
            "ended-long-ago": {"endOfLife": "2026-01-01"},
            "plan-date-only": {"plan": "2026-06-12"},
            "phase-out-only": {"phaseOut": "2026-06-12"},
            "undated": {},
            "malformed": {"active": "15/06/2026"},
        }
        expected = set()
        for name, lifecycle in hits.items():
            app, itc = await _link(db, name, lifecycle)
            expected |= {app.id, itc.id}
        for name, lifecycle in misses.items():
            await _link(db, name, lifecycle)
        ids = await sweep.affected_card_ids(db, after, through)
        assert set(ids) == expected
        assert len(ids) == len(expected)  # each card once
        assert ids == sorted(ids)

    async def test_archived_cards_are_skipped(self, land):
        db = land
        app, itc = await _link(db, "gone", {"active": "2026-06-15"}, status="ARCHIVED")
        assert await sweep.affected_card_ids(db, date(2026, 6, 14), DAY) == [itc.id]

    async def test_a_card_at_the_end_of_two_flips_appears_once(self, land):
        db = land
        app, itc = await _link(db, "first", {"active": "2026-06-15"})
        other = await create_card(db, card_type="ITComponent", name="other")
        await create_relation(
            db,
            type_key="relAppToITC",
            source_id=app.id,
            target_id=other.id,
            lifecycle={"endOfLife": "2026-06-15"},
        )
        ids = await sweep.affected_card_ids(db, date(2026, 6, 14), DAY)
        assert sorted(ids) == sorted([app.id, itc.id, other.id])


# ── the marker ───────────────────────────────────────────────────────────────


class TestMarker:
    async def test_absent_until_written(self, db):
        assert await sweep.read_marker(db) is None

    async def test_written_by_key_leaving_every_other_setting(self, db):
        db.add(
            AppSettings(
                id="default",
                general_settings={"fiscalYearStart": 4, "demoSeeded": {"x": True}},
                email_settings={},
            )
        )
        await db.flush()
        await sweep.write_marker(db, DAY)
        assert await sweep.read_marker(db) == DAY
        row = (
            await db.execute(
                select(AppSettings.general_settings).where(AppSettings.id == "default")
            )
        ).scalar_one()
        assert row == {
            "fiscalYearStart": 4,
            "demoSeeded": {"x": True},
            sweep.MARKER_KEY: "2026-06-15",
        }

    async def test_written_without_a_settings_row(self, db):
        await sweep.write_marker(db, DAY)
        await sweep.write_marker(db, DAY + timedelta(days=1))
        assert await sweep.read_marker(db) == DAY + timedelta(days=1)


# ── a whole run ──────────────────────────────────────────────────────────────


class TestRun:
    async def test_both_ends_are_recalculated_and_the_marker_advances(self, land, card_update_sql):
        db = land
        today = _utc_today()
        app, itc = await _link(db, "starts", {"active": today.isoformat()})
        ended_app, _ = await _link(db, "ends", {"endOfLife": today.isoformat()})
        untouched, _ = await _link(db, "old", {"active": "2001-01-01"})
        # Stored values from before the dates arrived.
        app.attributes = {"itcCount": 0}
        ended_app.attributes = {"itcCount": 1}
        untouched.attributes = {"itcCount": 99}
        itc.data_quality = 55.5  # a stale score no canonical rescore produces
        await db.flush()
        events_before = (await db.execute(select(Event.id))).all()
        card_update_sql.clear()

        swept = await sweep.run_relation_lifecycle_sweep(session_factory_for(db), today=today)

        assert swept == 4  # two relations, both ends each
        await db.refresh(app)
        await db.refresh(ended_app)
        await db.refresh(untouched)
        await db.refresh(itc)
        assert app.attributes["itcCount"] == 1
        assert ended_app.attributes["itcCount"] == 0
        assert untouched.attributes["itcCount"] == 99  # outside the window: not touched
        assert itc.data_quality != 55.5
        assert itc.data_quality == await calc_data_quality(db, itc)
        # Derived maintenance: the work was real, and it neither moved
        # updated_at nor wrote a card event.
        assert card_update_sql.statements
        assert not card_update_sql.bumped()
        assert (await db.execute(select(Event.id))).all() == events_before
        assert await sweep.read_marker(db) == today

    async def test_a_second_run_the_same_day_does_nothing(self, land):
        db = land
        today = _utc_today()
        app, _ = await _link(db, "starts", {"active": today.isoformat()})
        factory = session_factory_for(db)
        assert await sweep.run_relation_lifecycle_sweep(factory, today=today) == 2
        app.attributes = {"itcCount": 42}
        await db.flush()
        assert await sweep.run_relation_lifecycle_sweep(factory, today=today) == 0
        await db.refresh(app)
        assert app.attributes["itcCount"] == 42

    async def test_the_next_day_sweeps_from_the_marker(self, land):
        db = land
        today = _utc_today()
        yesterday = today - timedelta(days=1)
        await sweep.write_marker(db, yesterday - timedelta(days=1))
        _app_y, _ = await _link(db, "yesterday", {"active": yesterday.isoformat()})
        await _link(db, "before", {"active": (yesterday - timedelta(days=1)).isoformat()})
        assert await sweep.run_relation_lifecycle_sweep(session_factory_for(db), today=today) == 2
        assert await sweep.read_marker(db) == today

    async def test_cards_are_recalculated_in_batches(self, land, monkeypatch):
        db = land
        today = _utc_today()
        for i in range(3):
            await _link(db, f"n{i}", {"active": today.isoformat()})
        monkeypatch.setattr(sweep, "BATCH_SIZE", 4)
        sizes: list[int] = []
        real = sweep.recalculate_cards

        async def spy(session, ids):
            sizes.append(len(ids))
            return await real(session, ids)

        monkeypatch.setattr(sweep, "recalculate_cards", spy)
        assert await sweep.run_relation_lifecycle_sweep(session_factory_for(db), today=today) == 6
        assert sizes == [4, 2]

    async def test_nothing_to_do_still_advances_the_marker(self, land):
        db = land
        today = _utc_today()
        assert await sweep.run_relation_lifecycle_sweep(session_factory_for(db), today=today) == 0
        assert await sweep.read_marker(db) == today

    async def test_a_failure_leaves_the_marker_where_it_was(self, land, monkeypatch):
        db = land
        today = _utc_today()
        await _link(db, "starts", {"active": today.isoformat()})

        async def boom(session, ids):
            raise RuntimeError("down")

        monkeypatch.setattr(sweep, "recalculate_cards", boom)
        with pytest.raises(RuntimeError):
            await sweep.run_relation_lifecycle_sweep(session_factory_for(db), today=today)
        assert await sweep.read_marker(db) is None

    async def test_the_default_factory_is_the_app_session(self, land, patched_async_session):
        """Called without a factory, it opens the app's own sessions."""
        db = land
        today = _utc_today()
        await _link(db, "starts", {"active": today.isoformat()})
        assert await sweep.run_relation_lifecycle_sweep() == 2
        assert await sweep.read_marker(db) == today

    async def test_recalculate_skips_archived_and_unknown_ids(self, land):
        db = land
        app, itc = await _link(db, "gone", {}, status="ARCHIVED")
        assert await sweep.recalculate_cards(db, [app.id, itc.id]) == 1
        assert await sweep.recalculate_cards(db, []) == 0


async def test_the_relation_rows_themselves_are_not_rewritten(land):
    db = land
    today = _utc_today()
    await _link(db, "starts", {"active": today.isoformat()})
    before = [
        (r.id, r.lifecycle, r.updated_at) for r in (await db.execute(select(Relation))).scalars()
    ]
    await sweep.run_relation_lifecycle_sweep(session_factory_for(db), today=today)
    after = [
        (r.id, r.lifecycle, r.updated_at) for r in (await db.execute(select(Relation))).scalars()
    ]
    assert after == before
