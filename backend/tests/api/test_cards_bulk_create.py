"""Integration tests for `POST /cards/bulk-create` and `POST /cards/resolve-refs`."""

from __future__ import annotations

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def bulk_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_card_type(db, key="Organization", label="Organization", has_hierarchy=True)
    await create_card_type(db, key="Application", label="Application", has_hierarchy=True)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "viewer": viewer}


async def test_bulk_create_simple_rows(client, db, bulk_env):
    """Two unrelated cards: both should land as `created`."""
    admin = bulk_env["admin"]
    payload = {
        "cards": [
            {"row_index": 1, "type": "Application", "name": "App A"},
            {"row_index": 2, "type": "Application", "name": "App B"},
        ]
    }
    resp = await client.post("/api/v1/cards/bulk-create", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 2
    assert body["failed"] == 0
    assert [r["status"] for r in body["results"]] == ["created", "created"]


async def test_bulk_create_resolves_same_batch_parent_by_name(client, db, bulk_env):
    """A child row whose parent is created in the same batch must resolve
    against that newly-created parent — this is the whole point of the
    server-side topological sort."""
    admin = bulk_env["admin"]
    payload = {
        "cards": [
            # Intentionally out-of-order: child listed first so the topo
            # sort is doing real work.
            {
                "row_index": 1,
                "type": "Organization",
                "name": "Sales",
                "parent_path": [],
                "parent_name": "NexaTech",
            },
            {"row_index": 2, "type": "Organization", "name": "NexaTech"},
        ]
    }
    resp = await client.post("/api/v1/cards/bulk-create", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 2, body
    # The Sales row should reference NexaTech as parent.
    sales_id = next(r["id"] for r in body["results"] if r["row_index"] == 1)
    nexa_id = next(r["id"] for r in body["results"] if r["row_index"] == 2)
    list_resp = await client.get(f"/api/v1/cards/{sales_id}", headers=auth_headers(admin))
    assert list_resp.json()["parent_id"] == nexa_id


async def test_bulk_create_unknown_parent_fails_that_row(client, db, bulk_env):
    """A row pointing at a non-existent parent should fail that row only —
    other rows in the same batch must still succeed."""
    admin = bulk_env["admin"]
    payload = {
        "cards": [
            {"row_index": 1, "type": "Application", "name": "Standalone"},
            {
                "row_index": 2,
                "type": "Application",
                "name": "Orphan",
                "parent_name": "Ghost",
            },
        ]
    }
    resp = await client.post("/api/v1/cards/bulk-create", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 1
    assert body["failed"] == 1
    failed = next(r for r in body["results"] if r["row_index"] == 2)
    assert "Parent not found" in (failed["error"] or "")


async def test_bulk_create_viewer_forbidden(client, db, bulk_env):
    viewer = bulk_env["viewer"]
    payload = {"cards": [{"row_index": 1, "type": "Application", "name": "X"}]}
    resp = await client.post(
        "/api/v1/cards/bulk-create", json=payload, headers=auth_headers(viewer)
    )
    assert resp.status_code == 403


async def test_resolve_refs_resolved_and_ambiguous_and_missing(client, db, bulk_env):
    admin = bulk_env["admin"]
    nexa = await create_card(db, card_type="Organization", name="NexaTech", user_id=admin.id)
    sales = await create_card(
        db, card_type="Organization", name="Sales", parent_id=nexa.id, user_id=admin.id
    )
    eng = await create_card(
        db, card_type="Organization", name="Engineering", parent_id=nexa.id, user_id=admin.id
    )
    await create_card(db, card_type="Application", name="CRM", parent_id=sales.id, user_id=admin.id)
    await create_card(db, card_type="Application", name="CRM", parent_id=eng.id, user_id=admin.id)
    erp = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    await db.commit()

    payload = {
        "refs": [
            {"row": 1, "column": "rel:supports", "type": "Application", "ref": "ERP"},
            {"row": 2, "column": "rel:supports", "type": "Application", "ref": "CRM"},
            {
                "row": 3,
                "column": "rel:supports",
                "type": "Application",
                "ref": "NexaTech / Sales / CRM",
            },
            {
                "row": 4,
                "column": "rel:supports",
                "type": "Application",
                "ref": "DoesNotExist",
            },
        ]
    }
    resp = await client.post(
        "/api/v1/cards/resolve-refs", json=payload, headers=auth_headers(admin)
    )
    assert resp.status_code == 200, resp.text
    results = {r["row"]: r for r in resp.json()["results"]}
    assert results[1]["status"] == "resolved"
    assert results[1]["id"] == str(erp.id)
    assert results[2]["status"] == "ambiguous"
    assert len(results[2]["candidates"]) == 2
    assert results[3]["status"] == "resolved"
    assert results[4]["status"] == "missing"
