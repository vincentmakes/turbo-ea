"""What the revision and copy paths hand to ``document_collab``, and what
``document_collab.render_doc`` hands to the mention resolver (no database).

A new SoAW or decision revision copies its text through ``before_save`` in
the caller's session and as a copy (its mentions carried, never re-checked);
a duplicated decision records its ``created`` row itself, after its people
are copied, so ``create_decision`` must not record one; and a batch render
reuses the register the caller already holds.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from app.services import adr_service, document_collab, mention_service, soaw_service

DOC = uuid.UUID("00000000-0000-4000-8000-0000000000d0")


class StopError(Exception):
    """Ends the function under test once the call of interest was recorded."""


def stopping_spy():
    calls: list = []

    async def fn(*args, **kwargs):
        calls.append((args, kwargs))
        raise StopError

    fn.calls = calls  # type: ignore[attr-defined]
    return fn


async def test_a_soaw_revision_copies_its_text_in_the_callers_session(monkeypatch):
    before_save = stopping_spy()
    monkeypatch.setattr(document_collab, "before_save", before_save)
    db = object()
    source = SimpleNamespace(id=DOC, revision_number=1, sections={"1.1": {"content": "<p>x</p>"}})
    chains = SimpleNamespace(chain=lambda doc_id: None)
    with pytest.raises(StopError):
        await soaw_service.create_revision(db, source, created_by=None, chains=chains)
    ((args, kwargs),) = before_save.calls
    assert args[0] is db
    assert args[1:] == ("soaw", None, {"sections": {"1.1": {"content": "<p>x</p>"}}})
    assert kwargs == {"user": None, "read_scope": None, "copy": True}


async def test_a_decision_revision_copies_its_text_in_the_callers_session(monkeypatch):
    before_save = stopping_spy()
    monkeypatch.setattr(document_collab, "before_save", before_save)
    db = object()
    source = SimpleNamespace(
        id=DOC, context="c", decision="d", consequences="q", alternatives_considered="a"
    )
    with pytest.raises(StopError):
        await adr_service.create_revision(db, source, created_by=None, register=object())
    ((args, kwargs),) = before_save.calls
    assert args[0] is db
    assert args[1:] == (
        "adr",
        None,
        {"context": "c", "decision": "d", "consequences": "q", "alternatives_considered": "a"},
    )
    assert kwargs == {"user": None, "read_scope": None, "copy": True}


async def test_a_duplicate_does_not_record_its_own_created_row_early(monkeypatch):
    create = stopping_spy()
    monkeypatch.setattr(adr_service, "create_decision", create)
    original = SimpleNamespace(
        id=DOC,
        title="T",
        context=None,
        decision=None,
        consequences=None,
        alternatives_considered=None,
        attributes=None,
        valid_until=None,
    )
    with pytest.raises(StopError):
        await adr_service.duplicate_decision(object(), original, created_by=None)
    ((_, kwargs),) = create.calls
    assert kwargs["record_created"] is False
    assert kwargs["copy"] is True
    assert kwargs["publish"] is False
    assert kwargs["title"] == "T (copy)"


async def test_render_doc_reuses_the_register(monkeypatch):
    calls: list = []

    async def resolve(*args, **kwargs):
        calls.append((args, kwargs))
        return ["rendered"]

    monkeypatch.setattr(mention_service, "resolve_for_reader", resolve)
    db, user, scope, register = object(), object(), object(), object()
    payloads = [{"id": "x"}]
    out = await document_collab.render_doc(
        db, "adr", payloads, user=user, read_scope=scope, register=register
    )
    assert out == ["rendered"]
    ((args, kwargs),) = calls
    assert args == (db,)
    assert kwargs["doc_kind"] == "adr"
    assert kwargs["payloads"] is payloads
    assert kwargs["user"] is user
    assert kwargs["read_scope"] is scope
    assert kwargs["register"] is register
