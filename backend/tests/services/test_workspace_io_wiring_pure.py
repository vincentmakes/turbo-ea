"""Workspace import wiring pinned without a database.

A scripted session stands in for the database, so each test sees exactly
which ids the users pass and the remap context record, and which columns an
entity row is created with.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.dialects import postgresql

from app.services.workspace_io import applier, schema
from app.services.workspace_io import remap as rm
from app.services.workspace_io.bundle import WorkspaceBundle
from app.services.workspace_io.entities import apply_entity_section
from app.services.workspace_io.sections import ENTITY_SECTIONS

SRC_A = "aaaaaaaa-0000-4000-8000-000000000001"
SRC_B = "aaaaaaaa-0000-4000-8000-000000000002"
OLD_CARD = "cccccccc-0000-4000-8000-000000000001"
NEW_CARD = "dddddddd-0000-4000-8000-000000000001"


def _sql(stmt: Any) -> str:
    return str(stmt.compile(dialect=postgresql.dialect()))


class _Result:
    def __init__(self, rows: list[Any]):
        self._rows = rows

    def all(self) -> list[Any]:
        return list(self._rows)

    def scalars(self) -> _Result:
        return self


class FakeSession:
    """Answers each statement from ``answers`` (SQL fragment → rows) and
    records what was executed and added."""

    def __init__(self, answers: dict[str, list[Any]] | None = None):
        self.answers = answers or {}
        self.executed: list[str] = []
        self.added: list[Any] = []
        self.flushes = 0

    async def execute(self, stmt: Any) -> _Result:
        sql = _sql(stmt)
        self.executed.append(sql)
        for fragment, rows in self.answers.items():
            if fragment in sql:
                return _Result(rows)
        return _Result([])

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    async def flush(self) -> None:
        self.flushes += 1


def _bundle(**sheets: list[dict[str, Any]]) -> WorkspaceBundle:
    return WorkspaceBundle(manifest={}, sheets=sheets, assets={})


class _NoResolver:
    def resolve(self, ctype: str, ref: str) -> SimpleNamespace:
        return SimpleNamespace(status="missing", card_id=None)


# ── remap._rewrite_strings (through rewrite_history_content) ─────────────────


def test_a_mention_inside_a_list_of_a_history_snapshot_is_remapped():
    ids = rm.IdMap()
    ids.record(rm.CARDS, OLD_CARD, NEW_CARD)
    tally = rm.RewriteTally()
    span = '<span data-type="mention" data-kind="card" data-id="{}"></span>'
    out = rm.rewrite_history_content(
        {"notes": ["plain", span.format(OLD_CARD)], "title": "T"}, ids, tally
    )
    assert out == {"notes": ["plain", span.format(NEW_CARD)], "title": "T"}
    assert tally.counts == {"remapped": 1}


# ── entities.apply_entity_section: carried timestamps ────────────────────────


def _comments_section():
    return next(s for s in ENTITY_SECTIONS if s.sheet == "DocumentComments")


async def _create_comment(created_at: str):
    section = _comments_section()
    row = {"id": str(uuid.uuid4()), "author_name": "Ada", "body": "hi", "created_at": created_at}
    db = FakeSession()
    sr = applier.SectionResult(sheet=section.sheet)
    await apply_entity_section(db, section, _bundle(DocumentComments=[row]), sr, _NoResolver(), {})
    assert sr.created == 1 and db.flushes == 1
    (obj,) = db.added
    return obj


async def test_an_empty_carried_timestamp_is_left_to_the_server_default():
    obj = await _create_comment("")
    # never set at all, so the INSERT omits the column and the server dates it
    assert sa_inspect(obj).attrs.created_at.history.added == ()
    assert "created_at" not in vars(obj)


async def test_a_carried_timestamp_is_written():
    obj = await _create_comment("2026-01-02T03:04:05+00:00")
    assert obj.created_at.isoformat() == "2026-01-02T03:04:05+00:00"


# ── applier._apply_users ─────────────────────────────────────────────────────


async def test_users_differing_only_in_case_map_to_the_one_created_user():
    db = FakeSession({"roles.key": [("member",)]})
    bundle = _bundle(
        Users=[
            {"email": "dup@x.com", schema.SOURCE_ID_COLUMN: SRC_A, "role": "member"},
            {"email": "DUP@x.com", schema.SOURCE_ID_COLUMN: SRC_B, "role": "member"},
        ]
    )
    sr = applier.SectionResult(sheet="Users")
    ids = rm.IdMap()
    await applier._apply_users(db, bundle, sr, False, id_map=ids)
    (user,) = db.added
    assert ids.users == {SRC_A: str(user.id), SRC_B: str(user.id)}
    assert (sr.created, sr.skip_reasons) == (1, {"user_exists": 1})


# ── applier._load_remap_context: users mapped by e-mail ──────────────────────


async def _remap_users(users_rows: list[dict[str, Any]], db_users: list[tuple[str, uuid.UUID]]):
    db = FakeSession({"users.email": db_users})
    ids = rm.IdMap()
    ctx = await applier._load_remap_context(
        db, _bundle(Users=users_rows), ids, _NoResolver(), [SimpleNamespace(sheet="Adrs")]
    )
    assert ctx.ids is ids
    assert db.executed == ["SELECT users.email, users.id \nFROM users"]
    return ids


async def test_a_bundle_user_maps_to_the_target_user_with_that_email_in_any_case():
    target = uuid.uuid4()
    ids = await _remap_users(
        [{"email": " MIXED@example.COM ", schema.SOURCE_ID_COLUMN: SRC_A}],
        [("Mixed@Example.com", target), (None, uuid.uuid4())],
    )
    assert ids.users == {SRC_A: str(target)}


async def test_a_bundle_user_without_an_email_stays_unmapped():
    ids = await _remap_users(
        [{schema.SOURCE_ID_COLUMN: SRC_A}, {"email": "", schema.SOURCE_ID_COLUMN: SRC_B}],
        [("XXXX", uuid.uuid4()), ("x@y.z", uuid.uuid4())],
    )
    assert ids.users == {}


# ── applier._run: the users pass records into the run's id map ───────────────


class _StopError(Exception):
    pass


async def test_the_users_pass_records_into_the_runs_shared_id_map(monkeypatch):
    seen: dict[str, Any] = {}

    async def spy(db, bundle, sr, dry_run, id_map=None):
        seen["id_map"] = id_map
        raise _StopError

    monkeypatch.setattr(applier, "_apply_users", spy)
    with pytest.raises(_StopError):
        await applier._run(FakeSession(), _bundle(), None, dry_run=False, sheets={"Users"})
    assert isinstance(seen["id_map"], rm.IdMap)
