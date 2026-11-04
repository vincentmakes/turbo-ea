"""``POST /metamodel/principles/bulk-import`` — the EA principles spreadsheet import.

DB-backed: skipped locally without PostgreSQL, run in CI. The matching rules
themselves are pinned in ``tests/services/test_principle_service.py``; this
file covers the route: permission, dry run, commit, audit and the response.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.audit_log import AuditLogEntry
from app.models.ea_principle import EAPrinciple
from tests.conftest import auth_headers, create_role, create_user

URL = "/api/v1/metamodel/principles/bulk-import"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "viewer": viewer}


async def _principles(db) -> list[EAPrinciple]:
    result = await db.execute(select(EAPrinciple).order_by(EAPrinciple.reference_number))
    return list(result.scalars().all())


async def _audit_rows(db) -> list[AuditLogEntry]:
    result = await db.execute(
        select(AuditLogEntry)
        .where(AuditLogEntry.action == "admin.principle.imported")
        .order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars().all())


async def test_created_principles_get_a_reference(client, env):
    resp = await client.post(
        "/api/v1/metamodel/principles",
        json={"title": "Reuse first"},
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 201
    assert resp.json()["reference_number"] == "P-001"
    listed = await client.get("/api/v1/metamodel/principles", headers=auth_headers(env["admin"]))
    assert [p["reference_number"] for p in listed.json()] == ["P-001"]


async def test_dry_run_previews_without_writing(client, db, env):
    resp = await client.post(
        URL,
        json={
            "dry_run": True,
            "items": [
                {"row_index": 0, "title": "Cloud first"},
                {"row_index": 1, "title": "", "description": "no title"},
            ],
        },
        headers=auth_headers(env["admin"]),
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["dry_run"] is True
    assert (body["created"], body["updated"], body["skipped"], body["failed"]) == (1, 0, 0, 1)
    assert body["results"][0]["status"] == "created"
    assert body["results"][0]["reference_number"] == "P-001"
    assert body["results"][1] == {
        "row_index": 1,
        "status": "failed",
        "id": None,
        "reference_number": None,
        "changed_fields": [],
        "error": "Title is required",
        "warnings": [],
    }
    assert await _principles(db) == []
    assert await _audit_rows(db) == []


async def test_apply_creates_updates_and_records_one_audit_row(client, db, env):
    headers = auth_headers(env["admin"])
    created = await client.post(
        "/api/v1/metamodel/principles",
        json={"title": "Reuse first", "description": "old"},
        headers=headers,
    )
    assert created.status_code == 201

    resp = await client.post(
        URL,
        json={
            "items": [
                {"row_index": 0, "reference_number": "P-001", "title": "Reuse first"},
                {
                    "row_index": 1,
                    "reference_number": "P-001",
                    "title": "Reuse before buy",
                    "description": "new",
                },
                {"row_index": 2, "title": "API first", "is_active": "false"},
            ]
        },
        headers=headers,
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Row 1 repeats row 0's reference, so it fails; row 0 matches unchanged.
    assert [r["status"] for r in body["results"]] == ["skipped", "failed", "created"]
    assert (body["created"], body["updated"], body["skipped"], body["failed"]) == (1, 0, 1, 1)

    await db.rollback()  # read what the request committed, not its session
    rows = await _principles(db)
    assert [(p.reference_number, p.title, p.is_active) for p in rows] == [
        ("P-001", "Reuse first", True),
        ("P-002", "API first", False),
    ]
    [audit] = await _audit_rows(db)
    assert audit.category == "admin"
    assert audit.actor_user_id == env["admin"].id
    assert audit.target_label == "Spreadsheet import"
    assert audit.details == {
        "context": {"source": "Spreadsheet", "created": 1, "updated": 0, "skipped": 1, "failed": 1}
    }


async def test_update_reports_the_changed_fields(client, db, env):
    headers = auth_headers(env["admin"])
    await client.post("/api/v1/metamodel/principles", json={"title": "Old"}, headers=headers)

    resp = await client.post(
        URL,
        json={"items": [{"row_index": 0, "reference_number": "p-001", "title": "New"}]},
        headers=headers,
    )

    [result] = resp.json()["results"]
    assert result["status"] == "updated"
    assert result["changed_fields"] == ["title"]
    assert resp.json()["updated"] == 1
    await db.rollback()
    assert [p.title for p in await _principles(db)] == ["New"]


async def test_nothing_to_change_writes_no_audit_row(client, db, env):
    headers = auth_headers(env["admin"])
    await client.post("/api/v1/metamodel/principles", json={"title": "Same"}, headers=headers)

    resp = await client.post(
        URL, json={"items": [{"row_index": 0, "title": "Same"}]}, headers=headers
    )

    assert resp.json()["skipped"] == 1
    assert await _audit_rows(db) == []


async def test_viewer_is_refused(client, db, env):
    resp = await client.post(
        URL,
        json={"items": [{"row_index": 0, "title": "Sneaky"}]},
        headers=auth_headers(env["viewer"]),
    )
    assert resp.status_code == 403
    assert await _principles(db) == []


async def test_an_empty_batch_is_rejected(client, env):
    resp = await client.post(URL, json={"items": []}, headers=auth_headers(env["admin"]))
    assert resp.status_code == 422
