"""Integration tests for the /adr endpoints.

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
    create_user,
)


@pytest.fixture
async def adr_env(db):
    """Prerequisite data shared by all ADR tests."""
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
# Helper to create an ADR via the API
# -------------------------------------------------------------------


async def _create_adr(client, user, title="Test ADR", **extra):
    body = {"title": title, **extra}
    resp = await client.post(
        "/api/v1/adr",
        json=body,
        headers=auth_headers(user),
    )
    return resp


async def _sign_adr(client, admin, signers, adr_id):
    """Request signatures and have all signers sign the ADR."""
    await client.post(
        f"/api/v1/adr/{adr_id}/request-signatures",
        json={"user_ids": [str(s.id) for s in signers]},
        headers=auth_headers(admin),
    )
    for signer in signers:
        await client.post(
            f"/api/v1/adr/{adr_id}/sign",
            headers=auth_headers(signer),
        )


# -------------------------------------------------------------------
# POST /adr  (create)
# -------------------------------------------------------------------


class TestCreateADR:
    async def test_admin_can_create(self, client, db, adr_env):
        admin = adr_env["admin"]
        resp = await _create_adr(
            client,
            admin,
            title="Cloud Migration ADR",
            context="We need to migrate",
            decision="Use AWS",
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["title"] == "Cloud Migration ADR"
        assert data["status"] == "draft"
        assert data["revision_number"] == 1
        assert data["reference_number"].startswith("ADR-")
        assert data["context"] == "We need to migrate"
        assert data["decision"] == "Use AWS"

    async def test_member_can_create(self, client, db, adr_env):
        """Member has adr.manage permission and can create ADRs."""
        member = adr_env["member"]
        resp = await _create_adr(client, member, title="Member ADR")
        assert resp.status_code == 201

    async def test_viewer_cannot_create(self, client, db, adr_env):
        viewer = adr_env["viewer"]
        resp = await _create_adr(client, viewer, title="Blocked")
        assert resp.status_code == 403


# -------------------------------------------------------------------
# GET /adr  (list)
# -------------------------------------------------------------------


class TestListADR:
    async def test_list_returns_adrs(self, client, db, adr_env):
        admin = adr_env["admin"]
        await _create_adr(client, admin, title="ADR Alpha")
        await _create_adr(client, admin, title="ADR Beta")

        resp = await client.get(
            "/api/v1/adr",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        titles = [a["title"] for a in resp.json()]
        assert "ADR Alpha" in titles
        assert "ADR Beta" in titles

    async def test_viewer_can_list(self, client, db, adr_env):
        viewer = adr_env["viewer"]
        resp = await client.get(
            "/api/v1/adr",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 200

    async def test_search_filter(self, client, db, adr_env):
        admin = adr_env["admin"]
        await _create_adr(client, admin, title="Unique Searchable ADR")
        await _create_adr(client, admin, title="Other Decision")

        resp = await client.get(
            "/api/v1/adr?search=Searchable",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        results = resp.json()
        assert len(results) == 1
        assert results[0]["title"] == "Unique Searchable ADR"


# -------------------------------------------------------------------
# GET /adr/{id}
# -------------------------------------------------------------------


class TestGetADR:
    async def test_get_existing(self, client, db, adr_env):
        admin = adr_env["admin"]
        create_resp = await _create_adr(client, admin, title="Lookup ADR")
        adr_id = create_resp.json()["id"]

        resp = await client.get(
            f"/api/v1/adr/{adr_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Lookup ADR"

    async def test_get_nonexistent_returns_404(self, client, db, adr_env):
        admin = adr_env["admin"]
        fake_id = str(uuid.uuid4())
        resp = await client.get(
            f"/api/v1/adr/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# -------------------------------------------------------------------
# PATCH /adr/{id}  (update)
# -------------------------------------------------------------------


class TestUpdateADR:
    async def test_update_title(self, client, db, adr_env):
        admin = adr_env["admin"]
        create_resp = await _create_adr(client, admin, title="Old Title")
        adr_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/adr/{adr_id}",
            json={"title": "New Title"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "New Title"

    async def test_cannot_edit_signed(self, client, db, adr_env):
        admin = adr_env["admin"]
        member = adr_env["member"]

        create_resp = await _create_adr(client, admin, title="Locked ADR")
        adr_id = create_resp.json()["id"]

        await _sign_adr(client, admin, [member], adr_id)

        resp = await client.patch(
            f"/api/v1/adr/{adr_id}",
            json={"title": "Should Fail"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 403

    async def test_cannot_set_status_to_signed(self, client, db, adr_env):
        admin = adr_env["admin"]
        create_resp = await _create_adr(client, admin, title="No Direct Sign")
        adr_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/adr/{adr_id}",
            json={"status": "signed"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_viewer_cannot_update(self, client, db, adr_env):
        admin = adr_env["admin"]
        viewer = adr_env["viewer"]
        create_resp = await _create_adr(client, admin, title="Protected")
        adr_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/adr/{adr_id}",
            json={"title": "Hacked"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_update_nonexistent_returns_404(self, client, db, adr_env):
        admin = adr_env["admin"]
        fake_id = str(uuid.uuid4())
        resp = await client.patch(
            f"/api/v1/adr/{fake_id}",
            json={"title": "Ghost"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# -------------------------------------------------------------------
# DELETE /adr/{id}
# -------------------------------------------------------------------


class TestDeleteADR:
    async def test_admin_can_delete_draft(self, client, db, adr_env):
        admin = adr_env["admin"]
        create_resp = await _create_adr(client, admin, title="Delete Me")
        adr_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/adr/{adr_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

        # Verify it's gone
        get_resp = await client.get(
            f"/api/v1/adr/{adr_id}",
            headers=auth_headers(admin),
        )
        assert get_resp.status_code == 404

    async def test_author_can_delete_own_draft(self, client, db, adr_env):
        """Member who created the ADR can delete their own draft."""
        member = adr_env["member"]
        create_resp = await _create_adr(client, member, title="My Draft")
        assert create_resp.status_code == 201
        adr_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/adr/{adr_id}",
            headers=auth_headers(member),
        )
        assert resp.status_code == 204

    async def test_non_author_member_cannot_delete(self, client, db, adr_env):
        """Member cannot delete a draft created by someone else."""
        admin = adr_env["admin"]
        member = adr_env["member"]
        create_resp = await _create_adr(client, admin, title="Not Yours")
        adr_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/adr/{adr_id}",
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_viewer_cannot_delete_draft(self, client, db, adr_env):
        """Viewer lacks adr.manage so cannot delete even own draft."""
        admin = adr_env["admin"]
        viewer = adr_env["viewer"]
        create_resp = await _create_adr(client, admin, title="Protected")
        adr_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/adr/{adr_id}",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_cannot_delete_signed_adr(self, client, db, adr_env):
        """Signed ADRs cannot be deleted, even by admin."""
        admin = adr_env["admin"]
        member = adr_env["member"]
        create_resp = await _create_adr(client, admin, title="Signed")
        adr_id = create_resp.json()["id"]
        await _sign_adr(client, admin, [member], adr_id)

        resp = await client.delete(
            f"/api/v1/adr/{adr_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_cannot_delete_in_review_adr(self, client, db, adr_env):
        """ADRs in review cannot be deleted."""
        admin = adr_env["admin"]
        member = adr_env["member"]
        create_resp = await _create_adr(client, admin, title="In Review")
        adr_id = create_resp.json()["id"]

        # Send for review (puts it in in_review status)
        await client.post(
            f"/api/v1/adr/{adr_id}/request-signatures",
            json={"user_ids": [str(member.id)]},
            headers=auth_headers(admin),
        )

        resp = await client.delete(
            f"/api/v1/adr/{adr_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_ref_number_recycled_when_last(self, client, db, adr_env):
        """Deleting the highest-numbered ADR recycles the reference."""
        admin = adr_env["admin"]
        r1 = await _create_adr(client, admin, title="First")
        r2 = await _create_adr(client, admin, title="Second")
        assert r1.json()["reference_number"] == "ADR-001"
        assert r2.json()["reference_number"] == "ADR-002"

        # Delete the last one
        await client.delete(
            f"/api/v1/adr/{r2.json()['id']}",
            headers=auth_headers(admin),
        )

        # Next ADR should reuse ADR-002
        r3 = await _create_adr(client, admin, title="Third")
        assert r3.json()["reference_number"] == "ADR-002"

    async def test_ref_number_not_recycled_when_not_last(self, client, db, adr_env):
        """Deleting a non-last ADR leaves a gap in numbering."""
        admin = adr_env["admin"]
        r1 = await _create_adr(client, admin, title="First")
        await _create_adr(client, admin, title="Second")

        # Delete the first one
        await client.delete(
            f"/api/v1/adr/{r1.json()['id']}",
            headers=auth_headers(admin),
        )

        # Next ADR should be ADR-003, not ADR-001
        r3 = await _create_adr(client, admin, title="Third")
        assert r3.json()["reference_number"] == "ADR-003"


# -------------------------------------------------------------------
# POST /adr/{id}/duplicate
# -------------------------------------------------------------------


class TestDuplicateADR:
    async def test_duplicate_creates_new_draft(self, client, db, adr_env):
        admin = adr_env["admin"]
        create_resp = await _create_adr(
            client,
            admin,
            title="Original ADR",
            context="Some context",
            decision="Some decision",
        )
        original = create_resp.json()
        adr_id = original["id"]

        resp = await client.post(
            f"/api/v1/adr/{adr_id}/duplicate",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["title"] == "Original ADR (copy)"
        assert data["status"] == "draft"
        assert data["reference_number"] != original["reference_number"]
        assert data["context"] == "Some context"
        assert data["decision"] == "Some decision"
        assert data["id"] != original["id"]

    async def test_viewer_cannot_duplicate(self, client, db, adr_env):
        admin = adr_env["admin"]
        viewer = adr_env["viewer"]
        create_resp = await _create_adr(client, admin, title="No Copy")
        adr_id = create_resp.json()["id"]

        resp = await client.post(
            f"/api/v1/adr/{adr_id}/duplicate",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# POST /adr/{id}/request-signatures + POST /adr/{id}/sign
# -------------------------------------------------------------------


class TestSignWorkflow:
    async def test_request_signatures(self, client, db, adr_env):
        admin = adr_env["admin"]
        member = adr_env["member"]

        create_resp = await _create_adr(client, admin, title="Sign Me")
        adr_id = create_resp.json()["id"]

        resp = await client.post(
            f"/api/v1/adr/{adr_id}/request-signatures",
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

    async def test_sign_adr(self, client, db, adr_env):
        admin = adr_env["admin"]
        member = adr_env["member"]

        create_resp = await _create_adr(client, admin, title="Full Sign Flow")
        adr_id = create_resp.json()["id"]

        await client.post(
            f"/api/v1/adr/{adr_id}/request-signatures",
            json={"user_ids": [str(member.id)]},
            headers=auth_headers(admin),
        )

        # Member signs
        resp = await client.post(
            f"/api/v1/adr/{adr_id}/sign",
            headers=auth_headers(member),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "signed"
        assert data["signed_at"] is not None

    async def test_sign_with_comment_stores_it_on_signatory(self, client, db, adr_env):
        # The optional comment body used to be posted to a body-less
        # endpoint and silently dropped (#802 audit).
        admin = adr_env["admin"]
        member = adr_env["member"]

        create_resp = await _create_adr(client, admin, title="Commented Sign")
        adr_id = create_resp.json()["id"]

        await client.post(
            f"/api/v1/adr/{adr_id}/request-signatures",
            json={"user_ids": [str(member.id)]},
            headers=auth_headers(admin),
        )

        resp = await client.post(
            f"/api/v1/adr/{adr_id}/sign",
            json={"comment": "Approved with reservations about cost."},
            headers=auth_headers(member),
        )
        assert resp.status_code == 200
        sig = resp.json()["signatories"][0]
        assert sig["status"] == "signed"
        assert sig["comment"] == "Approved with reservations about cost."

    async def test_sign_rejects_unknown_body_field(self, client, db, adr_env):
        admin = adr_env["admin"]
        member = adr_env["member"]

        create_resp = await _create_adr(client, admin, title="Strict Sign Body")
        adr_id = create_resp.json()["id"]

        await client.post(
            f"/api/v1/adr/{adr_id}/request-signatures",
            json={"user_ids": [str(member.id)]},
            headers=auth_headers(admin),
        )

        resp = await client.post(
            f"/api/v1/adr/{adr_id}/sign",
            json={"note": "wrong field name"},
            headers=auth_headers(member),
        )
        assert resp.status_code == 422

    async def test_non_signatory_cannot_sign(self, client, db, adr_env):
        admin = adr_env["admin"]
        member = adr_env["member"]

        create_resp = await _create_adr(client, admin, title="Restricted Sign")
        adr_id = create_resp.json()["id"]

        # Request signature only from member
        await client.post(
            f"/api/v1/adr/{adr_id}/request-signatures",
            json={"user_ids": [str(member.id)]},
            headers=auth_headers(admin),
        )

        # Admin (not a signatory) tries to sign
        resp = await client.post(
            f"/api/v1/adr/{adr_id}/sign",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 403

    async def test_cannot_sign_already_signed(self, client, db, adr_env):
        admin = adr_env["admin"]
        member = adr_env["member"]

        create_resp = await _create_adr(client, admin, title="Already Signed")
        adr_id = create_resp.json()["id"]

        await _sign_adr(client, admin, [member], adr_id)

        # Try to sign again
        resp = await client.post(
            f"/api/v1/adr/{adr_id}/sign",
            headers=auth_headers(member),
        )
        assert resp.status_code == 400

    async def test_cannot_request_signatures_on_signed(self, client, db, adr_env):
        admin = adr_env["admin"]
        member = adr_env["member"]

        create_resp = await _create_adr(client, admin, title="Signed ADR")
        adr_id = create_resp.json()["id"]

        await _sign_adr(client, admin, [member], adr_id)

        resp = await client.post(
            f"/api/v1/adr/{adr_id}/request-signatures",
            json={"user_ids": [str(member.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400


# -------------------------------------------------------------------
# POST /adr/{id}/revise + GET /adr/{id}/revisions
# -------------------------------------------------------------------


class TestReviseADR:
    async def test_revise_signed_creates_new_draft(self, client, db, adr_env):
        admin = adr_env["admin"]
        member = adr_env["member"]

        create_resp = await _create_adr(
            client,
            admin,
            title="Revision Test",
            context="v1 context",
        )
        adr_id = create_resp.json()["id"]

        await _sign_adr(client, admin, [member], adr_id)

        # Revise
        resp = await client.post(
            f"/api/v1/adr/{adr_id}/revise",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "draft"
        assert data["revision_number"] == 2
        assert data["parent_id"] == adr_id
        assert data["context"] == "v1 context"

    async def test_cannot_revise_non_signed(self, client, db, adr_env):
        admin = adr_env["admin"]
        create_resp = await _create_adr(client, admin, title="Not Signed Yet")
        adr_id = create_resp.json()["id"]

        resp = await client.post(
            f"/api/v1/adr/{adr_id}/revise",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_revisions_list(self, client, db, adr_env):
        admin = adr_env["admin"]
        member = adr_env["member"]

        create_resp = await _create_adr(client, admin, title="Rev Chain")
        adr_id = create_resp.json()["id"]

        await _sign_adr(client, admin, [member], adr_id)

        revise_resp = await client.post(
            f"/api/v1/adr/{adr_id}/revise",
            headers=auth_headers(admin),
        )
        new_id = revise_resp.json()["id"]

        # List revisions from the original
        resp = await client.get(
            f"/api/v1/adr/{adr_id}/revisions",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        revisions = resp.json()
        assert len(revisions) == 2
        assert revisions[0]["id"] == adr_id
        assert revisions[1]["id"] == new_id


# -------------------------------------------------------------------
# linked_card_ids in the create/update body (#800)
# -------------------------------------------------------------------


class TestLinkedCardIdsInBody:
    @pytest.fixture
    async def card_env(self, db, adr_env):
        await create_card_type(db, key="Application", label="Application")
        card_a = await create_card(db, card_type="Application", name="App A")
        card_b = await create_card(db, card_type="Application", name="App B")
        return {**adr_env, "card_a": card_a, "card_b": card_b}

    async def test_create_with_linked_card_ids(self, client, db, card_env):
        admin = card_env["admin"]
        resp = await _create_adr(
            client,
            admin,
            title="Linked on create",
            context="ctx",
            linked_card_ids=[str(card_env["card_a"].id), str(card_env["card_b"].id)],
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["context"] == "ctx"
        linked_ids = {c["id"] for c in data["linked_cards"]}
        assert linked_ids == {str(card_env["card_a"].id), str(card_env["card_b"].id)}

    async def test_create_with_unknown_card_returns_404(self, client, db, card_env):
        admin = card_env["admin"]
        resp = await _create_adr(
            client,
            admin,
            title="Bad link",
            linked_card_ids=[str(uuid.uuid4())],
        )
        assert resp.status_code == 404

    async def test_create_with_invalid_uuid_returns_400(self, client, db, card_env):
        admin = card_env["admin"]
        resp = await _create_adr(
            client,
            admin,
            title="Bad uuid",
            linked_card_ids=["not-a-uuid"],
        )
        assert resp.status_code == 400

    async def test_update_replaces_link_set(self, client, db, card_env):
        admin = card_env["admin"]
        create_resp = await _create_adr(
            client,
            admin,
            title="Replace links",
            linked_card_ids=[str(card_env["card_a"].id)],
        )
        adr_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/adr/{adr_id}",
            json={"linked_card_ids": [str(card_env["card_b"].id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        linked_ids = {c["id"] for c in resp.json()["linked_cards"]}
        assert linked_ids == {str(card_env["card_b"].id)}

    async def test_update_empty_list_clears_links(self, client, db, card_env):
        admin = card_env["admin"]
        create_resp = await _create_adr(
            client,
            admin,
            title="Clear links",
            linked_card_ids=[str(card_env["card_a"].id)],
        )
        adr_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/adr/{adr_id}",
            json={"linked_card_ids": []},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["linked_cards"] == []

    async def test_update_without_links_leaves_them_unchanged(self, client, db, card_env):
        admin = card_env["admin"]
        create_resp = await _create_adr(
            client,
            admin,
            title="Keep links",
            linked_card_ids=[str(card_env["card_a"].id)],
        )
        adr_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/adr/{adr_id}",
            json={"title": "Keep links (renamed)"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        linked_ids = {c["id"] for c in resp.json()["linked_cards"]}
        assert linked_ids == {str(card_env["card_a"].id)}


# -------------------------------------------------------------------
# Unknown body fields are rejected, not silently dropped (#800)
# -------------------------------------------------------------------


class TestUnknownFieldsRejected:
    async def test_create_with_unknown_field_returns_422(self, client, db, adr_env):
        admin = adr_env["admin"]
        resp = await _create_adr(
            client,
            admin,
            title="Extra fields",
            sections=[{"heading": "Context", "body": "x"}],
        )
        assert resp.status_code == 422

    async def test_update_with_unknown_field_returns_422(self, client, db, adr_env):
        admin = adr_env["admin"]
        create_resp = await _create_adr(client, admin, title="Extra on update")
        adr_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/adr/{adr_id}",
            json={"sections": [{"heading": "Context", "body": "x"}]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 422


# -------------------------------------------------------------------
# POST /adr/{id}/cards  +  DELETE /adr/{id}/cards/{card_id}
# GET /adr/by-card/{card_id}
# -------------------------------------------------------------------


class TestCardLinking:
    @pytest.fixture
    async def card_env(self, db, adr_env):
        """Create a card type and card for linking tests."""
        card_type = await create_card_type(db, key="Application", label="Application")
        card = await create_card(db, card_type="Application", name="Test App")
        return {**adr_env, "card_type": card_type, "card": card}

    async def test_link_card(self, client, db, card_env):
        admin = card_env["admin"]
        card = card_env["card"]

        create_resp = await _create_adr(client, admin, title="Linked ADR")
        adr_id = create_resp.json()["id"]

        resp = await client.post(
            f"/api/v1/adr/{adr_id}/cards",
            json={"card_id": str(card.id)},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert len(data["linked_cards"]) == 1
        assert data["linked_cards"][0]["id"] == str(card.id)
        assert data["linked_cards"][0]["name"] == "Test App"

    async def test_duplicate_link_returns_409(self, client, db, card_env):
        admin = card_env["admin"]
        card = card_env["card"]

        create_resp = await _create_adr(client, admin, title="Dup Link ADR")
        adr_id = create_resp.json()["id"]

        # Link the first time
        await client.post(
            f"/api/v1/adr/{adr_id}/cards",
            json={"card_id": str(card.id)},
            headers=auth_headers(admin),
        )

        # Link again — should fail
        resp = await client.post(
            f"/api/v1/adr/{adr_id}/cards",
            json={"card_id": str(card.id)},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 409

    async def test_unlink_card(self, client, db, card_env):
        admin = card_env["admin"]
        card = card_env["card"]

        create_resp = await _create_adr(client, admin, title="Unlink ADR")
        adr_id = create_resp.json()["id"]

        await client.post(
            f"/api/v1/adr/{adr_id}/cards",
            json={"card_id": str(card.id)},
            headers=auth_headers(admin),
        )

        resp = await client.delete(
            f"/api/v1/adr/{adr_id}/cards/{card.id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

        # Verify the card is no longer linked
        get_resp = await client.get(
            f"/api/v1/adr/{adr_id}",
            headers=auth_headers(admin),
        )
        assert len(get_resp.json()["linked_cards"]) == 0

    async def test_list_adrs_for_card(self, client, db, card_env):
        admin = card_env["admin"]
        card = card_env["card"]

        create_resp = await _create_adr(client, admin, title="Card ADR 1")
        adr1_id = create_resp.json()["id"]
        create_resp2 = await _create_adr(client, admin, title="Card ADR 2")
        adr2_id = create_resp2.json()["id"]

        # Link both ADRs to the card
        await client.post(
            f"/api/v1/adr/{adr1_id}/cards",
            json={"card_id": str(card.id)},
            headers=auth_headers(admin),
        )
        await client.post(
            f"/api/v1/adr/{adr2_id}/cards",
            json={"card_id": str(card.id)},
            headers=auth_headers(admin),
        )

        resp = await client.get(
            f"/api/v1/adr/by-card/{card.id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        titles = [a["title"] for a in resp.json()]
        assert "Card ADR 1" in titles
        assert "Card ADR 2" in titles


# -------------------------------------------------------------------
# Extension attributes bag (ext.* namespaced JSONB)
# -------------------------------------------------------------------


class TestAdrAttributes:
    """The attributes bag that ADR extensions write to."""

    async def test_default_is_empty_object(self, client, db, adr_env):
        admin = adr_env["admin"]
        resp = await _create_adr(client, admin, title="Attr ADR")
        assert resp.status_code == 201
        assert resp.json()["attributes"] == {}

    async def test_patch_stores_and_returns_namespaced_key(self, client, db, adr_env):
        admin = adr_env["admin"]
        adr_id = (await _create_adr(client, admin, title="Attr ADR")).json()["id"]
        payload = {"ext.savings": {"lines": [{"category": "hard", "amount": 50000}]}}
        resp = await client.patch(
            f"/api/v1/adr/{adr_id}",
            json={"attributes": payload},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["attributes"] == payload
        # Persisted — visible on a fresh GET and in the list summary.
        got = await client.get(f"/api/v1/adr/{adr_id}", headers=auth_headers(admin))
        assert got.json()["attributes"] == payload
        listed = await client.get("/api/v1/adr", headers=auth_headers(admin))
        row = next(a for a in listed.json() if a["id"] == adr_id)
        assert row["attributes"] == payload

    async def test_merge_preserves_other_extension_keys(self, client, db, adr_env):
        admin = adr_env["admin"]
        adr_id = (await _create_adr(client, admin, title="Attr ADR")).json()["id"]
        await client.patch(
            f"/api/v1/adr/{adr_id}",
            json={"attributes": {"ext.savings": {"amount": 1}}},
            headers=auth_headers(admin),
        )
        resp = await client.patch(
            f"/api/v1/adr/{adr_id}",
            json={"attributes": {"ext.other": {"x": 2}}},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        attrs = resp.json()["attributes"]
        assert attrs == {"ext.savings": {"amount": 1}, "ext.other": {"x": 2}}

    async def test_null_value_removes_key(self, client, db, adr_env):
        admin = adr_env["admin"]
        adr_id = (await _create_adr(client, admin, title="Attr ADR")).json()["id"]
        await client.patch(
            f"/api/v1/adr/{adr_id}",
            json={"attributes": {"ext.savings": {"amount": 1}}},
            headers=auth_headers(admin),
        )
        resp = await client.patch(
            f"/api/v1/adr/{adr_id}",
            json={"attributes": {"ext.savings": None}},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["attributes"] == {}

    async def test_non_namespaced_key_rejected(self, client, db, adr_env):
        admin = adr_env["admin"]
        adr_id = (await _create_adr(client, admin, title="Attr ADR")).json()["id"]
        resp = await client.patch(
            f"/api/v1/adr/{adr_id}",
            json={"attributes": {"savings": {"amount": 1}}},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_frozen_once_signed(self, client, db, adr_env):
        admin = adr_env["admin"]
        adr_id = (await _create_adr(client, admin, title="Attr ADR")).json()["id"]
        await client.patch(
            f"/api/v1/adr/{adr_id}",
            json={"attributes": {"ext.savings": {"amount": 1}}},
            headers=auth_headers(admin),
        )
        await _sign_adr(client, admin, [admin], adr_id)
        resp = await client.patch(
            f"/api/v1/adr/{adr_id}",
            json={"attributes": {"ext.savings": {"amount": 999}}},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 403

    async def test_carried_into_revision(self, client, db, adr_env):
        admin = adr_env["admin"]
        adr_id = (await _create_adr(client, admin, title="Attr ADR")).json()["id"]
        payload = {"ext.savings": {"amount": 42}}
        await client.patch(
            f"/api/v1/adr/{adr_id}",
            json={"attributes": payload},
            headers=auth_headers(admin),
        )
        await _sign_adr(client, admin, [admin], adr_id)
        resp = await client.post(f"/api/v1/adr/{adr_id}/revise", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert resp.json()["attributes"] == payload

    async def test_carried_into_duplicate(self, client, db, adr_env):
        admin = adr_env["admin"]
        adr_id = (await _create_adr(client, admin, title="Attr ADR")).json()["id"]
        payload = {"ext.savings": {"amount": 7}}
        await client.patch(
            f"/api/v1/adr/{adr_id}",
            json={"attributes": payload},
            headers=auth_headers(admin),
        )
        resp = await client.post(f"/api/v1/adr/{adr_id}/duplicate", headers=auth_headers(admin))
        assert resp.status_code == 201
        assert resp.json()["attributes"] == payload
