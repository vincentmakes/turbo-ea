"""How ``app/services/document_history_service.py`` wires its helpers together
and a few exact edges of its pure rules, with a stand-in session and recording
spies (no database).

Pinned here: a non-table section holding ``columns`` is content; a restore
copies nested rows; a stored instant keeps its offset; a backfilled review
round reads only a list of signatories; the first save needs its earlier
state; a version is rendered for the reader with the document's id as the
token scope; a restore checks dates against today's UTC date and hands the
session, the document, the reader and the read scope on.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.services import adr_service, decision_people_service, document_collab, mention_service
from app.services import document_history_service as history

U1 = uuid.UUID("00000000-0000-4000-8000-000000000001")
U2 = uuid.UUID("00000000-0000-4000-8000-000000000002")
DOC = uuid.UUID("00000000-0000-4000-8000-0000000000d0")
ENTRY = uuid.UUID("00000000-0000-4000-8000-0000000000e1")
CARD = "00000000-0000-4000-8000-0000000000c1"


class Result:
    def __init__(self, rows=()):
        self.rows = list(rows)

    def scalars(self):
        return self

    def all(self):
        return list(self.rows)


class FakeDb:
    def __init__(self, *results):
        self.results = list(results)
        self.statements: list = []
        self.flushes = 0

    async def execute(self, stmt):
        self.statements.append(stmt)
        if not self.results:
            raise AssertionError(f"unexpected query: {stmt}")
        return self.results.pop(0)

    async def flush(self):
        self.flushes += 1

    async def get(self, *args):
        raise AssertionError("no get expected")


def spy(result=None):
    calls: list = []

    async def fn(*args, **kwargs):
        calls.append((args, kwargs))
        return result

    fn.calls = calls  # type: ignore[attr-defined]
    return fn


def sync_spy(result=None):
    calls: list = []

    def fn(*args, **kwargs):
        calls.append((args, kwargs))
        return result

    fn.calls = calls  # type: ignore[attr-defined]
    return fn


def refuse(name: str):
    async def fn(*args, **kwargs):
        raise AssertionError(f"{name} must not be called")

    return fn


# ---------------------------------------------------------------------------
# Pure edges
# ---------------------------------------------------------------------------


def test_a_non_table_section_key_with_columns_is_content():
    content = {"sections": {"1.1": {"extra": {"columns": ["A"]}}}}
    assert history.normalise(content) == content


def test_a_soaw_restore_copies_nested_rows():
    info = {"owner": {"name": "Ann"}}
    rows = [{"version": "1"}]
    fields = history.restore_fields(
        "soaw", {"name": "N", "document_info": info, "version_history": rows}
    )
    assert fields["document_info"] == info
    assert fields["document_info"]["owner"] is not info["owner"]
    assert fields["version_history"] == rows
    assert fields["version_history"][0] is not rows[0]


def test_restore_fields_refuses_an_unknown_kind():
    with pytest.raises(ValueError, match=r"^Unknown document kind 'risk'$"):
        history.restore_fields("risk", {})


def test_a_stored_time_keeps_its_offset():
    value = history._stored_time("2026-01-01T10:00:00+02:00")
    assert value is not None
    assert value.utcoffset() == timedelta(hours=2)
    assert value.hour == 10


def test_a_backfilled_round_reads_only_a_list_of_signatories():
    rows = [
        {
            "kind": "soaw",
            "id": DOC,
            "status": "in_review",
            "created_at": "2026-01-01T10:00:00+00:00",
            "updated_at": "2026-01-02T10:00:00+00:00",
            "signatories": ({"user_id": str(U1), "display_name": "Ann"},),
        }
    ]
    planned = history.plan_backfill(rows, {})
    assert [p["kind"] for p in planned] == ["created", "sent_for_review"]
    assert planned[1]["signatories"] == []


async def test_the_first_save_needs_its_earlier_state(monkeypatch):
    monkeypatch.setattr(history, "current_snapshot", spy({}))
    monkeypatch.setattr(history, "latest_version", spy(None))
    with pytest.raises(
        ValueError, match=r"^The first recorded save of a document needs its earlier state$"
    ):
        await history.record_save(FakeDb(), "adr", SimpleNamespace(id=DOC), user=None, before=None)


async def test_live_user_ids_skip_a_bad_id_and_keep_reading():
    db = FakeDb(Result([U2]))
    fields = {"decision_makers": [{"user_id": "nope"}, {"user_id": str(U2)}], "participants": []}
    assert await history._live_user_ids(db, fields) == {str(U2)}
    assert len(db.statements) == 1


# ---------------------------------------------------------------------------
# version_payload
# ---------------------------------------------------------------------------


def _entry(content):
    return SimpleNamespace(id=ENTRY, content=content, actor_id=None)


def _stub_payload(monkeypatch):
    sources = spy({})
    monkeypatch.setattr(history, "_sources", sources)
    monkeypatch.setattr(
        history, "entry_payload", lambda entry, name, srcs: {"actor": name, "sources": srcs}
    )
    return sources


async def test_a_version_is_rendered_for_the_reader(monkeypatch):
    sources = _stub_payload(monkeypatch)
    states = spy({})
    render = sync_spy("R")
    monkeypatch.setattr(mention_service, "mention_states", states)
    monkeypatch.setattr(mention_service, "render_for", render)
    mention = f'<span data-type="mention" data-kind="card" data-id="{CARD}"></span>'
    entry = _entry({"context": f"<p>{mention}</p>"})
    db, user, scope, doc = FakeDb(), SimpleNamespace(id=U1), object(), SimpleNamespace(id=DOC)
    out = await history.version_payload(db, "adr", doc, entry, user=user, read_scope=scope)
    assert out["entry"] == {"actor": None, "sources": {}}
    assert out["content"]["context"] == "R"
    ((sargs, skw),) = states.calls
    assert sargs[0] is db
    assert skw["user"] is user
    assert skw["read_scope"] is scope
    ((_, rkw),) = render.calls
    assert rkw["scope_id"] == DOC
    ((args, _),) = sources.calls
    assert args == (db, "adr", DOC, [entry])


async def test_a_version_without_mentions_reads_no_states(monkeypatch):
    _stub_payload(monkeypatch)
    monkeypatch.setattr(mention_service, "mention_states", refuse("mention_states"))
    entry = _entry({"context": "<p>plain</p>"})
    out = await history.version_payload(
        FakeDb(),
        "adr",
        SimpleNamespace(id=DOC),
        entry,
        user=SimpleNamespace(id=U1),
        read_scope=None,
    )
    assert out["content"]["context"] == "<p>plain</p>"


# ---------------------------------------------------------------------------
# restore
# ---------------------------------------------------------------------------


class _Clock(datetime):
    """``now(utc)`` and a naive ``now()`` fall on different days."""

    @classmethod
    def now(cls, tz=None):
        if tz is timezone.utc:
            return datetime(2026, 1, 2, 0, 30, tzinfo=timezone.utc)
        return datetime(2026, 1, 1, 23, 30)


def _stub_restore(monkeypatch, content, text):
    before_save = spy(text)
    written = object()
    monkeypatch.setattr(history, "load_version", spy(SimpleNamespace(id=ENTRY, content=content)))
    monkeypatch.setattr(document_collab, "before_save", before_save)
    monkeypatch.setattr(history, "current_snapshot", spy({"after": 1}))
    write = spy(written)
    monkeypatch.setattr(history, "_write", write)
    return before_save, write, written


async def test_restore_of_a_decision(monkeypatch):
    content = {"title": "T", "context": "<p>c</p>", "decided_on": "2026-01-01"}
    text = {field: f"<p>{field}</p>" for field in history.ADR_TEXT_FIELDS}
    before_save, write, written = _stub_restore(monkeypatch, content, text)
    check = sync_spy()
    monkeypatch.setattr(adr_service, "check_dates", check)
    monkeypatch.setattr(history, "datetime", _Clock)
    live = spy(set())
    monkeypatch.setattr(history, "_live_user_ids", live)
    people = spy()
    monkeypatch.setattr(decision_people_service, "replace_people", people)
    db, user, scope = FakeDb(), SimpleNamespace(id=U1), object()
    doc = SimpleNamespace(id=DOC, status="draft")
    out = await history.restore(db, "adr", doc, str(ENTRY), user=user, read_scope=scope)
    assert out is written
    ((cargs, ckw),) = check.calls
    assert cargs == (date(2026, 1, 1), None, None)
    assert ckw == {"today": date(2026, 1, 2)}
    ((args, kwargs),) = before_save.calls
    assert args[0] is db and args[1] == "adr" and args[2] is doc
    assert args[3] == {
        "context": "<p>c</p>",
        "decision": None,
        "consequences": None,
        "alternatives_considered": None,
    }
    assert kwargs["user"] is user
    assert kwargs["read_scope"] is scope
    assert live.calls[0][0][0] is db
    assert people.calls[0][0][0] is db and people.calls[0][0][1] is doc
    assert doc.context == "<p>context</p>"
    assert doc.decided_on == date(2026, 1, 1)
    ((wargs, wkw),) = write.calls
    assert wargs == (db, "adr", doc, "restored", {"after": 1})
    assert wkw == {"user": user, "note": str(ENTRY)}


async def test_restore_of_a_soaw(monkeypatch):
    sections = {"1.1": {"content": "<p>s</p>"}}
    content = {"name": "N", "sections": sections}
    before_save, _, written = _stub_restore(monkeypatch, content, {"sections": {"x": 1}})
    db, user, scope = FakeDb(), SimpleNamespace(id=U1), object()
    doc = SimpleNamespace(id=DOC, status="draft")
    out = await history.restore(db, "soaw", doc, str(ENTRY), user=user, read_scope=scope)
    assert out is written
    ((args, kwargs),) = before_save.calls
    assert args[0] is db and args[1] == "soaw" and args[2] is doc
    assert args[3] == {"sections": sections}
    assert kwargs["user"] is user
    assert kwargs["read_scope"] is scope
    assert doc.sections == {"x": 1}
    assert doc.name == "N"
