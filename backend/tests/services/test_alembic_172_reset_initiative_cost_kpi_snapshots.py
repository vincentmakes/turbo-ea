"""Migration 172: forget the KPI history of Initiative cost tiles counted the old way.

Before 2.203.2 a dashboard Sum / Average of an Initiative's ``costBudget`` /
``costActual`` read the all-years total the PPM cost sync stores; it now reads
the current fiscal year's PPM lines. The daily snapshots captured the old way
would draw a false drop on the day the release lands, so the migration deletes
those rows — only for the field whose PPM lines exist, so an install that never
used PPM keeps its history. The pure planner is pinned here, and the upgrade is
run against the test database through the same function ``upgrade()`` calls.
"""

from __future__ import annotations

import importlib.util
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import select

from app.models.dashboard import DashboardKpiSnapshot
from app.services.dashboard_query import DashboardQuery, metric_key
from tests.conftest import create_budget_line, create_card, create_card_type, create_cost_line

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "172_reset_initiative_cost_kpi_snapshots.py"
)
_spec = importlib.util.spec_from_file_location("mig172", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def key(**fields) -> str:
    """The key the running app stores a KPI's history under."""
    return metric_key(DashboardQuery(**fields))


BUDGET_SUM = key(card_type="Initiative", metric="sum", metric_field="costBudget")
BUDGET_AVG = key(card_type="Initiative", metric="avg", metric_field="costBudget")
ACTUAL_SUM = key(card_type="Initiative", metric="sum", metric_field="costActual")
ACTUAL_FILTERED = key(
    card_type="Initiative",
    metric="sum",
    metric_field="costActual",
    subtype="Project",
    flags="stale",
)
INIT_COUNT = key(card_type="Initiative")
APP_BUDGET = key(card_type="Application", metric="sum", metric_field="costBudget")
OTHER_FIELD = key(card_type="Initiative", metric="sum", metric_field="costForecast")
SHARE = key(card_type="Initiative", metric="share", flags="stale")
ALL = [
    BUDGET_SUM,
    BUDGET_AVG,
    ACTUAL_SUM,
    ACTUAL_FILTERED,
    INIT_COUNT,
    APP_BUDGET,
    OTHER_FIELD,
    SHARE,
    "",
    "not a query &&==",
]


def test_revision_chain():
    assert mig.revision == "172"
    assert mig.down_revision == "171"


def test_the_migration_imports_no_app_code():
    source = _MIG_PATH.read_text()
    assert "from app" not in source
    assert "import app" not in source


class TestStaleKeys:
    def test_both_kinds_of_lines_reset_both_fields(self):
        assert mig.stale_keys(ALL, has_budget_lines=True, has_cost_lines=True) == [
            BUDGET_SUM,
            BUDGET_AVG,
            ACTUAL_SUM,
            ACTUAL_FILTERED,
        ]

    def test_only_the_field_whose_lines_exist(self):
        assert mig.stale_keys(ALL, has_budget_lines=True, has_cost_lines=False) == [
            BUDGET_SUM,
            BUDGET_AVG,
        ]
        assert mig.stale_keys(ALL, has_budget_lines=False, has_cost_lines=True) == [
            ACTUAL_SUM,
            ACTUAL_FILTERED,
        ]

    def test_no_lines_keeps_every_history(self):
        assert mig.stale_keys(ALL, has_budget_lines=False, has_cost_lines=False) == []

    def test_count_and_other_types_and_fields_are_kept(self):
        kept = [INIT_COUNT, APP_BUDGET, OTHER_FIELD, SHARE, "", "not a query &&=="]
        assert mig.stale_keys(kept, has_budget_lines=True, has_cost_lines=True) == []

    def test_a_repeated_field_is_not_an_initiative_cost_metric(self):
        doubled = "card_type=Initiative&metric=sum&metric_field=costBudget&metric_field=x"
        assert mig.stale_keys([doubled], has_budget_lines=True, has_cost_lines=True) == []


async def _snapshot(db, metric: str, day: date, value: float = 1.0) -> None:
    db.add(DashboardKpiSnapshot(snapshot_date=day, metric_key=metric, value=value))
    await db.flush()


async def _keys(db) -> list[str]:
    rows = await db.execute(
        select(DashboardKpiSnapshot.metric_key).order_by(
            DashboardKpiSnapshot.metric_key, DashboardKpiSnapshot.snapshot_date
        )
    )
    return list(rows.scalars().all())


async def _upgrade(db) -> None:
    conn = await db.connection()
    await conn.run_sync(mig.reset_snapshots)


@pytest.fixture
async def snapshots(db):
    for metric in (BUDGET_SUM, BUDGET_AVG, ACTUAL_SUM, INIT_COUNT, APP_BUDGET, OTHER_FIELD):
        await _snapshot(db, metric, date(2026, 11, 10))
        await _snapshot(db, metric, date(2026, 11, 11))
    await create_card_type(db, key="Initiative", label="Initiative")
    return await create_card(db, card_type="Initiative", name="Programme")


async def test_the_upgrade_deletes_the_rows_of_the_fields_with_lines(db, snapshots):
    await create_budget_line(db, initiative_id=snapshots.id, fiscal_year=2026, amount=1.0)
    await _upgrade(db)
    remaining = set(await _keys(db))
    assert remaining == {ACTUAL_SUM, INIT_COUNT, APP_BUDGET, OTHER_FIELD}
    assert len(await _keys(db)) == 8

    await create_cost_line(db, initiative_id=snapshots.id, actual=1.0)
    await _upgrade(db)
    assert set(await _keys(db)) == {INIT_COUNT, APP_BUDGET, OTHER_FIELD}


async def test_the_upgrade_keeps_everything_without_ppm_lines(db, snapshots):
    before = await _keys(db)
    await _upgrade(db)
    assert await _keys(db) == before
    assert len(before) == 12
