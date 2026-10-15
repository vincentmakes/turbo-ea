"""``services/audit_labels`` — the shared label lookups and text clipping.

The lookups run against a fake session that records what it is asked, so the
"no query for an empty input" rule is pinned without a database.
"""

from __future__ import annotations

import pytest

from app.services.audit_labels import (
    AUDIT_TEXT_LIMIT,
    card_type_label,
    card_type_labels,
    clip_text,
    role_labels,
)


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return list(self._rows)


class FakeSession:
    def __init__(self, rows=()):
        self.rows = rows
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return _Result(self.rows)


def test_audit_text_limit():
    assert AUDIT_TEXT_LIMIT == 500


def test_clip_text():
    assert clip_text(None) is None
    assert clip_text("") == ""
    assert clip_text("a" * 500) == "a" * 500
    assert clip_text("a" * 501) == "a" * 499 + "…"
    assert len(clip_text("a" * 501)) == 500
    assert clip_text("abcdef", limit=4) == "abc…"
    assert clip_text("abcd", limit=4) == "abcd"


@pytest.mark.parametrize("lookup", [card_type_labels, role_labels])
async def test_empty_input_issues_no_query(lookup):
    db = FakeSession()
    assert await lookup(db, []) == {}
    assert await lookup(db, [None, ""]) == {}
    assert db.statements == []


async def test_card_type_labels_drop_unknown_and_unlabelled():
    db = FakeSession([("Application", "App"), ("Blank", ""), ("Nolabel", None)])
    assert await card_type_labels(db, ["Application", "Blank", "Nolabel", "Ghost", None]) == {
        "Application": "App"
    }
    [statement] = db.statements
    sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
    assert "FROM card_types" in sql
    assert "'Application'" in sql and "'Ghost'" in sql


async def test_role_labels_query_the_roles_table():
    db = FakeSession([("member", "Member")])
    assert await role_labels(db, ["member", "member", "ghost"]) == {"member": "Member"}
    [statement] = db.statements
    sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
    assert "FROM roles" in sql
    assert "'member'" in sql and "'ghost'" in sql


async def test_card_type_label_falls_back_to_the_key():
    assert await card_type_label(FakeSession([("Application", "App")]), "Application") == "App"
    assert await card_type_label(FakeSession([]), "Ghost") == "Ghost"
    db = FakeSession()
    assert await card_type_label(db, None) is None
    assert await card_type_label(db, "") == ""
    assert db.statements == []
