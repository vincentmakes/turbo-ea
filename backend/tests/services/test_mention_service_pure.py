"""The mention service's queries and wiring, pinned without a database.

A scripted session answers each query in order and keeps the compiled SQL,
so the search conditions (escaped ``LIKE``, live comments only, the
``jsonb_each`` guard) are compared as text; the read scope, the permission
check and the decision register are fakes that answer only the exact
question the service must ask.
"""

from __future__ import annotations

import hashlib
import hmac
import uuid
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy import Text, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import visitors
from sqlalchemy.sql.selectable import TableValuedAlias

from app.config import settings
from app.models.document_comment import DocumentComment
from app.models.soaw import SoAW
from app.services import mention_service as ms
from app.services.permission_service import PermissionService

CARD = "0b7f2c1e-1111-4a2b-9c3d-000000000001"
DECISION = "0b7f2c1e-3333-4a2b-9c3d-000000000003"


def U(n: int) -> uuid.UUID:  # noqa: N802 - a constructor-like helper
    return uuid.UUID(int=n)


def span(kind: str, mention_id: Any) -> str:
    return ms.canonical_span(kind, str(mention_id))


def _compile(stmt: Any):
    return stmt.compile(dialect=postgresql.dialect())


class _Result:
    def __init__(self, rows: list[Any]):
        self._rows = rows

    def all(self) -> list[Any]:
        return list(self._rows)

    def scalars(self) -> _Result:
        return self


class FakeSession:
    """Answers the queries in order from ``answers``; keeps each compiled one."""

    def __init__(self, *answers: list[Any]):
        self.answers = list(answers)
        self.sql: list[str] = []
        self.params: list[dict[str, Any]] = []

    async def execute(self, stmt: Any) -> _Result:
        compiled = _compile(stmt)
        self.sql.append(str(compiled))
        self.params.append(dict(compiled.params))
        return _Result(self.answers.pop(0) if self.answers else [])


USER = SimpleNamespace(id=U(99))


class SpyScope:
    """Readable only for the module-mode question about a known card."""

    def __init__(self, readable_ids: set[uuid.UUID]):
        self.readable_ids = readable_ids
        self.calls: list[tuple[Any, Any, Any]] = []

    def readable(self, card_id, card_type, *, mode):
        self.calls.append((card_id, card_type, mode))
        return mode == "module" and card_id in self.readable_ids


def _strict_permission(monkeypatch, session, granted: set[str]):
    """``check_permission`` answering True only for this session and a granted key."""
    calls: list[tuple[Any, Any, Any]] = []

    async def check(db, user, key):
        calls.append((db, user, key))
        return db is session and key in granted

    monkeypatch.setattr(PermissionService, "check_permission", check)
    return calls


def _no_loading(monkeypatch):
    async def refuse(*_a, **_kw):
        raise AssertionError("loaded although it was passed")

    monkeypatch.setattr(ms.CardReadScope, "load", refuse)
    monkeypatch.setattr(ms.ds, "load_register", refuse)


class FakeRegister:
    """``ds.Register`` stand-in: chains of decision rows, standing per id."""

    def __init__(self, rows: dict[uuid.UUID, Any], chains=None, standing=None):
        self.rows = rows
        self.chains = chains or {}
        self.standing = standing or {}

    def __contains__(self, key) -> bool:
        return key in self.rows

    def row(self, key):
        return self.rows[key]

    def chain(self, key):
        if key not in self.rows:
            raise KeyError(key)
        return self.chains.get(key) or SimpleNamespace(
            current=SimpleNamespace(id=key), open_revision=None, nodes=[SimpleNamespace(id=key)]
        )

    def get(self, key):
        return self.standing.get(key)


def _decision_row(n: int, ref: str, rev: int | None = None, title: str = "T"):
    return SimpleNamespace(
        id=U(n), reference_number=ref, revision_number=rev, title=title, status="draft"
    )


# ── small pure answers ──────────────────────────────────────────────────────


def test_the_state_constructors_name_their_status_and_an_empty_token():
    assert ms.resolved("@A").status == "resolved"
    assert ms.restricted().token == ""
    assert ms.restricted().status == "restricted"


def test_a_token_is_the_hmac_of_the_lower_cased_ids():
    message = b"ab12cd34-ef:card:0b7f2c1e-aaaa"
    expected = hmac.new(settings.SECRET_KEY.encode(), message, hashlib.sha256).hexdigest()[:16]
    assert ms.token_for("AB12CD34-EF", "card", "0B7F2C1E-AAAA") == expected


def test_stored_mentions_read_a_document_missing_some_fields():
    doc = SimpleNamespace(context=span("card", CARD))
    assert ms.stored_mentions("adr", doc) == {("card", CARD)}


def test_a_decision_row_without_a_standing_says_none():
    reg = FakeRegister({U(1): _decision_row(1, "ADR-001", 1)})
    assert ms.mentioned_decision_rows(reg, {U(1): "text"}) == [
        {
            "id": str(U(1)),
            "reference_number": "ADR-001",
            "revision_number": 1,
            "title": "T",
            "status": "draft",
            "standing": None,
            "via": "text",
        }
    ]


# ── check_new_mentions ──────────────────────────────────────────────────────


async def test_a_new_card_mention_is_checked_in_module_mode_with_the_passed_scope(monkeypatch):
    _no_loading(monkeypatch)
    card = uuid.UUID(CARD)
    session = FakeSession([(card, "Application")])
    scope = SpyScope({card})
    await ms.check_new_mentions(
        session, {("card", CARD)}, user=USER, read_scope=scope, system=False
    )
    assert scope.calls == [(card, "Application", "module")]
    assert session.sql[0].startswith("SELECT cards.id, cards.type \nFROM cards")


async def test_a_new_decision_mention_asks_adr_view_on_the_session(monkeypatch):
    _no_loading(monkeypatch)
    session = FakeSession([uuid.UUID(DECISION)])
    calls = _strict_permission(monkeypatch, session, {"adr.view"})
    await ms.check_new_mentions(
        session, {("decision", DECISION)}, user=USER, read_scope=None, system=False
    )
    assert calls == [(session, USER, "adr.view")]


# ── mention_states ──────────────────────────────────────────────────────────


async def test_mention_states_use_the_passed_scope_register_and_permission(monkeypatch):
    _no_loading(monkeypatch)
    card = uuid.UUID(CARD)
    decision = uuid.UUID(DECISION)
    session = FakeSession(
        [SimpleNamespace(id=card, name="CRM", type="Application", status="ACTIVE")]
    )
    calls = _strict_permission(monkeypatch, session, {"adr.view"})
    scope = SpyScope({card})
    reg = FakeRegister({decision: _decision_row(3, "ADR-007", 2, "Pick")})
    states = await ms.mention_states(
        session,
        {("card", CARD), ("decision", DECISION)},
        user=USER,
        read_scope=scope,
        register=reg,
    )
    assert states == {
        ("card", CARD): ms.resolved("@CRM"),
        ("decision", DECISION): ms.resolved(ms.decision_label("ADR-007", 2, "Pick")),
    }
    assert scope.calls == [(card, "Application", "module")]
    assert calls == [(session, USER, "adr.view")]


# ── resolve_for_reader ──────────────────────────────────────────────────────


async def test_resolve_for_reader_passes_the_register_and_keeps_every_payload(monkeypatch):
    seen: dict[str, Any] = {}

    async def states(db, mentions, *, user, read_scope, register=None):
        seen["register"] = register
        return {("card", CARD): ms.resolved("@CRM")}

    monkeypatch.setattr(ms, "mention_states", states)
    reg = object()
    plain = {"id": str(U(1)), "context": "no mention here"}
    marked = {"id": str(U(2)), "context": span("card", CARD)}
    out = await ms.resolve_for_reader(
        object(), doc_kind="adr", payloads=[plain, marked], user=USER, read_scope=None, register=reg
    )
    assert seen["register"] is reg
    assert out[0] is plain
    assert out[1]["context"] == ms.render_span("card", CARD, ms.resolved("@CRM"))
    assert len(out) == 2


# ── the "Mentioned in" queries ──────────────────────────────────────────────


def test_a_section_search_reads_each_sections_content_with_an_escaped_like():
    expr = ms._section_mentions('data-id="x_y"')
    compiled = _compile(select(SoAW.id).where(expr))
    assert str(compiled) == (
        "SELECT statement_of_architecture_works.id \n"
        "FROM statement_of_architecture_works \n"
        "WHERE EXISTS (SELECT %(param_1)s::INTEGER AS anon_1 \n"
        "FROM jsonb_each(CASE WHEN (jsonb_typeof(statement_of_architecture_works.sections)"
        " = %(jsonb_typeof_1)s::VARCHAR) THEN statement_of_architecture_works.sections"
        " ELSE CAST(%(param_2)s::VARCHAR AS JSONB) END) AS anon_2 \n"
        "WHERE ((anon_2.value ->> %(value_1)s::TEXT) LIKE '%%' || %(param_3)s::VARCHAR"
        " || '%%' ESCAPE '/'))"
    )
    assert compiled.params == {
        "param_1": 1,
        "jsonb_typeof_1": "object",
        "param_2": "{}",
        "value_1": "content",
        "param_3": 'data-id="x/_y"',
    }
    (each,) = [el for el in visitors.iterate(expr) if isinstance(el, TableValuedAlias)]
    assert [(c.name, type(c.type)) for c in each.c] == [("key", Text), ("value", JSONB)]


async def test_comment_hits_search_live_comments_with_an_escaped_like():
    body = span("card", CARD)
    session = FakeSession([(U(1), body), (U(2), 'data-kind="card" text only')])
    found = await ms._comment_hits(
        session,
        DocumentComment.architecture_decision_id,
        [ms.marker_of("card", CARD)],
        {("card", CARD)},
    )
    assert found == {U(1)}
    (sql,) = session.sql
    assert sql == (
        "SELECT document_comments.architecture_decision_id, document_comments.body \n"
        "FROM document_comments \n"
        "WHERE document_comments.architecture_decision_id IS NOT NULL"
        " AND document_comments.deleted_at IS NULL"
        " AND (document_comments.body LIKE '%%' || %(body_1)s::VARCHAR || '%%' ESCAPE '/')"
    )


async def test_decisions_skip_unregistered_and_skipped_hits_and_keep_the_rest():
    wanted = {("card", CARD)}
    text = span("card", CARD)
    reg = FakeRegister({U(1): _decision_row(1, "ADR-001"), U(3): _decision_row(3, "ADR-003")})
    session = FakeSession(
        [(U(1), text, None, None, None), (U(2), text, None, None, None)],
        [(U(3), text)],
    )
    rows = await ms._decisions_mentioning(
        session, [ms.marker_of("card", CARD)], wanted, reg, skip={U(1)}
    )
    assert [(r["id"], r["via"]) for r in rows] == [(str(U(3)), "comment")]
    assert session.sql[0].count("ESCAPE '/'") == 4


async def _soaws(monkeypatch, comment_rows, text_rows, chains):
    async def load_chains(db):
        if chains is None:
            raise AssertionError("no hit: nothing to load")
        return chains

    monkeypatch.setattr(ms.soaw_service, "load_chains", load_chains)
    session = FakeSession(text_rows, comment_rows)
    return await ms._soaws_mentioning(session, [ms.marker_of("card", CARD)], {("card", CARD)})


def _soaw_chains(rows: dict[uuid.UUID, Any], chains: dict[uuid.UUID, Any]):
    return SimpleNamespace(rows=rows, chain=lambda hit: chains.get(hit))


def _soaw(row_id: Any, name: str, rev: int):
    return SimpleNamespace(id=row_id, name=name, revision_number=rev, status="draft")


def _chain(current: uuid.UUID, open_revision: uuid.UUID | None = None):
    return SimpleNamespace(
        current=SimpleNamespace(id=current),
        open_revision=SimpleNamespace(id=open_revision) if open_revision else None,
    )


def _sections(html: str) -> dict[str, Any]:
    return {"intro": {"content": html}}


async def test_no_soaw_hit_loads_no_chain(monkeypatch):
    assert await _soaws(monkeypatch, [], [], None) == []


async def test_a_soaw_mentioned_only_in_its_discussion_is_listed(monkeypatch):
    chains = _soaw_chains({U(5): _soaw(U(5), "Plan", 1)}, {U(5): _chain(U(5))})
    rows = await _soaws(monkeypatch, [(U(5), span("card", CARD))], [], chains)
    assert rows == [{"id": str(U(5)), "name": "Plan", "revision_number": 1, "status": "draft"}]


async def test_soaws_are_listed_by_name_revision_and_id(monkeypatch):
    text = _sections(span("card", CARD))
    rows = {
        U(2): _soaw("zz", "Zeta", 1),
        U(3): _soaw("bb", "Alpha", 2),
        U(4): _soaw("aa", "Alpha", 2),
        U(5): _soaw("cc", "Alpha", 1),
    }
    chain_map = {k: _chain(k) for k in rows}  # U(1) has no chain
    found = await _soaws(
        monkeypatch,
        [],
        [(U(n), text) for n in (1, 2, 3, 4, 5)],
        _soaw_chains(rows, chain_map),
    )
    assert [(r["id"], r["name"], r["revision_number"]) for r in found] == [
        ("cc", "Alpha", 1),
        ("aa", "Alpha", 2),
        ("bb", "Alpha", 2),
        ("zz", "Zeta", 1),
    ]


async def test_a_soaw_mentioned_only_in_its_open_revision_names_that_revision(monkeypatch):
    rows = {U(7): _soaw(U(7), "Plan", 1), U(6): _soaw(U(6), "Plan", 2)}
    chains = _soaw_chains(rows, {U(6): _chain(U(7), U(6))})
    found = await _soaws(monkeypatch, [], [(U(6), _sections(span("card", CARD)))], chains)
    assert found == [{"id": str(U(6)), "name": "Plan", "revision_number": 2, "status": "draft"}]


# ── _mentioned_in and its two callers ───────────────────────────────────────


async def test_mentioned_in_without_soaw_view_lists_no_soaw(monkeypatch):
    _no_loading(monkeypatch)
    session = object()
    calls = _strict_permission(monkeypatch, session, set())
    seen: dict[str, Any] = {}

    async def decisions(db, needles, wanted, register, *, skip):
        seen["register"], seen["skip"] = register, skip
        return ["d"]

    monkeypatch.setattr(ms, "_decisions_mentioning", decisions)
    reg = object()
    out = await ms._mentioned_in(
        session,
        {("card", CARD)},
        user=USER,
        may_view_decisions=True,
        register=reg,
        skip=[U(1)],
    )
    assert out == {"decisions": ["d"], "soaws": []}
    assert seen == {"register": reg, "skip": {U(1)}}
    assert calls == [(session, USER, "soaw.view")]


async def test_mentioned_in_with_soaw_view_lists_the_soaws(monkeypatch):
    session = object()
    _strict_permission(monkeypatch, session, {"soaw.view"})

    async def soaws(db, needles, wanted):
        return ["s"]

    monkeypatch.setattr(ms, "_soaws_mentioning", soaws)
    out = await ms._mentioned_in(session, {("card", CARD)}, user=USER, may_view_decisions=False)
    assert out == {"decisions": [], "soaws": ["s"]}


def _spy_mentioned_in(monkeypatch) -> dict[str, Any]:
    seen: dict[str, Any] = {}

    async def spy(db, wanted, **kwargs):
        seen.update(kwargs, db=db, wanted=wanted)
        return {}

    monkeypatch.setattr(ms, "_mentioned_in", spy)
    return seen


async def test_mentioned_in_card_asks_adr_view_on_the_session(monkeypatch):
    session = object()
    _strict_permission(monkeypatch, session, {"adr.view"})
    seen = _spy_mentioned_in(monkeypatch)
    await ms.mentioned_in_card(session, uuid.UUID(CARD), user=USER)
    assert seen["may_view_decisions"] is True
    assert seen["wanted"] == {("card", CARD)}


async def test_mentioned_in_decision_passes_its_register_and_skips_its_chain(monkeypatch):
    chain = SimpleNamespace(nodes=[SimpleNamespace(id=U(1)), SimpleNamespace(id=U(2))])
    reg = SimpleNamespace(chain=lambda _id: chain)

    async def load(db):
        return reg

    monkeypatch.setattr(ms.ds, "load_register", load)
    seen = _spy_mentioned_in(monkeypatch)
    await ms.mentioned_in_decision(object(), U(2), user=USER)
    assert seen["register"] is reg
    assert seen["skip"] == {U(1), U(2)}
    assert seen["wanted"] == {("decision", str(U(1))), ("decision", str(U(2)))}


@pytest.mark.parametrize("kind", ["card", "decision"])
def test_marker_of_lower_cases_the_id(kind):
    assert ms.marker_of(kind, CARD.upper()) == f'data-kind="{kind}" data-id="{CARD}"'
