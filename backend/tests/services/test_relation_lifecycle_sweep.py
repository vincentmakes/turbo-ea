"""The daily relation lifecycle sweep (``services/relation_lifecycle_sweep.py``).

Time passing is not a write: a relation whose ``active`` or ``endOfLife`` date
arrives changes what a formula's ``relation_count`` and a card's data-quality
score read, and nobody saves anything. The sweep finds those relations and
recalculates both end cards as derived maintenance — no card event, no move
of ``updated_at``.

The window helpers are pure; the rest runs on the test database.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import event as sa_event
from sqlalchemy import select, update

from app.models.app_settings import AppSettings
from app.models.calculation import Calculation
from app.models.card import Card
from app.models.event import Event
from app.services import relation_lifecycle_sweep as sweep
from app.services.data_quality import calc_data_quality
from tests.conftest import (
    create_budget_line,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
)
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

    async def test_each_card_is_its_own_short_transaction(self, land, monkeypatch):
        db = land
        today = _utc_today()
        for i in range(3):
            await _link(db, f"n{i}", {"active": today.isoformat()})
        commits: list[str] = []
        real_commit = db.commit

        async def counting_commit():
            commits.append("commit")
            await real_commit()

        monkeypatch.setattr(db, "commit", counting_commit)
        seen: list[int] = []
        real = sweep.recalculate_card

        async def spy(session, card_id):
            seen.append(len(commits))
            return await real(session, card_id)

        monkeypatch.setattr(sweep, "recalculate_card", spy)
        assert await sweep.run_relation_lifecycle_sweep(session_factory_for(db), today=today) == 6
        # The id read commits first, then one commit per card, then the marker.
        assert seen == [1, 2, 3, 4, 5, 6]
        assert len(commits) == 8

    async def test_nothing_to_do_still_advances_the_marker(self, land):
        db = land
        today = _utc_today()
        assert await sweep.run_relation_lifecycle_sweep(session_factory_for(db), today=today) == 0
        assert await sweep.read_marker(db) == today

    async def test_a_failing_card_does_not_stop_the_others(self, land, monkeypatch, caplog):
        db = land
        today = _utc_today()
        bad, _ = await _link(db, "bad", {"active": today.isoformat()})
        good, _ = await _link(db, "good", {"active": today.isoformat()})
        good.attributes = {"itcCount": 0}
        await db.flush()
        real = sweep.recalculate_card

        async def flaky(session, card_id):
            if card_id == bad.id:
                raise RuntimeError("down")
            return await real(session, card_id)

        monkeypatch.setattr(sweep, "recalculate_card", flaky)
        swept = await sweep.run_relation_lifecycle_sweep(session_factory_for(db), today=today)
        assert swept == 3  # the other three cards
        await db.refresh(good)
        assert good.attributes["itcCount"] == 1
        assert str(bad.id) in caplog.text

    async def test_a_failure_leaves_the_marker_where_it_was(self, land, monkeypatch):
        db = land
        today = _utc_today()
        yesterday = today - timedelta(days=1)
        await sweep.write_marker(db, yesterday)
        await _link(db, "starts", {"active": today.isoformat()})
        calls: list[int] = []

        async def boom(session, card_id):
            calls.append(1)
            raise RuntimeError("down")

        monkeypatch.setattr(sweep, "recalculate_card", boom)
        assert await sweep.run_relation_lifecycle_sweep(session_factory_for(db), today=today) == 0
        assert len(calls) == 2  # both ends were tried
        assert await sweep.read_marker(db) == yesterday
        # The next run repeats the window, and advances once every card succeeds.
        monkeypatch.undo()
        assert await sweep.run_relation_lifecycle_sweep(session_factory_for(db), today=today) == 2
        assert await sweep.read_marker(db) == today

    async def test_a_failed_card_rolls_back_its_own_work_only(self, land, monkeypatch):
        db = land
        today = _utc_today()
        app, _ = await _link(db, "half", {"active": today.isoformat()})
        app.attributes = {"itcCount": 0}
        await db.flush()
        from app.services import card_write_service

        real_rescore = card_write_service.recalculate_and_rescore

        async def half_then_fail(session, card):
            await real_rescore(session, card)
            await session.flush()
            if card.id == app.id:
                raise RuntimeError("after the write")

        monkeypatch.setattr(card_write_service, "recalculate_and_rescore", half_then_fail)
        await sweep.run_relation_lifecycle_sweep(session_factory_for(db), today=today)
        await db.refresh(app)
        assert app.attributes["itcCount"] == 0  # rolled back, not half-written
        assert await sweep.read_marker(db) is None

    async def test_a_card_archived_after_the_listing_is_skipped(self, land, monkeypatch):
        db = land
        today = _utc_today()
        app, itc = await _link(db, "archived", {"active": today.isoformat()})
        app.attributes = {"itcCount": 0}
        await db.flush()
        real = sweep.affected_card_ids

        async def then_archive(session, after, through):
            ids = await real(session, after, through)
            await session.execute(update(Card).where(Card.id == app.id).values(status="ARCHIVED"))
            return ids

        monkeypatch.setattr(sweep, "affected_card_ids", then_archive)
        assert await sweep.run_relation_lifecycle_sweep(session_factory_for(db), today=today) == 1
        await db.refresh(app)
        assert app.attributes["itcCount"] == 0
        # Skipping an archived card is not a failure.
        assert await sweep.read_marker(db) == today

    async def test_an_edit_committed_after_the_listing_is_kept(self, land, monkeypatch):
        # The card is re-read under its lock: the whole `attributes` rewrite
        # starts from what is stored now, not from what was loaded earlier.
        db = land
        today = _utc_today()
        app, _ = await _link(db, "edited", {"active": today.isoformat()})
        app.attributes = {"itcCount": 0, "note": "old"}
        await db.flush()
        real = sweep.affected_card_ids

        async def then_edit(session, after, through):
            ids = await real(session, after, through)
            # Behind the identity map's back, as another request would.
            await session.execute(
                update(Card)
                .where(Card.id == app.id)
                .values(attributes={"itcCount": 0, "note": "edited"})
                .execution_options(synchronize_session=False)
            )
            return ids

        monkeypatch.setattr(sweep, "affected_card_ids", then_edit)
        await sweep.run_relation_lifecycle_sweep(session_factory_for(db), today=today)
        stored = (await db.execute(select(Card.attributes).where(Card.id == app.id))).scalar_one()
        assert stored == {"itcCount": 1, "note": "edited"}

    async def test_a_ppm_owned_field_is_not_overwritten(self, db):
        # A calculation targeting an Initiative's costBudget must not overwrite
        # the value PPM syncs from its budget lines — as on every write path.
        await create_card_type(db, key="Initiative", label="Initiative")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db, key="relInitToITC", source_type_key="Initiative", target_type_key="ITComponent"
        )
        for field in ("costBudget", "itcCount"):
            db.add(
                Calculation(
                    name=field,
                    formula="relation_count.relInitToITC",
                    target_type_key="Initiative",
                    target_field_key=field,
                    is_active=True,
                )
            )
        today = _utc_today()
        init = await create_card(
            db,
            card_type="Initiative",
            name="init",
            attributes={"costBudget": 5000, "itcCount": 0},
        )
        itc = await create_card(db, card_type="ITComponent", name="itc")
        await create_relation(
            db,
            type_key="relInitToITC",
            source_id=init.id,
            target_id=itc.id,
            lifecycle={"active": today.isoformat()},
        )
        await create_budget_line(db, initiative_id=init.id, amount=5000)
        await sweep.run_relation_lifecycle_sweep(session_factory_for(db), today=today)
        await db.refresh(init)
        assert init.attributes["itcCount"] == 1  # the sweep ran the calculations
        assert init.attributes["costBudget"] == 5000  # but left PPM's field alone

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
        assert await sweep.recalculate_card(db, app.id) is False
        assert await sweep.recalculate_card(db, itc.id) is True
        assert await sweep.recalculate_card(db, uuid.uuid4()) is False


async def test_the_relation_rows_themselves_are_not_rewritten(land):
    # `now()` is transaction-constant in a test, so comparing `updated_at`
    # proves nothing: watch the SQL instead. The sweep did real work (the card
    # UPDATEs) and never issued an UPDATE of a relation row.
    db = land
    today = _utc_today()
    app, _ = await _link(db, "starts", {"active": today.isoformat()})
    app.attributes = {"itcCount": 0}
    await db.flush()
    statements: list[str] = []
    bind = db.sync_session.get_bind()

    @sa_event.listens_for(bind, "before_cursor_execute")
    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement.lstrip().upper())

    try:
        await sweep.run_relation_lifecycle_sweep(session_factory_for(db), today=today)
    finally:
        sa_event.remove(bind, "before_cursor_execute", _record)
    assert any(st.startswith("UPDATE CARDS") for st in statements)
    assert not any(st.startswith("UPDATE RELATIONS") for st in statements)
