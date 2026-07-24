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

        resp = await client.get("/api/v1/stakeholder-roles", params={"type_key": "Application"})
        assert resp.status_code == 200
        keys = {r["key"] for r in resp.json()}
        assert "responsible" in keys
        assert "observer" in keys
        assert "it_owner" not in keys

    async def test_list_roles_filtered_by_type_key_with_no_defs(self, client, db):
        """Falls back to defaults when no definitions exist for a type."""
        await create_card_type(db, key="Application", label="Application")
        resp = await client.get("/api/v1/stakeholder-roles", params={"type_key": "Application"})
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


# ---------------------------------------------------------------------------
# /cards/{card_id}/me/observe  (one-click self-observe)
# ---------------------------------------------------------------------------


class TestSelfObserve:
    async def test_viewer_can_self_observe(self, client, db, stakeholders_env):
        """A viewer without stakeholders.manage can add themselves as Observer."""
        viewer = stakeholders_env["viewer"]
        card = stakeholders_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/me/observe",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["user_id"] == str(viewer.id)
        assert data["role"] == "observer"
        assert data["role_label"] == "Observer"

    async def test_self_observe_is_idempotent(self, client, db, stakeholders_env):
        """A second POST returns the same row instead of 409."""
        viewer = stakeholders_env["viewer"]
        card = stakeholders_env["card"]
        first = await client.post(
            f"/api/v1/cards/{card.id}/me/observe",
            headers=auth_headers(viewer),
        )
        assert first.status_code == 201
        first_id = first.json()["id"]

        second = await client.post(
            f"/api/v1/cards/{card.id}/me/observe",
            headers=auth_headers(viewer),
        )
        assert second.status_code == 201
        assert second.json()["id"] == first_id

    async def test_get_my_observe_status(self, client, db, stakeholders_env):
        """GET reports current state and role availability."""
        viewer = stakeholders_env["viewer"]
        card = stakeholders_env["card"]

        before = await client.get(
            f"/api/v1/cards/{card.id}/me/observe",
            headers=auth_headers(viewer),
        )
        assert before.status_code == 200
        assert before.json() == {
            "is_observer": False,
            "observer_role_available": True,
        }

        await client.post(
            f"/api/v1/cards/{card.id}/me/observe",
            headers=auth_headers(viewer),
        )

        after = await client.get(
            f"/api/v1/cards/{card.id}/me/observe",
            headers=auth_headers(viewer),
        )
        assert after.status_code == 200
        assert after.json() == {
            "is_observer": True,
            "observer_role_available": True,
        }

    async def test_self_unobserve_removes_row(self, client, db, stakeholders_env):
        """DELETE removes the observer row and a second call still returns 204."""
        viewer = stakeholders_env["viewer"]
        card = stakeholders_env["card"]
        await client.post(
            f"/api/v1/cards/{card.id}/me/observe",
            headers=auth_headers(viewer),
        )

        first = await client.delete(
            f"/api/v1/cards/{card.id}/me/observe",
            headers=auth_headers(viewer),
        )
        assert first.status_code == 204

        second = await client.delete(
            f"/api/v1/cards/{card.id}/me/observe",
            headers=auth_headers(viewer),
        )
        assert second.status_code == 204

        status = await client.get(
            f"/api/v1/cards/{card.id}/me/observe",
            headers=auth_headers(viewer),
        )
        assert status.json()["is_observer"] is False

    async def test_self_observe_card_not_found(self, client, db, stakeholders_env):
        """Observing a non-existent card returns 404."""
        viewer = stakeholders_env["viewer"]
        fake_id = uuid.uuid4()
        resp = await client.post(
            f"/api/v1/cards/{fake_id}/me/observe",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 404

    async def test_self_observe_when_role_absent(self, client, db, stakeholders_env):
        """POST returns 409 observer_role_unavailable when the card type has no
        active Observer role; GET reports observer_role_available=False; DELETE
        still succeeds for any stale row."""
        admin = stakeholders_env["admin"]
        viewer = stakeholders_env["viewer"]
        await create_card_type(db, key="Provider", label="Provider")
        # No observer role is defined for "Provider" — only the fallback path
        # in `_roles_for_type` would inject one, but defining a non-observer
        # role suppresses the fallback.
        await create_stakeholder_role_def(
            db, card_type_key="Provider", key="responsible", label="Responsible"
        )
        provider_card = await create_card(
            db,
            card_type="Provider",
            name="No-Observer Provider",
            user_id=admin.id,
        )

        status = await client.get(
            f"/api/v1/cards/{provider_card.id}/me/observe",
            headers=auth_headers(viewer),
        )
        assert status.status_code == 200
        assert status.json() == {
            "is_observer": False,
            "observer_role_available": False,
        }

        resp = await client.post(
            f"/api/v1/cards/{provider_card.id}/me/observe",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "observer_role_unavailable"

        # Stale-row cleanup path: even if the role were later removed, DELETE
        # must always succeed (returns 204 whether or not a row exists).
        delete_resp = await client.delete(
            f"/api/v1/cards/{provider_card.id}/me/observe",
            headers=auth_headers(viewer),
        )
        assert delete_resp.status_code == 204


# ---------------------------------------------------------------------------
# POST /stakeholders/bulk  (batched add/remove, spreadsheet importer)
# ---------------------------------------------------------------------------


class TestBulkStakeholders:
    async def test_bulk_add_by_id_and_email(self, client, db, stakeholders_env):
        """Ops may reference the user by user_id or (case-insensitive) email."""
        admin = stakeholders_env["admin"]
        member = stakeholders_env["member"]
        viewer = stakeholders_env["viewer"]
        card = stakeholders_env["card"]
        resp = await client.post(
            "/api/v1/stakeholders/bulk",
            json={
                "operations": [
                    {"card_id": str(card.id), "user_id": str(member.id), "role": "responsible"},
                    {"card_id": str(card.id), "user_email": "VIEWER@test.com", "role": "observer"},
                ]
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["added"] == 2
        assert data["removed"] == 0
        assert data["failed"] == 0
        assert data["dry_run"] is False
        assert [r["status"] for r in data["results"]] == ["added", "added"]

        list_resp = await client.get(
            f"/api/v1/cards/{card.id}/stakeholders", headers=auth_headers(admin)
        )
        by_user = {s["user_id"]: s["role"] for s in list_resp.json()}
        assert by_user[str(member.id)] == "responsible"
        assert by_user[str(viewer.id)] == "observer"

    async def test_bulk_add_duplicate_is_noop(self, client, db, stakeholders_env):
        """Adding an assignment that already exists reports noop, not error."""
        admin = stakeholders_env["admin"]
        member = stakeholders_env["member"]
        card = stakeholders_env["card"]
        op = {"card_id": str(card.id), "user_id": str(member.id), "role": "responsible"}
        first = await client.post(
            "/api/v1/stakeholders/bulk",
            json={"operations": [op]},
            headers=auth_headers(admin),
        )
        assert first.json()["added"] == 1

        second = await client.post(
            "/api/v1/stakeholders/bulk",
            json={"operations": [op]},
            headers=auth_headers(admin),
        )
        data = second.json()
        assert data["added"] == 0
        assert data["results"][0]["status"] == "noop"

    async def test_bulk_remove(self, client, db, stakeholders_env):
        """Remove deletes an existing assignment; removing again is a noop."""
        admin = stakeholders_env["admin"]
        member = stakeholders_env["member"]
        card = stakeholders_env["card"]
        add = {"card_id": str(card.id), "user_id": str(member.id), "role": "responsible"}
        await client.post(
            "/api/v1/stakeholders/bulk",
            json={"operations": [add]},
            headers=auth_headers(admin),
        )

        remove = {**add, "action": "remove"}
        resp = await client.post(
            "/api/v1/stakeholders/bulk",
            json={"operations": [remove]},
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert data["removed"] == 1
        assert data["results"][0]["status"] == "removed"

        again = await client.post(
            "/api/v1/stakeholders/bulk",
            json={"operations": [remove]},
            headers=auth_headers(admin),
        )
        assert again.json()["results"][0]["status"] == "noop"

        list_resp = await client.get(
            f"/api/v1/cards/{card.id}/stakeholders", headers=auth_headers(admin)
        )
        assert list_resp.json() == []

    async def test_bulk_mixed_batch_partial_success(self, client, db, stakeholders_env):
        """Bad rows fail individually without rolling back good rows."""
        admin = stakeholders_env["admin"]
        member = stakeholders_env["member"]
        card = stakeholders_env["card"]
        resp = await client.post(
            "/api/v1/stakeholders/bulk",
            json={
                "operations": [
                    {
                        "row_index": 10,
                        "card_id": str(card.id),
                        "user_id": str(member.id),
                        "role": "responsible",
                    },
                    {
                        "row_index": 11,
                        "card_id": str(card.id),
                        "user_id": str(member.id),
                        "role": "nonexistent_role",
                    },
                    {
                        "row_index": 12,
                        "card_id": str(card.id),
                        "user_email": "ghost@test.com",
                        "role": "observer",
                    },
                    {
                        "row_index": 13,
                        "card_id": str(uuid.uuid4()),
                        "user_id": str(member.id),
                        "role": "responsible",
                    },
                ]
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["added"] == 1
        assert data["failed"] == 3
        by_row = {r["row_index"]: r for r in data["results"]}
        assert by_row[10]["status"] == "added"
        assert "Invalid role" in by_row[11]["error"]
        assert "User not found" in by_row[12]["error"]
        assert by_row[13]["error"] == "Card not found"

        list_resp = await client.get(
            f"/api/v1/cards/{card.id}/stakeholders", headers=auth_headers(admin)
        )
        assert len(list_resp.json()) == 1

    async def test_bulk_dry_run_persists_nothing(self, client, db, stakeholders_env):
        """dry_run validates and reports but rolls everything back."""
        admin = stakeholders_env["admin"]
        member = stakeholders_env["member"]
        card = stakeholders_env["card"]
        resp = await client.post(
            "/api/v1/stakeholders/bulk",
            json={
                "operations": [
                    {"card_id": str(card.id), "user_id": str(member.id), "role": "responsible"}
                ],
                "dry_run": True,
            },
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert data["dry_run"] is True
        assert data["added"] == 1

        list_resp = await client.get(
            f"/api/v1/cards/{card.id}/stakeholders", headers=auth_headers(admin)
        )
        assert list_resp.json() == []

    async def test_bulk_viewer_gets_per_op_permission_errors(self, client, db, stakeholders_env):
        """A caller without stakeholders.manage fails per-op, changes nothing."""
        admin = stakeholders_env["admin"]
        viewer = stakeholders_env["viewer"]
        card = stakeholders_env["card"]
        resp = await client.post(
            "/api/v1/stakeholders/bulk",
            json={
                "operations": [
                    {"card_id": str(card.id), "user_id": str(viewer.id), "role": "observer"}
                ]
            },
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["failed"] == 1
        assert data["results"][0]["error"] == "Not enough permissions"

        list_resp = await client.get(
            f"/api/v1/cards/{card.id}/stakeholders", headers=auth_headers(admin)
        )
        assert list_resp.json() == []

    async def test_bulk_requires_user_reference(self, client, db, stakeholders_env):
        """An op with neither user_id nor user_email is rejected at validation."""
        admin = stakeholders_env["admin"]
        card = stakeholders_env["card"]
        resp = await client.post(
            "/api/v1/stakeholders/bulk",
            json={"operations": [{"card_id": str(card.id), "role": "responsible"}]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 422
