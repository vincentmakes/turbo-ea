"""How ``app/services/document_discussion_service.py`` wires its helpers
together: exact arguments, statements and payloads, with a stand-in session
and recording spies (no database).

Each test pins one value a reader or a later step depends on: the session and
reader handed on, the read scope and register reused rather than reloaded,
the ordering and the filters of each query, the flags that decide who may
comment or moderate, and what a write stores and announces.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.models.architecture_decision import ArchitectureDecision
from app.models.soaw import SoAW
from app.services import document_discussion_service as svc
from app.services import mention_service, soaw_service
from app.services.permission_service import PermissionService

U1 = uuid.UUID("00000000-0000-4000-8000-000000000001")
U2 = uuid.UUID("00000000-0000-4000-8000-000000000002")
U3 = uuid.UUID("00000000-0000-4000-8000-000000000003")
U4 = uuid.UUID("00000000-0000-4000-8000-000000000004")
DOC = uuid.UUID("00000000-0000-4000-8000-0000000000d0")
REV1 = uuid.UUID("00000000-0000-4000-8000-0000000000e1")
CID = uuid.UUID("00000000-0000-4000-8000-0000000000f1")
NOW = datetime(2026, 11, 10, 9, 30, tzinfo=timezone.utc)


class Result:
    def __init__(self, rows=(), scalar=None):
        self.rows = list(rows)
        self.scalar = scalar

    def scalars(self):
        return self

    def all(self):
        return list(self.rows)

    def scalar_one(self):
        return self.scalar


class FakeDb:
    """``execute`` answers the queued results in order and keeps each statement."""

    def __init__(self, *results):
        self.results = list(results)
        self.statements: list = []
        self.added: list = []
        self.flushes = 0

    async def execute(self, stmt):
        self.statements.append(stmt)
        if not self.results:
            raise AssertionError(f"unexpected query: {stmt}")
        return self.results.pop(0)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        self.flushes += 1

    async def get(self, *args):
        raise AssertionError("no get expected")

    def sql(self, index: int) -> str:
        return " ".join(str(self.statements[index]).split())


def spy(result=None, exc: BaseException | None = None):
    calls: list = []

    async def fn(*args, **kwargs):
        calls.append((args, kwargs))
        if exc is not None:
            raise exc
        return result

    fn.calls = calls  # type: ignore[attr-defined]
    return fn


def refuse(name: str):
    async def fn(*args, **kwargs):
        raise AssertionError(f"{name} must not be called")

    return fn


def span(kind, mention_id):
    return f'<span data-type="mention" data-kind="{kind}" data-id="{mention_id}"></span>'


def _user(uid=U1, name="Ann"):
    return SimpleNamespace(id=uid, display_name=name)


def _doc(**kw):
    base = {
        "id": DOC,
        "revision_number": 2,
        "signatories": [],
        "created_by": U1,
        "name": "Plan",
        "title": "T",
        "reference_number": "ADR-1",
    }
    base.update(kw)
    return SimpleNamespace(**base)


def _comment(*, cid=CID, author=U1, parent=None, body="<p>Hi</p>", kind="comment", owner=DOC):
    return SimpleNamespace(
        id=cid,
        kind=kind,
        author_id=author,
        author_name="Snap",
        parent_id=parent,
        deleted_at=None,
        resolved_at=None,
        resolved_by=None,
        architecture_decision_id=owner,
        soaw_id=None,
        body=body,
        section=None,
        created_at=NOW,
        edited_at=None,
    )


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def test_now_is_aware_utc():
    assert svc._now().tzinfo is timezone.utc


def test_a_round_without_a_kind_is_not_a_review_round():
    row = SimpleNamespace(signatories=[{"user_id": str(U1)}])
    assert svc.signatory_ids(None, [row]) == set()


def test_text_after_the_last_attribute_refuses_the_href():
    assert svc.safe_href(' href="https://x.test"X') is None
    assert svc.safe_href(' href="https://x.test" /') == "https://x.test"


def test_nested_links_keep_both_closing_tags():
    body = '<a href="https://a.test"><a href="https://b.test">x</a></a>'
    assert svc.comment_html(body) == body


def test_a_link_before_a_mention_is_kept():
    mention = span("user", U2)
    assert svc.comment_html(f'<a href="https://a.test">x</a> {mention}') == (
        f'<a href="https://a.test">x</a> {mention}'
    )


def test_comment_can_passes_may_comment_to_edit():
    comment = _comment(author=U1)
    assert svc.comment_can(comment, U1, may_comment=False, moderate=False) == {
        "edit": False,
        "delete": True,
        "resolve": False,
    }


def test_model_per_kind():
    assert svc._model("adr") is ArchitectureDecision
    assert svc._model("soaw") is SoAW


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


async def test_review_rows_filters_owner_and_kind():
    row = SimpleNamespace(architecture_decision_id=DOC, kind="sent_for_review")
    db = FakeDb(Result([row]))
    assert await svc.review_rows(db, "adr", [DOC]) == {str(DOC): [row]}
    sql = db.sql(0)
    assert "document_history.architecture_decision_id IN" in sql
    assert "document_history.kind = " in sql


async def test_signatory_of_answers_from_current_signatories_without_a_query():
    db = FakeDb()
    doc = _doc(signatories=[{"user_id": str(U1)}])
    assert await svc.signatory_of(db, "adr", doc, U1) is True
    assert db.statements == []


async def test_access_hands_the_session_on_and_keeps_holds(monkeypatch):
    seen = []

    async def check(db, user, perm):
        seen.append((db, user, perm))
        return perm == "adr.comment"

    monkeypatch.setattr(PermissionService, "check_permission", check)
    monkeypatch.setattr(svc, "signatory_of", refuse("signatory_of"))
    db, user = FakeDb(), _user()
    acc = await svc.access(db, "adr", _doc(), user)
    assert [p for _, _, p in seen] == ["adr.comment", "adr.manage"]
    assert all(d is db and u is user for d, u, _ in seen)
    assert (acc.comment, acc.moderate, acc.holds_comment) == (True, False, True)


async def test_renderer_passes_scope_and_register(monkeypatch):
    states = spy({})
    monkeypatch.setattr(mention_service, "mention_states", states)
    db, user, scope, register = FakeDb(), _user(), object(), object()
    await svc._renderer(
        db, [_comment(body=span("user", U2))], user=user, read_scope=scope, register=register
    )
    ((args, kwargs),) = states.calls
    assert args[0] is db
    assert kwargs["user"] is user
    assert kwargs["read_scope"] is scope
    assert kwargs["register"] is register


class FakeRegister:
    def __init__(self, ids, nodes=()):
        self.ids = set(ids)
        self.nodes = list(nodes)

    def __contains__(self, item):
        return item in self.ids

    def chain(self, doc_id):
        return SimpleNamespace(nodes=self.nodes)


async def test_revisions_reuse_a_given_register(monkeypatch):
    monkeypatch.setattr(svc.ds, "load_register", refuse("load_register"))
    nodes = [
        SimpleNamespace(id=REV1, revision_number=1),
        SimpleNamespace(id=DOC, revision_number=2),
    ]
    register = FakeRegister({REV1, DOC}, nodes)
    revisions, reg = await svc._revisions(FakeDb(), "adr", _doc(), svc.CHAIN, register)
    assert revisions == {str(REV1): 1, str(DOC): 2}
    assert reg is register


async def test_revisions_of_a_decision_outside_the_register(monkeypatch):
    register = FakeRegister(set())
    monkeypatch.setattr(svc.ds, "load_register", spy(register))
    revisions, reg = await svc._revisions(FakeDb(), "adr", _doc(), svc.CHAIN, None)
    assert revisions == {str(DOC): 2}
    assert reg is register


async def test_revisions_of_a_soaw_without_a_chain(monkeypatch):
    chains = SimpleNamespace(chain=lambda doc_id: None)
    monkeypatch.setattr(soaw_service, "load_chains", spy(chains))
    register = object()
    revisions, reg = await svc._revisions(FakeDb(), "soaw", _doc(), svc.CHAIN, register)
    assert revisions == {str(DOC): 2}
    assert reg is register


async def test_may_comment_everywhere_with_the_permission():
    ids = [str(REV1), str(DOC)]
    assert await svc._may_comment_per_revision(FakeDb(), "adr", ids, _user(), holds=True) == {
        str(REV1): True,
        str(DOC): True,
    }


async def test_may_comment_as_a_current_signatory():
    db = FakeDb(
        Result([(REV1, [{"user_id": str(U1)}]), (DOC, [{"user_id": str(U2)}])]),
        Result([]),
    )
    ids = [str(REV1), str(DOC)]
    out = await svc._may_comment_per_revision(db, "adr", ids, _user(), holds=False)
    assert out == {str(REV1): True, str(DOC): False}
    sql = db.sql(0)
    assert sql.startswith(
        "SELECT architecture_decisions.id, architecture_decisions.signatories "
        "FROM architecture_decisions WHERE architecture_decisions.id IN"
    )


def _stub_threads(monkeypatch, *, register_out=None):
    render = spy(lambda c: c.body)
    revisions = spy(({str(DOC): 2}, register_out))
    monkeypatch.setattr(svc, "_renderer", render)
    monkeypatch.setattr(svc, "_names", spy({}))
    monkeypatch.setattr(svc, "_revisions", revisions)
    return render, revisions


async def test_list_threads_refuses_an_unknown_scope():
    with pytest.raises(ValueError, match=r"^Unknown scope 'all'$"):
        await svc.list_threads(FakeDb(), "adr", _doc(), user=_user(), scope="all")


async def test_list_threads_with_given_rights(monkeypatch):
    loaded = object()
    render, revisions = _stub_threads(monkeypatch, register_out=loaded)
    monkeypatch.setattr(svc, "access", refuse("access"))
    db, user, doc, scope, register = (
        FakeDb(Result([_comment()])),
        _user(),
        _doc(),
        object(),
        object(),
    )
    acc = svc.Access(comment=True, moderate=False, holds_comment=True)
    out = await svc.list_threads(
        db, "adr", doc, user=user, acc=acc, read_scope=scope, register=register
    )
    assert out["threads"][0]["can"] == {"edit": True, "delete": True, "resolve": True}
    assert out["open_count"] == 1
    assert revisions.calls[0][0][4] is register
    ((_, kwargs),) = render.calls
    assert kwargs["read_scope"] is scope
    assert kwargs["register"] is loaded
    assert kwargs["user"] is user
    assert "ORDER BY document_comments.created_at, document_comments.id" in db.sql(0)


async def test_list_threads_loads_the_rights(monkeypatch):
    _stub_threads(monkeypatch)
    acc = svc.Access(comment=False, moderate=True)
    access = spy(acc)
    monkeypatch.setattr(svc, "access", access)
    db, user, doc = FakeDb(Result([])), _user(), _doc()
    out = await svc.list_threads(db, "adr", doc, user=user)
    ((args, kwargs),) = access.calls
    assert len(args) == 4 and kwargs == {}
    assert args[0] is db and args[1] == "adr" and args[2] is doc and args[3] is user
    assert out["can"] == {"comment": False, "moderate": True}


async def test_list_threads_over_a_chain_passes_holds(monkeypatch):
    _stub_threads(monkeypatch)
    per_revision = spy({str(DOC): False})
    monkeypatch.setattr(svc, "_may_comment_per_revision", per_revision)
    acc = svc.Access(comment=True, moderate=False, holds_comment=True)
    db, user = FakeDb(Result([_comment()])), _user()
    out = await svc.list_threads(db, "adr", _doc(), user=user, acc=acc, scope=svc.CHAIN)
    ((args, kwargs),) = per_revision.calls
    assert args[0] is db and args[2] == [str(DOC)] and args[3] is user
    assert kwargs["holds"] is True
    assert out["threads"][0]["can"]["resolve"] is False


async def test_open_thread_count_query():
    db = FakeDb(Result(scalar=4))
    assert await svc.open_thread_count(db, "adr", DOC) == 4
    sql = db.sql(0)
    assert sql.startswith("SELECT count(document_comments.id) AS count_1")
    assert "document_comments.deleted_at IS NULL" in sql
    assert "document_comments.parent_id IS NULL" in sql


async def test_thread_payload_for_a_moderator(monkeypatch):
    render = spy(lambda c: c.body)
    monkeypatch.setattr(svc, "_renderer", render)
    monkeypatch.setattr(svc, "_names", spy({}))
    top = _comment(author=U2)
    reply = _comment(cid=REV1, author=U2, parent=CID)
    db, user, scope = FakeDb(Result([reply])), _user(), object()
    acc = svc.Access(comment=True, moderate=True)
    thread = await svc.thread_payload(db, "adr", _doc(), top, user=user, acc=acc, read_scope=scope)
    assert thread["can"] == {"edit": False, "delete": True, "resolve": True}
    assert thread["replies"][0]["can"]["delete"] is True
    ((_, kwargs),) = render.calls
    assert kwargs["read_scope"] is scope
    assert "ORDER BY document_comments.created_at, document_comments.id" in db.sql(0)


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


async def test_check_mentions_hands_on_the_scope(monkeypatch):
    check = spy()
    monkeypatch.setattr(mention_service, "check_new_mentions", check)
    db, user, scope = FakeDb(), _user(), object()
    await svc._check_mentions(db, None, span("card", U3), user=user, read_scope=scope)
    ((args, kwargs),) = check.calls
    assert args == (db, {("card", str(U3))})
    assert kwargs["user"] is user
    assert kwargs["read_scope"] is scope
    assert kwargs["system"] is False


async def test_audience_queries_and_inputs():
    db = FakeDb(Result([]), Result([U3]), Result([U4]))
    doc = _doc(signatories=[{"user_id": str(U2)}])
    out = await svc._audience(db, "adr", doc, exclude=CID)
    assert out == {
        "creator_id": U1,
        "signatories": {str(U2)},
        "people": [U3],
        "commenters": [U4],
    }
    people = db.sql(1)
    assert "architecture_decision_people.architecture_decision_id = " in people
    assert "architecture_decision_people.user_id IS NOT NULL" in people
    commenters = db.sql(2)
    assert "document_comments.architecture_decision_id = " in commenters
    assert "document_comments.author_id IS NOT NULL" in commenters
    assert "document_comments.id != " in commenters


async def test_notify_names_unknown_people_blank_and_excludes_the_comment(monkeypatch):
    monkeypatch.setattr(svc, "document_label", lambda kind, doc: "Doc")
    monkeypatch.setattr(svc, "_viewers", spy((set(), {})))
    audience = spy({"creator_id": None, "signatories": set(), "people": [], "commenters": []})
    monkeypatch.setattr(svc, "_audience", audience)
    unnotified, deliveries = await svc._notify(
        FakeDb(),
        "adr",
        _doc(),
        _comment(),
        user=_user(),
        mentioned=[str(U3)],
        announce=True,
    )
    assert unnotified == [{"id": str(U3), "display_name": ""}]
    assert deliveries == ()
    ((_, kwargs),) = audience.calls
    assert kwargs == {"exclude": CID}


def _stub_writes(monkeypatch):
    check = spy()
    notify = spy(([], ()))
    monkeypatch.setattr(svc, "_check_mentions", check)
    monkeypatch.setattr(svc, "_notify", notify)
    monkeypatch.setattr(svc.event_bus, "publish", spy())
    return check, notify


async def test_add_comment_stores_a_plain_comment(monkeypatch):
    check, notify = _stub_writes(monkeypatch)
    monkeypatch.setattr(svc, "_now", lambda: NOW)
    db, user, scope = FakeDb(), _user(), object()
    acc = svc.Access(comment=True, moderate=False)
    body = f"<p>me {span('user', U1)}</p>"
    written = await svc.add_comment(
        db, "adr", _doc(), user=user, acc=acc, body=body, read_scope=scope
    )
    (stored,) = db.added
    assert stored.kind == "comment"
    assert stored.created_at == NOW
    assert written.comment is stored
    ((args, kwargs),) = check.calls
    assert args == (db, None, stored.body)
    assert kwargs["read_scope"] is scope
    assert notify.calls[0][1]["mentioned"] == []
    assert notify.calls[0][1]["announce"] is True


async def test_edit_comment_checks_and_announces_only_new_people(monkeypatch):
    check, notify = _stub_writes(monkeypatch)
    comment = _comment(author=U1, body="<p>a</p>")
    db, user, scope = FakeDb(), _user(), object()
    acc = svc.Access(comment=True, moderate=False)
    body = f"<p>b {span('user', U1)} {span('user', U3)}</p>"
    written = await svc.edit_comment(
        db, "adr", _doc(), comment, user=user, acc=acc, body=body, read_scope=scope
    )
    ((args, kwargs),) = check.calls
    assert args == (db, "<p>a</p>", comment.body)
    assert comment.body == f"<p>b {span('user', U1)} {span('user', U3)}</p>"
    assert kwargs["user"] is user
    assert kwargs["read_scope"] is scope
    ((_, nkw),) = notify.calls
    assert nkw["mentioned"] == [str(U3)]
    assert nkw["announce"] is False
    assert written.comment is comment
    assert written.top is comment


async def test_add_system_comment_refuses_a_person_kind():
    with pytest.raises(ValueError, match=r"^Not a system comment kind: 'comment'$"):
        await svc.add_system_comment(FakeDb(), "adr", _doc(), kind="comment", user=_user(), text="")


async def test_add_system_comment_is_stamped_now(monkeypatch):
    monkeypatch.setattr(svc, "_now", lambda: NOW)
    db = FakeDb()
    comment = await svc.add_system_comment(
        db, "adr", _doc(), kind=svc.REJECTION, user=_user(), text="No"
    )
    assert comment.created_at == NOW
    assert comment.body == "<p>No</p>"
    assert db.added == [comment]
