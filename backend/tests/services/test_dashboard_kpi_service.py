"""Generic dashboard KPI snapshots and the shared ``trend_for`` arithmetic."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

from app.models.dashboard import Dashboard, DashboardKpiSnapshot
from app.services.card_read_scope import CardReadScope
from app.services.dashboard_kpi_service import (
    as_metric_number,
    capture_dashboard_kpis,
    capture_for_queries,
    clamp_days,
    kpi_history,
    kpi_queries,
    kpi_with_trend,
    pick_comparison,
)
from app.services.dashboard_query import DashboardQuery, resolve_query
from app.services.kpi_snapshot_service import trend_for
from tests.conftest import create_card, create_card_type

Q = DashboardQuery
TODAY = datetime.now(timezone.utc).date()
RESTRICTED = CardReadScope(
    role_key="r",
    wildcard=False,
    base_view=True,
    denied_types=frozenset({"Secret"}),
    allowed_types=frozenset(),
    stakeholder_card_ids=frozenset(),
)


class TestTrendFor:
    def test_without_a_snapshot(self):
        assert trend_for(10, None, None) == {
            "current": 10,
            "previous": None,
            "delta_abs": None,
            "delta_pct": None,
            "comparison_days": 30,
            "snapshot_date": None,
            "snapshot_available": False,
        }
        assert trend_for(10, None, None, preferred_days=7)["comparison_days"] == 7

    def test_counts_keep_an_int_delta(self):
        then = TODAY - timedelta(days=12)
        trend = trend_for(12, 8, then)
        assert trend["delta_abs"] == 4
        assert isinstance(trend["delta_abs"], int)
        assert trend["delta_pct"] == 50.0
        assert trend["comparison_days"] == 12
        assert trend["snapshot_date"] == then.isoformat()
        assert trend["snapshot_available"] is True

    def test_floats_round_to_one_decimal(self):
        trend = trend_for(10.26, 10.0, TODAY - timedelta(days=3))
        assert trend["delta_abs"] == 0.3
        assert trend["delta_pct"] == 2.6

    def test_a_same_day_baseline_reads_one_day_and_a_zero_has_no_percentage(self):
        trend = trend_for(5, 0, TODAY)
        assert trend["comparison_days"] == 1
        assert trend["delta_pct"] is None
        assert trend["delta_abs"] == 5


class TestPureHelpers:
    def test_kpi_queries_picks_generic_kpis_only(self):
        widgets = [
            {"type": "kpi", "config": {"metric": "total_cards"}},
            {"type": "kpi", "config": {"query": {"card_type": "Application"}}},
            {"type": "chart", "config": {"query": {"group_by": "type"}}},
            {"type": "kpi", "config": {"query": {"bogus": 1}}},
            {"type": "kpi", "config": "junk"},
            "junk",
        ]
        assert kpi_queries(widgets) == [Q(card_type="Application")]
        assert kpi_queries(None) == []

    def test_pick_comparison_prefers_the_closest_then_the_older(self):
        rows = [
            (TODAY - timedelta(days=1), 1.0),
            (TODAY - timedelta(days=29), 2.0),
            (TODAY - timedelta(days=31), 3.0),
        ]
        assert pick_comparison(rows, TODAY) == rows[2]
        assert pick_comparison(rows[:1], TODAY) == rows[0]
        assert pick_comparison([], TODAY) is None
        assert pick_comparison(rows, TODAY, days_ago=0) == rows[0]

    def test_as_metric_number(self):
        assert as_metric_number(4.0, "count") == 4
        assert isinstance(as_metric_number(4.0, "count"), int)
        assert as_metric_number(4.5, "avg") == 4.5

    def test_clamp_days(self):
        assert clamp_days(0) == 1
        assert clamp_days(90) == 90
        assert clamp_days(9999) == 365


async def _seed(db):
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="Secret", label="Secret")
    await create_card(db, card_type="Application", name="A")
    await create_card(db, card_type="Application", name="B")
    await create_card(db, card_type="Secret", name="S")


async def _snapshots(db):
    rows = (await db.execute(select(DashboardKpiSnapshot))).scalars().all()
    return sorted((r.snapshot_date, r.metric_key, r.value) for r in rows)


class TestCapture:
    async def test_capture_is_landscape_wide_and_idempotent(self, db):
        await _seed(db)
        queries = [Q(card_type="Application"), Q(), Q(card_type="Application")]
        assert await capture_for_queries(db, queries) == {"card_type=Application": 2.0, "": 3.0}
        await create_card(db, card_type="Application", name="C")
        assert await capture_for_queries(db, queries) == {"card_type=Application": 3.0, "": 4.0}
        assert await _snapshots(db) == [
            (TODAY, "", 4.0),
            (TODAY, "card_type=Application", 3.0),
        ]

    async def test_an_unanswerable_query_is_skipped(self, db):
        await _seed(db)
        assert await capture_for_queries(db, [Q(card_type="Gone"), Q(group_by="nope")]) == {}
        assert await _snapshots(db) == []

    async def test_capture_dashboard_kpis_reads_every_dashboard(self, db):
        await _seed(db)
        db.add(
            Dashboard(
                key="d1",
                name="D1",
                widgets=[
                    {"id": "k", "type": "kpi", "config": {"query": {"card_type": "Secret"}}},
                    {"id": "p", "type": "kpi", "config": {"metric": "total_cards"}},
                ],
            )
        )
        await db.flush()
        day = date(2026, 1, 15)
        assert await capture_dashboard_kpis(db, snapshot_date=day) == {"card_type=Secret": 1.0}
        assert await _snapshots(db) == [(day, "card_type=Secret", 1.0)]


class TestKpiWithTrend:
    async def test_an_unrestricted_reader_gets_the_trend(self, db):
        await _seed(db)
        db.add(
            DashboardKpiSnapshot(
                snapshot_date=TODAY - timedelta(days=30),
                metric_key="card_type=Application",
                value=1,
            )
        )
        await db.flush()
        resolved = await resolve_query(db, Q(card_type="Application"))
        result = await kpi_with_trend(db, resolved, CardReadScope.everything())
        assert result["value"] == 2
        assert result["trend"]["previous"] == 1
        assert result["trend"]["delta_abs"] == 1
        assert result["trend"]["delta_pct"] == 100.0
        assert result["trend"]["comparison_days"] == 30

    async def test_no_snapshot_yet(self, db):
        await _seed(db)
        resolved = await resolve_query(db, Q())
        result = await kpi_with_trend(db, resolved, CardReadScope.everything())
        assert result["value"] == 3
        assert result["trend"]["snapshot_available"] is False
        assert result["trend"]["previous"] is None

    async def test_a_restricted_reader_gets_their_count_and_no_trend(self, db):
        await _seed(db)
        resolved = await resolve_query(db, Q())
        assert await kpi_with_trend(db, resolved, RESTRICTED) == {"value": 2, "trend": None}


class TestHistory:
    async def test_points_in_the_window_oldest_first(self, db):
        await _seed(db)
        for days_ago, value in ((100, 1), (20, 2), (5, 3)):
            db.add(
                DashboardKpiSnapshot(
                    snapshot_date=TODAY - timedelta(days=days_ago), metric_key="", value=value
                )
            )
        db.add(DashboardKpiSnapshot(snapshot_date=TODAY, metric_key="other", value=9))
        await db.flush()
        resolved = await resolve_query(db, Q())
        points = await kpi_history(db, resolved, CardReadScope.everything(), days=90)
        assert points == [
            {"date": (TODAY - timedelta(days=20)).isoformat(), "value": 2},
            {"date": (TODAY - timedelta(days=5)).isoformat(), "value": 3},
        ]
        assert len(await kpi_history(db, resolved, CardReadScope.everything(), days=365)) == 3
        assert await kpi_history(db, resolved, RESTRICTED) == []
