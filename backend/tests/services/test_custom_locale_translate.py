"""The AI translation job of a custom language (``custom_locale_translate``).

``call_llm`` is replaced on the module; the job's own short sessions are the
test's session (``patched_async_session``); the English catalogue is a small
hand-built one so every count is exact.
"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest
from sqlalchemy import select

from app.models.custom_locale import CustomLocale, CustomLocaleString
from app.services import custom_locale_store as store
from app.services import custom_locale_translate as tr
from app.services import language_pack as lp
from app.services import metamodel_strings as mm

AI = {
    "provider_url": "https://llm.test",
    "model": "m",
    "provider_type": "openai",
    "api_key": "k",
    "api_version": "v",
}
CAT = lp.catalog_from_trees(
    {
        "common": {"a": "Apple", "b": "Hello {{name}}"},
        "nav": {"home": "Home"},
        "grc": {"risk": "Risk"},
    }
)


@pytest.fixture
def tiny_catalog(monkeypatch):
    monkeypatch.setattr(store, "catalog", lambda: CAT)
    return CAT


@pytest.fixture
async def locale(db):
    loc = CustomLocale(code="nl", name="Nederlands", english_name="Dutch")
    loc.translate_job = tr.new_job("missing", 2)
    db.add(loc)
    await db.flush()
    return loc


class FakeLlm:
    def __init__(self, *answers):
        self.answers = list(answers)
        self.calls: list[list[dict]] = []

    async def __call__(self, provider_url, model, messages, **kwargs):
        self.calls.append(messages)
        assert provider_url == AI["provider_url"] and model == AI["model"]
        assert kwargs == {
            "provider_type": "openai",
            "api_key": "k",
            "api_version": "v",
        }
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(answer, BaseException):
            raise answer
        return answer


def items(*pairs):
    return [tr.WorkItem(ns, key, CAT.namespaces[ns].strings[key], None) for ns, key in pairs]


async def _row(db, loc, namespace):
    return (
        await db.execute(
            select(CustomLocaleString).where(
                CustomLocaleString.locale_id == loc.id,
                CustomLocaleString.namespace == namespace,
            )
        )
    ).scalar_one_or_none()


async def _job(db, loc):
    await db.refresh(loc)
    return loc.translate_job


@pytest.fixture
def run(monkeypatch, patched_async_session, tiny_catalog):
    def install(fake):
        monkeypatch.setattr(tr, "call_llm", fake)
        return fake

    return install


async def _launch_hanging(run) -> asyncio.Task:
    """Start a job whose LLM call never returns, and wait until it is in it —
    so the cancel lands on the call, never inside a database round-trip."""
    entered = asyncio.Event()

    async def hang(*args, **kwargs):
        entered.set()
        await asyncio.Event().wait()

    run(hang)
    task = tr.launch("nl", "Dutch", items(("common", "a")), AI)
    await asyncio.wait_for(entered.wait(), timeout=5)
    return task


class TestRunJob:
    async def test_happy_path(self, db, locale, run):
        fake = run(FakeLlm({"1": " Appel ", "2": "Hallo {{name}}"}))
        await tr.run_job("nl", "Dutch", items(("common", "a"), ("common", "b")), AI)
        row = await _row(db, locale, "common")
        assert row.strings == {"a": "Appel", "b": "Hallo {{name}}"}
        assert row.meta["a"] == {"h": lp.source_hash("Apple"), "o": "ai"}
        job = await _job(db, locale)
        assert job["status"] == "completed"
        assert (job["done"], job["failed"]) == (2, 0)
        assert job["finished_at"]
        assert len(fake.calls) == 1
        system, user = fake.calls[0]
        assert "into Dutch" in system["content"]
        assert json.loads(user["content"]) == {"1": "Apple", "2": "Hello {{name}}"}

    async def test_rejected_and_missing_ids_fail(self, db, locale, run):
        run(FakeLlm({"1": "<b>Appel</b>"}))
        await tr.run_job("nl", "Dutch", items(("common", "a"), ("common", "b")), AI)
        assert await _row(db, locale, "common") is None
        job = await _job(db, locale)
        assert (job["status"], job["done"], job["failed"]) == ("completed", 2, 2)

    async def test_a_failed_call_is_retried_once(self, db, locale, run):
        fake = run(FakeLlm(httpx.ConnectError("down"), {"1": "Appel"}))
        await tr.run_job("nl", "Dutch", items(("common", "a")), AI)
        assert len(fake.calls) == 2
        assert (await _row(db, locale, "common")).strings == {"a": "Appel"}
        assert (await _job(db, locale))["failed"] == 0

    async def test_three_failed_chunks_end_the_job(self, db, locale, run):
        fake = run(FakeLlm(httpx.ConnectError("down")))
        work = items(("common", "a"), ("nav", "home"), ("grc", "risk"))
        await tr.run_job("nl", "Dutch", work, AI)
        assert len(fake.calls) == 6
        job = await _job(db, locale)
        assert job["status"] == "failed"
        assert (job["done"], job["failed"]) == (3, 3)
        assert "3 times in a row" in job["error"] and "ConnectError" in job["error"]

    async def test_two_failures_then_a_success_continue(self, db, locale, run):
        down = httpx.ConnectError("down")
        run(FakeLlm(down, down, down, down, {"1": "Risico"}))
        await tr.run_job(
            "nl", "Dutch", items(("common", "a"), ("nav", "home"), ("grc", "risk")), AI
        )
        job = await _job(db, locale)
        assert (job["status"], job["done"], job["failed"]) == ("completed", 3, 2)
        assert (await _row(db, locale, "grc")).strings == {"risk": "Risico"}

    async def test_a_job_no_longer_running_stops(self, db, locale, run):
        locale.translate_job = {**locale.translate_job, "status": "cancelled"}
        await db.flush()
        fake = run(FakeLlm({"1": "Appel"}))
        await tr.run_job("nl", "Dutch", items(("common", "a"), ("nav", "home")), AI)
        assert len(fake.calls) == 1
        assert (await _job(db, locale))["status"] == "cancelled"

    async def test_a_value_changed_meanwhile_is_kept(self, db, locale, run):
        db.add(
            CustomLocaleString(
                locale_id=locale.id,
                namespace="common",
                strings={"a": "Appel (handmatig)"},
                meta={"a": {"h": lp.source_hash("Apple"), "o": "manual"}},
            )
        )
        await db.flush()
        run(FakeLlm({"1": "Appel"}))
        await tr.run_job("nl", "Dutch", items(("common", "a")), AI)
        row = await _row(db, locale, "common")
        assert row.strings == {"a": "Appel (handmatig)"}
        assert row.meta["a"]["o"] == "manual"

    async def test_cancel_ends_the_job_cancelled(self, db, locale, run):
        task = await _launch_hanging(run)
        assert tr.is_running("nl")
        assert tr.cancel("nl") is True
        with pytest.raises(asyncio.CancelledError):
            await task
        assert (await _job(db, locale))["status"] == "cancelled"
        assert not tr.is_running("nl")
        assert tr.cancel("nl") is False

    async def test_a_task_cancelled_from_outside_is_interrupted(self, db, locale, run):
        task = await _launch_hanging(run)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert (await _job(db, locale))["status"] == "interrupted"


class TestSelectWork:
    def _views(self, strings: dict, meta: dict) -> dict:
        ns = CAT.namespaces["common"]
        return {"common": store.View(ns=ns, strings=strings, meta=meta)}

    def test_missing_takes_missing_and_stale(self):
        ns = CAT.namespaces["common"]
        views = self._views({"a": "Appel", "b": "oud {{name}}"}, {"a": {"h": ns.hashes["a"]}})
        work = tr.select_work(views, mode="missing", include_manual=False)
        assert [(w.key, w.english, w.current) for w in work] == [
            ("b", "Hello {{name}}", "oud {{name}}")
        ]

    def test_all_skips_manual_unless_asked(self):
        ns = CAT.namespaces["common"]
        meta = {"a": {"h": ns.hashes["a"], "o": "manual"}, "b": {"h": ns.hashes["b"], "o": "ai"}}
        views = self._views({"a": "Appel", "b": "Hallo {{name}}"}, meta)
        assert [w.key for w in tr.select_work(views, mode="all", include_manual=False)] == ["b"]
        assert [w.key for w in tr.select_work(views, mode="all", include_manual=True)] == [
            "a",
            "b",
        ]

    def test_metamodel_comes_first(self):
        meta_ns = mm.namespace_of([mm.Entry("type.App.label", "Application", None, True)])
        views = {
            "metamodel": store.View(ns=meta_ns, strings={}, meta={}),
            **self._views({}, {}),
        }
        work = tr.select_work(views, mode="missing", include_manual=False)
        assert [w.namespace for w in work] == ["metamodel", "common", "common"]
        assert [c[0].namespace for c in tr.chunks_of(work)] == ["metamodel", "common"]


class TestHelpers:
    def test_accept_answer(self):
        chunk = items(("common", "a"), ("common", "b"))
        translations, expected, failed = tr.accept_answer(chunk, {"1": "Appel", "2": "Hallo"})
        assert translations == {"a": "Appel"}
        assert expected == {"a": None}
        assert failed == 1
        assert tr.accept_answer(chunk, "not json") == ({}, {}, 2)

    def test_chunks_are_per_namespace_and_capped(self):
        many = [tr.WorkItem("common", f"k{i}", "x", None) for i in range(45)]
        other = [tr.WorkItem("nav", "home", "Home", None)]
        chunks = tr.chunks_of(many + other)
        assert [len(c) for c in chunks] == [40, 5, 1]

    def test_type_name_pairs(self):
        entries = [
            mm.Entry("type.App.label", "Application", "Applicatie", True),
            mm.Entry("type.App.field.x", "X", "Iks", True),
            mm.Entry("type.Data.label", "Data", None, True),
            mm.Entry("relation.r.label", "uses", "gebruikt", True),
        ]
        view = store.View(ns=mm.namespace_of(entries), strings=mm.values_of(entries), meta={})
        assert tr.type_name_pairs(view) == [("Application", "Applicatie")]
        assert tr.type_name_pairs(view, limit=0) == []

    def test_job_states(self):
        job = tr.new_job("all", 7)
        assert {k: job[k] for k in ("status", "mode", "total", "done", "failed", "error")} == {
            "status": "running",
            "mode": "all",
            "total": 7,
            "done": 0,
            "failed": 0,
            "error": None,
        }
        assert job["finished_at"] is None and job["started_at"]
        cancelled = tr.cancelled_job(job)
        assert cancelled["status"] == "cancelled" and cancelled["finished_at"]
        assert tr.cancelled_job({"status": "completed"}) == {"status": "completed"}
        assert tr.cancelled_job(None) is None


class TestInterruptedAtStartup:
    async def test_running_jobs_are_marked_interrupted(self, db):
        running = CustomLocale(code="nl", name="NL", english_name="Dutch")
        running.translate_job = tr.new_job("missing", 3)
        done = CustomLocale(code="he", name="HE", english_name="Hebrew")
        done.translate_job = {"status": "completed"}
        idle = CustomLocale(code="th", name="TH", english_name="Thai")
        db.add_all([running, done, idle])
        await db.flush()
        assert await store.mark_interrupted_jobs(db) == 1
        assert running.translate_job["status"] == "interrupted"
        assert running.translate_job["finished_at"]
        assert running.translate_job["total"] == 3
        assert done.translate_job == {"status": "completed"}
        assert idle.translate_job is None
        assert await store.mark_interrupted_jobs(db) == 0
