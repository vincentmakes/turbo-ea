"""The app's background maintenance: the three ``_…_once`` bodies on the
test database, the initial KPI snapshot, every ``while True`` loop driven
through exactly one iteration (the delegate called once, the lifespan's
cancellation honoured, the error back-off), and the two one-shot tasks."""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from app import main
from app.models.kpi_snapshot import KpiSnapshot
from app.models.mutation_batch import MutationBatch
from app.models.ops_nonce import OpsRequestNonce
from tests.conftest import create_role, create_user
from tests.seams import one_shot_asyncio

NOW = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)


# ── The bodies ────────────────────────────────────────────────────────────


class TestPurgeMutationBatchesOnce:
    async def test_deletes_past_the_retention_window(self, db, monkeypatch):
        monkeypatch.setattr(main.settings, "MUTATION_BATCH_RETENTION_DAYS", 15)
        db.add_all(
            [
                MutationBatch(tool_name="old", created_at=NOW - timedelta(days=20)),
                MutationBatch(tool_name="edge", created_at=NOW - timedelta(days=15)),
                MutationBatch(tool_name="fresh", created_at=NOW - timedelta(days=1)),
            ]
        )
        await db.flush()
        assert await main._purge_mutation_batches_once(db, now=NOW) == 2
        left = (await db.execute(select(MutationBatch.tool_name))).scalars().all()
        assert left == ["fresh"]
        assert await main._purge_mutation_batches_once(db, now=NOW) == 0  # no commit either

    async def test_the_window_is_never_shorter_than_a_day(self, db, monkeypatch):
        monkeypatch.setattr(main.settings, "MUTATION_BATCH_RETENTION_DAYS", 0)
        db.add_all(
            [
                MutationBatch(tool_name="two days", created_at=NOW - timedelta(days=2)),
                MutationBatch(tool_name="half a day", created_at=NOW - timedelta(hours=12)),
            ]
        )
        await db.flush()
        assert await main._purge_mutation_batches_once(db, now=NOW) == 1
        left = (await db.execute(select(MutationBatch.tool_name))).scalars().all()
        assert left == ["half a day"]


class TestOpsAccessMaintenanceOnce:
    async def test_expires_rescue_accounts_and_old_nonces(self, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        expired = await create_user(db, email="expired@ops.test")
        expired.access_expires_at = NOW - timedelta(hours=1)
        expired.password_setup_token = "tok-expired"
        future = await create_user(db, email="future@ops.test")
        future.access_expires_at = NOW + timedelta(hours=1)
        future.password_setup_token = "tok-future"
        gone = await create_user(db, email="gone@ops.test")
        gone.access_expires_at = NOW - timedelta(days=1)
        gone.is_active = False
        permanent = await create_user(db, email="permanent@ops.test")
        db.add_all(
            [
                OpsRequestNonce(nonce="old", created_at=NOW - timedelta(hours=2)),
                OpsRequestNonce(nonce="fresh", created_at=NOW - timedelta(minutes=10)),
            ]
        )
        await db.flush()

        assert await main._ops_access_maintenance_once(db, now=NOW) == (1, 1)
        assert expired.is_active is False and expired.password_setup_token is None
        assert future.is_active is True and future.password_setup_token == "tok-future"
        assert permanent.is_active is True
        assert (await db.execute(select(OpsRequestNonce.nonce))).scalars().all() == ["fresh"]
        # Idempotent: the deactivated account is not counted again.
        assert await main._ops_access_maintenance_once(db, now=NOW) == (0, 0)

    async def test_a_self_hosted_install_is_a_no_op(self, db):
        assert await main._ops_access_maintenance_once(db) == (0, 0)


class TestEnsureInitialKpiSnapshot:
    async def test_captures_once_then_leaves_the_table_alone(self, db, patched_async_session):
        await main._ensure_initial_kpi_snapshot()
        (first,) = (await db.execute(select(KpiSnapshot))).scalars().all()
        assert first.total_cards == 0
        await main._ensure_initial_kpi_snapshot()
        assert len((await db.execute(select(KpiSnapshot))).scalars().all()) == 1

    async def test_a_failure_is_logged_not_raised(
        self, db, patched_async_session, monkeypatch, caplog
    ):
        monkeypatch.setattr(
            "app.services.kpi_snapshot_service.capture_snapshot",
            AsyncMock(side_effect=RuntimeError("down")),
        )
        with caplog.at_level(logging.ERROR):
            await main._ensure_initial_kpi_snapshot()
        assert "Failed to capture initial KPI snapshot" in caplog.text


# ── One iteration of every loop ───────────────────────────────────────────


def _snapshot():
    return SimpleNamespace(
        snapshot_date=date(2026, 10, 2),
        total_cards=1,
        avg_data_quality=50.0,
        approved_count=0,
        broken_count=0,
    )


# (loop, delegate target, delegate, sleeps recorded, log line on error, sleeps on error)
# The one-shot asyncio returns from the first sleep and raises on the second, so
# a happy iteration records the delay it woke from and the one it was cancelled in.
LOOPS = [
    (
        main._purge_mutation_batches_loop,
        "app.main._purge_mutation_batches_once",
        lambda: AsyncMock(return_value=0),
        [3600, 3600],
        "Error in mutation-batch purge loop",
        [3600, 3600],
    ),
    (
        main._ops_access_maintenance_loop,
        "app.main._ops_access_maintenance_once",
        lambda: AsyncMock(return_value=(0, 0)),
        [3600, 3600],
        "Error in ops access maintenance loop",
        [3600, 3600],
    ),
    (
        main._purge_archived_cards_loop,
        "app.main._purge_archived_cards_once",
        lambda: AsyncMock(return_value=None),
        [3600, 3600],
        "Error in archived card purge loop",
        [3600, 3600],
    ),
    (
        main._kpi_snapshot_loop,
        "app.services.kpi_snapshot_service.capture_snapshot",
        lambda: AsyncMock(return_value=_snapshot()),
        [None, None],  # seconds until 02:00 UTC, twice
        "Error in KPI snapshot loop",
        [None, 3600],  # the back-off
    ),
    (
        main._license_refresh_loop,
        "app.services.extensions.license_refresh.refresh_license_if_due",
        lambda: AsyncMock(return_value=None),
        [120, 86400],
        "Error in extension license refresh loop",
        [120, 86400],
    ),
    (
        main._update_check_loop,
        "app.services.update_check.run_update_check",
        lambda: AsyncMock(return_value=None),
        [180, 86400],
        "Error in update check loop",
        [180, 86400],
    ),
    (
        main._extension_store_check_loop,
        "app.services.extension_store_check.run_extension_store_check",
        lambda: AsyncMock(return_value={}),
        [240, 86400],
        "Error in extension store check loop",
        [240, 86400],
    ),
    (
        main._promote_recurring_tasks_loop,
        "app.services.risk_mitigation_task_service.promote_scheduled_occurrences",
        lambda: AsyncMock(return_value=2),
        [None, None],  # seconds until 03:00 UTC, twice
        "Error in recurring item promotion loop",
        [None, 3600],
    ),
]


def _check_sleeps(actual, expected):
    assert len(actual) == len(expected)
    for got, want in zip(actual, expected, strict=True):
        if want is None:
            assert 0 < got <= 86400  # until the next daily slot
        else:
            assert got == want


@pytest.mark.parametrize(("loop", "target", "delegate", "sleeps", "_m", "_e"), LOOPS)
async def test_each_loop_runs_its_delegate_once_and_honours_cancellation(
    db, patched_async_session, monkeypatch, loop, target, delegate, sleeps, _m, _e
):
    fake_asyncio = one_shot_asyncio()
    monkeypatch.setattr(main, "asyncio", fake_asyncio)
    mock = delegate()
    monkeypatch.setattr(target, mock)
    monkeypatch.setattr(
        "app.services.todo_recurrence_service.promote_scheduled_todos",
        AsyncMock(return_value=1),
    )
    with pytest.raises(asyncio.CancelledError):
        await loop()
    assert mock.await_count == 1
    _check_sleeps(fake_asyncio.sleeps, sleeps)


@pytest.mark.parametrize(("loop", "target", "_d", "_s", "message", "sleeps"), LOOPS)
async def test_each_loop_logs_a_failure_and_goes_on(
    db, patched_async_session, monkeypatch, caplog, loop, target, _d, _s, message, sleeps
):
    fake_asyncio = one_shot_asyncio()
    monkeypatch.setattr(main, "asyncio", fake_asyncio)
    monkeypatch.setattr(target, AsyncMock(side_effect=RuntimeError("down")))
    monkeypatch.setattr(
        "app.services.todo_recurrence_service.promote_scheduled_todos",
        AsyncMock(return_value=0),
    )
    with caplog.at_level(logging.ERROR), pytest.raises(asyncio.CancelledError):
        await loop()
    assert message in caplog.text
    _check_sleeps(fake_asyncio.sleeps, sleeps)


async def test_the_daily_loops_wake_at_their_hour(db, patched_async_session, monkeypatch):
    fake_asyncio = one_shot_asyncio()
    monkeypatch.setattr(main, "asyncio", fake_asyncio)
    monkeypatch.setattr(
        "app.services.kpi_snapshot_service.capture_snapshot", AsyncMock(return_value=_snapshot())
    )
    with pytest.raises(asyncio.CancelledError):
        await main._kpi_snapshot_loop()
    now = datetime.now(timezone.utc)
    target = now.replace(hour=main._KPI_SNAPSHOT_HOUR_UTC, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    assert abs(fake_asyncio.sleeps[0] - (target - now).total_seconds()) < 5


# ── One-shots ─────────────────────────────────────────────────────────────


class TestOneShots:
    async def test_upgrade_announcement_logs_and_swallows(
        self, db, patched_async_session, monkeypatch, caplog
    ):
        announce = AsyncMock(return_value=3)
        monkeypatch.setattr("app.services.upgrade_announce.announce_upgrade_if_needed", announce)
        with caplog.at_level(logging.INFO):
            await main._one_shot_upgrade_announcement()
        assert announce.await_count == 1 and "to 3 user(s)" in caplog.text

        monkeypatch.setattr(
            "app.services.upgrade_announce.announce_upgrade_if_needed",
            AsyncMock(side_effect=RuntimeError("down")),
        )
        await main._one_shot_upgrade_announcement()  # retried next boot, never raised
        assert "Upgrade announcement failed" in caplog.text

        monkeypatch.setattr(
            "app.services.upgrade_announce.announce_upgrade_if_needed",
            AsyncMock(side_effect=asyncio.CancelledError),
        )
        with pytest.raises(asyncio.CancelledError):
            await main._one_shot_upgrade_announcement()

    async def test_data_quality_rescore_logs_and_swallows(
        self, db, patched_async_session, monkeypatch, caplog
    ):
        monkeypatch.setattr(main, "run_dq_rescore_once", AsyncMock(return_value=2))
        with caplog.at_level(logging.INFO):
            await main._one_shot_data_quality_rescore()
        assert "updated 2 card(s)" in caplog.text

        monkeypatch.setattr(main, "run_dq_rescore_once", AsyncMock(side_effect=RuntimeError("x")))
        await main._one_shot_data_quality_rescore()
        assert "One-shot data-quality rescore failed" in caplog.text

        monkeypatch.setattr(
            main, "run_dq_rescore_once", AsyncMock(side_effect=asyncio.CancelledError)
        )
        with pytest.raises(asyncio.CancelledError):
            await main._one_shot_data_quality_rescore()
