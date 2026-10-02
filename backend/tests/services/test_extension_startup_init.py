"""Lifespan initialisation of the Extension Store on the test database:
the row reconciliation against what the loader actually loaded, and
``initialize_extensions`` end to end with the migrations, hooks and
starters patched at their binding site."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select

from app.models.extension import Extension
from app.services.extensions import startup
from app.services.extensions.jobs import reset_contexts
from app.services.extensions.loader import FailedExtension, LoadedExtension, LoadReport
from app.services.extensions.registry import extension_registry


class FakeInstance:
    def __init__(self, *, fail: bool = False):
        self.started_with: list = []
        self.fail = fail

    async def on_startup(self, ctx):
        self.started_with.append(ctx)
        if self.fail:
            raise RuntimeError("hook boom")


def _loaded(key: str, instance=None) -> LoadedExtension:
    return LoadedExtension(key=key, manifest={"key": key}, directory=None, instance=instance)  # type: ignore[arg-type]


@pytest.fixture(autouse=True)
def _clean_registry():
    extension_registry.clear()
    reset_contexts()
    yield
    extension_registry.clear()
    reset_contexts()


@pytest.fixture
async def rows(db):
    def row(key, **kw):
        base = dict(
            key=key,
            name=key,
            version="1.0.0",
            manifest={"key": key, "free": True},
            capabilities=["backend"],
            status="installed",
            enabled=True,
        )
        base.update(kw)
        return Extension(**base)

    rows = {
        "ok": row("ok-ext", status="needs_restart", last_error="old"),
        "off": row("off-ext", status="failed", enabled=False, last_error="old"),
        "broken": row("broken-ext"),
        "gone": row("gone-ext", capabilities=["frontend"]),
        "pack": row("pack-ext", capabilities=["content"]),
        "removed": row("removed-ext", status="removed"),
    }
    db.add_all(rows.values())
    await db.flush()
    return rows


@pytest.fixture
def starters(monkeypatch):
    """The per-extension starters, patched where ``startup`` bound them."""
    s = SimpleNamespace(
        migrations=AsyncMock(return_value={}),
        jobs=MagicMock(return_value=["job"]),
        events=MagicMock(return_value=["dispatcher"]),
        channels=MagicMock(return_value=["channel"]),
        types=MagicMock(),
        build_context=lambda key: f"ctx:{key}",
    )
    monkeypatch.setattr(startup, "run_extension_migrations", s.migrations)
    monkeypatch.setattr(startup, "start_extension_jobs", s.jobs)
    monkeypatch.setattr(startup, "start_extension_event_dispatchers", s.events)
    monkeypatch.setattr(startup, "start_notification_channels", s.channels)
    monkeypatch.setattr(startup, "start_notification_types", s.types)
    monkeypatch.setattr(startup, "build_context", s.build_context)
    return s


async def _statuses(db) -> dict[str, tuple[str, str | None]]:
    out = (await db.execute(select(Extension))).scalars().all()
    return {r.key: (r.status, r.last_error) for r in out}


class TestReconcileRows:
    async def test_every_row_follows_the_boot_outcome(self, db, patched_async_session, rows):
        report = LoadReport(
            loaded=[_loaded("ok-ext", FakeInstance()), _loaded("off-ext", FakeInstance())],
            failed=[FailedExtension(key="broken-ext", error="boom")],
        )
        await startup._reconcile_rows(report)
        statuses = await _statuses(db)
        assert statuses["ok-ext"] == ("installed", None)  # needs_restart, now loaded
        assert statuses["off-ext"] == ("disabled", None)  # failed before, loaded, switched off
        assert statuses["broken-ext"] == ("failed", "boom")
        assert statuses["gone-ext"] == (
            "failed",
            "Extension files are missing from the extensions volume",
        )
        assert statuses["pack-ext"] == ("installed", None)  # no code expected: untouched
        assert statuses["removed-ext"] == ("removed", None)


class TestInitializeExtensions:
    async def test_runs_hooks_and_starters_for_the_usable_extensions(
        self, db, patched_async_session, rows, starters
    ):
        ok, off = FakeInstance(), FakeInstance()
        report = LoadReport(
            loaded=[_loaded("ok-ext", ok), _loaded("off-ext", off), _loaded("pack-ext")],
            failed=[],
        )
        tasks = await startup.initialize_extensions(report)
        assert tasks == ["job", "dispatcher", "channel"]
        assert ok.started_with == ["ctx:ok-ext"]
        assert off.started_with == []  # disabled: never started
        assert starters.migrations.await_args.args == (report,)
        assert starters.migrations.await_args.kwargs == {
            "should_run": {"ok-ext": True, "off-ext": False, "pack-ext": True}
        }
        for starter in (starters.jobs, starters.events, starters.channels, starters.types):
            assert starter.call_args.args == (report,)
        assert extension_registry.get("ok-ext").status == "installed"

    async def test_a_failed_hook_is_isolated(
        self, db, patched_async_session, rows, starters, caplog
    ):
        report = LoadReport(loaded=[_loaded("ok-ext", FakeInstance(fail=True))], failed=[])
        assert await startup.initialize_extensions(report) == ["job", "dispatcher", "channel"]
        assert "Extension ok-ext on_startup() failed" in caplog.text

    async def test_a_failed_migration_fails_the_row_and_skips_the_hook(
        self, db, patched_async_session, rows, starters
    ):
        starters.migrations.return_value = {"ok-ext": "bad sql", "unknown-ext": "ignored"}
        ok = FakeInstance()
        report = LoadReport(loaded=[_loaded("ok-ext", ok)], failed=[])
        assert await startup.initialize_extensions(report) == ["job", "dispatcher", "channel"]
        assert ok.started_with == []
        assert (await _statuses(db))["ok-ext"] == ("failed", "Migration failed: bad sql")
        assert extension_registry.get("ok-ext").status == "failed"

    async def test_nothing_loaded_means_nothing_started(
        self, db, patched_async_session, rows, starters
    ):
        assert await startup.initialize_extensions(LoadReport()) == []
        assert starters.migrations.await_count == 0
        assert (await _statuses(db))["gone-ext"][0] == "failed"  # reconciliation still ran

    async def test_a_registry_failure_never_blocks_boot(
        self, db, patched_async_session, rows, starters, monkeypatch, caplog
    ):
        monkeypatch.setattr(
            extension_registry, "refresh_from_db", AsyncMock(side_effect=RuntimeError("db"))
        )
        report = LoadReport(loaded=[_loaded("ok-ext", FakeInstance())], failed=[])
        assert await startup.initialize_extensions(report) == []
        assert "Extension registry initialization failed" in caplog.text
        assert starters.migrations.await_count == 0
