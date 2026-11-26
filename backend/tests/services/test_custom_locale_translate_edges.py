"""The AI translation job: the counting, the retries, the hand-over between its
helpers and what it leaves behind. Pure helpers need no database; the job
itself runs on the test session (``patched_async_session``) with ``call_llm``
replaced and a small catalogue.
"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

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
        "ppm": {"task": "Task"},
        "plural": {"n_one": "{{count}} item", "n_other": "{{count}} items"},
    }
)
DOWN = httpx.ConnectError("down")


def items(*pairs):
    return [tr.WorkItem(ns, key, CAT.namespaces[ns].strings[key], None) for ns, key in pairs]


class Llm:
    """Answers in order (an exception is raised); records every call."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.calls: list[list[dict]] = []

    async def __call__(self, provider_url, model, messages, **kwargs):
        self.calls.append(messages)
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(answer, BaseException):
            raise answer
        return answer

    def payload(self, index):
        return json.loads(self.calls[index][1]["content"])


@pytest.fixture
def job(monkeypatch, patched_async_session, db):
    monkeypatch.setattr(store, "catalog", lambda: CAT)
    monkeypatch.setattr(tr, "RETRY_DELAY", 0)

    async def start(fake, total=1):
        loc = CustomLocale(code="nl", name="Nederlands", english_name="Dutch")
        loc.translate_job = tr.new_job("missing", total)
        db.add(loc)
        await db.flush()
        monkeypatch.setattr(tr, "call_llm", fake)
        return loc

    return start


async def _job_state(db, loc):
    await db.refresh(loc)
    return loc.translate_job


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


class TestHelpers:
    def test_now_is_utc(self):
        assert tr._now().endswith("+00:00")

    def test_select_work_reads_odd_meta_and_values(self):
        ns = CAT.namespaces["plural"]
        view = store.View(
            ns=ns,
            strings={"n_one": 5, "n_few": "{{count}} kusy"},
            meta={"n_one": "junk", "n_few": {"h": ns.hashes["n_other"], "o": "manual"}},
        )
        work = tr.select_work({"plural": view}, mode="all", include_manual=False)
        assert [(w.key, w.english, w.current) for w in work] == [
            ("n_one", "{{count}} item", None),
            ("n_other", "{{count}} items", None),
        ]
        stale = tr.select_work(
            {"plural": store.View(ns=ns, strings={"n_few": "x {{count}}"}, meta={})},
            mode="missing",
            include_manual=False,
        )
        assert [(w.key, w.english, w.current) for w in stale][-1] == (
            "n_few",
            "{{count}} items",
            "x {{count}}",
        )

    def test_accept_answer_keeps_what_each_key_held(self):
        chunk = [
            tr.WorkItem("common", "a", "Apple", "Appel (oud)"),
            tr.WorkItem("plural", "n_one", "{{count}} item", None),
            tr.WorkItem("plural", "n_other", "{{count}} items", None),
        ]
        translations, expected, failed = tr.accept_answer(
            chunk, {"1": "Appel", "2": "één item", "3": "items"}
        )
        assert translations == {"a": "Appel", "n_one": "één item"}
        assert expected == {"a": "Appel (oud)", "n_one": None}
        assert failed == 1

    def test_plural_forms(self):
        assert tr.is_plural_form("n_one") and tr.is_plural_form("n_two")
        assert not tr.is_plural_form("n_other") and not tr.is_plural_form("title")

    @pytest.mark.parametrize(
        ("answer", "size", "unusable"),
        [
            ({"1": "a", "2": "b"}, 3, False),
            ({"2": "b", "3": "c"}, 3, False),
            ({"1": "a", "3": "c"}, 4, False),
            ({"1": "a"}, 4, True),
            ({}, 1, True),
            ({"1": "a"}, 1, False),
        ],
    )
    def test_answer_is_unusable(self, answer, size, unusable):
        chunk = [tr.WorkItem("common", f"k{i}", "x", None) for i in range(size)]
        assert tr.answer_is_unusable(chunk, answer) is unusable

    def test_type_name_pairs_cap_the_translation(self):
        entries = [
            mm.Entry("type.A.label", "A", "x" * 121, True),
            mm.Entry("type.B.label", "B", "y" * 120, True),
            mm.Entry("type.C.label", "C", "", True),
        ]
        view = store.View(ns=mm.namespace_of(entries), strings=mm.values_of(entries), meta={})
        assert tr.type_name_pairs(view) == [("B", "y" * 120)]

    def test_the_provider_error_keeps_its_message(self):
        error = tr.ProviderFailedError(ValueError("boom"))
        assert str(error) == "boom" and isinstance(error.cause, ValueError)


# ---------------------------------------------------------------------------
# The split retry
# ---------------------------------------------------------------------------


class TestSplit:
    async def test_the_halves_keep_the_language_and_the_references(self, monkeypatch):
        fake = Llm({}, {"1": "<b>x</b>"}, {"1": "Hallo"})
        monkeypatch.setattr(tr, "call_llm", fake)
        chunk = [
            tr.WorkItem("common", "a", "Apple", None),
            tr.WorkItem("common", "b", "Hello", None),
        ]
        translations, _expected, failed = await tr.translate_chunk(
            "Dutch", chunk, [("Card", "Kaart")], AI
        )
        assert translations == {"b": "Hallo"} and failed == 1
        for index in (1, 2):
            assert "into Dutch" in fake.calls[index][0]["content"]
            assert fake.payload(index)["reference"] == {"Card": "Kaart"}

    async def test_failures_of_both_halves_add_up(self, monkeypatch):
        monkeypatch.setattr(tr, "call_llm", Llm({}, {"1": "<b>"}, {"1": "<i>"}))
        chunk = [tr.WorkItem("common", "a", "A", None), tr.WorkItem("common", "b", "B", None)]
        assert (await tr.translate_chunk("Dutch", chunk, [], AI))[2] == 2

    async def test_a_retry_after_a_failure_waits_exactly_once(self, monkeypatch):
        slept: list[float] = []

        async def sleep(seconds):
            slept.append(seconds)

        monkeypatch.setattr(tr.asyncio, "sleep", sleep)
        monkeypatch.setattr(tr, "RETRY_DELAY", 3)
        monkeypatch.setattr(tr, "call_llm", Llm({"1": "Appel"}))
        await tr.translate_chunk("Dutch", items(("common", "a")), [], AI)
        assert slept == []
        monkeypatch.setattr(tr, "call_llm", Llm(DOWN, DOWN))
        with pytest.raises(tr.ProviderFailedError):
            await tr.translate_chunk("Dutch", items(("common", "a")), [], AI)
        assert slept == [3]


# ---------------------------------------------------------------------------
# The job
# ---------------------------------------------------------------------------


class TestRunJobCounting:
    async def test_a_failed_last_chunk_is_recorded(self, db, job):
        loc = await job(Llm({"1": "Appel"}, DOWN, DOWN))
        await tr.run_job("nl", "Dutch", items(("common", "a"), ("nav", "home")), AI)
        state = await _job_state(db, loc)
        assert (state["status"], state["done"], state["failed"]) == ("completed", 2, 1)

    async def test_a_success_resets_the_failure_count(self, db, job):
        loc = await job(Llm(DOWN, DOWN, {"1": "Huis"}, DOWN, DOWN, DOWN, DOWN, {"1": "x"}))
        work = items(("common", "a"), ("nav", "home"), ("grc", "risk"), ("ppm", "task"))
        await tr.run_job("nl", "Dutch", work, AI)
        state = await _job_state(db, loc)
        assert state["status"] == "completed"
        assert (state["done"], state["failed"]) == (4, 3)

    async def test_a_failed_job_is_finished(self, db, job):
        loc = await job(Llm(DOWN))
        work = items(("common", "a"), ("nav", "home"), ("grc", "risk"))
        await tr.run_job("nl", "Dutch", work, AI)
        state = await _job_state(db, loc)
        assert state["status"] == "failed" and state["finished_at"]

    async def test_a_finished_job_leaves_no_task_behind(self, db, job):
        await job(Llm({"1": "Appel"}))
        task = tr.launch("nl", "Dutch", items(("common", "a")), AI)
        await task
        assert "nl" not in tr._TASKS

    async def test_launch_hands_the_language_on(self, db, job):
        fake = Llm({"1": "Appel"})
        await job(fake)
        await tr.launch("nl", "Hebrew", items(("common", "a")), AI)
        assert "into Hebrew" in fake.calls[0][0]["content"]

    async def test_a_cancelled_job_is_finished(self, db, job):
        entered = asyncio.Event()

        async def hang(*args, **kwargs):
            entered.set()
            await asyncio.Event().wait()

        loc = await job(hang)
        task = tr.launch("nl", "Dutch", items(("common", "a")), AI)
        await asyncio.wait_for(entered.wait(), timeout=5)
        tr.cancel("nl")
        with pytest.raises(asyncio.CancelledError):
            await task
        state = await _job_state(db, loc)
        assert state["status"] == "cancelled" and state["finished_at"]


class TestJobHelpersOnTheDatabase:
    async def test_update_and_merge_answer_false_for_a_deleted_language(
        self, db, patched_async_session, monkeypatch
    ):
        monkeypatch.setattr(store, "catalog", lambda: CAT)
        assert await tr._update_job("zz", done=1) is False
        chunk = items(("common", "a"))
        assert await tr._merge("zz", chunk, {"a": "Appel"}, {"a": None}) is False

    async def test_references_are_current_short_translations_minus_the_chunk(
        self, db, patched_async_session, monkeypatch
    ):
        monkeypatch.setattr(store, "catalog", lambda: CAT)
        loc = CustomLocale(code="nl", name="N", english_name="Dutch")
        db.add(loc)
        await db.flush()
        ns = CAT.namespaces["common"]
        db.add(
            CustomLocaleString(
                locale_id=loc.id,
                namespace="common",
                strings={"a": "Appel", "b": "Hallo {{name}}"},
                meta={"a": {"h": ns.hashes["a"]}, "b": {"h": "old"}},
            )
        )
        await db.flush()
        seen: list[list[str] | None] = []
        real = store.load_views

        async def spy(db_, locale, cat, names=None):
            seen.append(names)
            return await real(db_, locale, cat, names)

        monkeypatch.setattr(store, "load_views", spy)
        assert await tr._references("nl", "common", []) == [("Apple", "Appel")]
        assert await tr._references("nl", "common", ["a"]) == []
        assert seen == [["common", "metamodel"], ["common", "metamodel"]]

    async def test_a_metamodel_chunk_gets_no_second_copy_of_the_type_names(
        self, db, patched_async_session, monkeypatch
    ):
        from tests.conftest import create_card_type

        monkeypatch.setattr(store, "catalog", lambda: CAT)
        db.add(CustomLocale(code="nl", name="N", english_name="Dutch"))
        await create_card_type(
            db, key="Widget", label="Widget", translations={"label": {"nl": "Ding"}}
        )
        refs = await tr._references("nl", "metamodel", [])
        assert refs.count(("Widget", "Ding")) == 1
