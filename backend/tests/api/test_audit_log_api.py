"""``/admin/audit-log`` — reading and exporting the security & admin audit log.

The DB-backed tests need PostgreSQL (skipped locally without it, run in CI).
The helpers at the bottom (filters, CSV) and the two source scans run without
one.
"""

from __future__ import annotations

import ast
import csv
import io
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from app.api.v1 import audit_log as audit_routes
from app.models.audit_log import AuditLogEntry
from app.services import audit_log
from tests.conftest import auth_headers, create_user

URL = "/api/v1/admin/audit-log"
BASE = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)


def _entry(**kwargs):
    defaults = {"category": "auth", "action": "auth.login.succeeded", "outcome": "success"}
    return AuditLogEntry(**{**defaults, **kwargs})


@pytest.fixture
async def seeded(db, admin_user):
    """Five rows spread over five days, newest last."""
    rows = [
        _entry(
            action="auth.login.failed",
            outcome="failure",
            subject_email="mallory@evil.test",
            ip="203.0.113.9",
            details={"reason": "bad_password"},
            created_at=BASE,
        ),
        _entry(
            action="auth.login.succeeded",
            actor_user_id=admin_user.id,
            actor_email=admin_user.email,
            ip="198.51.100.2",
            created_at=BASE + timedelta(days=1),
        ),
        _entry(
            category="admin",
            action="admin.role.updated",
            actor_user_id=admin_user.id,
            actor_email=admin_user.email,
            target_type="role",
            target_id="member",
            target_label="Member role",
            created_at=BASE + timedelta(days=2),
        ),
        _entry(
            action="auth.logout",
            actor_email="someone@else.test",
            created_at=BASE + timedelta(days=3),
        ),
        _entry(
            category="access",
            action="access.export.cards",
            actor_user_id=admin_user.id,
            actor_email=admin_user.email,
            details={"rows": 3},
            created_at=BASE + timedelta(days=4),
        ),
    ]
    db.add_all(rows)
    await db.flush()
    return rows


async def _list(client, user, **params):
    resp = await client.get(URL, params=params, headers=auth_headers(user))
    assert resp.status_code == 200, resp.text
    return resp.json()


def _actions(body):
    return [item["action"] for item in body["items"]]


class TestList:
    async def test_admin_lists_newest_first_in_an_envelope(self, client, admin_user, seeded):
        body = await _list(client, admin_user)
        assert set(body) == {"items", "total", "page", "page_size"}
        assert body["total"] == 5
        assert body["page"] == 1
        assert body["page_size"] == 50
        assert _actions(body) == [
            "access.export.cards",
            "auth.logout",
            "admin.role.updated",
            "auth.login.succeeded",
            "auth.login.failed",
        ]
        first = body["items"][-1]
        assert first["outcome"] == "failure"
        assert first["subject_email"] == "mallory@evil.test"
        assert first["ip"] == "203.0.113.9"
        assert first["details"] == {"reason": "bad_password"}
        assert first["created_at"].startswith("2026-10-01T12:00:00")

    async def test_viewer_gets_403(self, client, viewer_user, admin_user, seeded):
        for path in ("", "/actions", "/export"):
            resp = await client.get(URL + path, headers=auth_headers(viewer_user))
            assert resp.status_code == 403, path

    async def test_unauthenticated_gets_401(self, client):
        assert (await client.get(URL)).status_code == 401

    async def test_a_role_with_admin_events_may_read(self, client, db, seeded):
        from tests.conftest import create_role

        await create_role(db, key="auditor", label="Auditor", permissions={"admin.events": True})
        auditor = await create_user(db, email="auditor@test.com", role="auditor")
        body = await _list(client, auditor)
        assert body["total"] == 5

    async def test_pagination(self, client, admin_user, seeded):
        body = await _list(client, admin_user, page=2, page_size=2)
        assert body["total"] == 5 and body["page"] == 2 and body["page_size"] == 2
        assert _actions(body) == ["admin.role.updated", "auth.login.succeeded"]

    async def test_page_size_is_capped(self, client, admin_user):
        resp = await client.get(URL, params={"page_size": 201}, headers=auth_headers(admin_user))
        assert resp.status_code == 422

    async def test_filter_category(self, client, admin_user, seeded):
        assert _actions(await _list(client, admin_user, category="admin")) == ["admin.role.updated"]

    async def test_filter_action_is_a_prefix(self, client, admin_user, seeded):
        body = await _list(client, admin_user, action="auth.login")
        assert _actions(body) == ["auth.login.succeeded", "auth.login.failed"]
        assert (await _list(client, admin_user, action="login"))["total"] == 0

    async def test_filter_action_escapes_like_wildcards(self, client, admin_user, seeded):
        assert (await _list(client, admin_user, action="auth%"))["total"] == 0
        assert (await _list(client, admin_user, action="auth_login"))["total"] == 0

    async def test_filter_outcome(self, client, admin_user, seeded):
        assert _actions(await _list(client, admin_user, outcome="failure")) == ["auth.login.failed"]

    async def test_filter_actor(self, client, admin_user, seeded):
        body = await _list(client, admin_user, actor_user_id=str(admin_user.id))
        assert _actions(body) == [
            "access.export.cards",
            "admin.role.updated",
            "auth.login.succeeded",
        ]

    async def test_filter_q_searches_emails_and_target_label(self, client, admin_user, seeded):
        assert _actions(await _list(client, admin_user, q="MALLORY")) == ["auth.login.failed"]
        assert _actions(await _list(client, admin_user, q="else.test")) == ["auth.logout"]
        assert _actions(await _list(client, admin_user, q="member role")) == ["admin.role.updated"]
        assert (await _list(client, admin_user, q="%"))["total"] == 0
        assert (await _list(client, admin_user, q="   "))["total"] == 5

    async def test_filter_ip(self, client, admin_user, seeded):
        assert _actions(await _list(client, admin_user, ip="198.51.100.2")) == [
            "auth.login.succeeded"
        ]

    async def test_filter_since_and_until_are_inclusive(self, client, admin_user, seeded):
        body = await _list(
            client,
            admin_user,
            since=(BASE + timedelta(days=1)).isoformat(),
            until=(BASE + timedelta(days=3)).isoformat(),
        )
        assert _actions(body) == ["auth.logout", "admin.role.updated", "auth.login.succeeded"]


class TestActions:
    async def test_distinct_sorted(self, client, db, admin_user, seeded):
        db.add(_entry(action="auth.logout", created_at=BASE))
        await db.flush()
        resp = await client.get(URL + "/actions", headers=auth_headers(admin_user))
        assert resp.status_code == 200
        assert resp.json() == [
            "access.export.cards",
            "admin.role.updated",
            "auth.login.failed",
            "auth.login.succeeded",
            "auth.logout",
        ]


class TestExport:
    async def test_csv_header_rows_and_the_export_is_recorded(self, client, db, admin_user, seeded):
        resp = await client.get(
            URL + "/export",
            params={"category": "auth"},
            headers={**auth_headers(admin_user), "User-Agent": "pytest-agent"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"].startswith("text/csv")
        assert resp.headers["content-disposition"] == 'attachment; filename="audit-log.csv"'
        rows = list(csv.reader(io.StringIO(resp.text)))
        assert rows[0] == list(audit_routes.CSV_COLUMNS)
        assert [r[2] for r in rows[1:]] == [
            "auth.logout",
            "auth.login.succeeded",
            "auth.login.failed",
        ]
        failed = dict(zip(rows[0], rows[-1], strict=True))
        assert failed["outcome"] == "failure"
        assert failed["subject_email"] == "mallory@evil.test"
        assert failed["details"] == '{"reason": "bad_password"}'

        recorded = (
            (
                await db.execute(
                    select(AuditLogEntry).where(AuditLogEntry.action == "access.audit_log.exported")
                )
            )
            .scalars()
            .all()
        )
        assert len(recorded) == 1
        row = recorded[0]
        assert row.category == "access"
        assert row.outcome == "success"
        assert row.actor_user_id == admin_user.id
        assert row.actor_email == admin_user.email
        assert row.details == {"rows": 3}
        assert row.user_agent == "pytest-agent"
        assert row.created_at is not None

    async def test_the_export_row_is_listed_afterwards(self, client, admin_user, seeded):
        await client.get(URL + "/export", headers=auth_headers(admin_user))
        body = await _list(client, admin_user, category="access")
        assert "access.audit_log.exported" in _actions(body)

    async def test_the_export_is_capped(self, client, admin_user, seeded, monkeypatch):
        monkeypatch.setattr(audit_routes, "AUDIT_EXPORT_MAX_ROWS", 2)
        resp = await client.get(URL + "/export", headers=auth_headers(admin_user))
        rows = list(csv.reader(io.StringIO(resp.text)))
        assert len(rows) == 3  # header + the 2 newest


class TestRecordRoundTrip:
    async def test_record_persists_with_a_server_timestamp(self, db, admin_user):
        entry = await audit_log.record(
            db, action="auth.login.succeeded", category="auth", actor=admin_user
        )
        assert entry.created_at is not None
        stored = await db.get(AuditLogEntry, entry.id)
        assert stored.actor_email == admin_user.email

    async def test_rows_written_in_one_transaction_keep_their_order(self, db):
        first = await audit_log.record(db, action="auth.login.failed", category="auth")
        second = await audit_log.record(db, action="auth.login.locked", category="auth")
        assert second.created_at > first.created_at

    async def test_the_actor_survives_the_user(self, db, admin_role):
        gone = await create_user(db, email="gone@test.com", role="admin")
        entry = await audit_log.record(db, action="auth.logout", category="auth", actor=gone)
        await db.delete(gone)
        await db.flush()
        await db.refresh(entry)
        assert entry.actor_user_id is None
        assert entry.actor_email == "gone@test.com"


# ── Helpers, no database ─────────────────────────────────────────────────


def _sql(clause) -> str:
    return str(clause.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


def test_no_filters_means_no_clauses():
    assert audit_routes.build_filters() == []
    assert audit_routes.build_filters(q="   ") == []


def test_every_filter_contributes_one_clause():
    actor = uuid.uuid4()
    clauses = audit_routes.build_filters(
        category="auth",
        action="auth.login",
        outcome="failure",
        actor_user_id=actor,
        q="bob",
        ip=" 10.0.0.1 ",
        since=BASE,
        until=BASE + timedelta(days=1),
    )
    rendered = [_sql(c) for c in clauses]
    assert len(rendered) == 8
    assert rendered[0] == "audit_log.category = 'auth'"
    assert rendered[1] == "audit_log.action LIKE 'auth.login' || '%%' ESCAPE '/'"
    assert rendered[2] == "audit_log.outcome = 'failure'"
    assert str(actor) in rendered[3]
    assert rendered[4] == " OR ".join(
        f"(audit_log.{col} ILIKE '%%' || 'bob' || '%%' ESCAPE '/')"
        for col in ("actor_email", "subject_email", "target_label")
    )
    assert rendered[5] == "audit_log.ip = '10.0.0.1'"
    assert ">=" in rendered[6] and "2026-10-01" in rendered[6]
    assert "<=" in rendered[7] and "2026-10-02" in rendered[7]


def test_query_orders_newest_first_with_an_id_tie_break():
    sql = _sql(audit_routes.filtered_query([]))
    assert "ORDER BY audit_log.created_at DESC, audit_log.id DESC" in sql


@pytest.mark.parametrize(
    ("value", "cell"),
    [
        (None, ""),
        ("plain", "plain"),
        ("=HYPERLINK(1)", "'=HYPERLINK(1)"),
        ("+1", "'+1"),
        ("-1", "'-1"),
        ("@sum", "'@sum"),
        ("\tx", "'\tx"),
        ("\rx", "'\rx"),
        (3, "3"),
        (BASE, BASE.isoformat()),
    ],
)
def test_csv_safe(value, cell):
    assert audit_routes.csv_safe(value) == cell


def test_entry_row_follows_the_columns_and_serialises_details():
    entry = SimpleNamespace(
        created_at=BASE,
        category="auth",
        action="auth.login.failed",
        outcome="failure",
        actor_email=None,
        subject_email="=evil",
        target_type=None,
        target_id=None,
        target_label=None,
        ip="10.0.0.1",
        user_agent="ua",
        origin="web",
        impersonator_user_id=None,
        impersonated_role=None,
        details={"b": 1, "a": uuid.UUID(int=1)},
    )
    row = audit_routes.entry_row(entry)
    assert len(row) == len(audit_routes.CSV_COLUMNS) == 15
    by_column = dict(zip(audit_routes.CSV_COLUMNS, row, strict=True))
    assert by_column["created_at"] == BASE.isoformat()
    assert by_column["subject_email"] == "'=evil"
    assert by_column["actor_email"] == ""
    assert by_column["details"] == '{"a": "00000000-0000-0000-0000-000000000001", "b": 1}'
    entry.details = None
    assert audit_routes.entry_row(entry)[-1] == ""


def test_build_csv_writes_a_header_then_a_row_per_entry():
    entry = SimpleNamespace(**{c: None for c in audit_routes.CSV_COLUMNS})
    entry.action = "auth.logout"
    rows = list(csv.reader(io.StringIO(audit_routes.build_csv([entry, entry]))))
    assert rows[0] == list(audit_routes.CSV_COLUMNS)
    assert [r[2] for r in rows[1:]] == ["auth.logout", "auth.logout"]
    assert list(csv.reader(io.StringIO(audit_routes.build_csv([])))) == [
        list(audit_routes.CSV_COLUMNS)
    ]


def test_the_export_cap():
    assert audit_routes.AUDIT_EXPORT_MAX_ROWS == 50_000


_SOURCE = Path(audit_routes.__file__)


def _route_functions():
    tree = ast.parse(_SOURCE.read_text())
    for node in tree.body:
        if isinstance(node, ast.AsyncFunctionDef):
            for deco in node.decorator_list:
                if (
                    isinstance(deco, ast.Call)
                    and isinstance(deco.func, ast.Attribute)
                    and isinstance(deco.func.value, ast.Name)
                    and deco.func.value.id == "router"
                ):
                    yield node, deco.func.attr


@pytest.mark.source_scan
def test_export_handler_never_streams():
    """A ``StreamingResponse`` would hold the request's DB session until the
    client finished reading (CLAUDE.md, never hold a session across non-DB work)."""
    handlers = {fn.name: fn for fn, _ in _route_functions()}
    export = handlers["export_audit_log"]
    source = ast.get_source_segment(_SOURCE.read_text(), export)
    assert "StreamingResponse" not in source
    assert "await db.commit()" in source
    assert source.index("await db.commit()") < source.index("return Response(")
    assert "from fastapi.responses import Response" in _SOURCE.read_text()


@pytest.mark.source_scan
def test_the_log_is_read_only():
    """No route may create, update or delete an audit row — only the purge does."""
    methods = {method for _, method in _route_functions()}
    assert methods == {"get"}
    assert not methods & {"post", "patch", "put", "delete"}
