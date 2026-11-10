"""Integration tests for the /cards endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.card import Card
from app.models.card_type import CardType
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_tag,
    create_tag_group,
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


class TestPpmViewCardRead:
    """ppm.view alone must open an Initiative card (#1043) — and nothing else."""

    @pytest.fixture
    async def ppm_view_env(self, db, cards_env):
        await create_card_type(db, key="Initiative", label="Initiative")
        await create_role(
            db,
            key="ppm_only",
            label="PPM Only",
            permissions={"ppm.view": True, "inventory.view": False},
        )
        await create_role(db, key="no_view", label="No View", permissions={})
        ppm_user = await create_user(db, email="ppmonly@test.com", role="ppm_only")
        no_view_user = await create_user(db, email="noview@test.com", role="no_view")
        initiative = await create_card(db, card_type="Initiative", name="Init A")
        application = await create_card(db, card_type="Application", name="App A")
        return {
            "ppm_user": ppm_user,
            "no_view_user": no_view_user,
            "initiative": initiative,
            "application": application,
        }

    async def test_ppm_view_can_read_initiative(self, client, db, ppm_view_env):
        resp = await client.get(
            f"/api/v1/cards/{ppm_view_env['initiative'].id}",
            headers=auth_headers(ppm_view_env["ppm_user"]),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Init A"

    async def test_ppm_view_cannot_read_other_types(self, client, db, ppm_view_env):
        resp = await client.get(
            f"/api/v1/cards/{ppm_view_env['application'].id}",
            headers=auth_headers(ppm_view_env["ppm_user"]),
        )
        assert resp.status_code == 403

    async def test_ppm_view_can_read_initiative_hierarchy_and_history(
        self, client, db, ppm_view_env
    ):
        headers = auth_headers(ppm_view_env["ppm_user"])
        initiative_id = ppm_view_env["initiative"].id
        await create_card(db, card_type="Initiative", name="Init A child", parent_id=initiative_id)
        resp = await client.get(f"/api/v1/cards/{initiative_id}/hierarchy", headers=headers)
        assert resp.status_code == 200
        # The tree is read in module mode: a role without the global
        # `inventory.view` still sees the children of a card it may open.
        assert [c["name"] for c in resp.json()["children"]] == ["Init A child"]
        resp = await client.get(f"/api/v1/cards/{initiative_id}/history", headers=headers)
        assert resp.status_code == 200

    async def test_no_permission_still_denied_on_initiative(self, client, db, ppm_view_env):
        resp = await client.get(
            f"/api/v1/cards/{ppm_view_env['initiative'].id}",
            headers=auth_headers(ppm_view_env["no_view_user"]),
        )
        assert resp.status_code == 403

    async def test_inventory_view_still_reads_initiative(self, client, db, cards_env, ppm_view_env):
        resp = await client.get(
            f"/api/v1/cards/{ppm_view_env['initiative'].id}",
            headers=auth_headers(cards_env["viewer"]),
        )
        assert resp.status_code == 200


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

    async def test_list_filters_by_comma_separated_types(self, client, db, cards_env):
        """`?type=A,B` returns the union of both types with correct total.

        Used by the diagram Insert-Cards dialog when more than one type
        chip is selected — without this the dialog used to silently fetch
        an unfiltered page and filter client-side (#569).
        """
        admin = cards_env["admin"]
        await create_card_type(db, key="DataObject", label="Data Object")
        await create_card_type(db, key="Interface", label="Interface")

        await create_card(db, card_type="Application", name="App A", user_id=admin.id)
        await create_card(db, card_type="DataObject", name="Data A", user_id=admin.id)
        await create_card(db, card_type="DataObject", name="Data B", user_id=admin.id)
        await create_card(db, card_type="Interface", name="Iface A", user_id=admin.id)

        response = await client.get(
            "/api/v1/cards?type=Application,DataObject",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        data = response.json()
        names = {item["name"] for item in data["items"]}
        assert names == {"App A", "Data A", "Data B"}
        assert data["total"] == 3

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

    async def test_search_ranks_prefix_before_contains(self, client, db, cards_env):
        """Typing `w` must surface names starting with W, not bury them (#918)."""
        admin = cards_env["admin"]
        for name in ("Network Monitor", "Cloud Work Hub", "Workday Adaptive", "Workday"):
            await create_card(db, card_type="Application", name=name, user_id=admin.id)

        response = await client.get(
            "/api/v1/cards?search=work",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        names = [item["name"] for item in response.json()["items"]]
        # starts-with (alphabetical) → starts-a-word → plain substring
        assert names == ["Workday", "Workday Adaptive", "Cloud Work Hub", "Network Monitor"]

    async def test_search_exact_match_ranks_first(self, client, db, cards_env):
        admin = cards_env["admin"]
        await create_card(db, card_type="Application", name="Workflow", user_id=admin.id)
        await create_card(db, card_type="Application", name="Work", user_id=admin.id)

        response = await client.get(
            "/api/v1/cards?search=Work",
            headers=auth_headers(admin),
        )
        names = [item["name"] for item in response.json()["items"]]
        assert names[0] == "Work"

    async def test_search_ranks_word_boundary_on_punctuation(self, client, db, cards_env):
        """A term after `-` or `/` starts a word just as much as after a space."""
        admin = cards_env["admin"]
        await create_card(db, card_type="Application", name="Reworked Portal", user_id=admin.id)
        await create_card(db, card_type="Application", name="SAP/Workday", user_id=admin.id)

        response = await client.get(
            "/api/v1/cards?search=work",
            headers=auth_headers(admin),
        )
        names = [item["name"] for item in response.json()["items"]]
        assert names == ["SAP/Workday", "Reworked Portal"]

    async def test_explicit_sort_overrides_relevance(self, client, db, cards_env):
        admin = cards_env["admin"]
        for name in ("Workday", "Cloud Work Hub", "Network Monitor"):
            await create_card(db, card_type="Application", name=name, user_id=admin.id)

        response = await client.get(
            "/api/v1/cards?search=work&sort_by=name&sort_dir=desc",
            headers=auth_headers(admin),
        )
        names = [item["name"] for item in response.json()["items"]]
        assert names == ["Workday", "Network Monitor", "Cloud Work Hub"]

    async def test_search_wildcards_are_literal(self, client, db, cards_env):
        """`%` and `_` in a search term must not act as LIKE wildcards."""
        admin = cards_env["admin"]
        await create_card(db, card_type="Application", name="100% Uptime", user_id=admin.id)
        await create_card(db, card_type="Application", name="100 Percent", user_id=admin.id)

        response = await client.get(
            "/api/v1/cards?search=100%25",
            headers=auth_headers(admin),
        )
        data = response.json()
        assert [item["name"] for item in data["items"]] == ["100% Uptime"]

        response = await client.get(
            "/api/v1/cards?search=a_b",
            headers=auth_headers(admin),
        )
        assert response.json()["total"] == 0

    async def test_search_matches_the_alias(self, client, db, cards_env):
        """An alias IS a name — searching for one has to find the card (#1108)."""
        admin = cards_env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="Customer Relationship Suite",
            alias="CRM-v2",
            user_id=admin.id,
        )
        await create_card(db, card_type="Application", name="Unrelated", user_id=admin.id)

        response = await client.get(
            "/api/v1/cards?search=CRM-v2",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        data = response.json()
        assert [item["name"] for item in data["items"]] == ["Customer Relationship Suite"]
        assert data["items"][0]["alias"] == "CRM-v2"

    async def test_search_ranks_an_exact_alias_above_a_name_substring(self, client, db, cards_env):
        """Relevance takes the better of name and alias, so the alias can win."""
        admin = cards_env["admin"]
        await create_card(
            db, card_type="Application", name="Legacy Workday Bridge", user_id=admin.id
        )
        await create_card(
            db,
            card_type="Application",
            name="Human Capital Suite",
            alias="Workday",
            user_id=admin.id,
        )

        response = await client.get(
            "/api/v1/cards?search=Workday",
            headers=auth_headers(admin),
        )
        names = [item["name"] for item in response.json()["items"]]
        assert names == ["Human Capital Suite", "Legacy Workday Bridge"]

    async def test_a_card_without_an_alias_ranks_as_before(self, client, db, cards_env):
        """`least()` over a NULL alias must not disturb the name tiers (#918)."""
        admin = cards_env["admin"]
        for name in ("Network Monitor", "Cloud Work Hub", "Workday Adaptive", "Workday"):
            await create_card(db, card_type="Application", name=name, user_id=admin.id)

        response = await client.get(
            "/api/v1/cards?search=work",
            headers=auth_headers(admin),
        )
        names = [item["name"] for item in response.json()["items"]]
        assert names == ["Workday", "Workday Adaptive", "Cloud Work Hub", "Network Monitor"]

    async def test_explicit_sort_still_overrides_alias_relevance(self, client, db, cards_env):
        admin = cards_env["admin"]
        await create_card(db, card_type="Application", name="Alpha", alias="Zeta", user_id=admin.id)
        await create_card(db, card_type="Application", name="Zeta Bridge", user_id=admin.id)

        response = await client.get(
            "/api/v1/cards?search=zeta&sort_by=name&sort_dir=desc",
            headers=auth_headers(admin),
        )
        names = [item["name"] for item in response.json()["items"]]
        assert names == ["Zeta Bridge", "Alpha"]

    async def test_pagination_has_a_stable_tiebreaker(self, client, db, cards_env):
        """Same-named cards must not duplicate or vanish across pages."""
        admin = cards_env["admin"]
        first = await create_card(db, card_type="Application", name="Twin", user_id=admin.id)
        second = await create_card(db, card_type="DataObject", name="Twin", user_id=admin.id)

        seen = []
        for page in (1, 2):
            response = await client.get(
                f"/api/v1/cards?search=Twin&page={page}&page_size=1",
                headers=auth_headers(admin),
            )
            seen.extend(item["id"] for item in response.json()["items"])
        assert sorted(seen) == sorted([str(first.id), str(second.id)])

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


class TestOrphanedAndStaleFilters:
    """`?orphaned=` / `?stale=` — the inventory equivalents of the Data
    Quality dashboard's two KPI tiles, so a tile can deep-link to a view
    holding exactly the cards it counted."""

    async def _names(self, client, admin, query):
        response = await client.get(f"/api/v1/cards?{query}", headers=auth_headers(admin))
        assert response.status_code == 200
        return response.json(), [item["name"] for item in response.json()["items"]]

    @pytest.fixture
    async def related(self, db, cards_env):
        """One connected pair plus one unconnected card."""
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
        source = await create_card(db, card_type="Application", name="Wired", user_id=admin.id)
        target = await create_card(db, card_type="ITComponent", name="Pointed At", user_id=admin.id)
        await create_relation(db, type_key="appUsesItc", source_id=source.id, target_id=target.id)
        await create_card(db, card_type="Application", name="Alone", user_id=admin.id)
        await db.flush()
        return cards_env

    async def test_orphaned_keeps_only_unconnected_cards(self, client, db, related):
        _, names = await self._names(client, related["admin"], "orphaned=true")
        assert names == ["Alone"]

    async def test_orphaned_counts_a_relation_in_either_direction(self, client, db, related):
        """The target of a relation is connected too — reporting it as
        orphaned would send someone hunting a problem that isn't there."""
        _, names = await self._names(client, related["admin"], "orphaned=true")
        assert "Pointed At" not in names
        assert "Wired" not in names

    async def test_orphaned_total_matches_the_returned_rows(self, client, db, related):
        # The count query must carry the same predicate, or the grid's
        # "N cards" caption contradicts the rows under it.
        data, names = await self._names(client, related["admin"], "orphaned=true")
        assert data["total"] == len(names) == 1

    async def test_off_by_default(self, client, db, related):
        _, names = await self._names(client, related["admin"], "type=Application")
        assert sorted(names) == ["Alone", "Wired"]

    async def test_stale_honours_the_90_day_cutoff(self, client, db, cards_env):
        admin = cards_env["admin"]
        old = await create_card(db, card_type="Application", name="Dusty", user_id=admin.id)
        old.updated_at = datetime.now(timezone.utc) - timedelta(days=91)
        edge = await create_card(db, card_type="Application", name="JustInside", user_id=admin.id)
        edge.updated_at = datetime.now(timezone.utc) - timedelta(days=89)
        await create_card(db, card_type="Application", name="Fresh", user_id=admin.id)
        await db.flush()

        _, names = await self._names(client, admin, "stale=true")
        assert names == ["Dusty"]

    async def test_stale_composes_with_orphaned(self, client, db, related):
        """Both tiles can be open at once; the filters must intersect."""
        admin = related["admin"]
        lonely_and_old = await create_card(
            db, card_type="Application", name="OldAndAlone", user_id=admin.id
        )
        lonely_and_old.updated_at = datetime.now(timezone.utc) - timedelta(days=120)
        await db.flush()

        _, names = await self._names(client, admin, "orphaned=true&stale=true")
        assert names == ["OldAndAlone"]

    async def test_composes_with_the_type_filter(self, client, db, related):
        _, names = await self._names(client, related["admin"], "type=ITComponent&orphaned=true")
        assert names == []


# ---------------------------------------------------------------------------
# GET /cards?query=  (multi-hop card query)
# ---------------------------------------------------------------------------


class TestQueryParam:
    """``?query=`` keeps the start cards with a chain of related cards matching
    every hop (``services/card_query.py``)."""

    CHAIN = {
        "type": "Organization",
        "related": [
            {
                "relation": "orgUsesApp",
                "type": "Application",
                "related": [
                    {
                        "relation": "initAffectsApp",
                        "type": "Initiative",
                        "where": {"attributes": {"initiativeStatus": ["onTrack"]}},
                    }
                ],
            }
        ],
    }

    async def _get(self, client, user, query, extra: str = ""):
        return await client.get(
            "/api/v1/cards",
            params={"query": query if isinstance(query, str) else json.dumps(query)}
            | dict(p.split("=") for p in extra.split("&") if p),
            headers=auth_headers(user),
        )

    @pytest.fixture
    async def chain(self, db, cards_env):
        """Corp uses Alpha, which the on-track Rocket affects; Team uses Beta,
        which the at-risk Drag affects; Solo uses nothing. Organization is
        hierarchical."""
        await create_card_type(db, key="Organization", label="Organization", has_hierarchy=True)
        await create_card_type(
            db,
            key="Initiative",
            label="Initiative",
            fields_schema=[
                {
                    "section": "Main",
                    "fields": [
                        {
                            "key": "initiativeStatus",
                            "type": "single_select",
                            "options": [{"key": "onTrack"}, {"key": "atRisk"}],
                        }
                    ],
                }
            ],
        )
        await create_relation_type(
            db, key="orgUsesApp", source_type_key="Organization", target_type_key="Application"
        )
        await create_relation_type(
            db, key="initAffectsApp", source_type_key="Initiative", target_type_key="Application"
        )
        corp = await create_card(db, card_type="Organization", name="Corp")
        team = await create_card(db, card_type="Organization", name="Team")
        await create_card(db, card_type="Organization", name="Solo")
        alpha = await create_card(db, name="Alpha")
        beta = await create_card(db, name="Beta")
        rocket = await create_card(
            db,
            card_type="Initiative",
            name="Rocket Initiative",
            attributes={"initiativeStatus": "onTrack"},
        )
        drag = await create_card(
            db, card_type="Initiative", name="Drag", attributes={"initiativeStatus": "atRisk"}
        )
        await create_relation(db, type_key="orgUsesApp", source_id=corp.id, target_id=alpha.id)
        await create_relation(db, type_key="orgUsesApp", source_id=team.id, target_id=beta.id)
        await create_relation(
            db, type_key="initAffectsApp", source_id=rocket.id, target_id=alpha.id
        )
        await create_relation(db, type_key="initAffectsApp", source_id=drag.id, target_id=beta.id)
        return cards_env

    async def test_keeps_the_chained_cards(self, client, db, chain):
        resp = await self._get(client, chain["admin"], self.CHAIN)
        assert resp.status_code == 200
        data = resp.json()
        assert [item["name"] for item in data["items"]] == ["Corp"]
        assert data["total"] == len(data["items"]) == 1

    async def test_one_hop_total_matches(self, client, db, chain):
        one_hop = {"type": "Organization", "related": [CHAIN_HOP]}
        resp = await self._get(client, chain["admin"], one_hop)
        data = resp.json()
        assert [item["name"] for item in data["items"]] == ["Corp", "Team"]
        assert data["total"] == 2

    async def test_total_counts_past_the_page(self, client, db, chain):
        one_hop = {"type": "Organization", "related": [CHAIN_HOP]}
        resp = await self._get(client, chain["admin"], one_hop, "page_size=1")
        data = resp.json()
        assert [item["name"] for item in data["items"]] == ["Corp"]
        assert data["total"] == 2

    async def test_combines_with_type(self, client, db, chain):
        resp = await self._get(client, chain["admin"], self.CHAIN, "type=Organization")
        assert [item["name"] for item in resp.json()["items"]] == ["Corp"]
        other = await self._get(client, chain["admin"], self.CHAIN, "type=Application")
        assert other.status_code == 200
        assert other.json()["items"] == []
        assert other.json()["total"] == 0

    async def test_requires_inventory_browse(self, client, db, chain):
        await create_role(db, key="reports", label="Reports", permissions={})
        user = await create_user(db, email="reports@test.com", role="reports")
        resp = await self._get(client, user, self.CHAIN)
        assert resp.status_code == 403

    @pytest.mark.parametrize(
        ("query", "code"),
        [
            ("{nope", "invalid_query_json"),
            (json.dumps({"type": "Organization", "colour": "red"}), "invalid_query"),
            (json.dumps({"type": "Nope"}), "unknown_card_type"),
            (
                json.dumps(
                    {"type": "Organization", "related": [{"relation": "x", "type": "Application"}]}
                ),
                "unknown_relation_type",
            ),
            # One past the limit: the documented 400, not the parameter's 422.
            ("x" * 8001, "query_too_long"),
        ],
    )
    async def test_rejected_queries(self, client, db, chain, query, code):
        resp = await self._get(client, chain["admin"], query)
        assert resp.status_code == 400
        assert resp.json()["detail"] == code

    ON_TRACK_APP = {
        "type": "Application",
        "related": [
            {
                "relation": "initAffectsApp",
                "type": "Initiative",
                "where": {"attributes": {"initiativeStatus": ["onTrack"]}},
            }
        ],
    }
    ORG_LINE = {
        "type": "Organization",
        "related": [{"relation": "orgUsesApp", "type": "Application"}],
    }

    async def test_an_any_of_lists_two_card_types(self, client, db, chain):
        query = {"any_of": [self.ON_TRACK_APP, self.ORG_LINE]}
        resp = await self._get(client, chain["admin"], query)
        assert resp.status_code == 200
        data = resp.json()
        assert {(item["type"], item["name"]) for item in data["items"]} == {
            ("Application", "Alpha"),
            ("Organization", "Corp"),
            ("Organization", "Team"),
        }
        assert data["total"] == len(data["items"]) == 3

    async def test_an_any_of_total_counts_past_the_page(self, client, db, chain):
        query = {"any_of": [self.ON_TRACK_APP, self.ORG_LINE]}
        resp = await self._get(client, chain["admin"], query, "page_size=1")
        assert len(resp.json()["items"]) == 1
        assert resp.json()["total"] == 3

    async def test_an_all_of_keeps_the_intersection(self, client, db, chain):
        used = {
            "type": "Application",
            "related": [{"relation": "orgUsesApp", "type": "Organization"}],
        }
        not_at_risk = {
            "type": "Application",
            "related": [
                {
                    "relation": "initAffectsApp",
                    "type": "Initiative",
                    "where": {"attributes": {"initiativeStatus": ["atRisk"]}},
                    "negate": True,
                }
            ],
        }
        both = await self._get(client, chain["admin"], {"all_of": [used, not_at_risk]})
        assert both.status_code == 200
        assert [item["name"] for item in both.json()["items"]] == ["Alpha"]
        assert both.json()["total"] == 1
        alone = await self._get(client, chain["admin"], used)
        assert [item["name"] for item in alone.json()["items"]] == ["Alpha", "Beta"]

    async def test_a_stack_combines_with_type(self, client, db, chain):
        query = {"any_of": [self.ON_TRACK_APP, self.ORG_LINE]}
        resp = await self._get(client, chain["admin"], query, "type=Application")
        assert resp.status_code == 200
        assert [item["name"] for item in resp.json()["items"]] == ["Alpha"]
        assert resp.json()["total"] == 1
        orgs = await self._get(client, chain["admin"], query, "type=Organization")
        assert [item["name"] for item in orgs.json()["items"]] == ["Corp", "Team"]

    @pytest.mark.parametrize(
        ("query", "code"),
        [
            ({"all_of": [{"type": "Organization"}]}, "all_of_needs_two"),
            ({"any_of": [{"type": "Organization"}]}, "any_of_needs_two"),
            (
                {"all_of": [{"type": "Organization"}, {"type": "Application"}]},
                "all_of_type_mismatch",
            ),
            ({"all_of": [{"type": "Organization"}] * 7}, "too_many_lines"),
            ({"any_of": [{"any_of": [{"type": "A"}] * 2}, {"type": "A"}]}, "invalid_query"),
            ({"any_of": [{"type": "Organization"}, {"type": "Nope"}]}, "unknown_card_type"),
        ],
    )
    async def test_rejected_stacks(self, client, db, chain, query, code):
        resp = await self._get(client, chain["admin"], query)
        assert resp.status_code == 400
        assert resp.json()["detail"] == code

    async def test_a_data_quality_band_at_a_hop(self, client, db, chain):
        """Alpha (Corp's) scores 85, Beta (Team's) 50."""
        for name, score in (("Alpha", 85.0), ("Beta", 50.0)):
            card = (await db.execute(select(Card).where(Card.name == name))).scalar_one()
            card.data_quality = score
        await db.flush()

        def query(*bands: str) -> dict:
            where = {"data_quality_band": list(bands)}
            return {"type": "Organization", "related": [{**CHAIN_HOP, "where": where}]}

        resp = await self._get(client, chain["admin"], query("complete"))
        assert resp.status_code == 200
        assert [item["name"] for item in resp.json()["items"]] == ["Corp"]
        assert resp.json()["total"] == 1
        resp = await self._get(client, chain["admin"], query("partial"))
        assert [item["name"] for item in resp.json()["items"]] == ["Team"]
        resp = await self._get(client, chain["admin"], query("minimal"))
        assert resp.json()["items"] == []
        assert resp.json()["total"] == 0

    async def test_an_unknown_data_quality_band_is_refused(self, client, db, chain):
        query = {"type": "Organization", "where": {"data_quality_band": ["good"]}}
        resp = await self._get(client, chain["admin"], query)
        assert resp.status_code == 400
        assert resp.json()["detail"] == "unknown_band"

    @pytest.fixture
    async def tagged(self, db, chain):
        """On top of ``chain``: Alpha carries Gold, Beta carries Silver (group
        Tier); group Hq (Organization only) holds Main, on Team."""
        apps = {
            c.name: c
            for c in (await db.execute(select(Card).where(Card.type == "Application")))
            .scalars()
            .all()
        }
        team = (await db.execute(select(Card).where(Card.name == "Team"))).scalar_one()
        tier = await create_tag_group(db, name="Tier")
        hq = await create_tag_group(db, name="Hq", restrict_to_types=["Organization"])
        tags = {
            "Gold": await create_tag(db, group=tier, name="Gold", cards=[apps["Alpha"]]),
            "Silver": await create_tag(db, group=tier, name="Silver", cards=[apps["Beta"]]),
            "Main": await create_tag(db, group=hq, name="Main", cards=[team]),
        }
        return {**chain, "tags": {k: str(v.id) for k, v in tags.items()}}

    async def test_tags_at_a_hop(self, client, db, tagged):
        def query(*names: str) -> dict:
            where = {"tags": [tagged["tags"][n] for n in names]}
            return {"type": "Organization", "related": [{**CHAIN_HOP, "where": where}]}

        resp = await self._get(client, tagged["admin"], query("Silver"))
        assert resp.status_code == 200
        assert [item["name"] for item in resp.json()["items"]] == ["Team"]
        assert resp.json()["total"] == 1
        resp = await self._get(client, tagged["admin"], query("Silver", "Gold"))
        assert [item["name"] for item in resp.json()["items"]] == ["Corp", "Team"]

    async def test_tags_on_the_start_card(self, client, db, tagged):
        query = {"type": "Organization", "where": {"tags": [tagged["tags"]["Main"]]}}
        resp = await self._get(client, tagged["admin"], query)
        assert [item["name"] for item in resp.json()["items"]] == ["Team"]

    @pytest.mark.parametrize(
        ("where", "code"),
        [
            ({"tags": ["7a1d1c1e-0000-4000-8000-000000000001"]}, "unknown_tag"),
            ({"tags": ["Gold"]}, "unknown_tag"),
            ({"tags": []}, "empty_values"),
        ],
    )
    async def test_rejected_tags(self, client, db, tagged, where, code):
        query = {"type": "Organization", "related": [{**CHAIN_HOP, "where": where}]}
        resp = await self._get(client, tagged["admin"], query)
        assert resp.status_code == 400
        assert resp.json()["detail"] == code

    async def test_a_tag_of_a_group_for_other_types_is_refused(self, client, db, tagged):
        query = {
            "type": "Organization",
            "related": [{**CHAIN_HOP, "where": {"tags": [tagged["tags"]["Main"]]}}],
        }
        resp = await self._get(client, tagged["admin"], query)
        assert resp.status_code == 400
        assert resp.json()["detail"] == "tag_not_for_type"

    async def test_a_card_id_beside_tags_is_still_refused(self, client, db, tagged):
        alpha = (await db.execute(select(Card).where(Card.name == "Alpha"))).scalar_one()
        query = {
            "type": "Organization",
            "where": {"tags": [tagged["tags"]["Main"]], "subtype": [str(alpha.id)]},
        }
        resp = await self._get(client, tagged["admin"], query)
        assert resp.status_code == 400
        assert resp.json()["detail"] == "query_holds_an_id"

    async def test_a_restricted_reader_never_sees_through_a_denied_type(self, client, db, chain):
        await create_role(db, key="r", label="R", permissions={"inventory.view": True})
        reader = await create_user(db, email="r@test.com", role="r")
        ct = (await db.execute(select(CardType).where(CardType.key == "Initiative"))).scalar_one()
        ct.role_permissions = {"r": {"inventory.view": False}}
        await db.flush()
        PermissionService.invalidate_type_permission_cache()

        resp = await self._get(client, reader, self.CHAIN)
        assert resp.status_code == 200
        assert resp.json()["items"] == []
        assert resp.json()["total"] == 0
        assert "Rocket Initiative" not in resp.text
        # Control: the admin reaches Corp through the same chain.
        admin_resp = await self._get(client, chain["admin"], self.CHAIN)
        assert [item["name"] for item in admin_resp.json()["items"]] == ["Corp"]

    async def _ids(self, db) -> dict[str, str]:
        rows = await db.execute(select(Card.name, Card.id))
        return {name: str(card_id) for name, card_id in rows.all()}

    async def test_cards_at_a_hop(self, client, db, chain):
        ids = await self._ids(db)
        query = {
            "type": "Organization",
            "related": [{**CHAIN_HOP, "where": {"cards": [ids["Beta"]]}}],
        }
        resp = await self._get(client, chain["admin"], query)
        assert resp.status_code == 200
        assert [item["name"] for item in resp.json()["items"]] == ["Team"]
        assert resp.json()["total"] == 1
        both = {
            "type": "Organization",
            "related": [{**CHAIN_HOP, "where": {"cards": [ids["Beta"], ids["Alpha"]]}}],
        }
        resp = await self._get(client, chain["admin"], both)
        assert [item["name"] for item in resp.json()["items"]] == ["Corp", "Team"]

    async def test_cards_on_the_start_card_with_sub_cards(self, client, db, chain):
        ids = await self._ids(db)
        await create_card(db, card_type="Organization", name="Corp Unit", parent_id=ids["Corp"])
        query = {"type": "Organization", "where": {"cards": [ids["Corp"]]}}
        resp = await self._get(client, chain["admin"], query)
        assert [item["name"] for item in resp.json()["items"]] == ["Corp"]
        flagged = {
            "type": "Organization",
            "where": {"cards": [ids["Corp"]], "include_descendants": True},
        }
        resp = await self._get(client, chain["admin"], flagged)
        assert [item["name"] for item in resp.json()["items"]] == ["Corp", "Corp Unit"]
        assert resp.json()["total"] == 2

    async def test_unknown_wrong_type_and_hidden_picks_answer_alike(self, client, db, chain):
        """No existence oracle: the read path checks no pick. For a reader who
        cannot see Applications, a pick naming no card, a card of another type
        and a hidden card all answer the same 200 with the same rows."""
        ids = await self._ids(db)
        await create_role(db, key="r", label="R", permissions={"inventory.view": True})
        reader = await create_user(db, email="r@test.com", role="r")
        ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
        ct.role_permissions = {"r": {"inventory.view": False}}
        await db.flush()
        PermissionService.invalidate_type_permission_cache()

        bodies = []
        for value in ("7a1d1c1e-0000-4000-8000-000000000002", ids["Corp"], ids["Alpha"]):
            hop = {**CHAIN_HOP, "where": {"cards": [value]}}
            for negate in (False, True):
                query = {"type": "Organization", "related": [{**hop, "negate": negate}]}
                resp = await self._get(client, reader, query)
                assert resp.status_code == 200, resp.text
                assert "unknown_card" not in resp.text
                bodies.append((negate, [i["name"] for i in resp.json()["items"]]))
        assert bodies == [(False, []), (True, ["Corp", "Solo", "Team"])] * 3

    async def test_an_unknown_pick_beside_a_known_one_narrows_to_the_known(self, client, db, chain):
        ids = await self._ids(db)
        for extra in ("7a1d1c1e-0000-4000-8000-000000000002", ids["Corp"], "not-a-uuid"):
            query = {
                "type": "Organization",
                "related": [{**CHAIN_HOP, "where": {"cards": [ids["Beta"], extra]}}],
            }
            resp = await self._get(client, chain["admin"], query)
            assert resp.status_code == 200, resp.text
            assert [item["name"] for item in resp.json()["items"]] == ["Team"]
            assert resp.json()["total"] == 1

    async def test_descendants_on_a_type_without_hierarchy(self, client, db, chain):
        ids = await self._ids(db)
        query = {
            "type": "Organization",
            "related": [
                {**CHAIN_HOP, "where": {"cards": [ids["Alpha"]], "include_descendants": True}}
            ],
        }
        resp = await self._get(client, chain["admin"], query)
        assert resp.status_code == 400
        assert resp.json()["detail"] == "descendants_without_hierarchy"

    async def test_a_view_naming_a_card_hidden_from_the_reader_is_narrowed(self, client, db, chain):
        ids = await self._ids(db)
        await create_role(db, key="r", label="R", permissions={"inventory.view": True})
        reader = await create_user(db, email="r@test.com", role="r")
        ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
        ct.role_permissions = {"r": {"inventory.view": False}}
        await db.flush()
        PermissionService.invalidate_type_permission_cache()
        query = {
            "type": "Organization",
            "related": [{**CHAIN_HOP, "where": {"cards": [ids["Alpha"]]}}],
        }

        resp = await self._get(client, reader, query)
        assert resp.status_code == 200
        assert resp.json()["items"] == []
        assert resp.json()["total"] == 0
        assert "Alpha" not in resp.text
        # The negated hop reads the hidden card as absent: every organization.
        negated = {
            "type": "Organization",
            "related": [{**CHAIN_HOP, "where": {"cards": [ids["Alpha"]]}, "negate": True}],
        }
        resp = await self._get(client, reader, negated)
        assert resp.status_code == 200
        assert [item["name"] for item in resp.json()["items"]] == ["Corp", "Solo", "Team"]
        assert "Alpha" not in resp.text
        # Control: the admin reaches Corp through the pick.
        admin_resp = await self._get(client, chain["admin"], query)
        assert [item["name"] for item in admin_resp.json()["items"]] == ["Corp"]

    # -- where.eol_status ---------------------------------------------------

    @pytest.fixture
    async def eol_chain(self, db, chain, monkeypatch):
        """``chain`` with Alpha linked to an end-of-life nginx cycle and Beta
        recording nothing; the upstream fetch answers from a fixed list and
        records whether the request's session was still in a transaction."""
        from app.services import eol_service

        alpha = (await db.execute(select(Card).where(Card.name == "Alpha"))).scalar_one()
        alpha.attributes = {"eol_product": "nginx", "eol_cycle": "1.0"}
        await db.flush()
        held: list[bool] = []

        async def fake(products):
            held.append(db.in_transaction())
            cycles = {"nginx": [{"cycle": "1.0", "eol": "2020-01-01", "support": False}]}
            return {p: cycles[p] for p in products if p in cycles}

        monkeypatch.setattr(eol_service, "fetch_cycles_for_products", fake)
        return {**chain, "held": held}

    @staticmethod
    def _eol_query(*values: str) -> dict:
        hop = {**CHAIN_HOP, "where": {"eol_status": list(values)}}
        return {"type": "Organization", "related": [hop]}

    @pytest.mark.parametrize(
        ("values", "names", "held"),
        [
            (["eol"], ["Corp"], [False]),
            (["supported", "unknown"], [], [False]),
            # Pure SQL: no fetch at all, so nothing to release for.
            (["__empty__"], ["Team"], []),
        ],
    )
    async def test_eol_status(self, client, db, eol_chain, values, names, held):
        resp = await self._get(client, eol_chain["admin"], self._eol_query(*values))
        assert resp.status_code == 200
        assert [item["name"] for item in resp.json()["items"]] == names
        assert resp.json()["total"] == len(names)
        # The connection was handed back before the outbound fetch.
        assert eol_chain["held"] == held

    @pytest.fixture
    async def archived_eol(self, db, cards_env, monkeypatch):
        """Archived Applications: Relic linked to a cycle no active card
        uses (end of life), Fossil recording nothing, Ruin with a far manual
        end of life; Live, active, linked to a supported cycle."""
        from app.services import eol_service

        far = (datetime.now(timezone.utc).date() + timedelta(days=400)).isoformat()
        await create_card(
            db,
            name="Relic",
            status="ARCHIVED",
            attributes={"eol_product": "nginx", "eol_cycle": "0.9"},
        )
        await create_card(db, name="Fossil", status="ARCHIVED")
        await create_card(db, name="Ruin", status="ARCHIVED", lifecycle={"endOfLife": far})
        await create_card(db, name="Live", attributes={"eol_product": "nginx", "eol_cycle": "1.3"})

        async def fake(products):
            cycles = {
                "nginx": [
                    {"cycle": "0.9", "eol": "2019-01-01", "support": False},
                    {"cycle": "1.3", "eol": far, "support": far},
                ]
            }
            return {p: cycles[p] for p in products if p in cycles}

        monkeypatch.setattr(eol_service, "fetch_cycles_for_products", fake)
        return cards_env

    @pytest.mark.parametrize(
        ("value", "names"),
        [
            ("eol", ["Relic"]),
            ("approaching", []),
            ("supported", ["Ruin"]),
            ("unknown", []),
            ("__empty__", ["Fossil"]),
        ],
    )
    async def test_an_archived_card_matches_its_status(
        self, client, db, archived_eol, value, names
    ):
        """``status=ARCHIVED`` (the inventory's "Show archived"): Relic's
        pair is on no active card, yet it reads ``eol``. The five values
        partition the archived cards."""
        query = {"type": "Application", "where": {"eol_status": [value]}}
        resp = await self._get(client, archived_eol["admin"], query, "status=ARCHIVED")
        assert resp.status_code == 200
        assert [item["name"] for item in resp.json()["items"]] == names

    async def test_the_values_together_list_every_archived_card(self, client, db, archived_eol):
        values = ["eol", "approaching", "supported", "unknown", "__empty__"]
        query = {"type": "Application", "where": {"eol_status": values}}
        resp = await self._get(client, archived_eol["admin"], query, "status=ARCHIVED")
        assert sorted(item["name"] for item in resp.json()["items"]) == ["Fossil", "Relic", "Ruin"]
        active = await self._get(client, archived_eol["admin"], query)
        assert [item["name"] for item in active.json()["items"]] == ["Live"]

    async def test_a_query_without_eol_neither_fetches_nor_commits(self, client, db, eol_chain):
        resp = await self._get(client, eol_chain["admin"], self.CHAIN)
        assert [item["name"] for item in resp.json()["items"]] == ["Corp"]
        assert eol_chain["held"] == []

    async def test_eol_status_needs_eol_view(self, client, db, eol_chain):
        await create_role(
            db, key="no_eol", label="No EOL", permissions={**MEMBER_PERMISSIONS, "eol.view": False}
        )
        reader = await create_user(db, email="no-eol@test.com", role="no_eol")
        resp = await self._get(client, reader, self._eol_query("eol"))
        assert resp.status_code == 403
        assert resp.json()["detail"] == "eol_view_required"
        assert eol_chain["held"] == []
        # The same reader runs a query without the condition.
        assert (await self._get(client, reader, self.CHAIN)).status_code == 200

    @pytest.mark.parametrize(
        ("query", "code"),
        [
            ({"type": "Application", "where": {"eol_status": []}}, "empty_values"),
            ({"type": "Application", "where": {"eol_status": ["retired"]}}, "unknown_eol_status"),
            ({"type": "Organization", "where": {"eol_status": ["eol"]}}, "eol_not_tracked"),
        ],
    )
    async def test_rejected_eol_queries(self, client, db, eol_chain, query, code):
        resp = await self._get(client, eol_chain["admin"], query)
        assert resp.status_code == 400
        assert resp.json()["detail"] == code


CHAIN_HOP = {"relation": "orgUsesApp", "type": "Application"}
