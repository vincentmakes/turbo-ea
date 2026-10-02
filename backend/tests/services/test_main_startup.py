"""The boot sequence in ``app.main`` without a database: ``_migrate_and_seed``
over a fake engine and session (reset, fresh, at head, behind head, the
persisted settings and every demo seeder), and ``lifespan`` (the secret-key
gate, the AI auto-configuration and the cancellation of every background
task on shutdown)."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app import main
from app.models import Base

SENTINEL = object()


# ── Fakes ─────────────────────────────────────────────────────────────────


class FakeConn:
    def __init__(self, engine):
        self.engine = engine

    async def run_sync(self, fn):
        if fn == Base.metadata.create_all:
            self.engine.ddl.append("create_all")
            return None
        if fn == Base.metadata.drop_all:
            self.engine.ddl.append("drop_all")
            return None
        if "has_table" in fn.__code__.co_names:
            return self.engine.has_alembic
        return fn(SENTINEL)  # the stamp / upgrade lambdas, patched below

    async def execute(self, _stmt):
        version = self.engine.version
        return SimpleNamespace(first=lambda: (version,) if version is not None else None)


class FakeEngine:
    def __init__(self, *, has_alembic=False, version=None):
        self.has_alembic = has_alembic
        self.version = version
        self.ddl: list[str] = []

    @asynccontextmanager
    async def begin(self):
        yield FakeConn(self)

    @asynccontextmanager
    async def connect(self):
        yield FakeConn(self)


class FakeSession:
    """Answers every ``scalar_one_or_none`` from a FIFO of scripted rows."""

    def __init__(self, rows):
        self.rows = list(rows)
        self.added: list = []
        self.commits = 0

    async def execute(self, _stmt):
        row = self.rows.pop(0) if self.rows else None
        return SimpleNamespace(scalar_one_or_none=lambda: row)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1


@pytest.fixture
def boot(monkeypatch):
    """Patch everything ``_migrate_and_seed`` reaches for; returns the knobs."""
    for name in ("RESET_DB", "SEED_DEMO", "SEED_BPM", "SEED_PPM", "SEED_SECURITY"):
        monkeypatch.setattr(main.settings, name, False)
    monkeypatch.setattr(main.settings, "APP_TITLE", "Turbo EA")
    stamp, upgrade = MagicMock(), MagicMock()
    monkeypatch.setattr(main, "_alembic_stamp_sync", stamp)
    monkeypatch.setattr(main, "_alembic_upgrade_sync", upgrade)
    monkeypatch.setattr("alembic.config.Config", lambda _path: SimpleNamespace(attributes={}))
    monkeypatch.setattr(
        "alembic.script.ScriptDirectory.from_config",
        classmethod(lambda cls, cfg: SimpleNamespace(get_current_head=lambda: "head123")),
    )
    session = FakeSession([])

    @asynccontextmanager
    async def factory():
        yield session

    monkeypatch.setattr("app.database.async_session", factory)
    patched = {}
    for target in (
        "app.services.seed.seed_metamodel",
        "app.services.extensions.instance_id.ensure_instance_id",
        "app.services.email_backends.runtime.apply_email_settings_to_runtime",
    ):
        patched[target] = AsyncMock() if "runtime" not in target else MagicMock()
        monkeypatch.setattr(target, patched[target])
    init = AsyncMock(return_value=["job-task"])
    monkeypatch.setattr("app.services.extensions.startup.initialize_extensions", init)
    return SimpleNamespace(
        session=session, stamp=stamp, upgrade=upgrade, patched=patched, init=init, mp=monkeypatch
    )


def _engine(monkeypatch, **kw) -> FakeEngine:
    engine = FakeEngine(**kw)
    monkeypatch.setattr(main, "engine", engine)
    return engine


# ── _migrate_and_seed ─────────────────────────────────────────────────────


class TestMigrateAndSeed:
    async def test_reset_drops_recreates_and_stamps(self, boot):
        boot.mp.setattr(main.settings, "RESET_DB", True)
        engine = _engine(boot.mp)
        assert await main._migrate_and_seed("report") == ["job-task"]
        assert engine.ddl == ["drop_all", "create_all"]
        assert boot.stamp.call_count == 1 and boot.upgrade.call_count == 0
        assert boot.patched["app.services.seed.seed_metamodel"].await_count == 1
        assert boot.init.await_args.args == ("report",)

    @pytest.mark.parametrize(("has_alembic", "version"), [(False, None), (True, None)])
    async def test_a_fresh_database_is_created_and_stamped(self, boot, has_alembic, version):
        engine = _engine(boot.mp, has_alembic=has_alembic, version=version)
        await main._migrate_and_seed(None)
        assert engine.ddl == ["create_all"]
        assert boot.stamp.call_count == 1 and boot.upgrade.call_count == 0

    async def test_at_head_only_creates_new_tables(self, boot):
        engine = _engine(boot.mp, has_alembic=True, version="head123")
        await main._migrate_and_seed(None)
        assert engine.ddl == ["create_all"]
        assert boot.stamp.call_count == 0 and boot.upgrade.call_count == 0

    async def test_behind_head_upgrades_first(self, boot):
        engine = _engine(boot.mp, has_alembic=True, version="old")
        await main._migrate_and_seed(None)
        assert engine.ddl == ["create_all"]
        assert boot.upgrade.call_count == 1 and boot.stamp.call_count == 0

    async def test_a_failed_upgrade_stops_the_boot(self, boot, caplog):
        _engine(boot.mp, has_alembic=True, version="old")
        boot.upgrade.side_effect = RuntimeError("bad migration")
        with caplog.at_level(logging.ERROR), pytest.raises(RuntimeError, match="bad migration"):
            await main._migrate_and_seed(None)
        assert "Alembic migration failed" in caplog.text
        assert boot.init.await_count == 0

    async def test_persisted_settings_reach_the_runtime(self, boot):
        _engine(boot.mp, has_alembic=True, version="head123")
        boot.session.rows = [
            SimpleNamespace(
                email_settings={"smtp_host": "mail"}, general_settings={"app_title": "  ACME EA "}
            )
        ]
        await main._migrate_and_seed(None)
        runtime = boot.patched[
            "app.services.email_backends.runtime.apply_email_settings_to_runtime"
        ]
        assert runtime.call_args.args == ({"smtp_host": "mail"},)
        assert main.settings.APP_TITLE == "ACME EA"

    async def test_demo_seeding_runs_every_seeder_and_creates_the_admin(self, boot, capsys):
        _engine(boot.mp, has_alembic=True, version="head123")
        boot.mp.setattr(main.settings, "SEED_DEMO", True)
        seeders = {
            "app.services.seed_demo.seed_demo_data": {
                "cards": 1,
                "relations": 2,
                "tag_groups": 3,
                "adrs": 4,
                "soaws": 5,
            },
            "app.services.seed_demo_bpm.seed_bpm_demo_data": {"skipped": True, "reason": "done"},
            "app.services.seed_demo_ppm.seed_ppm_demo_data": {
                "status_reports": 1,
                "wbs_items": 2,
                "tasks": 3,
                "budget_lines": 4,
                "cost_lines": 5,
                "risks": 6,
            },
            "app.services.seed_demo_extras.seed_extras_demo_data": {
                "comments": 1,
                "stakeholders": 2,
                "events": 3,
                "diagrams": 4,
                "saved_reports": 5,
                "surveys": 6,
            },
            "app.services.seed_demo_security.seed_security_demo_data": {
                "compliance_findings": 1,
                "analysis_runs": 2,
            },
            "app.services.seed_demo_logos.seed_logo_demo_data": {
                "brand_logos": 1,
                "house_logos": 2,
            },
            "app.services.seed_demo_workspace.seed_workspace_demo_data": {
                "portals": 1,
                "diagram_groups": 2,
                "published_diagrams": 3,
                "card_favorites": 4,
                "diagram_favorites": 5,
            },
        }
        mocks = {t: AsyncMock(return_value=r) for t, r in seeders.items()}
        for target, mock in mocks.items():
            boot.mp.setattr(target, mock)
        # rows: settings (none) · admin lookup (none → created) · PPM settings row
        ppm_row = SimpleNamespace(general_settings={})
        boot.session.rows = [None, None, ppm_row]

        await main._migrate_and_seed(None)

        assert all(m.await_count == 1 for m in mocks.values())
        admin = next(o for o in boot.session.added if getattr(o, "email", None))
        assert admin.email == "admin@turboea.demo" and admin.role == "admin"
        assert ppm_row.general_settings == {"ppmEnabled": True}
        out = capsys.readouterr().out
        assert "[seed_demo] Seeded 1 cards, 2 relations" in out
        assert "[seed_bpm] Skipped: done" in out
        assert "[seed_ppm] Enabled PPM module" in out
        assert "[seed] Created demo admin user" in out
        assert "[seed_workspace] Seeded 1 web portals" in out

    async def test_bpm_only_seeding_keeps_an_existing_admin(self, boot, capsys):
        _engine(boot.mp, has_alembic=True, version="head123")
        boot.mp.setattr(main.settings, "SEED_BPM", True)
        bpm = AsyncMock(
            return_value={
                "cards": 1,
                "relations": 2,
                "diagrams": 3,
                "elements": 4,
                "assessments": 5,
            }
        )
        boot.mp.setattr("app.services.seed_demo_bpm.seed_bpm_demo_data", bpm)
        boot.session.rows = [None, "an-admin-id"]
        await main._migrate_and_seed(None)
        assert bpm.await_count == 1 and boot.session.added == []
        assert "[seed_bpm] Seeded 1 processes" in capsys.readouterr().out


# ── lifespan ──────────────────────────────────────────────────────────────


@pytest.fixture
async def quiet_lifespan(monkeypatch):
    """Every long-running piece of the lifespan replaced by a parked task."""
    monkeypatch.setattr(main.settings, "SECRET_KEY", "a-strong-secret-key-of-32-chars!!")
    monkeypatch.setattr(main.settings, "AI_AUTO_CONFIGURE", False)
    cancelled: list[str] = []

    def parked(name):
        async def _run():
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled.append(name)
                raise

        return _run

    @asynccontextmanager
    async def no_lock(_engine):
        yield

    monkeypatch.setattr(main, "startup_lock", no_lock)
    ext_task = asyncio.create_task(parked("extension-job")())
    monkeypatch.setattr(main, "_migrate_and_seed", AsyncMock(return_value=[ext_task]))
    monkeypatch.setattr(main, "_ensure_initial_kpi_snapshot", AsyncMock())
    monkeypatch.setattr(main, "_auto_configure_ai", AsyncMock())
    for name in (
        "_purge_archived_cards_loop",
        "_purge_mutation_batches_loop",
        "_kpi_snapshot_loop",
        "_promote_recurring_tasks_loop",
        "_license_refresh_loop",
        "_update_check_loop",
        "_extension_store_check_loop",
        "_ops_access_maintenance_loop",
        "_ensure_ollama_model",
    ):
        monkeypatch.setattr(main, name, parked(name))
    one_shots = {
        "_one_shot_data_quality_rescore": AsyncMock(),
        "_one_shot_upgrade_announcement": AsyncMock(),
    }
    for name, mock in one_shots.items():
        monkeypatch.setattr(main, name, mock)
    return SimpleNamespace(cancelled=cancelled, one_shots=one_shots, mp=monkeypatch)


class TestLifespan:
    async def test_starts_every_task_and_cancels_them_on_shutdown(self, quiet_lifespan):
        async with main.lifespan(main.app):
            await asyncio.sleep(0)  # let the one-shot tasks run
        assert sorted(quiet_lifespan.cancelled) == [
            "_extension_store_check_loop",
            "_kpi_snapshot_loop",
            "_license_refresh_loop",
            "_ops_access_maintenance_loop",
            "_promote_recurring_tasks_loop",
            "_purge_archived_cards_loop",
            "_purge_mutation_batches_loop",
            "_update_check_loop",
            "extension-job",
        ]
        assert all(m.await_count == 1 for m in quiet_lifespan.one_shots.values())
        assert main._auto_configure_ai.await_count == 0

    async def test_ai_auto_configuration_runs_and_the_pull_is_cancelled(self, quiet_lifespan):
        quiet_lifespan.mp.setattr(main.settings, "AI_AUTO_CONFIGURE", True)
        async with main.lifespan(main.app):
            pass
        assert main._auto_configure_ai.await_count == 1
        assert "_ensure_ollama_model" in quiet_lifespan.cancelled

    async def test_the_default_secret_key_is_refused_outside_development(self, quiet_lifespan):
        quiet_lifespan.mp.setattr(
            main.settings, "SECRET_KEY", next(iter(main._DEFAULT_SECRET_KEYS))
        )
        quiet_lifespan.mp.setattr(main.settings, "ENVIRONMENT", "production")
        with pytest.raises(RuntimeError, match="SECRET_KEY must be set"):
            async with main.lifespan(main.app):
                pass
        assert main._migrate_and_seed.await_count == 0

    async def test_the_default_secret_key_only_warns_in_development(self, quiet_lifespan, caplog):
        quiet_lifespan.mp.setattr(
            main.settings, "SECRET_KEY", next(iter(main._DEFAULT_SECRET_KEYS))
        )
        quiet_lifespan.mp.setattr(main.settings, "ENVIRONMENT", "development")
        with caplog.at_level(logging.WARNING):
            async with main.lifespan(main.app):
                pass
        assert "Using default SECRET_KEY" in caplog.text
        assert main._migrate_and_seed.await_count == 1
