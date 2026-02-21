"""Integration tests for the /cards/{id}/documents and /documents endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.permissions import VIEWER_PERMISSIONS
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
