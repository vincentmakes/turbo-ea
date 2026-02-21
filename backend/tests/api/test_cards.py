"""Integration tests for the /cards endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

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
async def cards_env(db):
    """Prerequisite data shared by all card tests: roles, users, card type."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    card_type = await create_card_type(
        db,
        key="Application",
        label="Application",
        fields_schema=[
            {
                "section": "General",
                "fields": [
                    {
                        "key": "costTotalAnnual",
                        "label": "Annual Cost",
                        "type": "cost",
                        "weight": 1,
                    },
                    {
                        "key": "riskLevel",
                        "label": "Risk Level",
                        "type": "single_select",
                        "weight": 1,
                        "options": [
                            {"key": "low", "label": "Low"},
                            {"key": "high", "label": "High"},
                        ],
                    },
                    {
                        "key": "website",
                        "label": "Website",
                        "type": "url",
                        "weight": 0,
                    },
                ],
            }
        ],
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")

    return {
        "admin": admin,
        "member": member,
        "viewer": viewer,
        "card_type": card_type,
    }


# ---------------------------------------------------------------------------
# POST /cards  (create)
# ---------------------------------------------------------------------------


class TestCreateCard:
    async def test_admin_can_create_card(self, client, db, cards_env):
        admin = cards_env["admin"]
        response = await client.post(
            "/api/v1/cards",
            json={"type": "Application", "name": "My App"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "My App"
        assert data["type"] == "Application"
        assert data["status"] == "ACTIVE"
        assert data["approval_status"] == "DRAFT"

    async def test_member_can_create_card(self, client, db, cards_env):
        member = cards_env["member"]
        response = await client.post(
            "/api/v1/cards",
            json={"type": "Application", "name": "Member App"},
            headers=auth_headers(member),
        )
        assert response.status_code == 201

    async def test_viewer_cannot_create_card(self, client, db, cards_env):
        viewer = cards_env["viewer"]
        response = await client.post(
            "/api/v1/cards",
            json={"type": "Application", "name": "Blocked App"},
            headers=auth_headers(viewer),
        )
        assert response.status_code == 403

    async def test_data_quality_auto_computed(self, client, db, cards_env):
        admin = cards_env["admin"]
        response = await client.post(
            "/api/v1/cards",
            json={
                "type": "Application",
                "name": "Quality App",
                "description": "Has a description",
                "attributes": {"costTotalAnnual": 50000, "riskLevel": "low"},
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 201
        # description (1) + costTotalAnnual (1) + riskLevel (1) filled out of total weight
        assert response.json()["data_quality"] > 0

    async def test_unauthenticated_returns_401(self, client, db, cards_env):
        response = await client.post(
            "/api/v1/cards",
            json={"type": "Application", "name": "No Auth"},
        )
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# GET /cards/{id}
# ---------------------------------------------------------------------------


class TestGetCard:
    async def test_get_existing_card(self, client, db, cards_env):
        admin = cards_env["admin"]
        card = await create_card(db, card_type="Application", name="Lookup App", user_id=admin.id)

        response = await client.get(
            f"/api/v1/cards/{card.id}",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["name"] == "Lookup App"

    async def test_get_nonexistent_card(self, client, db, cards_env):
        admin = cards_env["admin"]
        fake_id = uuid.uuid4()

        response = await client.get(
            f"/api/v1/cards/{fake_id}",
            headers=auth_headers(admin),
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# GET /cards  (list)
# ---------------------------------------------------------------------------


class TestListCards:
    async def test_list_returns_cards(self, client, db, cards_env):
        admin = cards_env["admin"]
        await create_card(db, card_type="Application", name="App One", user_id=admin.id)
        await create_card(db, card_type="Application", name="App Two", user_id=admin.id)

        response = await client.get(
            "/api/v1/cards?type=Application",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 2
        names = [item["name"] for item in data["items"]]
        assert "App One" in names
        assert "App Two" in names

    async def test_search_filter(self, client, db, cards_env):
        admin = cards_env["admin"]
        await create_card(db, card_type="Application", name="Searchable App", user_id=admin.id)
        await create_card(db, card_type="Application", name="Other Thing", user_id=admin.id)

        response = await client.get(
            "/api/v1/cards?search=Searchable",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["items"][0]["name"] == "Searchable App"

    async def test_viewer_can_list(self, client, db, cards_env):
        viewer = cards_env["viewer"]
        response = await client.get(
            "/api/v1/cards",
            headers=auth_headers(viewer),
        )
        assert response.status_code == 200


# ---------------------------------------------------------------------------
# PATCH /cards/{id}  (update)
# ---------------------------------------------------------------------------


class TestUpdateCard:
    async def test_update_name(self, client, db, cards_env):
        admin = cards_env["admin"]
        card = await create_card(db, card_type="Application", name="Old Name", user_id=admin.id)

        response = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"name": "New Name"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["name"] == "New Name"

    async def test_approval_breaks_on_edit(self, client, db, cards_env):
        admin = cards_env["admin"]
        card = await create_card(db, card_type="Application", name="Approved App", user_id=admin.id)
        card.approval_status = "APPROVED"
        await db.flush()

        response = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"name": "Changed Name"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["approval_status"] == "BROKEN"

    async def test_viewer_cannot_update(self, client, db, cards_env):
        admin = cards_env["admin"]
        viewer = cards_env["viewer"]
        card = await create_card(db, card_type="Application", name="Protected", user_id=admin.id)

        response = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"name": "Hacked"},
            headers=auth_headers(viewer),
        )
        assert response.status_code == 403

    async def test_url_validation_rejects_bad_scheme(self, client, db, cards_env):
        admin = cards_env["admin"]
        card = await create_card(db, card_type="Application", name="URL Test", user_id=admin.id)

        response = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"attributes": {"website": "javascript:alert(1)"}},
            headers=auth_headers(admin),
        )
        assert response.status_code == 422

    async def test_url_validation_accepts_https(self, client, db, cards_env):
        admin = cards_env["admin"]
        card = await create_card(db, card_type="Application", name="URL Good", user_id=admin.id)

        response = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"attributes": {"website": "https://example.com"}},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200

    async def test_update_nonexistent_card_returns_404(self, client, db, cards_env):
        admin = cards_env["admin"]
        fake_id = uuid.uuid4()

        response = await client.patch(
            f"/api/v1/cards/{fake_id}",
            json={"name": "Ghost"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# POST /cards/{id}/archive  +  POST /cards/{id}/restore
# ---------------------------------------------------------------------------


class TestArchiveRestore:
    async def test_archive_sets_status(self, client, db, cards_env):
        admin = cards_env["admin"]
        card = await create_card(db, card_type="Application", name="Archive Me", user_id=admin.id)

        response = await client.post(
            f"/api/v1/cards/{card.id}/archive",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ARCHIVED"
        assert data["archived_at"] is not None

    async def test_archive_already_archived_returns_400(self, client, db, cards_env):
        admin = cards_env["admin"]
        card = await create_card(
            db,
            card_type="Application",
            name="Already Archived",
            user_id=admin.id,
            status="ARCHIVED",
        )
        card.archived_at = datetime.now(timezone.utc)
        await db.flush()

        response = await client.post(
            f"/api/v1/cards/{card.id}/archive",
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_restore_archived_card(self, client, db, cards_env):
        admin = cards_env["admin"]
        card = await create_card(
            db,
            card_type="Application",
            name="Restore Me",
            user_id=admin.id,
            status="ARCHIVED",
        )
        card.archived_at = datetime.now(timezone.utc)
        await db.flush()

        response = await client.post(
            f"/api/v1/cards/{card.id}/restore",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ACTIVE"
        assert data["archived_at"] is None

    async def test_restore_non_archived_returns_400(self, client, db, cards_env):
        admin = cards_env["admin"]
        card = await create_card(db, card_type="Application", name="Not Archived", user_id=admin.id)

        response = await client.post(
            f"/api/v1/cards/{card.id}/restore",
            headers=auth_headers(admin),
        )
        assert response.status_code == 400


# ---------------------------------------------------------------------------
# DELETE /cards/{id}
# ---------------------------------------------------------------------------


class TestDeleteCard:
    async def test_admin_can_permanently_delete(self, client, db, cards_env):
        admin = cards_env["admin"]
        card = await create_card(db, card_type="Application", name="Delete Me", user_id=admin.id)

        response = await client.delete(
            f"/api/v1/cards/{card.id}",
            headers=auth_headers(admin),
        )
        assert response.status_code == 204

    async def test_viewer_cannot_delete(self, client, db, cards_env):
        admin = cards_env["admin"]
        viewer = cards_env["viewer"]
        card = await create_card(db, card_type="Application", name="Protected", user_id=admin.id)

        response = await client.delete(
            f"/api/v1/cards/{card.id}",
            headers=auth_headers(viewer),
        )
        assert response.status_code == 403

    async def test_delete_nonexistent_returns_404(self, client, db, cards_env):
        admin = cards_env["admin"]

        response = await client.delete(
            f"/api/v1/cards/{uuid.uuid4()}",
            headers=auth_headers(admin),
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# POST /cards/{id}/approval-status
# ---------------------------------------------------------------------------


class TestApprovalStatus:
    async def test_approve_card(self, client, db, cards_env):
        admin = cards_env["admin"]
        card = await create_card(db, card_type="Application", name="Approve Me", user_id=admin.id)

        response = await client.post(
            f"/api/v1/cards/{card.id}/approval-status?action=approve",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["approval_status"] == "APPROVED"

    async def test_reject_card(self, client, db, cards_env):
        admin = cards_env["admin"]
        card = await create_card(db, card_type="Application", name="Reject Me", user_id=admin.id)

        response = await client.post(
            f"/api/v1/cards/{card.id}/approval-status?action=reject",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["approval_status"] == "REJECTED"

    async def test_reset_card(self, client, db, cards_env):
        admin = cards_env["admin"]
        card = await create_card(db, card_type="Application", name="Reset Me", user_id=admin.id)
        card.approval_status = "APPROVED"
        await db.flush()

        response = await client.post(
            f"/api/v1/cards/{card.id}/approval-status?action=reset",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["approval_status"] == "DRAFT"
