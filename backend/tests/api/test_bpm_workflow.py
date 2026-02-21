"""Integration tests for the BPM workflow endpoints (process flow versions).

Covers the draft / pending / published / archived lifecycle:
- GET    /bpm/processes/{id}/flow/published
- GET    /bpm/processes/{id}/flow/drafts
- POST   /bpm/processes/{id}/flow/drafts
- GET    /bpm/processes/{id}/flow/versions/{vid}
- PATCH  /bpm/processes/{id}/flow/versions/{vid}
- DELETE /bpm/processes/{id}/flow/versions/{vid}
- POST   /bpm/processes/{id}/flow/versions/{vid}/submit
- POST   /bpm/processes/{id}/flow/versions/{vid}/approve
- POST   /bpm/processes/{id}/flow/versions/{vid}/reject
- GET    /bpm/processes/{id}/flow/archived
- GET    /bpm/processes/{id}/flow/permissions
"""

from __future__ import annotations

import uuid

import pytest

from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)

pytestmark = pytest.mark.anyio

SAMPLE_BPMN = "<bpmn>test</bpmn>"
UPDATED_BPMN = "<bpmn>updated</bpmn>"
SAMPLE_SVG = "<svg>thumbnail</svg>"


# ---------------------------------------------------------------------------
# Shared fixture
# ---------------------------------------------------------------------------


@pytest.fixture
async def wf_env(db):
    """Prerequisite data for BPM workflow tests.

    Creates admin and viewer roles, a BusinessProcess card type,
    an admin user, a viewer user, and an active BusinessProcess card.
    """
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions={
            "inventory.view": True,
            "bpm.view": True,
        },
    )
    await create_card_type(
        db,
        key="BusinessProcess",
        label="Business Process",
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    process = await create_card(
        db,
        card_type="BusinessProcess",
        name="Test Process",
        user_id=admin.id,
    )
    return {
        "admin": admin,
        "viewer": viewer,
        "process": process,
    }


# ---------------------------------------------------------------------------
# Helper to create a draft via API and return the response JSON
# ---------------------------------------------------------------------------


async def _create_draft(client, process_id, user, bpmn_xml=SAMPLE_BPMN, **kwargs):
    """Shortcut to POST a draft and return the parsed JSON body."""
    body = {"bpmn_xml": bpmn_xml, **kwargs}
    resp = await client.post(
        f"/api/v1/bpm/processes/{process_id}/flow/drafts",
        json=body,
        headers=auth_headers(user),
    )
    return resp


# ---------------------------------------------------------------------------
# GET /bpm/processes/{id}/flow/published
# ---------------------------------------------------------------------------


class TestGetPublishedFlow:
    async def test_no_published_returns_none(self, client, db, wf_env):
        """When no version is published the endpoint returns null."""
        admin = wf_env["admin"]
        process = wf_env["process"]
        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/flow/published",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json() is None

    async def test_get_published_after_approve(self, client, db, wf_env):
        """After a draft is submitted and approved, published returns it."""
        admin = wf_env["admin"]
        process = wf_env["process"]

        # Create draft -> submit -> approve
        draft_resp = await _create_draft(client, process.id, admin)
        assert draft_resp.status_code == 201
        vid = draft_resp.json()["id"]

        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/submit",
            headers=auth_headers(admin),
        )
        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/approve",
            headers=auth_headers(admin),
        )

        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/flow/published",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data is not None
        assert data["status"] == "published"
        assert data["bpmn_xml"] == SAMPLE_BPMN


# ---------------------------------------------------------------------------
# POST /bpm/processes/{id}/flow/drafts — create draft
# ---------------------------------------------------------------------------


class TestCreateDraft:
    async def test_create_draft(self, client, db, wf_env):
        """Admin can create a draft process flow version."""
        admin = wf_env["admin"]
        process = wf_env["process"]
        resp = await _create_draft(client, process.id, admin)
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "draft"
        assert data["bpmn_xml"] == SAMPLE_BPMN
        assert data["revision"] == 1
        assert data["process_id"] == str(process.id)
        assert data["created_by"] == str(admin.id)

    async def test_create_draft_with_svg(self, client, db, wf_env):
        """Draft can include an SVG thumbnail."""
        admin = wf_env["admin"]
        process = wf_env["process"]
        resp = await _create_draft(client, process.id, admin, svg_thumbnail=SAMPLE_SVG)
        assert resp.status_code == 201
        assert resp.json()["svg_thumbnail"] == SAMPLE_SVG

    async def test_create_draft_increments_revision(self, client, db, wf_env):
        """Each new draft gets a higher revision number."""
        admin = wf_env["admin"]
        process = wf_env["process"]
        r1 = await _create_draft(client, process.id, admin)
        r2 = await _create_draft(client, process.id, admin, bpmn_xml="<bpmn>v2</bpmn>")
        assert r1.json()["revision"] < r2.json()["revision"]

    async def test_viewer_cannot_create_draft(self, client, db, wf_env):
        """Viewer role lacks bpm.edit and should get 403."""
        viewer = wf_env["viewer"]
        process = wf_env["process"]
        resp = await _create_draft(client, process.id, viewer)
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# GET /bpm/processes/{id}/flow/drafts — list drafts
# ---------------------------------------------------------------------------


class TestListDrafts:
    async def test_list_drafts(self, client, db, wf_env):
        """Admin can list draft versions."""
        admin = wf_env["admin"]
        process = wf_env["process"]

        await _create_draft(client, process.id, admin)
        await _create_draft(client, process.id, admin, bpmn_xml="<bpmn>d2</bpmn>")

        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/flow/drafts",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 2
        # Summaries should not include bpmn_xml
        for item in data:
            assert "bpmn_xml" not in item
            assert item["status"] in ("draft", "pending")

    async def test_list_drafts_empty(self, client, db, wf_env):
        """No drafts returns an empty list."""
        admin = wf_env["admin"]
        process = wf_env["process"]
        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/flow/drafts",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json() == []


# ---------------------------------------------------------------------------
# PATCH /bpm/processes/{id}/flow/versions/{vid} — update draft
# ---------------------------------------------------------------------------


class TestUpdateDraft:
    async def test_update_draft_bpmn_xml(self, client, db, wf_env):
        """Admin can update the BPMN XML of a draft version."""
        admin = wf_env["admin"]
        process = wf_env["process"]

        create_resp = await _create_draft(client, process.id, admin)
        vid = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}",
            json={"bpmn_xml": UPDATED_BPMN},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["bpmn_xml"] == UPDATED_BPMN

    async def test_update_draft_svg_thumbnail(self, client, db, wf_env):
        """Admin can update the SVG thumbnail of a draft version."""
        admin = wf_env["admin"]
        process = wf_env["process"]

        create_resp = await _create_draft(client, process.id, admin)
        vid = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}",
            json={"svg_thumbnail": SAMPLE_SVG},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["svg_thumbnail"] == SAMPLE_SVG

    async def test_update_non_draft_fails(self, client, db, wf_env):
        """Cannot update a version that is not in draft status (e.g. pending)."""
        admin = wf_env["admin"]
        process = wf_env["process"]

        create_resp = await _create_draft(client, process.id, admin)
        vid = create_resp.json()["id"]

        # Submit to move to pending
        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/submit",
            headers=auth_headers(admin),
        )

        resp = await client.patch(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}",
            json={"bpmn_xml": UPDATED_BPMN},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# DELETE /bpm/processes/{id}/flow/versions/{vid} — delete draft
# ---------------------------------------------------------------------------


class TestDeleteDraft:
    async def test_delete_draft(self, client, db, wf_env):
        """Admin can delete a draft version."""
        admin = wf_env["admin"]
        process = wf_env["process"]

        create_resp = await _create_draft(client, process.id, admin)
        vid = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

        # Verify it is gone
        get_resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}",
            headers=auth_headers(admin),
        )
        assert get_resp.status_code == 404

    async def test_delete_non_draft_fails(self, client, db, wf_env):
        """Cannot delete a version that is not in draft status (e.g. pending)."""
        admin = wf_env["admin"]
        process = wf_env["process"]

        create_resp = await _create_draft(client, process.id, admin)
        vid = create_resp.json()["id"]

        # Submit to move to pending
        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/submit",
            headers=auth_headers(admin),
        )

        resp = await client.delete(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# POST /bpm/processes/{id}/flow/versions/{vid}/submit — submit for approval
# ---------------------------------------------------------------------------


class TestSubmitForApproval:
    async def test_submit_draft(self, client, db, wf_env):
        """Submitting a draft changes its status to pending."""
        admin = wf_env["admin"]
        process = wf_env["process"]

        create_resp = await _create_draft(client, process.id, admin)
        vid = create_resp.json()["id"]

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/submit",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "pending"
        assert data["submitted_by"] == str(admin.id)
        assert data["submitted_at"] is not None

    async def test_submit_non_draft_fails(self, client, db, wf_env):
        """Cannot submit a version that is already pending."""
        admin = wf_env["admin"]
        process = wf_env["process"]

        create_resp = await _create_draft(client, process.id, admin)
        vid = create_resp.json()["id"]

        # First submit succeeds
        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/submit",
            headers=auth_headers(admin),
        )
        # Second submit should fail
        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/submit",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# POST /bpm/processes/{id}/flow/versions/{vid}/approve
# ---------------------------------------------------------------------------


class TestApproveVersion:
    async def test_approve_pending(self, client, db, wf_env):
        """Approving a pending version publishes it."""
        admin = wf_env["admin"]
        process = wf_env["process"]

        create_resp = await _create_draft(client, process.id, admin)
        vid = create_resp.json()["id"]

        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/submit",
            headers=auth_headers(admin),
        )

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/approve",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "published"
        assert data["approved_by"] == str(admin.id)
        assert data["approved_at"] is not None

    async def test_approve_non_pending_fails(self, client, db, wf_env):
        """Cannot approve a draft that hasn't been submitted."""
        admin = wf_env["admin"]
        process = wf_env["process"]

        create_resp = await _create_draft(client, process.id, admin)
        vid = create_resp.json()["id"]

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/approve",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_approve_archives_previous_published(self, client, db, wf_env):
        """When a new version is approved the previously published one is archived."""
        admin = wf_env["admin"]
        process = wf_env["process"]

        # Create first draft, submit, approve (becomes published)
        r1 = await _create_draft(client, process.id, admin, bpmn_xml="<bpmn>v1</bpmn>")
        vid1 = r1.json()["id"]
        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid1}/submit",
            headers=auth_headers(admin),
        )
        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid1}/approve",
            headers=auth_headers(admin),
        )

        # Create second draft, submit, approve (becomes published, first becomes archived)
        r2 = await _create_draft(client, process.id, admin, bpmn_xml="<bpmn>v2</bpmn>")
        vid2 = r2.json()["id"]
        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid2}/submit",
            headers=auth_headers(admin),
        )
        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid2}/approve",
            headers=auth_headers(admin),
        )

        # The published endpoint should return v2
        pub_resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/flow/published",
            headers=auth_headers(admin),
        )
        assert pub_resp.json()["id"] == vid2
        assert pub_resp.json()["status"] == "published"

        # v1 should now be archived
        v1_resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid1}",
            headers=auth_headers(admin),
        )
        assert v1_resp.status_code == 200
        assert v1_resp.json()["status"] == "archived"
        assert v1_resp.json()["archived_at"] is not None


# ---------------------------------------------------------------------------
# POST /bpm/processes/{id}/flow/versions/{vid}/reject
# ---------------------------------------------------------------------------


class TestRejectVersion:
    async def test_reject_pending(self, client, db, wf_env):
        """Rejecting a pending version returns it to draft status."""
        admin = wf_env["admin"]
        process = wf_env["process"]

        create_resp = await _create_draft(client, process.id, admin)
        vid = create_resp.json()["id"]

        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/submit",
            headers=auth_headers(admin),
        )

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/reject",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "draft"
        # submitted_by / submitted_at should be cleared on reject
        assert data["submitted_by"] is None
        assert data["submitted_at"] is None

    async def test_reject_non_pending_fails(self, client, db, wf_env):
        """Cannot reject a version that is not pending."""
        admin = wf_env["admin"]
        process = wf_env["process"]

        create_resp = await _create_draft(client, process.id, admin)
        vid = create_resp.json()["id"]

        # Draft (not pending) — reject should fail
        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/reject",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# GET /bpm/processes/{id}/flow/versions/{vid} — get specific version
# ---------------------------------------------------------------------------


class TestGetVersion:
    async def test_get_specific_version(self, client, db, wf_env):
        """Can fetch a specific version by ID."""
        admin = wf_env["admin"]
        process = wf_env["process"]

        create_resp = await _create_draft(client, process.id, admin)
        vid = create_resp.json()["id"]

        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == vid
        assert data["bpmn_xml"] == SAMPLE_BPMN
        assert data["status"] == "draft"

    async def test_version_not_found(self, client, db, wf_env):
        """Returns 404 for a non-existent version ID."""
        admin = wf_env["admin"]
        process = wf_env["process"]
        fake_vid = uuid.uuid4()

        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{fake_vid}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Process not found (404)
# ---------------------------------------------------------------------------


class TestProcessNotFound:
    async def test_published_process_not_found(self, client, db, wf_env):
        """Returns 404 when the process ID does not exist."""
        admin = wf_env["admin"]
        fake_pid = uuid.uuid4()

        resp = await client.get(
            f"/api/v1/bpm/processes/{fake_pid}/flow/published",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_create_draft_process_not_found(self, client, db, wf_env):
        """Returns 404 when creating a draft for a non-existent process."""
        admin = wf_env["admin"]
        fake_pid = uuid.uuid4()

        resp = await client.post(
            f"/api/v1/bpm/processes/{fake_pid}/flow/drafts",
            json={"bpmn_xml": SAMPLE_BPMN},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_list_drafts_process_not_found(self, client, db, wf_env):
        """Returns 404 when listing drafts for a non-existent process."""
        admin = wf_env["admin"]
        fake_pid = uuid.uuid4()

        resp = await client.get(
            f"/api/v1/bpm/processes/{fake_pid}/flow/drafts",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /bpm/processes/{id}/flow/permissions
# ---------------------------------------------------------------------------


class TestGetFlowPermissions:
    async def test_admin_permissions(self, client, db, wf_env):
        """Admin user has full permissions on the process flow."""
        admin = wf_env["admin"]
        process = wf_env["process"]

        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/flow/permissions",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["can_view_drafts"] is True
        assert data["can_edit_draft"] is True
        assert data["can_approve"] is True

    async def test_viewer_permissions(self, client, db, wf_env):
        """Viewer has view-only permissions (can view drafts but not edit/approve)."""
        viewer = wf_env["viewer"]
        process = wf_env["process"]

        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/flow/permissions",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["can_view_drafts"] is True
        assert data["can_edit_draft"] is False
        assert data["can_approve"] is False

    async def test_permissions_process_not_found(self, client, db, wf_env):
        """Returns 404 for flow permissions on a non-existent process."""
        admin = wf_env["admin"]
        fake_pid = uuid.uuid4()

        resp = await client.get(
            f"/api/v1/bpm/processes/{fake_pid}/flow/permissions",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /bpm/processes/{id}/flow/archived — list archived versions
# ---------------------------------------------------------------------------


class TestListArchived:
    async def test_list_archived_empty(self, client, db, wf_env):
        """Returns empty list when no versions have been archived."""
        admin = wf_env["admin"]
        process = wf_env["process"]

        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/flow/archived",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_list_archived_after_two_publishes(self, client, db, wf_env):
        """After publishing two versions, the first appears in the archived list."""
        admin = wf_env["admin"]
        process = wf_env["process"]

        # Publish v1
        r1 = await _create_draft(client, process.id, admin, bpmn_xml="<bpmn>v1</bpmn>")
        vid1 = r1.json()["id"]
        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid1}/submit",
            headers=auth_headers(admin),
        )
        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid1}/approve",
            headers=auth_headers(admin),
        )

        # Publish v2 (archives v1)
        r2 = await _create_draft(client, process.id, admin, bpmn_xml="<bpmn>v2</bpmn>")
        vid2 = r2.json()["id"]
        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid2}/submit",
            headers=auth_headers(admin),
        )
        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid2}/approve",
            headers=auth_headers(admin),
        )

        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/flow/archived",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["id"] == vid1
        assert data[0]["status"] == "archived"
        # Archived list uses summaries — no bpmn_xml
        assert "bpmn_xml" not in data[0]
