"""The extension-job supervisor: which jobs run, when, and what a tick does."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services.extensions import jobs
from app.services.extensions.loader import LoadedExtension, LoadReport
from app.services.extensions.sdk import ExtensionJob
from tests.seams import one_shot_asyncio


async def _noop(ctx) -> None:
    return None


def _job(name="nightly", interval=None, cron=None, run=_noop) -> ExtensionJob:
    return ExtensionJob(name=name, interval_seconds=interval, run=run, cron=cron)


class TestValidateJobSchedule:
    def test_exactly_one_schedule(self):
        message = "exactly one of interval_seconds / cron must be set"
        assert jobs.validate_job_schedule(_job(interval=60, cron="0 3 * * *")) == message
        assert jobs.validate_job_schedule(_job()) == message

    @pytest.mark.parametrize("interval", [0, -5])
    def test_an_interval_must_be_positive(self, interval):
        assert jobs.validate_job_schedule(_job(interval=interval)) == (
            f"interval_seconds must be positive, got {interval}"
        )

    def test_a_one_second_interval_is_valid(self):
        assert jobs.validate_job_schedule(_job(interval=1)) is None

    def test_a_cron_that_never_fires_is_refused(self):
        # February 31st parses, but the loop would spin on it forever.
        assert jobs.validate_job_schedule(_job(cron="0 0 31 2 *")) == (
            "cron expression never fires: '0 0 31 2 *'"
        )

    def test_a_cron_that_does_not_parse_is_refused(self):
        problem = jobs.validate_job_schedule(_job(cron="not a cron"))
        assert problem and "never fires" not in problem

    def test_a_firing_cron_is_valid(self):
        now = datetime(2026, 10, 10, 2, 0, tzinfo=UTC)
        assert jobs.validate_job_schedule(_job(cron="0 3 * * *"), now) is None


class TestNextSleepSeconds:
    NOW = datetime(2026, 10, 10, 2, 59, 30, tzinfo=UTC)

    def test_an_interval_job_sleeps_its_interval(self):
        assert jobs.next_sleep_seconds(_job(interval=90), self.NOW) == 90.0

    def test_a_cron_job_sleeps_until_its_next_instant(self):
        assert jobs.next_sleep_seconds(_job(cron="0 3 * * *"), self.NOW) == 30.0

    def test_never_less_than_a_second(self):
        just_before = datetime(2026, 10, 10, 2, 59, 59, 500000, tzinfo=UTC)
        assert jobs.next_sleep_seconds(_job(cron="0 3 * * *"), just_before) == 1.0
        assert jobs.next_sleep_seconds(_job(interval=0), self.NOW) == 1.0


def _registry(info=None, usable=True):
    return SimpleNamespace(
        get=lambda key: info,
        entitlement=lambda key: SimpleNamespace(usable=usable),
    )


class TestExtensionMayRun:
    def test_an_unknown_extension_may_not(self, monkeypatch):
        monkeypatch.setattr(jobs, "extension_registry", _registry(None))
        assert jobs.extension_may_run("x") is False

    def test_a_disabled_extension_may_not(self, monkeypatch):
        info = SimpleNamespace(enabled=False, status="installed")
        monkeypatch.setattr(jobs, "extension_registry", _registry(info))
        assert jobs.extension_may_run("x") is False

    @pytest.mark.parametrize("status", ["removed", "disabled", "failed"])
    def test_a_parked_extension_may_not(self, monkeypatch, status):
        info = SimpleNamespace(enabled=True, status=status)
        monkeypatch.setattr(jobs, "extension_registry", _registry(info))
        assert jobs.extension_may_run("x") is False

    def test_an_unlicensed_extension_may_not(self, monkeypatch):
        info = SimpleNamespace(enabled=True, status="installed")
        monkeypatch.setattr(jobs, "extension_registry", _registry(info, usable=False))
        assert jobs.extension_may_run("x") is False

    def test_an_enabled_licensed_extension_may(self, monkeypatch):
        info = SimpleNamespace(enabled=True, status="installed")
        monkeypatch.setattr(jobs, "extension_registry", _registry(info, usable=True))
        assert jobs.extension_may_run("x") is True


def _loaded(key, instance) -> LoadedExtension:
    return LoadedExtension(key=key, manifest={}, directory=Path("."), instance=instance)


class TestPlanJobs:
    def test_keeps_valid_jobs_and_logs_the_rest(self, caplog):
        good = _job("sync", interval=300)
        bad = _job("broken", interval=0)

        def raises():
            raise RuntimeError("boom")

        report = LoadReport(
            loaded=[
                _loaded("content-only", None),
                _loaded("raises", SimpleNamespace(get_jobs=raises)),
                _loaded("none", SimpleNamespace(get_jobs=lambda: None)),
                _loaded("ext", SimpleNamespace(get_jobs=lambda: [good, bad])),
            ]
        )
        with caplog.at_level(logging.ERROR):
            planned = jobs.plan_jobs(report)
        assert planned == [("ext", good)]
        messages = [r.getMessage() for r in caplog.records]
        assert "Extension raises get_jobs() failed" in messages
        assert (
            "Extension ext job broken has an invalid schedule "
            "(interval_seconds must be positive, got 0) — job skipped"
        ) in messages


class TestJobLoop:
    async def test_a_tick_runs_the_job_with_its_context(self, monkeypatch):
        fake = one_shot_asyncio()
        monkeypatch.setattr(jobs, "asyncio", fake)
        monkeypatch.setattr(jobs, "extension_may_run", lambda key: key == "ext")
        seen = []

        async def run(ctx):
            seen.append(ctx)

        ctx = object()
        with pytest.raises(asyncio.CancelledError):
            await jobs._job_loop("ext", _job(interval=42, run=run), ctx)
        assert seen == [ctx]
        assert fake.sleeps == [42.0, 42.0]

    async def test_a_paused_extension_skips_the_tick(self, monkeypatch):
        fake = one_shot_asyncio()
        monkeypatch.setattr(jobs, "asyncio", fake)
        monkeypatch.setattr(jobs, "extension_may_run", lambda key: False)
        seen = []

        async def run(ctx):
            seen.append(ctx)

        with pytest.raises(asyncio.CancelledError):
            await jobs._job_loop("ext", _job(interval=5, run=run), object())
        assert seen == []

    async def test_a_failing_tick_is_logged_and_the_loop_goes_on(self, monkeypatch, caplog):
        fake = one_shot_asyncio()
        monkeypatch.setattr(jobs, "asyncio", fake)
        monkeypatch.setattr(jobs, "extension_may_run", lambda key: True)

        async def run(ctx):
            raise RuntimeError("down")

        with caplog.at_level(logging.ERROR), pytest.raises(asyncio.CancelledError):
            await jobs._job_loop("ext", _job("sync", interval=5, run=run), object())
        assert fake.sleeps == [5.0, 5.0]
        assert "Extension ext job sync failed — retrying next tick" in [
            r.getMessage() for r in caplog.records
        ]


class TestStartExtensionJobs:
    async def test_one_named_task_per_planned_job(self, monkeypatch):
        ran: list[tuple[str, str, object]] = []

        async def loop(key, job, ctx):
            ran.append((key, job.name, ctx))

        monkeypatch.setattr(jobs, "_job_loop", loop)
        monkeypatch.setattr(jobs, "build_context", lambda key: f"ctx:{key}")
        report = LoadReport(
            loaded=[
                _loaded(
                    "ext",
                    SimpleNamespace(
                        get_jobs=lambda: [_job("a", interval=60), _job("b", cron="0 3 * * *")]
                    ),
                )
            ]
        )
        tasks = jobs.start_extension_jobs(report)
        await asyncio.gather(*tasks)
        assert [t.get_name() for t in tasks] == ["ext:ext:a", "ext:ext:b"]
        assert ran == [("ext", "a", "ctx:ext"), ("ext", "b", "ctx:ext")]
