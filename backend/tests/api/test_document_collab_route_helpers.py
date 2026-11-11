"""The shared bodies of the discussion and history routes
(``app/api/v1/document_comments.py``, ``app/api/v1/document_history.py``):
what each hands to the services, with recording spies (no database).

The route tests prove the behaviour end to end; these pin the arguments a
mutation of the plain helpers would change without a visible effect on one
request: the rights already computed are reused, the document kind and the
actor are passed on, and only a decision loads a card read scope.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

from app.api.v1 import document_comments as comments_routes
from app.api.v1 import document_history as history_routes
from app.services import document_collab as collab
from app.services import document_discussion_service as discussion
from app.services import document_history_service as history
from app.services.card_read_scope import CardReadScope
from app.services.permission_service import PermissionService

U1 = uuid.UUID("00000000-0000-4000-8000-000000000001")
DOC = uuid.UUID("00000000-0000-4000-8000-0000000000d0")
CID = "00000000-0000-4000-8000-0000000000f1"


class FakeDb:
    def __init__(self):
        self.commits = 0

    async def commit(self):
        self.commits += 1


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


def _setup(monkeypatch):
    doc = SimpleNamespace(id=DOC)
    acc = discussion.Access(comment=True, moderate=False)
    monkeypatch.setattr(discussion, "open_document", spy((doc, acc)))
    thread = spy({"id": "thread"})
    monkeypatch.setattr(discussion, "thread_payload", thread)
    deliveries = sync_spy()
    monkeypatch.setattr(discussion, "schedule_deliveries", deliveries)
    return doc, acc, thread, deliveries


async def test_list_reuses_the_rights(monkeypatch):
    doc, acc, _, _ = _setup(monkeypatch)
    listing = spy({"threads": []})
    monkeypatch.setattr(discussion, "list_threads", listing)
    db, user = FakeDb(), SimpleNamespace(id=U1)
    assert await comments_routes._list(db, user, "adr", str(DOC), "chain") == {"threads": []}
    ((args, kwargs),) = listing.calls
    assert args == (db, "adr", doc)
    assert kwargs["user"] is user
    assert kwargs["acc"] is acc
    assert kwargs["scope"] == "chain"


async def test_create_passes_the_kind_and_the_actor(monkeypatch):
    doc, acc, thread, deliveries = _setup(monkeypatch)
    top = object()
    written = SimpleNamespace(top=top, deliveries=("d",), unnotified=[])
    monkeypatch.setattr(discussion, "add_comment", spy(written))
    db, user, tasks = FakeDb(), SimpleNamespace(id=U1), object()
    body = comments_routes.CommentCreate(body="<p>x</p>")
    out = await comments_routes._create(db, user, "soaw", str(DOC), body, tasks)
    assert out == {"id": "thread", "unnotified_mentions": []}
    ((targs, tkw),) = thread.calls
    assert targs == (db, "soaw", doc, top)
    assert tkw["user"] is user and tkw["acc"] is acc
    ((dargs, dkw),) = deliveries.calls
    assert dargs == (tasks, ("d",))
    assert dkw == {"actor_id": U1}
    assert db.commits == 1


async def test_update_passes_the_kind_and_the_actor(monkeypatch):
    doc, acc, thread, deliveries = _setup(monkeypatch)
    comment, top = object(), object()
    monkeypatch.setattr(discussion, "load_comment", spy(comment))
    written = SimpleNamespace(top=top, deliveries=("d",), unnotified=[{"id": "u"}])
    monkeypatch.setattr(discussion, "edit_comment", spy(written))
    db, user, tasks = FakeDb(), SimpleNamespace(id=U1), object()
    body = comments_routes.CommentUpdate(body="<p>x</p>")
    out = await comments_routes._update(db, user, "adr", str(DOC), CID, body, tasks)
    assert out == {"id": "thread", "unnotified_mentions": [{"id": "u"}]}
    ((targs, tkw),) = thread.calls
    assert targs == (db, "adr", doc, top)
    assert tkw["user"] is user and tkw["acc"] is acc
    ((dargs, dkw),) = deliveries.calls
    assert dargs == (tasks, ("d",))
    assert dkw == {"actor_id": U1}


async def test_reopen_passes_the_reader_and_the_kind(monkeypatch):
    doc, acc, thread, _ = _setup(monkeypatch)
    comment = object()
    monkeypatch.setattr(discussion, "load_comment", spy(comment))
    monkeypatch.setattr(discussion, "resolve_thread", refuse("resolve_thread"))
    reopen = spy(comment)
    monkeypatch.setattr(discussion, "reopen_thread", reopen)
    db, user = FakeDb(), SimpleNamespace(id=U1)
    out = await comments_routes._resolve(db, user, "soaw", str(DOC), CID, resolved=False)
    assert out == {"id": "thread"}
    ((rargs, rkw),) = reopen.calls
    assert rargs == (db, comment)
    assert rkw["user"] is user and rkw["acc"] is acc
    ((targs, _),) = thread.calls
    assert targs == (db, "soaw", doc, comment)


async def test_rights_ask_in_the_callers_session(monkeypatch):
    seen = []

    async def check(db, user, perm):
        seen.append((db, user, perm))
        return True

    monkeypatch.setattr(PermissionService, "check_permission", check)
    monkeypatch.setattr(discussion, "signatory_of", refuse("signatory_of"))
    db, user = FakeDb(), SimpleNamespace(id=U1)
    assert await history_routes._rights(db, "soaw", SimpleNamespace(id=DOC), user) == (True, True)
    ((d, u, perm),) = seen
    assert d is db and u is user and perm == "soaw.manage"


def _setup_version(monkeypatch):
    doc, entry, scope = SimpleNamespace(id=DOC), object(), object()

    async def check(db, user, perm):
        return True

    monkeypatch.setattr(PermissionService, "require_permission", spy())
    monkeypatch.setattr(PermissionService, "check_permission", check)
    monkeypatch.setattr(collab, "load_document", spy(doc))
    monkeypatch.setattr(history, "load_version", spy(entry))
    payload = spy({"entry": {}})
    monkeypatch.setattr(history, "version_payload", payload)
    return doc, entry, scope, payload


async def test_a_decision_version_is_read_with_the_card_scope(monkeypatch):
    doc, entry, scope, payload = _setup_version(monkeypatch)
    load = spy(scope)
    monkeypatch.setattr(CardReadScope, "load", load)
    db, user = FakeDb(), SimpleNamespace(id=U1)
    assert await history_routes._version(db, "adr", str(DOC), "e1", user) == {"entry": {}}
    ((largs, _),) = load.calls
    assert largs == (db, user)
    ((args, kwargs),) = payload.calls
    assert args == (db, "adr", doc, entry)
    assert kwargs["user"] is user
    assert kwargs["read_scope"] is scope


async def test_a_soaw_version_reads_no_card_scope(monkeypatch):
    doc, entry, _, payload = _setup_version(monkeypatch)
    monkeypatch.setattr(CardReadScope, "load", refuse("CardReadScope.load"))
    db, user = FakeDb(), SimpleNamespace(id=U1)
    await history_routes._version(db, "soaw", str(DOC), "e1", user)
    ((args, kwargs),) = payload.calls
    assert args == (db, "soaw", doc, entry)
    assert kwargs["read_scope"] is None
