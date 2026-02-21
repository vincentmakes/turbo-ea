"""Integration tests for the /soaw endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_role,
    create_user,
)


@pytest.fixture
async def soaw_env(db):
    """Prerequisite data shared by all SoAW tests."""
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
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "member": member, "viewer": viewer}


# -------------------------------------------------------------------
# POST /soaw  (create)
# -------------------------------------------------------------------


class TestCreateSoAW:
    async def test_admin_can_create(self, client, db, soaw_env):
        admin = soaw_env["admin"]
        resp = await client.post(
            "/api/v1/soaw",
            json={
                "name": "Cloud Migration SoAW",
                "status": "draft",
                "document_info": {"version": "1.0"},
                "sections": {"scope": "Migrate to AWS"},
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Cloud Migration SoAW"
        assert data["status"] == "draft"
        assert data["revision_number"] == 1
        assert data["sections"]["scope"] == "Migrate to AWS"

    async def test_member_can_create(self, client, db, soaw_env):
        member = soaw_env["member"]
        resp = await client.post(
            "/api/v1/soaw",
            json={"name": "Member SoAW"},
            headers=auth_headers(member),
        )
        assert resp.status_code == 201

    async def test_viewer_cannot_create(self, client, db, soaw_env):
        viewer = soaw_env["viewer"]
        resp = await client.post(
            "/api/v1/soaw",
            json={"name": "Blocked"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# GET /soaw  (list)
# -------------------------------------------------------------------


class TestListSoAW:
    async def test_list_returns_soaws(self, client, db, soaw_env):
        admin = soaw_env["admin"]
        await client.post(
            "/api/v1/soaw",
            json={"name": "SoAW A"},
            headers=auth_headers(admin),
        )
        await client.post(
            "/api/v1/soaw",
            json={"name": "SoAW B"},
            headers=auth_headers(admin),
        )

        resp = await client.get(
            "/api/v1/soaw",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        names = [s["name"] for s in resp.json()]
        assert "SoAW A" in names
        assert "SoAW B" in names

    async def test_viewer_can_list(self, client, db, soaw_env):
        viewer = soaw_env["viewer"]
        resp = await client.get(
            "/api/v1/soaw",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 200


# -------------------------------------------------------------------
# GET /soaw/{id}
# -------------------------------------------------------------------


class TestGetSoAW:
    async def test_get_existing(self, client, db, soaw_env):
        admin = soaw_env["admin"]
        create_resp = await client.post(
            "/api/v1/soaw",
            json={"name": "Lookup SoAW"},
            headers=auth_headers(admin),
        )
        soaw_id = create_resp.json()["id"]

        resp = await client.get(
            f"/api/v1/soaw/{soaw_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Lookup SoAW"

    async def test_get_nonexistent_returns_404(self, client, db, soaw_env):
        admin = soaw_env["admin"]
        fake_id = str(uuid.uuid4())
        resp = await client.get(
            f"/api/v1/soaw/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# -------------------------------------------------------------------
# PATCH /soaw/{id}  (update)
# -------------------------------------------------------------------


class TestUpdateSoAW:
    async def test_update_name(self, client, db, soaw_env):
        admin = soaw_env["admin"]
        create_resp = await client.post(
            "/api/v1/soaw",
            json={"name": "Old Name"},
            headers=auth_headers(admin),
        )
        soaw_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/soaw/{soaw_id}",
            json={"name": "New Name"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "New Name"

    async def test_cannot_set_status_to_signed_via_update(self, client, db, soaw_env):
        admin = soaw_env["admin"]
        create_resp = await client.post(
            "/api/v1/soaw",
            json={"name": "No Direct Sign"},
            headers=auth_headers(admin),
        )
        soaw_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/soaw/{soaw_id}",
            json={"status": "signed"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_viewer_cannot_update(self, client, db, soaw_env):
        admin = soaw_env["admin"]
        viewer = soaw_env["viewer"]
        create_resp = await client.post(
            "/api/v1/soaw",
            json={"name": "Protected"},
            headers=auth_headers(admin),
        )
        soaw_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/soaw/{soaw_id}",
            json={"name": "Hacked"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_update_nonexistent_returns_404(self, client, db, soaw_env):
        admin = soaw_env["admin"]
        fake_id = str(uuid.uuid4())
        resp = await client.patch(
            f"/api/v1/soaw/{fake_id}",
            json={"name": "Ghost"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# -------------------------------------------------------------------
# DELETE /soaw/{id}
# -------------------------------------------------------------------


class TestDeleteSoAW:
    async def test_admin_can_delete(self, client, db, soaw_env):
        admin = soaw_env["admin"]
        create_resp = await client.post(
            "/api/v1/soaw",
            json={"name": "Delete Me"},
            headers=auth_headers(admin),
        )
        soaw_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/soaw/{soaw_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

        # Verify it's gone
        get_resp = await client.get(
            f"/api/v1/soaw/{soaw_id}",
            headers=auth_headers(admin),
        )
        assert get_resp.status_code == 404

    async def test_viewer_cannot_delete(self, client, db, soaw_env):
        admin = soaw_env["admin"]
        viewer = soaw_env["viewer"]
        create_resp = await client.post(
            "/api/v1/soaw",
            json={"name": "Protected"},
            headers=auth_headers(admin),
        )
        soaw_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/soaw/{soaw_id}",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# POST /soaw/{id}/request-signatures + POST /soaw/{id}/sign
# -------------------------------------------------------------------


class TestSignWorkflow:
    async def test_request_signatures(self, client, db, soaw_env):
        admin = soaw_env["admin"]
        member = soaw_env["member"]

        create_resp = await client.post(
            "/api/v1/soaw",
            json={"name": "Sign Me"},
            headers=auth_headers(admin),
        )
        soaw_id = create_resp.json()["id"]

        resp = await client.post(
            f"/api/v1/soaw/{soaw_id}/request-signatures",
            json={
                "user_ids": [str(member.id)],
                "message": "Please sign",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "in_review"
        assert len(data["signatories"]) == 1
        assert data["signatories"][0]["status"] == "pending"

    async def test_sign_soaw(self, client, db, soaw_env):
        admin = soaw_env["admin"]
        member = soaw_env["member"]

        # Create + request signature from member
        create_resp = await client.post(
            "/api/v1/soaw",
            json={"name": "Full Sign Flow"},
            headers=auth_headers(admin),
        )
        soaw_id = create_resp.json()["id"]

        await client.post(
            f"/api/v1/soaw/{soaw_id}/request-signatures",
            json={"user_ids": [str(member.id)]},
            headers=auth_headers(admin),
        )

        # Member signs
        resp = await client.post(
            f"/api/v1/soaw/{soaw_id}/sign",
            headers=auth_headers(member),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "signed"
        assert data["signed_at"] is not None

    async def test_non_signatory_cannot_sign(self, client, db, soaw_env):
        admin = soaw_env["admin"]
        member = soaw_env["member"]

        create_resp = await client.post(
            "/api/v1/soaw",
            json={"name": "Restricted Sign"},
            headers=auth_headers(admin),
        )
        soaw_id = create_resp.json()["id"]

        # Request signature only from member
        await client.post(
            f"/api/v1/soaw/{soaw_id}/request-signatures",
            json={"user_ids": [str(member.id)]},
            headers=auth_headers(admin),
        )

        # Admin (not a signatory) tries to sign
        resp = await client.post(
            f"/api/v1/soaw/{soaw_id}/sign",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 403

    async def test_cannot_edit_signed_soaw(self, client, db, soaw_env):
        admin = soaw_env["admin"]
        member = soaw_env["member"]

        # Create, request signature, sign
        create_resp = await client.post(
            "/api/v1/soaw",
            json={"name": "Locked After Sign"},
            headers=auth_headers(admin),
        )
        soaw_id = create_resp.json()["id"]

        await client.post(
            f"/api/v1/soaw/{soaw_id}/request-signatures",
            json={"user_ids": [str(member.id)]},
            headers=auth_headers(admin),
        )

        await client.post(
            f"/api/v1/soaw/{soaw_id}/sign",
            headers=auth_headers(member),
        )

        # Try to edit the signed document
        resp = await client.patch(
            f"/api/v1/soaw/{soaw_id}",
            json={"name": "Should Fail"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# POST /soaw/{id}/revise
# -------------------------------------------------------------------


class TestReviseSoAW:
    async def test_revise_signed_creates_new_draft(self, client, db, soaw_env):
        admin = soaw_env["admin"]
        member = soaw_env["member"]

        # Create, request signature, sign
        create_resp = await client.post(
            "/api/v1/soaw",
            json={
                "name": "Revision Test",
                "sections": {"scope": "v1 scope"},
            },
            headers=auth_headers(admin),
        )
        soaw_id = create_resp.json()["id"]

        await client.post(
            f"/api/v1/soaw/{soaw_id}/request-signatures",
            json={"user_ids": [str(member.id)]},
            headers=auth_headers(admin),
        )
        await client.post(
            f"/api/v1/soaw/{soaw_id}/sign",
            headers=auth_headers(member),
        )

        # Revise
        resp = await client.post(
            f"/api/v1/soaw/{soaw_id}/revise",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "draft"
        assert data["revision_number"] == 2
        assert data["parent_id"] == soaw_id
        assert data["sections"]["scope"] == "v1 scope"

    async def test_cannot_revise_non_signed(self, client, db, soaw_env):
        admin = soaw_env["admin"]
        create_resp = await client.post(
            "/api/v1/soaw",
            json={"name": "Not Signed Yet"},
            headers=auth_headers(admin),
        )
        soaw_id = create_resp.json()["id"]

        resp = await client.post(
            f"/api/v1/soaw/{soaw_id}/revise",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400
