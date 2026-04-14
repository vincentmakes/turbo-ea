"""Unit tests for the KPI snapshot capture and trend helpers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.kpi_snapshot import KpiSnapshot
from app.services.kpi_snapshot_service import (
    capture_snapshot,
    compute_current_kpis,
    compute_trend_block,
    get_comparison_snapshot,
)
from tests.conftest import create_card, create_card_type


async def test_compute_current_kpis(db):
    await create_card_type(db, key="Application", label="Application")
    await create_card(
        db,
        card_type="Application",
        name="A",
        data_quality=80.0,
        approval_status="APPROVED",
    )
    await create_card(
        db,
        card_type="Application",
        name="B",
        data_quality=40.0,
        approval_status="BROKEN",
    )

    kpis = await compute_current_kpis(db)
    assert kpis["total_cards"] == 2
    assert kpis["avg_data_quality"] == 60.0
    assert kpis["approved_count"] == 1
    assert kpis["broken_count"] == 1


async def test_capture_snapshot_creates_row(db):
    await create_card_type(db, key="Application", label="Application")
    await create_card(db, card_type="Application", name="X", data_quality=70.0)

    snap = await capture_snapshot(db)
    assert snap.total_cards == 1
    assert snap.avg_data_quality == 70.0

    rows = (await db.execute(select(KpiSnapshot))).scalars().all()
    assert len(rows) == 1


async def test_capture_snapshot_idempotent(db):
    """A second capture on the same date updates the existing row, not inserts."""
    await create_card_type(db, key="Application", label="Application")
    await create_card(db, card_type="Application", name="X", data_quality=70.0)

    first = await capture_snapshot(db)
    # Add a card and re-capture on the same date.
    await create_card(db, card_type="Application", name="Y", data_quality=30.0)
    second = await capture_snapshot(db)

    rows = (await db.execute(select(KpiSnapshot))).scalars().all()
    assert len(rows) == 1
    assert second.id == first.id
    assert second.total_cards == 2
    assert second.avg_data_quality == 50.0


async def test_get_comparison_snapshot_picks_closest(db):
    today = datetime.now(timezone.utc).date()
    db.add(
        KpiSnapshot(
            snapshot_date=today - timedelta(days=29),
            total_cards=10,
            avg_data_quality=50.0,
            approved_count=2,
            broken_count=1,
        )
    )
    db.add(
        KpiSnapshot(
            snapshot_date=today - timedelta(days=33),
            total_cards=8,
            avg_data_quality=45.0,
            approved_count=1,
            broken_count=0,
        )
    )
    await db.commit()

    snap = await get_comparison_snapshot(db, days_ago=30)
    assert snap is not None
    # 29 days ago is closer to 30 than 33 days ago.
    assert snap.snapshot_date == today - timedelta(days=29)


async def test_get_comparison_snapshot_returns_none_when_empty(db):
    """Empty table → no comparison snapshot."""
    snap = await get_comparison_snapshot(db, days_ago=30)
    assert snap is None


async def test_get_comparison_snapshot_includes_today(db):
    """Today's startup baseline is a valid comparison (min_days=0)."""
    today = datetime.now(timezone.utc).date()
    db.add(
        KpiSnapshot(
            snapshot_date=today,
            total_cards=10,
            avg_data_quality=50.0,
            approved_count=2,
            broken_count=1,
        )
    )
    await db.commit()

    snap = await get_comparison_snapshot(db, days_ago=30)
    assert snap is not None
    assert snap.snapshot_date == today


async def test_get_comparison_snapshot_falls_back_to_oldest_available(db):
    """On a fresh install with only recent snapshots, return the oldest one."""
    today = datetime.now(timezone.utc).date()
    db.add(
        KpiSnapshot(
            snapshot_date=today - timedelta(days=3),
            total_cards=10,
            avg_data_quality=50.0,
            approved_count=2,
            broken_count=1,
        )
    )
    await db.commit()

    snap = await get_comparison_snapshot(db, days_ago=30)
    assert snap is not None
    assert snap.snapshot_date == today - timedelta(days=3)


def test_compute_trend_block_no_previous():
    current = {
        "total_cards": 5,
        "avg_data_quality": 70.0,
        "approved_count": 2,
        "broken_count": 1,
    }
    block = compute_trend_block(current=current, previous=None)
    assert block["snapshot_available"] is False
    assert block["snapshot_date"] is None
    assert block["comparison_days"] == 30
    for key in current:
        assert block[key]["current"] == current[key]
        assert block[key]["previous"] is None
        assert block[key]["delta_abs"] is None
        assert block[key]["delta_pct"] is None


def test_compute_trend_block_handles_zero_previous():
    current = {
        "total_cards": 5,
        "avg_data_quality": 70.0,
        "approved_count": 2,
        "broken_count": 1,
    }
    snapshot = KpiSnapshot(
        snapshot_date=datetime.now(timezone.utc).date() - timedelta(days=30),
        total_cards=0,
        avg_data_quality=0.0,
        approved_count=0,
        broken_count=0,
    )
    block = compute_trend_block(current=current, previous=snapshot)
    assert block["snapshot_available"] is True
    # Percentage change is undefined against a zero baseline, but absolute
    # delta is still meaningful.
    for key in current:
        assert block[key]["delta_pct"] is None
        assert block[key]["previous"] == 0
    assert block["total_cards"]["delta_abs"] == 5
    assert block["avg_data_quality"]["delta_abs"] == 70.0


def test_compute_trend_block_calculates_signed_delta():
    current = {
        "total_cards": 12,
        "avg_data_quality": 90.0,
        "approved_count": 3,
        "broken_count": 1,
    }
    snapshot = KpiSnapshot(
        snapshot_date=datetime.now(timezone.utc).date() - timedelta(days=30),
        total_cards=10,
        avg_data_quality=60.0,
        approved_count=4,
        broken_count=2,
    )
    block = compute_trend_block(current=current, previous=snapshot)
    assert block["comparison_days"] == 30
    assert block["total_cards"]["delta_pct"] == 20.0
    assert block["total_cards"]["delta_abs"] == 2
    assert block["avg_data_quality"]["delta_pct"] == 50.0
    assert block["avg_data_quality"]["delta_abs"] == 30.0
    assert block["approved_count"]["delta_pct"] == -25.0
    assert block["approved_count"]["delta_abs"] == -1
    assert block["broken_count"]["delta_pct"] == -50.0
    assert block["broken_count"]["delta_abs"] == -1


def test_compute_trend_block_uses_actual_snapshot_age():
    """When fallback picks a younger snapshot, comparison_days reflects that."""
    current = {
        "total_cards": 10,
        "avg_data_quality": 70.0,
        "approved_count": 3,
        "broken_count": 1,
    }
    snapshot = KpiSnapshot(
        snapshot_date=datetime.now(timezone.utc).date() - timedelta(days=5),
        total_cards=8,
        avg_data_quality=65.0,
        approved_count=2,
        broken_count=1,
    )
    block = compute_trend_block(current=current, previous=snapshot)
    assert block["comparison_days"] == 5
    assert block["total_cards"]["delta_abs"] == 2
