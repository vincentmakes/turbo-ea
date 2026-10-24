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
    """Set up card types and a published portal.

    The portal shows ``app_to_itc`` relations and the type has a
    ``businessCriticality`` field: a public portal returns and filters on
    nothing its page does not show (see test_web_portals_public_shaping.py).
    """
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    await create_card_type(
        db,
        key="Application",
        label="Application",
        fields_schema=[
            {
                "section": "Main",
                "fields": [
                    {
                        "key": "businessCriticality",
                        "label": "Business Criticality",
                        "type": "single_select",
                    }
                ],
            }
        ],
    )
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
        card_config={"toggles": {"rel:app_to_itc": {"card": True, "detail": True}}},
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

    async def test_exposes_card_logo_when_the_type_allows_it(self, client, db, portal_env):
        """An anonymous visitor gets logo_updated_at, which is all the viewer
        needs — the image itself comes from the unauthenticated logo route."""
        from sqlalchemy import select

        from app.models.card_logo import CardLogo
        from app.models.card_type import CardType

        admin = portal_env["admin"]
        card = await create_card(db, card_type="Application", name="Kafka", user_id=admin.id)
        ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
        ct.allow_card_logo = True
        db.add(
            CardLogo(
                card_id=card.id,
                mime_type="image/png",
                size=8,
                data=b"\x89PNG\r\n\x1a\n",
                created_by=admin.id,
            )
        )
        await db.flush()

        resp = await client.get("/api/v1/web-portals/public/app-portal/cards")
        assert resp.status_code == 200
        item = next(i for i in resp.json()["items"] if i["name"] == "Kafka")
        assert item["logo_updated_at"] is not None

        # Switching the type off returns the portal to type-icon rendering.
        ct.allow_card_logo = False
        await db.flush()
        resp = await client.get("/api/v1/web-portals/public/app-portal/cards")
        item = next(i for i in resp.json()["items"] if i["name"] == "Kafka")
        assert item["logo_updated_at"] is None

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

    async def test_search_matches_the_alias(self, client, db, portal_env):
        """Every card search box matches the same three texts (#1108)."""
        admin = portal_env["admin"]
        await create_card(
            db, card_type="Application", name="Salesforce", alias="CRM-v2", user_id=admin.id
        )
        await create_card(db, card_type="Application", name="SAP ERP", user_id=admin.id)

        resp = await client.get("/api/v1/web-portals/public/app-portal/cards?search=CRM-v2")
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


# ---------------------------------------------------------------------------
# The shared card filter set as a portal preset (``filters.card_filters``)
# ---------------------------------------------------------------------------


def _card_filters(**kwargs) -> dict:
    value = {
        "subtypeFilters": [],
        "attrFilters": {},
        "relationFilters": {},
        "relSubtypeFilters": {},
        "tagFilterIds": [],
        "includeDescendants": False,
    }
    value.update(kwargs)
    return value


class TestPortalCardFilters:
    @pytest.fixture
    async def linked(self, db, portal_env):
        admin = portal_env["admin"]
        crm = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        erp = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
        db_server = await create_card(db, card_type="ITComponent", name="DB", user_id=admin.id)
        web = await create_card(db, card_type="ITComponent", name="Web", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=crm.id, target_id=db_server.id)
        await create_relation(db, type_key="app_to_itc", source_id=erp.id, target_id=web.id)
        return {"crm": crm, "erp": erp, "db": db_server, "web": web}

    async def test_cards_and_relation_options_honour_the_preset(
        self, client, db, portal_env, linked
    ):
        portal = portal_env["portal"]
        portal.filters = {
            "card_filters": _card_filters(relationFilters={"ITComponent": [str(linked["db"].id)]})
        }
        await db.flush()

        resp = await client.get("/api/v1/web-portals/public/app-portal/cards")
        assert resp.status_code == 200
        assert resp.json()["total"] == 1
        assert [i["name"] for i in resp.json()["items"]] == ["CRM"]

        resp = await client.get(
            "/api/v1/web-portals/public/app-portal/relation-options?type_key=ITComponent"
        )
        assert [o["name"] for o in resp.json()] == ["DB"]

    async def test_a_visitor_filter_cannot_widen_the_preset(self, client, db, portal_env, linked):
        portal = portal_env["portal"]
        portal.filters = {
            "card_filters": _card_filters(relationFilters={"ITComponent": [str(linked["db"].id)]})
        }
        await db.flush()
        rel = json.dumps({"app_to_itc": str(linked["web"].id)})
        resp = await client.get(
            f"/api/v1/web-portals/public/app-portal/cards?relation_filters={rel}"
        )
        assert resp.json()["total"] == 0

    async def test_the_public_payload_never_carries_the_preset(self, client, db, portal_env):
        portal = portal_env["portal"]
        hidden_id = str(uuid.uuid4())
        portal.filters = {
            "approval_statuses": ["APPROVED"],
            "card_filters": _card_filters(relationFilters={"ITComponent": [hidden_id]}),
        }
        await db.flush()
        resp = await client.get("/api/v1/web-portals/public/app-portal")
        assert resp.status_code == 200
        assert resp.json()["filters"] == {"approval_statuses": ["APPROVED"]}
        assert hidden_id not in resp.text

    async def test_create_stores_the_canonical_shape(self, client, portal_env):
        admin = portal_env["admin"]
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Filtered",
                "slug": "filtered",
                "card_type": "Application",
                "filters": {
                    "approval_statuses": ["APPROVED"],
                    "card_filters": {"subtypeFilters": ["a", 3], "bogus": True},
                },
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["filters"] == {
            "approval_statuses": ["APPROVED"],
            "card_filters": _card_filters(subtypeFilters=["a"]),
        }

    async def test_an_empty_card_filter_value_is_not_stored(self, client, portal_env):
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Legacy",
                "slug": "legacy",
                "card_type": "Application",
                "filters": {"subtypes": ["saas"], "card_filters": {}},
            },
            headers=auth_headers(portal_env["admin"]),
        )
        assert resp.status_code == 201
        assert resp.json()["filters"] == {"subtypes": ["saas"]}

    async def test_include_sub_cards_alone_is_kept(self, client, portal_env):
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Sub",
                "slug": "sub",
                "card_type": "Application",
                "filters": {"card_filters": {"includeDescendants": True}},
            },
            headers=auth_headers(portal_env["admin"]),
        )
        assert resp.json()["filters"] == {"card_filters": _card_filters(includeDescendants=True)}

    async def test_changing_the_card_type_drops_card_filters(self, client, db, portal_env):
        portal = portal_env["portal"]
        portal.filters = {
            "approval_statuses": ["APPROVED"],
            "card_filters": _card_filters(subtypeFilters=["micro"]),
        }
        await db.flush()
        headers = auth_headers(portal_env["admin"])
        resp = await client.patch(
            f"/api/v1/web-portals/{portal.id}", json={"card_type": "Application"}, headers=headers
        )
        assert resp.json()["filters"]["card_filters"]["subtypeFilters"] == ["micro"]
        resp = await client.patch(
            f"/api/v1/web-portals/{portal.id}", json={"card_type": "ITComponent"}, headers=headers
        )
        assert resp.status_code == 200
        assert resp.json()["filters"] == {"approval_statuses": ["APPROVED"]}

    async def test_a_board_portal_drops_card_filters(self, client, db, portal_env, monkeypatch):
        from app.api.v1 import web_portals as wp

        async def _enabled(_db):
            return True

        monkeypatch.setattr(wp, "_bpm_enabled", _enabled)
        await create_card_type(db, key="BusinessProcess", label="Business Process")
        admin = portal_env["admin"]
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Processes",
                "slug": "processes",
                "card_type": "BusinessProcess",
                "view": "process_navigator",
                "filters": {"subtypes": ["core"], "card_filters": _card_filters()},
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["filters"] == {"subtypes": ["core"]}

    async def test_switching_to_a_board_strips_stored_card_filters(
        self, client, db, portal_env, monkeypatch
    ):
        from app.api.v1 import web_portals as wp

        async def _enabled(_db):
            return True

        monkeypatch.setattr(wp, "_bpm_enabled", _enabled)
        await create_card_type(db, key="BusinessProcess", label="Business Process")
        portal = portal_env["portal"]
        portal.filters = {"approval_statuses": ["APPROVED"], "card_filters": _card_filters()}
        await db.flush()
        resp = await client.patch(
            f"/api/v1/web-portals/{portal.id}",
            json={"view": "process_navigator"},
            headers=auth_headers(portal_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["filters"] == {"approval_statuses": ["APPROVED"]}

    async def test_an_unrelated_patch_leaves_filters_alone(self, client, db, portal_env):
        portal = portal_env["portal"]
        stored = {"approval_statuses": ["APPROVED"], "card_filters": _card_filters()}
        portal.filters = stored
        await db.flush()
        resp = await client.patch(
            f"/api/v1/web-portals/{portal.id}",
            json={"name": "Renamed"},
            headers=auth_headers(portal_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["filters"] == stored


class TestPortalFilterOptions:
    async def test_returns_the_option_payload_without_cards(self, client, db, portal_env):
        admin = portal_env["admin"]
        app = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        itc = await create_card(db, card_type="ITComponent", name="DB", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=app.id, target_id=itc.id)

        resp = await client.get(
            "/api/v1/web-portals/filter-options?type=Application", headers=auth_headers(admin)
        )
        assert resp.status_code == 200
        data = resp.json()
        assert set(data) == {"fields_schema", "relation_types", "groupable_types", "tag_groups"}
        assert [m["name"] for m in data["groupable_types"]["ITComponent"]] == ["DB"]
        assert [rt["key"] for rt in data["relation_types"]] == ["app_to_itc"]

    async def test_needs_the_portal_permission(self, client, db, portal_env):
        await create_role(db, key="viewer", permissions={"reports.portfolio": True})
        viewer = await create_user(db, email="viewer@test.com", role="viewer")
        resp = await client.get(
            "/api/v1/web-portals/filter-options?type=Application", headers=auth_headers(viewer)
        )
        assert resp.status_code == 403

    @pytest.mark.parametrize("type_key", ["Nope", "Hidden"])
    async def test_unknown_or_hidden_type_is_404(self, client, db, portal_env, type_key):
        await create_card_type(db, key="Hidden", label="Hidden", is_hidden=True)
        resp = await client.get(
            f"/api/v1/web-portals/filter-options?type={type_key}",
            headers=auth_headers(portal_env["admin"]),
        )
        assert resp.status_code == 404

    async def test_requires_a_type(self, client, portal_env):
        resp = await client.get(
            "/api/v1/web-portals/filter-options", headers=auth_headers(portal_env["admin"])
        )
        assert resp.status_code == 422
