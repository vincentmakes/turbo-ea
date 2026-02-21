"""Integration tests for the /stakeholder-roles, /cards/{id}/stakeholders,
and /stakeholders/{id} endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

pytestmark = pytest.mark.anyio


# ---------------------------------------------------------------------------
# Shared fixture
# ---------------------------------------------------------------------------


@pytest.fixture
async def stakeholders_env(db):
    """Prerequisite data for stakeholder tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="member",
        label="Member",
        permissions=MEMBER_PERMISSIONS,
    )
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions=VIEWER_PERMISSIONS,
    )
    await create_card_type(db, key="Application", label="Application")
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="responsible", label="Responsible"
    )
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="observer", label="Observer"
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    card = await create_card(
        db,
        card_type="Application",
        name="Stakeholder Test App",
        user_id=admin.id,
    )
    return {
        "admin": admin,
        "member": member,
        "viewer": viewer,
        "card": card,
    }


# ---------------------------------------------------------------------------
# GET /stakeholder-roles  (list roles)
# ---------------------------------------------------------------------------


class TestListStakeholderRoles:
    async def test_list_roles_empty(self, client, db):
        """Returns empty list when no role definitions exist."""
        resp = await client.get("/api/v1/stakeholder-roles")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_list_roles_with_definitions(self, client, db, stakeholders_env):
        """Returns all unique roles across all types."""
        resp = await client.get("/api/v1/stakeholder-roles")
        assert resp.status_code == 200
        data = resp.json()
        keys = {r["key"] for r in data}
        assert "responsible" in keys
        assert "observer" in keys
        for role in data:
            assert "key" in role
            assert "label" in role

    async def test_list_roles_filtered_by_type_key(self, client, db, stakeholders_env):
        """Returns only roles for the specified type_key."""
        # Create a second type with a different role
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_stakeholder_role_def(
            db, card_type_key="ITComponent", key="it_owner", label="IT Owner"
        )

        resp = await client.get(
            "/api/v1/stakeholder-roles", params={"type_key": "Application"}
        )
        assert resp.status_code == 200
        keys = {r["key"] for r in resp.json()}
        assert "responsible" in keys
        assert "observer" in keys
        assert "it_owner" not in keys

    async def test_list_roles_filtered_by_type_key_with_no_defs(self, client, db):
        """Falls back to defaults when no definitions exist for a type."""
        await create_card_type(db, key="Application", label="Application")
        resp = await client.get(
            "/api/v1/stakeholder-roles", params={"type_key": "Application"}
        )
        assert resp.status_code == 200
        data = resp.json()
        # Should fall back to default roles
        keys = {r["key"] for r in data}
        assert "responsible" in keys
        assert "observer" in keys


# ---------------------------------------------------------------------------
# GET /cards/{card_id}/stakeholders  (list stakeholders on a card)
# ---------------------------------------------------------------------------


class TestListStakeholders:
    async def test_list_stakeholders_empty(self, client, db, stakeholders_env):
        """Returns empty list when no stakeholders assigned."""
        admin = stakeholders_env["admin"]
        card = stakeholders_env["card"]
        resp = await client.get(
            f"/api/v1/cards/{card.id}/stakeholders",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_list_stakeholders_after_create(self, client, db, stakeholders_env):
        """Returns stakeholder data after creating one."""
        admin = stakeholders_env["admin"]
        member = stakeholders_env["member"]
        card = stakeholders_env["card"]

        # Create a stakeholder first
        create_resp = await client.post(
            f"/api/v1/cards/{card.id}/stakeholders",
            json={"user_id": str(member.id), "role": "responsible"},
            headers=auth_headers(admin),
        )
        assert create_resp.status_code == 201

        # List and verify
        resp = await client.get(
            f"/api/v1/cards/{card.id}/stakeholders",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["user_id"] == str(member.id)
        assert data[0]["role"] == "responsible"
        assert data[0]["role_label"] == "Responsible"
        assert data[0]["user_display_name"] is not None
        assert data[0]["user_email"] is not None
        assert "id" in data[0]
        assert "created_at" in data[0]

    async def test_viewer_can_list_stakeholders(self, client, db, stakeholders_env):
        """Viewer role has stakeholders.view permission."""
        viewer = stakeholders_env["viewer"]
        card = stakeholders_env["card"]
        resp = await client.get(
            f"/api/v1/cards/{card.id}/stakeholders",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# POST /cards/{card_id}/stakeholders  (create)
# ---------------------------------------------------------------------------


class TestCreateStakeholder:
    async def test_admin_can_create_stakeholder(self, client, db, stakeholders_env):
        """Admin can assign a stakeholder to a card."""
        admin = stakeholders_env["admin"]
        member = stakeholders_env["member"]
        card = stakeholders_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/stakeholders",
            json={"user_id": str(member.id), "role": "responsible"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["user_id"] == str(member.id)
        assert data["role"] == "responsible"
        assert data["role_label"] == "Responsible"
        assert "id" in data
        assert "user_display_name" in data

    async def test_member_can_create_stakeholder(self, client, db, stakeholders_env):
        """Member role has stakeholders.manage permission."""
        admin = stakeholders_env["admin"]
        member = stakeholders_env["member"]
        card = stakeholders_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/stakeholders",
            json={"user_id": str(admin.id), "role": "observer"},
            headers=auth_headers(member),
        )
        assert resp.status_code == 201
        assert resp.json()["role"] == "observer"

    async def test_duplicate_stakeholder_returns_409(self, client, db, stakeholders_env):
        """Same user + same role on the same card is rejected."""
        admin = stakeholders_env["admin"]
        member = stakeholders_env["member"]
        card = stakeholders_env["card"]
        payload = {"user_id": str(member.id), "role": "responsible"}
        resp1 = await client.post(
            f"/api/v1/cards/{card.id}/stakeholders",
            json=payload,
            headers=auth_headers(admin),
        )
        assert resp1.status_code == 201

        resp2 = await client.post(
            f"/api/v1/cards/{card.id}/stakeholders",
            json=payload,
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 409

    async def test_same_user_different_role_allowed(self, client, db, stakeholders_env):
        """Same user can hold a different role on the same card."""
        admin = stakeholders_env["admin"]
        member = stakeholders_env["member"]
        card = stakeholders_env["card"]

        resp1 = await client.post(
            f"/api/v1/cards/{card.id}/stakeholders",
            json={"user_id": str(member.id), "role": "responsible"},
            headers=auth_headers(admin),
        )
        assert resp1.status_code == 201

        resp2 = await client.post(
            f"/api/v1/cards/{card.id}/stakeholders",
            json={"user_id": str(member.id), "role": "observer"},
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 201

    async def test_invalid_role_returns_400(self, client, db, stakeholders_env):
        """Role key must be one of the defined stakeholder roles for the type."""
        admin = stakeholders_env["admin"]
        member = stakeholders_env["member"]
        card = stakeholders_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/stakeholders",
            json={"user_id": str(member.id), "role": "nonexistent_role"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_card_not_found_returns_404(self, client, db, stakeholders_env):
        """Creating a stakeholder on a non-existent card returns 404."""
        admin = stakeholders_env["admin"]
        member = stakeholders_env["member"]
        fake_card_id = uuid.uuid4()
        resp = await client.post(
            f"/api/v1/cards/{fake_card_id}/stakeholders",
            json={"user_id": str(member.id), "role": "responsible"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_viewer_cannot_create_stakeholder(self, client, db, stakeholders_env):
        """Viewer role does not have stakeholders.manage permission."""
        viewer = stakeholders_env["viewer"]
        member = stakeholders_env["member"]
        card = stakeholders_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/stakeholders",
            json={"user_id": str(member.id), "role": "responsible"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# PATCH /stakeholders/{stakeholder_id}  (update)
# ---------------------------------------------------------------------------


class TestUpdateStakeholder:
    async def test_update_stakeholder_role(self, client, db, stakeholders_env):
        """Admin can update a stakeholder's role."""
        admin = stakeholders_env["admin"]
        member = stakeholders_env["member"]
        card = stakeholders_env["card"]

        # Create stakeholder
        create_resp = await client.post(
            f"/api/v1/cards/{card.id}/stakeholders",
            json={"user_id": str(member.id), "role": "responsible"},
            headers=auth_headers(admin),
        )
        assert create_resp.status_code == 201
        stakeholder_id = create_resp.json()["id"]

        # Update role
        resp = await client.patch(
            f"/api/v1/stakeholders/{stakeholder_id}",
            json={"user_id": str(member.id), "role": "observer"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["role"] == "observer"
        assert data["role_label"] == "Observer"
        assert data["id"] == stakeholder_id

    async def test_update_with_invalid_role_returns_400(self, client, db, stakeholders_env):
        """Updating to an invalid role is rejected."""
        admin = stakeholders_env["admin"]
        member = stakeholders_env["member"]
        card = stakeholders_env["card"]

        create_resp = await client.post(
            f"/api/v1/cards/{card.id}/stakeholders",
            json={"user_id": str(member.id), "role": "responsible"},
            headers=auth_headers(admin),
        )
        stakeholder_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/stakeholders/{stakeholder_id}",
            json={"user_id": str(member.id), "role": "nonexistent_role"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_update_nonexistent_returns_404(self, client, db, stakeholders_env):
        """Updating a non-existent stakeholder returns 404."""
        admin = stakeholders_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.patch(
            f"/api/v1/stakeholders/{fake_id}",
            json={"user_id": str(admin.id), "role": "observer"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_viewer_cannot_update_stakeholder(self, client, db, stakeholders_env):
        """Viewer role cannot update stakeholders."""
        admin = stakeholders_env["admin"]
        member = stakeholders_env["member"]
        viewer = stakeholders_env["viewer"]
        card = stakeholders_env["card"]

        create_resp = await client.post(
            f"/api/v1/cards/{card.id}/stakeholders",
            json={"user_id": str(member.id), "role": "responsible"},
            headers=auth_headers(admin),
        )
        stakeholder_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/stakeholders/{stakeholder_id}",
            json={"user_id": str(member.id), "role": "observer"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# DELETE /stakeholders/{stakeholder_id}
# ---------------------------------------------------------------------------


class TestDeleteStakeholder:
    async def test_delete_stakeholder(self, client, db, stakeholders_env):
        """Admin can delete a stakeholder assignment."""
        admin = stakeholders_env["admin"]
        member = stakeholders_env["member"]
        card = stakeholders_env["card"]

        # Create stakeholder
        create_resp = await client.post(
            f"/api/v1/cards/{card.id}/stakeholders",
            json={"user_id": str(member.id), "role": "responsible"},
            headers=auth_headers(admin),
        )
        assert create_resp.status_code == 201
        stakeholder_id = create_resp.json()["id"]

        # Delete
        resp = await client.delete(
            f"/api/v1/stakeholders/{stakeholder_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

        # Verify it is gone
        list_resp = await client.get(
            f"/api/v1/cards/{card.id}/stakeholders",
            headers=auth_headers(admin),
        )
        assert list_resp.status_code == 200
        assert len(list_resp.json()) == 0

    async def test_delete_nonexistent_returns_404(self, client, db, stakeholders_env):
        """Deleting a non-existent stakeholder returns 404."""
        admin = stakeholders_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.delete(
            f"/api/v1/stakeholders/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_viewer_cannot_delete_stakeholder(self, client, db, stakeholders_env):
        """Viewer role cannot delete stakeholders."""
        admin = stakeholders_env["admin"]
        member = stakeholders_env["member"]
        viewer = stakeholders_env["viewer"]
        card = stakeholders_env["card"]

        create_resp = await client.post(
            f"/api/v1/cards/{card.id}/stakeholders",
            json={"user_id": str(member.id), "role": "observer"},
            headers=auth_headers(admin),
        )
        stakeholder_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/stakeholders/{stakeholder_id}",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403
