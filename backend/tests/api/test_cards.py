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
    create_relation,
    create_relation_type,
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

    async def test_mine_stakeholder_filters_to_stakeholder_cards(self, client, db, cards_env):
        """`mine=stakeholder` must restrict to cards the caller is a stakeholder on.

        Combined with `approval_status=BROKEN` it powers the Dashboard
        "broken card you're responsible for" deep-link.
        """
        from app.models.stakeholder import Stakeholder

        admin = cards_env["admin"]
        member = cards_env["member"]

        # Two broken cards, but member is only a stakeholder on one of them.
        mine_broken = await create_card(
            db,
            card_type="Application",
            name="Mine Broken",
            user_id=admin.id,
            approval_status="BROKEN",
        )
        await create_card(
            db,
            card_type="Application",
            name="Other Broken",
            user_id=admin.id,
            approval_status="BROKEN",
        )
        # A non-broken card member is a stakeholder on — must be excluded by approval filter.
        mine_draft = await create_card(
            db,
            card_type="Application",
            name="Mine Draft",
            user_id=admin.id,
            approval_status="DRAFT",
        )
        db.add(Stakeholder(card_id=mine_broken.id, user_id=member.id, role="responsible"))
        db.add(Stakeholder(card_id=mine_draft.id, user_id=member.id, role="responsible"))
        await db.flush()

        # mine=stakeholder alone → both mine cards.
        response = await client.get(
            "/api/v1/cards?mine=stakeholder",
            headers=auth_headers(member),
        )
        assert response.status_code == 200
        names = {item["name"] for item in response.json()["items"]}
        assert names == {"Mine Broken", "Mine Draft"}

        # mine=stakeholder + approval_status=BROKEN → only Mine Broken.
        response = await client.get(
            "/api/v1/cards?mine=stakeholder&approval_status=BROKEN",
            headers=auth_headers(member),
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["items"][0]["name"] == "Mine Broken"

    async def test_mine_rejects_unknown_value(self, client, db, cards_env):
        response = await client.get(
            "/api/v1/cards?mine=bogus",
            headers=auth_headers(cards_env["member"]),
        )
        assert response.status_code == 422


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
        assert data["primary"]["status"] == "ARCHIVED"
        assert data["primary"]["archived_at"] is not None
        assert data["affected_children_ids"] == []
        assert data["affected_related_card_ids"] == []

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
        assert data["primary"]["status"] == "ACTIVE"
        assert data["primary"]["archived_at"] is None
        assert data["restored_passenger_ids"] == []

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
        assert response.status_code == 200
        data = response.json()
        assert data["deleted_card_ids"] == [str(card.id)]
        assert data["affected_children_ids"] == []
        assert data["affected_related_card_ids"] == []

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


# ---------------------------------------------------------------------------
# GET /cards/counts  (per-card-type counts for the diagram Insert dialog)
# ---------------------------------------------------------------------------


class TestCardCounts:
    async def test_counts_groups_by_type_and_excludes_archived(self, client, db, cards_env):
        admin = cards_env["admin"]
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_card(db, card_type="Application", name="App A", user_id=admin.id)
        await create_card(db, card_type="Application", name="App B", user_id=admin.id)
        archived = await create_card(db, card_type="Application", name="App C", user_id=admin.id)
        archived.status = "ARCHIVED"
        await create_card(db, card_type="ITComponent", name="ITC One", user_id=admin.id)
        await db.flush()

        response = await client.get("/api/v1/cards/counts", headers=auth_headers(admin))
        assert response.status_code == 200
        body = response.json()
        by_type = {entry["type"]: entry["count"] for entry in body["by_type"]}
        assert by_type.get("Application") == 2
        assert by_type.get("ITComponent") == 1
        assert body["total"] == 3

    async def test_counts_excludes_hidden_types(self, client, db, cards_env):
        admin = cards_env["admin"]
        await create_card_type(db, key="HiddenType", label="Hidden", is_hidden=True)
        await create_card(db, card_type="Application", name="Visible", user_id=admin.id)
        await create_card(db, card_type="HiddenType", name="Stealth", user_id=admin.id)
        await db.flush()

        response = await client.get("/api/v1/cards/counts", headers=auth_headers(admin))
        assert response.status_code == 200
        keys = {entry["type"] for entry in response.json()["by_type"]}
        assert "Application" in keys
        assert "HiddenType" not in keys


# ---------------------------------------------------------------------------
# GET /cards?ids=...  (batch fetch for diagram view perspectives)
# ---------------------------------------------------------------------------


class TestCardsBatchByIds:
    async def test_returns_only_requested_ids(self, client, db, cards_env):
        admin = cards_env["admin"]
        kept = await create_card(db, card_type="Application", name="Kept", user_id=admin.id)
        await create_card(db, card_type="Application", name="Skipped", user_id=admin.id)
        await db.flush()

        response = await client.get(
            f"/api/v1/cards?ids={kept.id}",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert body["items"][0]["id"] == str(kept.id)

    async def test_invalid_uuid_in_batch_is_silently_skipped(self, client, db, cards_env):
        admin = cards_env["admin"]
        good = await create_card(db, card_type="Application", name="Good", user_id=admin.id)
        await db.flush()

        response = await client.get(
            f"/api/v1/cards?ids=not-a-uuid,{good.id}",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert body["items"][0]["id"] == str(good.id)

    async def test_batch_returns_archived_cards(self, client, db, cards_env):
        # Diagrams may carry references to cards that were archived after the
        # diagram was saved — the view-perspectives feature still wants to
        # know they exist so the cell can be flagged on the canvas.
        admin = cards_env["admin"]
        archived = await create_card(
            db, card_type="Application", name="Was Archived", user_id=admin.id
        )
        archived.status = "ARCHIVED"
        archived.archived_at = datetime.now(timezone.utc)
        await db.flush()

        response = await client.get(
            f"/api/v1/cards?ids={archived.id}",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["total"] == 1


# ---------------------------------------------------------------------------
# GET /cards/{id}/relation-summary  (diagram editor expand-by-relation menu)
# ---------------------------------------------------------------------------


class TestRelationSummary:
    async def test_groups_outgoing_and_incoming_relations(self, client, db, cards_env):
        admin = cards_env["admin"]
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="appUsesItc",
            label="uses",
            reverse_label="used by",
            source_type_key="Application",
            target_type_key="ITComponent",
        )
        app = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
        itc1 = await create_card(db, card_type="ITComponent", name="DB", user_id=admin.id)
        itc2 = await create_card(db, card_type="ITComponent", name="Cache", user_id=admin.id)
        # Two outgoing relations from the app
        await create_relation(db, type_key="appUsesItc", source_id=app.id, target_id=itc1.id)
        await create_relation(db, type_key="appUsesItc", source_id=app.id, target_id=itc2.id)
        # One incoming (other app uses ERP via the same relation type)
        other = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        await create_relation(db, type_key="appUsesItc", source_id=other.id, target_id=app.id)
        await db.flush()

        response = await client.get(
            f"/api/v1/cards/{app.id}/relation-summary",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        rows = response.json()["by_type"]
        outgoing = [r for r in rows if r["direction"] == "outgoing"]
        incoming = [r for r in rows if r["direction"] == "incoming"]
        assert len(outgoing) == 1
        assert outgoing[0]["count"] == 2
        assert outgoing[0]["label"] == "uses"
        assert outgoing[0]["peer_type_key"] == "ITComponent"
        assert len(incoming) == 1
        assert incoming[0]["count"] == 1
        # Reverse label is used for incoming rows when defined.
        assert incoming[0]["label"] == "used by"
        assert incoming[0]["peer_type_key"] == "Application"

    async def test_excludes_archived_neighbours(self, client, db, cards_env):
        admin = cards_env["admin"]
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="appUsesItc",
            label="uses",
            source_type_key="Application",
            target_type_key="ITComponent",
        )
        app = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
        live = await create_card(db, card_type="ITComponent", name="Live", user_id=admin.id)
        gone = await create_card(db, card_type="ITComponent", name="Gone", user_id=admin.id)
        gone.status = "ARCHIVED"
        await create_relation(db, type_key="appUsesItc", source_id=app.id, target_id=live.id)
        await create_relation(db, type_key="appUsesItc", source_id=app.id, target_id=gone.id)
        await db.flush()

        response = await client.get(
            f"/api/v1/cards/{app.id}/relation-summary",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        rows = response.json()["by_type"]
        # The archived target must not contribute to the count, otherwise the
        # menu would lie about how many neighbours expand.
        assert sum(r["count"] for r in rows) == 1

    async def test_unknown_card_returns_404(self, client, db, cards_env):
        admin = cards_env["admin"]
        response = await client.get(
            f"/api/v1/cards/{uuid.uuid4()}/relation-summary",
            headers=auth_headers(admin),
        )
        assert response.status_code == 404

    async def test_hierarchy_block_reports_children_and_parent(self, client, db, cards_env):
        # Parent / child / grandchild chain — the middle card should report
        # 1 child + 1 parent so the diagram editor can enable Drill-Down +
        # Roll-Up in one fetch.
        admin = cards_env["admin"]
        parent = await create_card(db, card_type="Application", name="Parent", user_id=admin.id)
        middle = await create_card(db, card_type="Application", name="Middle", user_id=admin.id)
        middle.parent_id = parent.id
        child = await create_card(db, card_type="Application", name="Child", user_id=admin.id)
        child.parent_id = middle.id
        await db.flush()

        response = await client.get(
            f"/api/v1/cards/{middle.id}/relation-summary",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["hierarchy"]["children_count"] == 1
        assert body["hierarchy"]["parent_id"] == str(parent.id)
        assert body["hierarchy"]["parent_name"] == "Parent"
        assert body["hierarchy"]["parent_type"] == "Application"

    async def test_hierarchy_block_excludes_archived_children(self, client, db, cards_env):
        admin = cards_env["admin"]
        parent = await create_card(db, card_type="Application", name="P", user_id=admin.id)
        active = await create_card(db, card_type="Application", name="Active", user_id=admin.id)
        active.parent_id = parent.id
        archived = await create_card(db, card_type="Application", name="Archived", user_id=admin.id)
        archived.parent_id = parent.id
        archived.status = "ARCHIVED"
        await db.flush()

        response = await client.get(
            f"/api/v1/cards/{parent.id}/relation-summary",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        # The Drill-Down menu must not lie about the number of children
        # it can actually fetch through /hierarchy.
        assert response.json()["hierarchy"]["children_count"] == 1
