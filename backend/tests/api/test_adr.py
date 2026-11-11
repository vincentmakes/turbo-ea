"""Integration tests for the /adr endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_file import (
    ArchitectureDecisionFile,
    ArchitectureDecisionFileContent,
)
from app.models.event import Event
from app.models.todo import Todo
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
        assert original["reference_number"] == "ADR-001"
        assert (data["reference_number"], data["revision_number"], data["parent_id"]) == (
            "ADR-002",
            1,
            None,
        )
        assert data["context"] == "Some context"
        assert data["decision"] == "Some decision"
        assert data["id"] != original["id"]
        events = (
            (await db.execute(select(Event).where(Event.event_type == "adr.created")))
            .scalars()
            .all()
        )
        dup_events = [e for e in events if e.data["adr_id"] == data["id"]]
        assert len(dup_events) == 1
        assert (dup_events[0].data["reference_number"], dup_events[0].user_id) == (
            "ADR-002",
            admin.id,
        )
        assert "revision_of" not in dup_events[0].data

    async def test_duplicate_of_a_signed_revision_drops_dates_and_hard_links(
        self, client, db, adr_env
    ):
        admin = adr_env["admin"]
        target = (await _create_adr(client, admin, title="Target")).json()
        await _sign_adr(client, admin, [admin], target["id"])
        source = (
            await _create_adr(
                client,
                admin,
                title="Source",
                decided_on="2026-01-02",
                links=[{"decision_id": target["id"], "kind": "amends"}],
            )
        ).json()
        await _sign_adr(client, admin, [admin], source["id"])

        resp = await client.post(
            f"/api/v1/adr/{source['id']}/duplicate", headers=auth_headers(admin)
        )

        dup = resp.json()
        assert (dup["decided_on"], dup["effective_from"], dup["signatories"]) == (None, None, [])
        assert dup["links"]["outgoing"] == []

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

    async def test_sign_with_comment_keeps_it_in_the_discussion(self, client, db, adr_env):
        # The optional comment body used to be posted to a body-less
        # endpoint and silently dropped (#802 audit). It then lived on the
        # signatory entry, where a recall wiped it; it is now a ``sign_note``
        # comment and the note of the signature timeline row.
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
        assert "comment" not in sig
        threads = (
            await client.get(f"/api/v1/adr/{adr_id}/comments", headers=auth_headers(admin))
        ).json()["threads"]
        assert [(t["kind"], t["body"], t["author_name"]) for t in threads] == [
            ("sign_note", "<p>Approved with reservations about cost.</p>", member.display_name)
        ]
        history = (
            await client.get(f"/api/v1/adr/{adr_id}/history", headers=auth_headers(admin))
        ).json()["entries"]
        assert [(e["kind"], e["note"]) for e in history if e["kind"] == "signature"] == [
            ("signature", "Approved with reservations about cost.")
        ]

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
        assert resp.json()["detail"] == "Decision is already signed"


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
        reference = create_resp.json()["reference_number"]

        await _sign_adr(client, admin, [member], adr_id)

        # Revise (no body at all keeps working)
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
        # A revision keeps the decision's reference.
        assert data["reference_number"] == reference
        assert data["change_summary"] is None
        assert data["signatories"] == []

    async def test_cannot_revise_non_signed(self, client, db, adr_env):
        admin = adr_env["admin"]
        create_resp = await _create_adr(client, admin, title="Not Signed Yet")
        adr_id = create_resp.json()["id"]

        resp = await client.post(
            f"/api/v1/adr/{adr_id}/revise",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_viewer_cannot_revise(self, client, db, adr_env):
        admin = adr_env["admin"]
        adr_id = (await _create_adr(client, admin, title="Viewer")).json()["id"]
        await _sign_adr(client, admin, [admin], adr_id)
        resp = await client.post(
            f"/api/v1/adr/{adr_id}/revise", headers=auth_headers(adr_env["viewer"])
        )
        assert resp.status_code == 403

    async def test_unknown_body_field_is_422(self, client, db, adr_env):
        admin = adr_env["admin"]
        adr_id = (await _create_adr(client, admin, title="Strict")).json()["id"]
        await _sign_adr(client, admin, [admin], adr_id)
        resp = await client.post(
            f"/api/v1/adr/{adr_id}/revise",
            json={"summary": "wrong key"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 422

    async def test_number_is_the_chain_maximum_plus_one(self, client, db, adr_env):
        """A chain with a gap (an old rejection bump) continues after its highest."""
        admin = adr_env["admin"]
        first = ArchitectureDecision(reference_number="ADR-050", title="Gap", status="signed")
        db.add(first)
        await db.flush()
        third = ArchitectureDecision(
            reference_number="ADR-050",
            title="Gap",
            status="signed",
            revision_number=3,
            parent_id=first.id,
        )
        db.add(third)
        await db.flush()

        resp = await client.post(
            f"/api/v1/adr/{third.id}/revise",
            json={"change_summary": "Tighten §2"},
            headers=auth_headers(admin),
        )

        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert (data["reference_number"], data["revision_number"], data["parent_id"]) == (
            "ADR-050",
            4,
            str(third.id),
        )
        assert data["change_summary"] == "Tighten §2"
        assert [(r["reference_number"], r["revision_number"]) for r in data["revisions"]] == [
            ("ADR-050", 1),
            ("ADR-050", 3),
            ("ADR-050", 4),
        ]

    async def test_a_second_revise_names_the_open_revision(self, client, db, adr_env):
        admin = adr_env["admin"]
        adr_id = (await _create_adr(client, admin, title="Twice")).json()["id"]
        await _sign_adr(client, admin, [admin], adr_id)
        first = await client.post(f"/api/v1/adr/{adr_id}/revise", headers=auth_headers(admin))
        assert first.status_code == 200

        again = await client.post(f"/api/v1/adr/{adr_id}/revise", headers=auth_headers(admin))

        assert again.status_code == 409
        assert again.json()["detail"] == {
            "error": "open_revision_exists",
            "revision_id": first.json()["id"],
        }
        count = await db.execute(
            select(ArchitectureDecision).where(ArchitectureDecision.parent_id == uuid.UUID(adr_id))
        )
        assert len(count.scalars().all()) == 1

    async def test_a_superseded_revision_is_not_the_latest(self, client, db, adr_env):
        admin = adr_env["admin"]
        adr_id = (await _create_adr(client, admin, title="Old")).json()["id"]
        await _sign_adr(client, admin, [admin], adr_id)
        rev2 = await client.post(f"/api/v1/adr/{adr_id}/revise", headers=auth_headers(admin))
        await _sign_adr(client, admin, [admin], rev2.json()["id"])

        resp = await client.post(f"/api/v1/adr/{adr_id}/revise", headers=auth_headers(admin))

        assert resp.status_code == 409
        assert resp.json()["detail"] == {"error": "not_revisable", "reason": "not_latest"}
        # The latest revision itself stays revisable.
        resp = await client.post(
            f"/api/v1/adr/{rev2.json()['id']}/revise", headers=auth_headers(admin)
        )
        assert resp.status_code == 200
        assert resp.json()["revision_number"] == 3

    async def test_a_revoked_decision_is_not_revisable(self, client, db, adr_env):
        admin = adr_env["admin"]
        target = (await _create_adr(client, admin, title="Target")).json()
        await _sign_adr(client, admin, [admin], target["id"])
        revoker = (
            await _create_adr(
                client,
                admin,
                title="Revoker",
                links=[{"decision_id": target["id"], "kind": "revokes"}],
            )
        ).json()
        await _sign_adr(client, admin, [admin], revoker["id"])

        resp = await client.post(f"/api/v1/adr/{target['id']}/revise", headers=auth_headers(admin))

        assert resp.status_code == 409
        assert resp.json()["detail"] == {
            "error": "not_revisable",
            "by": {
                "id": revoker["id"],
                "reference_number": revoker["reference_number"],
                "revision_number": 1,
                "title": "Revoker",
            },
        }

    async def test_an_expired_decision_stays_revisable(self, client, db, adr_env):
        admin = adr_env["admin"]
        row = ArchitectureDecision(
            reference_number="ADR-060",
            title="Waiver",
            status="signed",
            valid_until=date(2020, 1, 31),
            effective_from=date(2020, 1, 1),
        )
        db.add(row)
        await db.flush()
        resp = await client.post(f"/api/v1/adr/{row.id}/revise", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert resp.json()["valid_until"] == "2020-01-31"

    async def test_carries_content_but_not_dates_signatures_or_hard_links(
        self, client, db, adr_env
    ):
        admin, member = adr_env["admin"], adr_env["member"]
        related = (await _create_adr(client, admin, title="Related")).json()
        await _sign_adr(client, admin, [admin], related["id"])
        replaced = (await _create_adr(client, admin, title="Replaced")).json()
        await _sign_adr(client, admin, [admin], replaced["id"])
        source = (
            await _create_adr(
                client,
                admin,
                title="Source",
                decided_on="2026-01-02",
                valid_until="2099-12-31",
                change_summary="Original wording",
                related_decisions=[related["id"]],
                links=[{"decision_id": replaced["id"], "kind": "replaces", "note": "all"}],
                decision_makers=[{"name": "Board"}],
                participants=[{"user_id": str(member.id)}],
            )
        ).json()
        await _sign_adr(client, admin, [member], source["id"])
        blob = b"%PDF-1.7 minutes"
        content = ArchitectureDecisionFileContent(size=len(blob), data=blob)
        db.add(content)
        await db.flush()
        db.add(
            ArchitectureDecisionFile(
                architecture_decision_id=uuid.UUID(source["id"]),
                content_id=content.id,
                name="minutes.pdf",
                mime_type="application/pdf",
                size=len(blob),
                created_by=member.id,
            )
        )
        await db.flush()

        resp = await client.post(f"/api/v1/adr/{source['id']}/revise", headers=auth_headers(admin))

        assert resp.status_code == 200, resp.text
        rev = resp.json()
        assert [(e["kind"], e["decision"]["id"]) for e in rev["links"]["outgoing"]] == [
            ("relates", related["id"])
        ]
        assert rev["decision_makers"] == [{"user_id": None, "display_name": "Board"}]
        assert rev["participants"] == [
            {"user_id": str(member.id), "display_name": member.display_name}
        ]
        assert rev["valid_until"] == "2099-12-31"
        assert (rev["decided_on"], rev["effective_from"], rev["recorded_at"]) == (
            None,
            None,
            None,
        )
        assert rev["change_summary"] is None
        assert rev["signatories"] == []
        assert rev["signed_at"] is None
        files = (
            (
                await db.execute(
                    select(ArchitectureDecisionFile).where(
                        ArchitectureDecisionFile.architecture_decision_id == uuid.UUID(rev["id"])
                    )
                )
            )
            .scalars()
            .all()
        )
        assert [(f.content_id, f.name, f.mime_type, f.size, f.created_by) for f in files] == [
            (content.id, "minutes.pdf", "application/pdf", len(blob), member.id)
        ]

    async def test_consolidates_names_the_amending_decision(self, client, db, adr_env):
        admin = adr_env["admin"]
        target = (await _create_adr(client, admin, title="Amended")).json()
        await _sign_adr(client, admin, [admin], target["id"])
        amender = (
            await _create_adr(
                client,
                admin,
                title="Amender",
                links=[{"decision_id": target["id"], "kind": "amends"}],
            )
        ).json()
        await _sign_adr(client, admin, [admin], amender["id"])
        assert (
            await client.get(f"/api/v1/adr/{target['id']}", headers=auth_headers(admin))
        ).json()["standing"] == "amended"

        resp = await client.post(
            f"/api/v1/adr/{target['id']}/revise",
            json={"consolidates": [amender["reference_number"]], "change_summary": "Fold in"},
            headers=auth_headers(admin),
        )

        assert resp.status_code == 200, resp.text
        rev = resp.json()
        assert [(e["kind"], e["decision"]["id"]) for e in rev["links"]["outgoing"]] == [
            ("consolidates", amender["id"])
        ]
        assert rev["change_summary"] == "Fold in"

    async def test_consolidating_a_decision_that_does_not_amend_is_400(self, client, db, adr_env):
        admin = adr_env["admin"]
        target = (await _create_adr(client, admin, title="Plain")).json()
        await _sign_adr(client, admin, [admin], target["id"])
        other = (await _create_adr(client, admin, title="Other")).json()
        await _sign_adr(client, admin, [admin], other["id"])

        resp = await client.post(
            f"/api/v1/adr/{target['id']}/revise",
            json={"consolidates": [other["id"]]},
            headers=auth_headers(admin),
        )

        assert resp.status_code == 400
        detail = resp.json()["detail"]
        assert (detail["error"], detail["problems"], detail["target_id"]) == (
            "consolidates_not_amender",
            ["consolidates_not_amender"],
            other["id"],
        )
        # Nothing was created.
        children = await db.execute(
            select(ArchitectureDecision).where(
                ArchitectureDecision.parent_id == uuid.UUID(target["id"])
            )
        )
        assert children.scalars().all() == []

    async def test_consolidating_an_unknown_reference_is_404(self, client, db, adr_env):
        admin = adr_env["admin"]
        target = (await _create_adr(client, admin, title="Plain")).json()
        await _sign_adr(client, admin, [admin], target["id"])
        resp = await client.post(
            f"/api/v1/adr/{target['id']}/revise",
            json={"consolidates": ["ADR-404"]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"]["error"] == "decision_not_found"

    async def test_publishes_adr_created_with_revision_of(self, client, db, adr_env):
        admin = adr_env["admin"]
        adr_id = (await _create_adr(client, admin, title="Evented")).json()["id"]
        await _sign_adr(client, admin, [admin], adr_id)

        rev = (
            await client.post(f"/api/v1/adr/{adr_id}/revise", headers=auth_headers(admin))
        ).json()

        events = (
            (await db.execute(select(Event).where(Event.event_type == "adr.created")))
            .scalars()
            .all()
        )
        created = [e for e in events if e.data["adr_id"] == rev["id"]]
        assert len(created) == 1
        assert created[0].user_id == admin.id
        assert {
            k: created[0].data[k]
            for k in ("reference_number", "revision_number", "status", "revision_of")
        } == {
            "reference_number": rev["reference_number"],
            "revision_number": 2,
            "status": "draft",
            "revision_of": adr_id,
        }

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
        assert [(r["id"], r["revision_number"], r["standing"]) for r in revisions] == [
            (adr_id, 1, "in_force"),
            (new_id, 2, None),
        ]
        assert revisions[0]["open_revision"]["id"] == new_id

    async def test_revisions_of_a_legacy_fork_list_every_branch_once(self, client, db, adr_env):
        """Two children of one parent (a legacy double revise) used to break the
        listing; the chain is read from the register, in chain order."""
        admin = adr_env["admin"]
        root = ArchitectureDecision(reference_number="ADR-070", title="Fork", status="signed")
        db.add(root)
        await db.flush()
        left = ArchitectureDecision(
            reference_number="ADR-071",
            title="Fork",
            status="signed",
            revision_number=2,
            parent_id=root.id,
        )
        right = ArchitectureDecision(
            reference_number="ADR-072",
            title="Fork",
            status="draft",
            revision_number=3,
            parent_id=root.id,
        )
        db.add_all([left, right])
        await db.flush()

        for start in (root, left, right):
            resp = await client.get(
                f"/api/v1/adr/{start.id}/revisions", headers=auth_headers(admin)
            )
            assert resp.status_code == 200
            assert [(r["id"], r["revision_number"]) for r in resp.json()] == [
                (str(root.id), 1),
                (str(left.id), 2),
                (str(right.id), 3),
            ]

    async def test_revisions_of_an_unknown_decision_is_404(self, client, db, adr_env):
        resp = await client.get(
            f"/api/v1/adr/{uuid.uuid4()}/revisions", headers=auth_headers(adr_env["admin"])
        )
        assert resp.status_code == 404


# -------------------------------------------------------------------
# POST /adr/{id}/reject
# -------------------------------------------------------------------


class TestRejectADR:
    async def test_reject_resets_to_draft_without_a_revision_bump(self, client, db, adr_env):
        admin, member = adr_env["admin"], adr_env["member"]
        adr_id = (await _create_adr(client, admin, title="Rejectable")).json()["id"]
        await client.post(
            f"/api/v1/adr/{adr_id}/request-signatures",
            json={"user_ids": [str(member.id)]},
            headers=auth_headers(admin),
        )

        resp = await client.post(
            f"/api/v1/adr/{adr_id}/reject",
            json={"comment": "Needs numbers"},
            headers=auth_headers(member),
        )

        assert resp.status_code == 200
        data = resp.json()
        assert (data["status"], data["revision_number"], data["signatories"]) == (
            "draft",
            1,
            [],
        )
        event = (
            await db.execute(select(Event).where(Event.event_type == "adr.rejected"))
        ).scalar_one()
        assert event.data["revision_number"] == 1

    async def test_a_rejected_revision_keeps_its_number(self, client, db, adr_env):
        admin, member = adr_env["admin"], adr_env["member"]
        adr_id = (await _create_adr(client, admin, title="Chain")).json()["id"]
        await _sign_adr(client, admin, [admin], adr_id)
        rev = (
            await client.post(f"/api/v1/adr/{adr_id}/revise", headers=auth_headers(admin))
        ).json()
        await client.post(
            f"/api/v1/adr/{rev['id']}/request-signatures",
            json={"user_ids": [str(member.id)]},
            headers=auth_headers(admin),
        )

        resp = await client.post(
            f"/api/v1/adr/{rev['id']}/reject",
            json={"comment": "No"},
            headers=auth_headers(member),
        )

        assert resp.status_code == 200
        assert (resp.json()["status"], resp.json()["revision_number"]) == ("draft", 2)

    async def test_a_non_signatory_cannot_reject(self, client, db, adr_env):
        admin, member = adr_env["admin"], adr_env["member"]
        adr_id = (await _create_adr(client, admin, title="Mine")).json()["id"]
        await client.post(
            f"/api/v1/adr/{adr_id}/request-signatures",
            json={"user_ids": [str(member.id)]},
            headers=auth_headers(admin),
        )
        resp = await client.post(
            f"/api/v1/adr/{adr_id}/reject", json={"comment": "x"}, headers=auth_headers(admin)
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# The review lock (PATCH and request-signatures)
# -------------------------------------------------------------------


class TestReviewLock:
    @pytest.fixture
    async def in_review(self, client, db, adr_env):
        admin, member = adr_env["admin"], adr_env["member"]
        await create_card_type(db, key="Application", label="Application")
        card = await create_card(db, card_type="Application", name="Billing")
        adr = (await _create_adr(client, admin, title="Under review")).json()
        resp = await client.post(
            f"/api/v1/adr/{adr['id']}/request-signatures",
            json={"user_ids": [str(member.id)]},
            headers=auth_headers(admin),
        )
        assert resp.json()["status"] == "in_review"
        return {**adr_env, "adr": adr, "card": card}

    async def test_linked_cards_stay_editable_in_review(self, client, db, in_review):
        admin, adr, card = in_review["admin"], in_review["adr"], in_review["card"]
        resp = await client.patch(
            f"/api/v1/adr/{adr['id']}",
            json={"linked_card_ids": [str(card.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert [c["id"] for c in resp.json()["linked_cards"]] == [str(card.id)]
        assert resp.json()["status"] == "in_review"

    @pytest.mark.parametrize(
        "body",
        [
            {"title": "Changed"},
            {"context": "<p>new</p>"},
            {"decided_on": "2026-01-01"},
            {"valid_until": None},
            {"links": []},
            {"related_decisions": []},
            {"decision_makers": [{"name": "Board"}]},
            {"participants": []},
            {"attributes": {"ext.x": 1}},
            {"change_summary": "x"},
            {"status": "archived"},
            {"linked_card_ids": [], "title": "Sneaky"},
        ],
    )
    async def test_content_is_locked_in_review(self, client, db, in_review, body):
        admin, adr = in_review["admin"], in_review["adr"]
        resp = await client.patch(
            f"/api/v1/adr/{adr['id']}", json=body, headers=auth_headers(admin)
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == (
            "Cannot edit a decision in review. Recall the signatures to edit it."
        )
        row = await db.get(ArchitectureDecision, uuid.UUID(adr["id"]))
        await db.refresh(row)
        assert (row.title, row.status) == ("Under review", "in_review")

    async def test_a_workflow_status_keeps_its_400_in_review(self, client, db, in_review):
        admin, adr = in_review["admin"], in_review["adr"]
        resp = await client.patch(
            f"/api/v1/adr/{adr['id']}",
            json={"status": "draft", "title": "x"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "Use the recall-signatures endpoint to reset to draft"

    async def test_recall_unlocks_editing(self, client, db, in_review):
        admin, adr = in_review["admin"], in_review["adr"]
        resp = await client.post(
            f"/api/v1/adr/{adr['id']}/recall-signatures", headers=auth_headers(admin)
        )
        assert resp.json()["status"] == "draft"
        resp = await client.patch(
            f"/api/v1/adr/{adr['id']}", json={"title": "Edited"}, headers=auth_headers(admin)
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Edited"

    async def test_request_signatures_again_in_review_is_409(self, client, db, in_review):
        admin, member, adr = in_review["admin"], in_review["member"], in_review["adr"]
        resp = await client.post(
            f"/api/v1/adr/{adr['id']}/request-signatures",
            json={"user_ids": [str(admin.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 409
        assert resp.json()["detail"] == {"error": "not_draft"}
        got = (await client.get(f"/api/v1/adr/{adr['id']}", headers=auth_headers(admin))).json()
        assert [s["user_id"] for s in got["signatories"]] == [str(member.id)]
        todos = (
            (await db.execute(select(Todo).where(Todo.link == f"/ea-delivery/adr/{adr['id']}")))
            .scalars()
            .all()
        )
        assert len(todos) == 1


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

    async def test_list_adrs_for_card_rejects_malformed_id(self, client, db, card_env):
        """A non-UUID card id is a 400, not an unhandled ValueError → 500."""
        resp = await client.get(
            "/api/v1/adr/by-card/not-a-uuid",
            headers=auth_headers(card_env["admin"]),
        )
        assert resp.status_code == 400

    async def test_link_and_unlink_land_in_card_history(self, client, db, card_env):
        """Linking/unlinking fans out to the card timeline so the card's ADRs
        tab can surface new activity."""
        admin = card_env["admin"]
        card = card_env["card"]

        adr_id = (await _create_adr(client, admin, title="History ADR")).json()["id"]

        await client.post(
            f"/api/v1/adr/{adr_id}/cards",
            json={"card_id": str(card.id)},
            headers=auth_headers(admin),
        )
        resp = await client.get(f"/api/v1/cards/{card.id}/history", headers=auth_headers(admin))
        assert resp.status_code == 200
        linked = [e for e in resp.json() if e["event_type"] == "adr.linked"]
        assert len(linked) == 1
        assert linked[0]["data"]["adr_id"] == adr_id
        assert linked[0]["data"]["reference_number"] == "ADR-001"

        await client.delete(
            f"/api/v1/adr/{adr_id}/cards/{card.id}",
            headers=auth_headers(admin),
        )
        resp = await client.get(f"/api/v1/cards/{card.id}/history", headers=auth_headers(admin))
        unlinked = [e for e in resp.json() if e["event_type"] == "adr.unlinked"]
        assert len(unlinked) == 1
        assert unlinked[0]["data"]["adr_id"] == adr_id


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


# -------------------------------------------------------------------
# Search relevance (#918)
# -------------------------------------------------------------------


async def test_search_ranks_prefix_matches_before_substring(client, db, adr_env):
    """Searching switches the list out of recency order into best-match order."""
    admin = adr_env["admin"]
    for title in (
        "Retire legacy gateway",
        "Gateway consolidation",
        "Gateway timeout policy",
    ):
        assert (await _create_adr(client, admin, title=title)).status_code in (200, 201)

    resp = await client.get("/api/v1/adr?search=gateway", headers=auth_headers(admin))
    assert resp.status_code == 200
    titles = [a["title"] for a in resp.json()]
    # Both "Gateway…" titles outrank the one where it appears mid-title; within
    # the tier the newest stays first, which is the list's own order.
    assert titles.index("Retire legacy gateway") == 2
    assert set(titles[:2]) == {"Gateway consolidation", "Gateway timeout policy"}


async def test_search_wildcards_are_literal(client, db, adr_env):
    admin = adr_env["admin"]
    await _create_adr(client, admin, title="100% availability decision")
    await _create_adr(client, admin, title="Unrelated decision")

    resp = await client.get("/api/v1/adr?search=100%25", headers=auth_headers(admin))
    assert [a["title"] for a in resp.json()] == ["100% availability decision"]


class TestReferenceSequence:
    async def test_a_reference_shared_by_a_chain_counts_once(self, client, db, adr_env):
        """Revisions share their reference; the next decision still gets max+1."""
        admin = adr_env["admin"]
        adr_id = (await _create_adr(client, admin, title="One")).json()["id"]
        await _sign_adr(client, admin, [admin], adr_id)
        rev = await client.post(f"/api/v1/adr/{adr_id}/revise", headers=auth_headers(admin))
        assert rev.json()["reference_number"] == "ADR-001"
        nxt = await _create_adr(client, admin, title="Two")
        assert nxt.json()["reference_number"] == "ADR-002"

    async def test_consecutive_creates_get_consecutive_reference_numbers(self, client, db, adr_env):
        # The route goes through the shared adr_service generator — the same
        # sequence the analysis commit flow and the extension bridge draw from.
        admin = adr_env["admin"]
        first = await _create_adr(client, admin, title="One")
        second = await _create_adr(client, admin, title="Two")
        assert first.json()["reference_number"] == "ADR-001"
        assert second.json()["reference_number"] == "ADR-002"


class TestListAndEventHelpers:
    """The list-row, detail and card-event helpers of ``app/api/v1/adr.py``,
    called directly so each field is pinned without the route around it."""

    async def _decision_with_card(self, db, *, creator=None, card_type="Application"):
        from app.models.architecture_decision_card import ArchitectureDecisionCard

        card = await create_card(db, card_type=card_type, name=f"{card_type} card")
        adr = ArchitectureDecision(
            reference_number=f"ADR-{uuid.uuid4().hex[:6]}",
            title="Listed",
            created_by=creator.id if creator else None,
        )
        db.add(adr)
        await db.flush()
        db.add(ArchitectureDecisionCard(architecture_decision_id=adr.id, card_id=card.id))
        await db.flush()
        return adr, card

    async def test_summaries_carry_cards_and_creator_names_by_default(self, db, adr_env):
        from app.api.v1 import adr as adr_api
        from app.services import decision_standing as ds

        admin = adr_env["admin"]
        creator = await create_user(db, email="lister@test.com", display_name="Lister")
        adr, card = await self._decision_with_card(db, creator=creator)
        # A card on a decision not asked for must not reach the rows.
        await self._decision_with_card(db)
        anonymous = ArchitectureDecision(reference_number="ADR-ANON", title="Nobody's")
        db.add(anonymous)
        await db.flush()
        register = await ds.load_register(db)

        rows = await adr_api._summaries(db, [adr, anonymous], register, admin)

        assert [r["id"] for r in rows] == [str(adr.id), str(anonymous.id)]
        assert rows[0]["linked_cards"] == [
            {"id": str(card.id), "name": "Application card", "type": "Application"}
        ]
        assert rows[0]["creator_name"] == "Lister"
        assert (rows[1]["linked_cards"], rows[1]["creator_name"]) == ([], None)
        assert "participants" not in rows[0]

    async def test_summaries_without_creators_name_nobody(self, db, adr_env):
        from app.api.v1 import adr as adr_api
        from app.services import decision_standing as ds

        creator = await create_user(db, email="unnamed@test.com", display_name="Unnamed")
        adr, _ = await self._decision_with_card(db, creator=creator)
        rows = await adr_api._summaries(
            db, [adr], await ds.load_register(db), adr_env["admin"], with_creators=False
        )
        assert rows[0]["creator_name"] is None
        assert rows[0]["created_by"] == str(creator.id)

    async def test_a_module_only_reader_sees_the_linked_cards(self, db, adr_env):
        """A role with ``adr.view`` but not ``inventory.view`` reads the list in
        module mode: every linked card is shown."""
        from app.api.v1 import adr as adr_api
        from app.services import decision_standing as ds

        await create_role(db, key="adr_only", label="ADR only", permissions={"adr.view": True})
        reader = await create_user(db, email="adr-only@test.com", role="adr_only")
        adr, card = await self._decision_with_card(db)

        rows = await adr_api._summaries(db, [adr], await ds.load_register(db), reader)

        assert [c["id"] for c in rows[0]["linked_cards"]] == [str(card.id)]

    async def test_a_card_of_a_hidden_type_is_left_out_of_rows_and_detail(self, db, adr_env):
        from app.api.v1 import adr as adr_api
        from app.models.card_type import CardType
        from app.services import decision_standing as ds
        from app.services.permission_service import PermissionService

        await create_card_type(db, key="Initiative", label="Initiative")
        adr, _secret = await self._decision_with_card(db, card_type="Initiative")
        ct = (await db.execute(select(CardType).where(CardType.key == "Initiative"))).scalar_one()
        ct.role_permissions = {"member": {"inventory.view": False}}
        await db.flush()
        PermissionService.invalidate_type_permission_cache()
        member = adr_env["member"]

        rows = await adr_api._summaries(db, [adr], await ds.load_register(db), member)
        detail = await adr_api._detail(db, adr, member)

        assert rows[0]["linked_cards"] == []
        assert detail["linked_cards"] == []

    async def test_a_summary_without_people_has_empty_lists(self, db, adr_env):
        from app.api.v1 import adr as adr_api
        from app.services import decision_standing as ds

        adr = ArchitectureDecision(id=uuid.uuid4(), reference_number="ADR-P", title="No people")
        register = ds.build_register([], [], today=date(2026, 1, 1))

        plain = adr_api._adr_to_summary(adr, register=register, people={})
        full = adr_api._adr_to_summary(adr, register=register, people={}, with_participants=True)

        assert plain["decision_makers"] == []
        assert "participants" not in plain
        assert (full["decision_makers"], full["participants"]) == ([], [])

    async def test_the_card_event_names_the_revision_and_links_the_decision(self, db, adr_env):
        from app.api.v1 import adr as adr_api
        from app.services import adr_service

        adr, card = await self._decision_with_card(db)
        adr.revision_number = 3
        await db.flush()

        await adr_api._publish_adr_card_event(
            db, adr, "adr.linked", card.id, actor_id=adr_env["admin"].id
        )

        event = (
            await db.execute(select(Event).where(Event.event_type == "adr.linked"))
        ).scalar_one()
        assert event.data == {
            "adr_id": str(adr.id),
            "reference_number": adr.reference_number,
            "revision_number": 3,
            "title": "Listed",
            "status": "draft",
            "link": adr_service.decision_link(adr.id),
        }
        assert (event.card_id, event.user_id) == (card.id, adr_env["admin"].id)

    async def test_a_recorder_no_longer_found_has_no_name(self, db, adr_env):
        from app.api.v1 import adr as adr_api
        from app.services import decision_standing as ds

        adr, _ = await self._decision_with_card(db)
        register = await ds.load_register(db)
        ghost = uuid.uuid4()
        with db.no_autoflush:
            adr.recorded_by = ghost
            detail = await adr_api._adr_to_dict(db, adr, register, adr_env["admin"])
        assert detail["recorded_by"] == {"user_id": str(ghost), "display_name": None}
        adr.recorded_by = None
