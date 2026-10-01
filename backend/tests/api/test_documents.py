"""Integration tests for the /cards/{id}/documents and /documents endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.event import Event
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def docs_env(db):
    """Prerequisite data for document tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions=VIEWER_PERMISSIONS,
    )
    await create_card_type(db, key="Application", label="Application")
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    card = await create_card(
        db,
        card_type="Application",
        name="Doc App",
        user_id=admin.id,
    )
    return {
        "admin": admin,
        "viewer": viewer,
        "card": card,
    }


# ---------------------------------------------------------------
# POST /cards/{id}/documents  (create)
# ---------------------------------------------------------------


class TestCreateDocument:
    async def test_admin_can_create_document(self, client, db, docs_env):
        admin = docs_env["admin"]
        card = docs_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/documents",
            json={
                "name": "Architecture Guide",
                "url": "https://docs.example.com/arch",
                "type": "link",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Architecture Guide"
        assert data["url"] == "https://docs.example.com/arch"

    async def test_viewer_cannot_create_document(self, client, db, docs_env):
        viewer = docs_env["viewer"]
        card = docs_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/documents",
            json={
                "name": "Blocked",
                "url": "https://example.com",
            },
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_url_validation_rejects_bad_scheme(self, client, db, docs_env):
        admin = docs_env["admin"]
        card = docs_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/documents",
            json={
                "name": "Bad URL",
                "url": "javascript:alert(1)",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 422

    async def test_mailto_url_accepted(self, client, db, docs_env):
        admin = docs_env["admin"]
        card = docs_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/documents",
            json={
                "name": "Contact",
                "url": "mailto:owner@example.com",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201

    async def test_empty_url_is_stored_as_no_url(self, client, db, docs_env):
        # Before #1166 an empty string was a 422: it is not None, so the
        # scheme check ran on "" and failed.
        admin = docs_env["admin"]
        card = docs_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/documents",
            json={"name": "Reference only", "url": ""},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["url"] is None


# ---------------------------------------------------------------
# GET /cards/{id}/documents  (list)
# ---------------------------------------------------------------


class TestListDocuments:
    async def test_list_documents(self, client, db, docs_env):
        admin = docs_env["admin"]
        card = docs_env["card"]
        # Create a doc first
        await client.post(
            f"/api/v1/cards/{card.id}/documents",
            json={
                "name": "README",
                "url": "https://example.com/readme",
            },
            headers=auth_headers(admin),
        )
        resp = await client.get(
            f"/api/v1/cards/{card.id}/documents",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1

    async def test_viewer_can_list_documents(self, client, db, docs_env):
        viewer = docs_env["viewer"]
        card = docs_env["card"]
        resp = await client.get(
            f"/api/v1/cards/{card.id}/documents",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------
# PATCH /documents/{id}  (edit — #1166)
# ---------------------------------------------------------------


async def _create_link(client, admin, card, **overrides):
    body = {"name": "Runbook", "url": "https://wiki.example.com/runbook", "type": "documentation"}
    body.update(overrides)
    resp = await client.post(
        f"/api/v1/cards/{card.id}/documents", json=body, headers=auth_headers(admin)
    )
    assert resp.status_code == 201
    return resp.json()["id"]


async def _update_events(db, card_id):
    rows = await db.execute(
        select(Event).where(Event.card_id == card_id, Event.event_type == "document.updated")
    )
    return rows.scalars().all()


class TestUpdateDocument:
    async def test_admin_can_edit_name_url_and_type(self, client, db, docs_env):
        admin, card = docs_env["admin"], docs_env["card"]
        doc_id = await _create_link(client, admin, card)

        resp = await client.patch(
            f"/api/v1/documents/{doc_id}",
            json={
                "name": "Operations runbook",
                "url": "https://wiki.example.com/ops",
                "type": "operations",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        # The PATCH answers with the same row shape the list endpoint returns.
        assert set(data) == {"id", "card_id", "name", "url", "type", "created_at"}
        assert data["id"] == doc_id
        assert data["name"] == "Operations runbook"
        assert data["url"] == "https://wiki.example.com/ops"
        assert data["type"] == "operations"

        listed = await client.get(f"/api/v1/cards/{card.id}/documents", headers=auth_headers(admin))
        row = next(d for d in listed.json() if d["id"] == doc_id)
        assert row["name"] == "Operations runbook"
        assert row["url"] == "https://wiki.example.com/ops"

    async def test_viewer_cannot_edit(self, client, db, docs_env):
        admin, viewer, card = docs_env["admin"], docs_env["viewer"], docs_env["card"]
        doc_id = await _create_link(client, admin, card)
        resp = await client.patch(
            f"/api/v1/documents/{doc_id}",
            json={"name": "Hijacked"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_unknown_document_returns_404(self, client, db, docs_env):
        resp = await client.patch(
            f"/api/v1/documents/{uuid.uuid4()}",
            json={"name": "Ghost"},
            headers=auth_headers(docs_env["admin"]),
        )
        assert resp.status_code == 404

    async def test_bad_scheme_rejected_on_edit(self, client, db, docs_env):
        admin, card = docs_env["admin"], docs_env["card"]
        doc_id = await _create_link(client, admin, card)
        resp = await client.patch(
            f"/api/v1/documents/{doc_id}",
            json={"url": "javascript:alert(1)"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 422
        # The row is untouched.
        listed = await client.get(f"/api/v1/cards/{card.id}/documents", headers=auth_headers(admin))
        row = next(d for d in listed.json() if d["id"] == doc_id)
        assert row["url"] == "https://wiki.example.com/runbook"

    async def test_edit_records_only_the_fields_that_moved(self, client, db, docs_env):
        admin, card = docs_env["admin"], docs_env["card"]
        doc_id = await _create_link(client, admin, card)
        resp = await client.patch(
            f"/api/v1/documents/{doc_id}",
            # `type` is re-sent unchanged, as the dialog does; it must not be
            # recorded as a change.
            json={"name": "Renamed", "type": "documentation"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        events = await _update_events(db, card.id)
        assert len(events) == 1
        event = events[0]
        assert event.data["document_id"] == doc_id
        assert event.data["changes"] == {"name": {"old": "Runbook", "new": "Renamed"}}
        assert event.data["summary"] == "Renamed"

    async def test_noop_edit_writes_no_event(self, client, db, docs_env):
        admin, card = docs_env["admin"], docs_env["card"]
        doc_id = await _create_link(client, admin, card)
        resp = await client.patch(
            f"/api/v1/documents/{doc_id}",
            json={
                "name": "Runbook",
                "url": "https://wiki.example.com/runbook",
                "type": "documentation",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert await _update_events(db, card.id) == []

    async def test_empty_url_clears_it(self, client, db, docs_env):
        admin, card = docs_env["admin"], docs_env["card"]
        doc_id = await _create_link(client, admin, card)
        resp = await client.patch(
            f"/api/v1/documents/{doc_id}",
            json={"url": "   "},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["url"] is None
        (event,) = await _update_events(db, card.id)
        assert event.data["changes"] == {
            "url": {"old": "https://wiki.example.com/runbook", "new": None}
        }


# ---------------------------------------------------------------
# DELETE /documents/{id}
# ---------------------------------------------------------------


class TestDeleteDocument:
    async def test_admin_can_delete(self, client, db, docs_env):
        admin = docs_env["admin"]
        card = docs_env["card"]
        create_resp = await client.post(
            f"/api/v1/cards/{card.id}/documents",
            json={
                "name": "Delete me",
                "url": "https://example.com/rm",
            },
            headers=auth_headers(admin),
        )
        doc_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/documents/{doc_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

    async def test_viewer_cannot_delete(self, client, db, docs_env):
        admin = docs_env["admin"]
        viewer = docs_env["viewer"]
        card = docs_env["card"]
        create_resp = await client.post(
            f"/api/v1/cards/{card.id}/documents",
            json={
                "name": "Protected",
                "url": "https://example.com/prot",
            },
            headers=auth_headers(admin),
        )
        doc_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/documents/{doc_id}",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_delete_nonexistent_returns_404(self, client, db, docs_env):
        admin = docs_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.delete(
            f"/api/v1/documents/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404
