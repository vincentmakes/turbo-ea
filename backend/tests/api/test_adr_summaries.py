"""``app/api/v1/adr.py::_summaries``: the list rows of decisions, with
recording spies in place of the queries' collaborators (no database).

A plain list carries no section text; the spreadsheet export
(``with_content``) adds every section and the references of each decision;
the batch is rendered once for the reader, with the read scope and the
register already in hand (no scope at all for an empty page).
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

from app.api.v1 import adr as adr_routes
from app.services import adr_import_service, adr_service, decision_people_service, document_collab
from app.services.card_read_scope import CardReadScope

U1 = uuid.UUID("00000000-0000-4000-8000-000000000001")
DOC = uuid.UUID("00000000-0000-4000-8000-0000000000d0")


class Result:
    def all(self):
        return []


class FakeDb:
    def __init__(self):
        self.statements: list = []

    async def execute(self, stmt):
        self.statements.append(stmt)
        return Result()


class FakeScope:
    def where(self, model, *, mode):
        return []


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


def _setup(monkeypatch, scope):
    async def load(db, user):
        return scope

    async def render(db, kind, payloads, **kwargs):
        render.calls.append(((db, kind, payloads), kwargs))  # type: ignore[attr-defined]
        return payloads

    render.calls = []  # type: ignore[attr-defined]
    monkeypatch.setattr(CardReadScope, "load", load)
    monkeypatch.setattr(decision_people_service, "people_payload", spy({}))
    monkeypatch.setattr(
        adr_routes, "_adr_to_summary", lambda adr, *args, **kwargs: {"id": str(adr.id)}
    )
    monkeypatch.setattr(document_collab, "render_doc", render)
    return render


def _adr():
    return SimpleNamespace(
        id=DOC,
        created_by=None,
        context="<p>c</p>",
        consequences="<p>q</p>",
        alternatives_considered="<p>a</p>",
    )


async def test_a_plain_list_carries_no_section_text(monkeypatch):
    _setup(monkeypatch, FakeScope())
    out = await adr_routes._summaries(FakeDb(), [_adr()], object(), SimpleNamespace(id=U1))
    assert out == [{"id": str(DOC)}]


async def test_the_export_adds_sections_and_references(monkeypatch):
    scope = FakeScope()
    render = _setup(monkeypatch, scope)
    labels = sync_spy(["ADR-2"])
    links = sync_spy([{"reference": "ADR-3"}])
    monkeypatch.setattr(adr_import_service, "related_reference_labels", labels)
    monkeypatch.setattr(adr_service, "link_references", links)
    db, register, user = FakeDb(), object(), SimpleNamespace(id=U1)
    out = await adr_routes._summaries(db, [_adr()], register, user, with_content=True)
    assert out == [
        {
            "id": str(DOC),
            "context": "<p>c</p>",
            "consequences": "<p>q</p>",
            "alternatives_considered": "<p>a</p>",
            "related_references": ["ADR-2"],
            "link_references": [{"reference": "ADR-3"}],
        }
    ]
    ((largs, _),) = labels.calls
    assert largs[0] is register and largs[1] == DOC
    ((kargs, _),) = links.calls
    assert kargs[0] is register and kargs[1] == DOC
    ((rargs, rkw),) = render.calls
    assert rargs[0] is db and rargs[1] == "adr"
    assert rkw["user"] is user
    assert rkw["read_scope"] is scope
    assert rkw["register"] is register


async def test_an_empty_page_renders_without_a_scope(monkeypatch):
    render = _setup(monkeypatch, FakeScope())
    assert await adr_routes._summaries(FakeDb(), [], object(), SimpleNamespace(id=U1)) == []
    ((_, rkw),) = render.calls
    assert rkw["read_scope"] is None
