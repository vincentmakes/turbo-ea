"""Extended integration tests for web portals — public endpoints.

Covers the untested public endpoints: GET /public/{slug}/cards,
GET /public/{slug}/relation-options, and additional CRUD edge cases.

Integration tests requiring a PostgreSQL test database.
"""

from __future__ import annotations

import json
import uuid

import pytest

from app.models.web_portal import WebPortal
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
async def portal_env(db):
    """Set up card types and a published portal."""
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_relation_type(
        db,
        key="app_to_itc",
        label="App to ITC",
        source_type_key="Application",
        target_type_key="ITComponent",
    )

    portal = WebPortal(
        name="App Portal",
        slug="app-portal",
        card_type="Application",
        is_published=True,
        created_by=admin.id,
    )
    db.add(portal)
    await db.flush()

    return {"admin": admin, "portal": portal}


# ---------------------------------------------------------------------------
# Public portal cards endpoint
# ---------------------------------------------------------------------------


class TestPublicPortalCards:
    async def test_returns_cards(self, client, db, portal_env):
        admin = portal_env["admin"]
        await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        await create_card(db, card_type="Application", name="ERP", user_id=admin.id)

        resp = await client.get("/api/v1/web-portals/public/app-portal/cards")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert len(data["items"]) == 2
        assert data["page"] == 1
        assert data["page_size"] == 24

    async def test_empty_portal(self, client, portal_env):
        resp = await client.get("/api/v1/web-portals/public/app-portal/cards")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["items"] == []

    async def test_nonexistent_portal_404(self, client):
        resp = await client.get("/api/v1/web-portals/public/no-such/cards")
        assert resp.status_code == 404

    async def test_unpublished_portal_404(self, client, db, portal_env):
        """Unpublished portals are invisible to public cards endpoint."""
        portal = WebPortal(
            name="Draft",
            slug="draft-portal",
            card_type="Application",
            is_published=False,
        )
        db.add(portal)
        await db.flush()

        resp = await client.get("/api/v1/web-portals/public/draft-portal/cards")
        assert resp.status_code == 404

    async def test_search_filter(self, client, db, portal_env):
        admin = portal_env["admin"]
        await create_card(db, card_type="Application", name="Salesforce", user_id=admin.id)
        await create_card(db, card_type="Application", name="SAP ERP", user_id=admin.id)

        resp = await client.get("/api/v1/web-portals/public/app-portal/cards?search=Sales")
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["name"] == "Salesforce"

    async def test_subtype_filter(self, client, db, portal_env):
        admin = portal_env["admin"]
        from sqlalchemy import update

        from app.models.card import Card

        c = await create_card(db, card_type="Application", name="App1", user_id=admin.id)
        await db.execute(update(Card).where(Card.id == c.id).values(subtype="Microservice"))
        await create_card(db, card_type="Application", name="App2", user_id=admin.id)
        await db.flush()

        resp = await client.get("/api/v1/web-portals/public/app-portal/cards?subtype=Microservice")
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["name"] == "App1"

    async def test_pagination(self, client, db, portal_env):
        admin = portal_env["admin"]
        for i in range(5):
            await create_card(
                db,
                card_type="Application",
                name=f"App{i}",
                user_id=admin.id,
            )

        resp = await client.get("/api/v1/web-portals/public/app-portal/cards?page=2&page_size=2")
        data = resp.json()
        assert data["total"] == 5
        assert data["page"] == 2
        assert data["page_size"] == 2
        assert len(data["items"]) == 2

    async def test_sort_by_name_desc(self, client, db, portal_env):
        admin = portal_env["admin"]
        await create_card(db, card_type="Application", name="Alpha", user_id=admin.id)
        await create_card(db, card_type="Application", name="Zeta", user_id=admin.id)

        resp = await client.get(
            "/api/v1/web-portals/public/app-portal/cards?sort_by=name&sort_dir=desc"
        )
        data = resp.json()
        assert data["items"][0]["name"] == "Zeta"
        assert data["items"][1]["name"] == "Alpha"

    async def test_invalid_sort_by_falls_back(self, client, db, portal_env):
        admin = portal_env["admin"]
        await create_card(db, card_type="Application", name="App", user_id=admin.id)

        resp = await client.get(
            "/api/v1/web-portals/public/app-portal/cards?sort_by=invalid_column"
        )
        assert resp.status_code == 200

    async def test_attr_filters(self, client, db, portal_env):
        admin = portal_env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="Critical",
            user_id=admin.id,
            attributes={"businessCriticality": "high"},
        )
        await create_card(
            db,
            card_type="Application",
            name="Normal",
            user_id=admin.id,
            attributes={"businessCriticality": "low"},
        )

        filters = json.dumps({"businessCriticality": "high"})
        resp = await client.get(
            f"/api/v1/web-portals/public/app-portal/cards?attr_filters={filters}"
        )
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["name"] == "Critical"

    async def test_malformed_attr_filters_ignored(self, client, db, portal_env):
        admin = portal_env["admin"]
        await create_card(db, card_type="Application", name="App", user_id=admin.id)

        resp = await client.get(
            "/api/v1/web-portals/public/app-portal/cards?attr_filters=not-valid-json"
        )
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

    async def test_excludes_archived_cards(self, client, db, portal_env):
        admin = portal_env["admin"]
        await create_card(db, card_type="Application", name="Active", user_id=admin.id)
        await create_card(
            db,
            card_type="Application",
            name="Archived",
            user_id=admin.id,
            status="ARCHIVED",
        )

        resp = await client.get("/api/v1/web-portals/public/app-portal/cards")
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["name"] == "Active"

    async def test_cards_include_relations(self, client, db, portal_env):
        admin = portal_env["admin"]
        app = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        itc = await create_card(db, card_type="ITComponent", name="Server", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=app.id, target_id=itc.id)

        resp = await client.get("/api/v1/web-portals/public/app-portal/cards")
        data = resp.json()
        assert len(data["items"]) == 1
        rels = data["items"][0]["relations"]
        assert len(rels) == 1
        assert rels[0]["related_name"] == "Server"
        assert rels[0]["direction"] == "outgoing"

    async def test_relation_filter(self, client, db, portal_env):
        """Filter cards by related_type + related_id."""
        admin = portal_env["admin"]
        app1 = await create_card(db, card_type="Application", name="App1", user_id=admin.id)
        await create_card(db, card_type="Application", name="App2", user_id=admin.id)
        itc = await create_card(db, card_type="ITComponent", name="Server", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=app1.id, target_id=itc.id)

        resp = await client.get(
            f"/api/v1/web-portals/public/app-portal/cards"
            f"?related_type=app_to_itc&related_id={itc.id}"
        )
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["name"] == "App1"

    async def test_portal_level_subtype_filter(self, client, db, portal_env):
        """Portal's own filters.subtypes restricts which cards appear."""
        admin = portal_env["admin"]
        from sqlalchemy import update

        from app.models.card import Card

        c1 = await create_card(db, card_type="Application", name="MS", user_id=admin.id)
        await db.execute(update(Card).where(Card.id == c1.id).values(subtype="Microservice"))
        await create_card(db, card_type="Application", name="Other", user_id=admin.id)
        await db.flush()

        # Update portal with subtype filter
        portal = portal_env["portal"]
        portal.filters = {"subtypes": ["Microservice"]}
        await db.flush()

        resp = await client.get("/api/v1/web-portals/public/app-portal/cards")
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["name"] == "MS"


# ---------------------------------------------------------------------------
# Public portal relation options endpoint
# ---------------------------------------------------------------------------


class TestPublicPortalRelationOptions:
    async def test_returns_related_cards(self, client, db, portal_env):
        admin = portal_env["admin"]
        app = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        itc = await create_card(db, card_type="ITComponent", name="Server", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=app.id, target_id=itc.id)

        resp = await client.get(
            "/api/v1/web-portals/public/app-portal/relation-options?type_key=ITComponent"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "Server"

    async def test_empty_when_no_relations(self, client, db, portal_env):
        admin = portal_env["admin"]
        await create_card(db, card_type="Application", name="CRM", user_id=admin.id)

        resp = await client.get(
            "/api/v1/web-portals/public/app-portal/relation-options?type_key=ITComponent"
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_nonexistent_portal_404(self, client):
        resp = await client.get(
            "/api/v1/web-portals/public/nope/relation-options?type_key=ITComponent"
        )
        assert resp.status_code == 404

    async def test_unpublished_portal_404(self, client, db):
        portal = WebPortal(
            name="Draft",
            slug="draft",
            card_type="Application",
            is_published=False,
        )
        db.add(portal)
        await db.flush()

        resp = await client.get(
            "/api/v1/web-portals/public/draft/relation-options?type_key=ITComponent"
        )
        assert resp.status_code == 404

    async def test_respects_portal_subtype_filter(self, client, db, portal_env):
        """Only relations from portal-visible cards are returned."""
        admin = portal_env["admin"]
        from sqlalchemy import update

        from app.models.card import Card

        app1 = await create_card(db, card_type="Application", name="MS", user_id=admin.id)
        await db.execute(update(Card).where(Card.id == app1.id).values(subtype="Microservice"))
        app2 = await create_card(db, card_type="Application", name="Other", user_id=admin.id)
        itc1 = await create_card(db, card_type="ITComponent", name="Server1", user_id=admin.id)
        itc2 = await create_card(db, card_type="ITComponent", name="Server2", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=app1.id, target_id=itc1.id)
        await create_relation(db, type_key="app_to_itc", source_id=app2.id, target_id=itc2.id)
        await db.flush()

        # Restrict portal to Microservice subtype
        portal = portal_env["portal"]
        portal.filters = {"subtypes": ["Microservice"]}
        await db.flush()

        resp = await client.get(
            "/api/v1/web-portals/public/app-portal/relation-options?type_key=ITComponent"
        )
        data = resp.json()
        # Only Server1 (linked to visible Microservice app) should appear
        assert len(data) == 1
        assert data[0]["name"] == "Server1"


# ---------------------------------------------------------------------------
# CRUD edge cases
# ---------------------------------------------------------------------------


class TestPortalCrudEdgeCases:
    async def test_create_invalid_card_type(self, client, portal_env):
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Bad",
                "slug": "bad-type",
                "card_type": "NonexistentType",
            },
            headers=auth_headers(portal_env["admin"]),
        )
        assert resp.status_code == 400
        assert "not found" in resp.json()["detail"]

    async def test_update_nonexistent_404(self, client, portal_env):
        resp = await client.patch(
            f"/api/v1/web-portals/{uuid.uuid4()}",
            json={"name": "Updated"},
            headers=auth_headers(portal_env["admin"]),
        )
        assert resp.status_code == 404

    async def test_update_slug_duplicate(self, client, db, portal_env):
        admin = portal_env["admin"]
        # Create a second portal
        p2 = WebPortal(
            name="Second",
            slug="second-portal",
            card_type="Application",
            is_published=False,
            created_by=admin.id,
        )
        db.add(p2)
        await db.flush()

        # Try to update second portal's slug to match first
        resp = await client.patch(
            f"/api/v1/web-portals/{p2.id}",
            json={"slug": "app-portal"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400
        assert "slug" in resp.json()["detail"].lower()

    async def test_update_slug_invalid_format(self, client, portal_env):
        portal = portal_env["portal"]
        resp = await client.patch(
            f"/api/v1/web-portals/{portal.id}",
            json={"slug": "INVALID SLUG!"},
            headers=auth_headers(portal_env["admin"]),
        )
        assert resp.status_code == 400

    async def test_update_is_published(self, client, portal_env):
        portal = portal_env["portal"]
        resp = await client.patch(
            f"/api/v1/web-portals/{portal.id}",
            json={"is_published": False},
            headers=auth_headers(portal_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["is_published"] is False

    async def test_delete_nonexistent_404(self, client, portal_env):
        resp = await client.delete(
            f"/api/v1/web-portals/{uuid.uuid4()}",
            headers=auth_headers(portal_env["admin"]),
        )
        assert resp.status_code == 404

    async def test_public_portal_includes_type_info(self, client, portal_env):
        resp = await client.get("/api/v1/web-portals/public/app-portal")
        assert resp.status_code == 200
        data = resp.json()
        assert data["type_info"] is not None
        assert data["type_info"]["key"] == "Application"
        assert "relation_types" in data
        assert "tag_groups" in data

    async def test_public_portal_relation_types(self, client, portal_env):
        """Public portal includes non-hidden relation types."""
        resp = await client.get("/api/v1/web-portals/public/app-portal")
        data = resp.json()
        rel_types = data["relation_types"]
        assert len(rel_types) >= 1
        rt = rel_types[0]
        assert "key" in rt
        assert "other_type_key" in rt
        assert "other_type_label" in rt
