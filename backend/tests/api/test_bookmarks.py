"""Integration tests for the /bookmarks endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.bookmark import Bookmark
from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation_type import RelationType
from app.services.card_query import base_view_filters
from app.services.card_read_scope import CardReadScope
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
async def bm_env(db):
    """Prerequisite data for bookmark tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions=VIEWER_PERMISSIONS,
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "viewer": viewer}


# ---------------------------------------------------------------
# POST /bookmarks  (create)
# ---------------------------------------------------------------


class TestCreateBookmark:
    async def test_admin_can_create_bookmark(self, client, db, bm_env):
        admin = bm_env["admin"]
        resp = await client.post(
            "/api/v1/bookmarks",
            json={
                "name": "My Apps",
                "card_type": "Application",
                "filters": {"types": ["Application"]},
                "columns": ["name", "status"],
                "sort": {"field": "name", "direction": "asc"},
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "My Apps"
        assert data["card_type"] == "Application"
        assert data["is_owner"] is True
        assert data["visibility"] == "private"

    async def test_viewer_can_create_bookmark(self, client, db, bm_env):
        viewer = bm_env["viewer"]
        resp = await client.post(
            "/api/v1/bookmarks",
            json={
                "name": "Viewer View",
                "card_type": "Application",
            },
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 201

    async def test_column_state_round_trips(self, client, db, bm_env):
        """The AG Grid column layout is persisted and returned verbatim."""
        admin = bm_env["admin"]
        column_state = [
            {"colId": "core_name", "width": 240, "pinned": "left"},
            {"colId": "core_type", "width": 140},
            {"colId": "attr_costTotalAnnual", "width": 160, "hide": True},
        ]
        resp = await client.post(
            "/api/v1/bookmarks",
            json={
                "name": "Layout View",
                "card_type": "Application",
                "columns": ["core_name", "core_type"],
                "column_state": column_state,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["column_state"] == column_state

        # GET returns it too
        bm_id = resp.json()["id"]
        listed = await client.get("/api/v1/bookmarks", headers=auth_headers(admin))
        match = next(b for b in listed.json() if b["id"] == bm_id)
        assert match["column_state"] == column_state

        # PATCH updates it
        new_state = [{"colId": "core_type", "width": 120}]
        patched = await client.patch(
            f"/api/v1/bookmarks/{bm_id}",
            json={"column_state": new_state},
            headers=auth_headers(admin),
        )
        assert patched.status_code == 200
        assert patched.json()["column_state"] == new_state

    async def test_column_state_defaults_to_null(self, client, db, bm_env):
        admin = bm_env["admin"]
        resp = await client.post(
            "/api/v1/bookmarks",
            json={"name": "No Layout"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["column_state"] is None

    async def test_column_filter_model_round_trips(self, client, db, bm_env):
        """The AG Grid column-filter model is persisted and returned verbatim."""
        admin = bm_env["admin"]
        column_filter_model = {
            "meta_created_at": {
                "filterType": "date",
                "type": "greaterThan",
                "dateFrom": "2026-01-01 00:00:00",
            },
            "core_name": {"filterType": "text", "type": "contains", "filter": "erp"},
        }
        resp = await client.post(
            "/api/v1/bookmarks",
            json={
                "name": "Filtered View",
                "card_type": "Application",
                "column_filter_model": column_filter_model,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["column_filter_model"] == column_filter_model

        # GET returns it too
        bm_id = resp.json()["id"]
        listed = await client.get("/api/v1/bookmarks", headers=auth_headers(admin))
        match = next(b for b in listed.json() if b["id"] == bm_id)
        assert match["column_filter_model"] == column_filter_model

        # PATCH updates it
        new_model = {"core_type": {"filterType": "text", "type": "equals", "filter": "Application"}}
        patched = await client.patch(
            f"/api/v1/bookmarks/{bm_id}",
            json={"column_filter_model": new_model},
            headers=auth_headers(admin),
        )
        assert patched.status_code == 200
        assert patched.json()["column_filter_model"] == new_model

    async def test_column_filter_model_defaults_to_null(self, client, db, bm_env):
        admin = bm_env["admin"]
        resp = await client.post(
            "/api/v1/bookmarks",
            json={"name": "No Filters"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["column_filter_model"] is None


# ---------------------------------------------------------------
# GET /bookmarks  (list)
# ---------------------------------------------------------------


class TestListBookmarks:
    async def test_list_bookmarks(self, client, db, bm_env):
        admin = bm_env["admin"]
        # Create one first
        await client.post(
            "/api/v1/bookmarks",
            json={"name": "Listed BM"},
            headers=auth_headers(admin),
        )
        resp = await client.get(
            "/api/v1/bookmarks",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1

    async def test_filter_my_bookmarks(self, client, db, bm_env):
        admin = bm_env["admin"]
        await client.post(
            "/api/v1/bookmarks",
            json={"name": "Mine"},
            headers=auth_headers(admin),
        )
        resp = await client.get(
            "/api/v1/bookmarks?filter=my",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        for bm in resp.json():
            assert bm["is_owner"] is True


# ---------------------------------------------------------------
# PATCH /bookmarks/{id}  (update)
# ---------------------------------------------------------------


class TestUpdateBookmark:
    async def test_owner_can_update(self, client, db, bm_env):
        admin = bm_env["admin"]
        create_resp = await client.post(
            "/api/v1/bookmarks",
            json={"name": "Old Name"},
            headers=auth_headers(admin),
        )
        bm_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/bookmarks/{bm_id}",
            json={"name": "New Name"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "New Name"

    async def test_update_nonexistent_returns_404(self, client, db, bm_env):
        admin = bm_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.patch(
            f"/api/v1/bookmarks/{fake_id}",
            json={"name": "Ghost"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_non_owner_cannot_update(self, client, db, bm_env):
        admin = bm_env["admin"]
        viewer = bm_env["viewer"]
        create_resp = await client.post(
            "/api/v1/bookmarks",
            json={"name": "Admin BM"},
            headers=auth_headers(admin),
        )
        bm_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/bookmarks/{bm_id}",
            json={"name": "Hacked"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------
# DELETE /bookmarks/{id}
# ---------------------------------------------------------------


class TestDeleteBookmark:
    async def test_owner_can_delete(self, client, db, bm_env):
        admin = bm_env["admin"]
        create_resp = await client.post(
            "/api/v1/bookmarks",
            json={"name": "Delete Me"},
            headers=auth_headers(admin),
        )
        bm_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/bookmarks/{bm_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

    async def test_non_owner_cannot_delete(self, client, db, bm_env):
        admin = bm_env["admin"]
        viewer = bm_env["viewer"]
        create_resp = await client.post(
            "/api/v1/bookmarks",
            json={"name": "Protected BM"},
            headers=auth_headers(admin),
        )
        bm_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/bookmarks/{bm_id}",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_delete_nonexistent_returns_404(self, client, db, bm_env):
        admin = bm_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.delete(
            f"/api/v1/bookmarks/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------
# GET /bookmarks/{id}/odata  (feed)
# ---------------------------------------------------------------


class TestBookmarkOdataFeed:
    async def test_search_matches_the_alias(self, client, db, bm_env):
        """The feed's saved search matches the same three texts as the UI (#1108)."""
        admin = bm_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card(
            db, card_type="Application", name="Salesforce", alias="CRM-v2", user_id=admin.id
        )
        await create_card(db, card_type="Application", name="SAP ERP", user_id=admin.id)

        created = await client.post(
            "/api/v1/bookmarks",
            json={
                "name": "Aliased",
                "card_type": "Application",
                "filters": {"search": "CRM-v2"},
                "odata_enabled": True,
            },
            headers=auth_headers(admin),
        )
        assert created.status_code == 201
        bm_id = created.json()["id"]

        resp = await client.get(
            f"/api/v1/bookmarks/{bm_id}/odata",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        names = [row["name"] for row in resp.json()["value"]]
        assert names == ["Salesforce"]


# ---------------------------------------------------------------
# Query views (a multi-hop card query on a saved view)
# ---------------------------------------------------------------

ORG_QUERY = {
    "type": "Organization",
    "related": [
        {
            "relation": "orgUsesApp",
            "type": "Application",
            "related": [{"relation": "initAffectsApp", "type": "Initiative"}],
        }
    ],
}


@pytest.fixture
async def query_env(db, bm_env):
    """Corp uses Alpha, which Rocket affects; Team uses Beta, which nothing
    affects; Solo uses nothing."""
    await create_card_type(db, key="Organization", label="Organization", has_hierarchy=True)
    await create_card_type(db, key="Application", label="Application", has_hierarchy=True)
    await create_card_type(db, key="Initiative", label="Initiative", has_hierarchy=False)
    await create_relation_type(
        db, key="orgUsesApp", source_type_key="Organization", target_type_key="Application"
    )
    await create_relation_type(
        db, key="initAffectsApp", source_type_key="Initiative", target_type_key="Application"
    )
    corp = await create_card(db, card_type="Organization", name="Corp")
    team = await create_card(db, card_type="Organization", name="Team")
    await create_card(db, card_type="Organization", name="Solo")
    alpha = await create_card(db, card_type="Application", name="Alpha")
    beta = await create_card(db, card_type="Application", name="Beta")
    rocket = await create_card(db, card_type="Initiative", name="Rocket")
    await create_relation(db, type_key="orgUsesApp", source_id=corp.id, target_id=alpha.id)
    await create_relation(db, type_key="orgUsesApp", source_id=team.id, target_id=beta.id)
    await create_relation(db, type_key="initAffectsApp", source_id=rocket.id, target_id=alpha.id)
    return bm_env


async def _create(client, user, **body):
    payload = {"name": "Chain", **body}
    return await client.post("/api/v1/bookmarks", json=payload, headers=auth_headers(user))


class TestQueryViews:
    async def test_create_with_a_query_pins_the_start_type(self, client, db, query_env):
        resp = await _create(
            client,
            query_env["admin"],
            card_type=None,
            filters={"search": "", "groupBy": "subtype"},
            query=ORG_QUERY,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["query"] == ORG_QUERY
        assert data["card_type"] == "Organization"
        assert data["filters"] == {"search": "", "groupBy": "subtype", "types": ["Organization"]}

    async def test_create_stores_a_data_quality_band_verbatim(self, client, db, query_env):
        query = {
            "type": "Organization",
            "related": [
                {
                    "relation": "orgUsesApp",
                    "type": "Application",
                    "where": {"data_quality_band": ["minimal", "complete"]},
                }
            ],
        }
        resp = await _create(client, query_env["admin"], query=query)
        assert resp.status_code == 201
        assert resp.json()["query"] == query
        listed = await client.get("/api/v1/bookmarks", headers=auth_headers(query_env["admin"]))
        assert [bm["query"] for bm in listed.json()] == [query]

    async def test_a_plain_view_has_no_query(self, client, db, query_env):
        resp = await _create(client, query_env["admin"], card_type="Application")
        assert resp.status_code == 201
        assert resp.json()["query"] is None

    async def test_the_mcp_origin_is_recorded(self, client, db, query_env):
        resp = await client.post(
            "/api/v1/bookmarks",
            json={"name": "Chain", "query": ORG_QUERY},
            headers={**auth_headers(query_env["admin"]), "X-Turbo-EA-Origin": "mcp"},
        )
        assert resp.status_code == 201
        assert resp.json()["created_via"] == "mcp"
        assert resp.json()["updated_via"] == "mcp"

    async def test_a_direct_call_is_recorded_as_api(self, client, db, query_env):
        resp = await _create(client, query_env["admin"], query=ORG_QUERY)
        assert resp.json()["created_via"] == "api"
        bm_id = resp.json()["id"]
        patched = await client.patch(
            f"/api/v1/bookmarks/{bm_id}",
            json={"name": "Renamed"},
            headers={**auth_headers(query_env["admin"]), "X-Turbo-EA-Origin": "mcp"},
        )
        assert patched.json()["created_via"] == "api"
        assert patched.json()["updated_via"] == "mcp"

    @pytest.mark.parametrize(
        ("query", "code"),
        [
            ({"type": "Organization", "colour": "red"}, "invalid_query"),
            ({"type": "Nope"}, "unknown_card_type"),
            (
                {"type": "Organization", "related": [{"relation": "x", "type": "Application"}]},
                "unknown_relation_type",
            ),
            (
                {
                    "type": "Organization",
                    "where": {"attributes": {"code": ["0b7d9a6e-1f1c-4a52-9b8a-3c2d1e0f9a8b"]}},
                },
                "query_holds_an_id",
            ),
            ({"type": "Organization", "where": {"data_quality_band": ["good"]}}, "unknown_band"),
        ],
    )
    async def test_a_bad_query_is_refused(self, client, db, query_env, query, code):
        resp = await _create(client, query_env["admin"], query=query)
        assert resp.status_code == 400
        assert resp.json()["detail"] == code

    async def test_a_contradicting_type_is_refused(self, client, db, query_env):
        resp = await _create(
            client,
            query_env["admin"],
            card_type="Organization",
            filters={"types": ["Application"]},
            query=ORG_QUERY,
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "query_type_mismatch"
        other = await _create(client, query_env["admin"], card_type="Application", query=ORG_QUERY)
        assert other.status_code == 400
        assert other.json()["detail"] == "query_type_mismatch"

    async def test_patch_null_clears_the_query(self, client, db, query_env):
        admin = query_env["admin"]
        bm_id = (await _create(client, admin, query=ORG_QUERY)).json()["id"]
        resp = await client.patch(
            f"/api/v1/bookmarks/{bm_id}", json={"query": None}, headers=auth_headers(admin)
        )
        assert resp.status_code == 200
        assert resp.json()["query"] is None
        assert resp.json()["card_type"] == "Organization"

    async def test_patch_a_query_renormalises_the_stored_view(self, client, db, query_env):
        admin = query_env["admin"]
        created = await _create(
            client,
            admin,
            card_type="Application",
            filters={"types": ["Application"], "groupBy": "subtype"},
        )
        bm_id = created.json()["id"]
        resp = await client.patch(
            f"/api/v1/bookmarks/{bm_id}", json={"query": ORG_QUERY}, headers=auth_headers(admin)
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["query"] == ORG_QUERY
        assert data["card_type"] == "Organization"
        # Another start type: the Application facets and grouping are reset.
        assert data["filters"] == base_view_filters("Organization")

    async def test_patch_a_query_on_the_same_type_keeps_the_facets(self, client, db, query_env):
        admin = query_env["admin"]
        created = await _create(
            client,
            admin,
            card_type="Organization",
            filters={"types": ["Organization"], "groupBy": "subtype", "groupTree": True},
        )
        bm_id = created.json()["id"]
        resp = await client.patch(
            f"/api/v1/bookmarks/{bm_id}", json={"query": ORG_QUERY}, headers=auth_headers(admin)
        )
        assert resp.status_code == 200
        assert resp.json()["filters"] == {
            "types": ["Organization"],
            "groupBy": "subtype",
            "groupTree": True,
        }

    async def test_patch_a_bad_query_is_refused(self, client, db, query_env):
        admin = query_env["admin"]
        bm_id = (await _create(client, admin, query=ORG_QUERY)).json()["id"]
        resp = await client.patch(
            f"/api/v1/bookmarks/{bm_id}",
            json={"query": {"type": "Nope"}},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "unknown_card_type"

    async def test_patch_contradicting_filters_on_a_query_view(self, client, db, query_env):
        admin = query_env["admin"]
        bm_id = (await _create(client, admin, query=ORG_QUERY)).json()["id"]
        resp = await client.patch(
            f"/api/v1/bookmarks/{bm_id}",
            json={"filters": {"types": ["Application"]}},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "query_type_mismatch"

    async def test_patch_layout_on_a_query_view_keeps_it_in_sync(self, client, db, query_env):
        admin = query_env["admin"]
        bm_id = (await _create(client, admin, query=ORG_QUERY)).json()["id"]
        resp = await client.patch(
            f"/api/v1/bookmarks/{bm_id}",
            json={"filters": {"groupBy": "name"}, "name": "Renamed"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["filters"] == {"groupBy": "name", "types": ["Organization"]}
        assert data["query"] == ORG_QUERY
        assert data["name"] == "Renamed"

    async def test_odata_feed_applies_the_query(self, client, db, query_env):
        admin = query_env["admin"]
        bm_id = (await _create(client, admin, query=ORG_QUERY, odata_enabled=True)).json()["id"]
        resp = await client.get(f"/api/v1/bookmarks/{bm_id}/odata", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert [row["name"] for row in resp.json()["value"]] == ["Corp"]
        assert resp.json()["@odata.count"] == 1

    async def test_odata_feed_refuses_a_query_naming_a_deleted_relation_type(
        self, client, db, query_env
    ):
        admin = query_env["admin"]
        bm_id = (await _create(client, admin, query=ORG_QUERY, odata_enabled=True)).json()["id"]
        rt = (
            await db.execute(select(RelationType).where(RelationType.key == "initAffectsApp"))
        ).scalar_one()
        await db.delete(rt)
        await db.flush()
        resp = await client.get(f"/api/v1/bookmarks/{bm_id}/odata", headers=auth_headers(admin))
        assert resp.status_code == 400
        assert resp.json()["detail"] == "unknown_relation_type"


EOL_QUERY = {
    "type": "Organization",
    "related": [
        {"relation": "orgUsesApp", "type": "Application", "where": {"eol_status": ["eol"]}}
    ],
}


class TestQueryViewEol:
    """A view filtering on end-of-life status (``where.eol_status``)."""

    @pytest.fixture
    async def eol_env(self, db, query_env, monkeypatch):
        """Alpha is linked to an end-of-life nginx cycle; the upstream fetch
        answers from a fixed list and records whether the request's session
        was still in a transaction."""
        from app.services import eol_service

        alpha = (await db.execute(select(Card).where(Card.name == "Alpha"))).scalar_one()
        alpha.attributes = {"eol_product": "nginx", "eol_cycle": "1.0"}
        await db.flush()
        held: list[bool] = []

        async def fake(products):
            held.append(db.in_transaction())
            cycles = {"nginx": [{"cycle": "1.0", "eol": True}]}
            return {p: cycles[p] for p in products if p in cycles}

        monkeypatch.setattr(eol_service, "fetch_cycles_for_products", fake)
        return {**query_env, "held": held}

    async def test_create_stores_the_condition_verbatim(self, client, db, eol_env):
        resp = await _create(client, eol_env["admin"], query=EOL_QUERY)
        assert resp.status_code == 201
        assert resp.json()["query"] == EOL_QUERY
        assert resp.json()["card_type"] == "Organization"
        # Saving evaluates nothing: no fetch.
        assert eol_env["held"] == []

    async def test_create_refuses_a_type_that_does_not_track_eol(self, client, db, eol_env):
        query = {"type": "Organization", "where": {"eol_status": ["eol"]}}
        resp = await _create(client, eol_env["admin"], query=query)
        assert resp.status_code == 400
        assert resp.json()["detail"] == "eol_not_tracked"

    async def test_odata_feed_applies_the_condition(self, client, db, eol_env):
        admin = eol_env["admin"]
        bm_id = (await _create(client, admin, query=EOL_QUERY, odata_enabled=True)).json()["id"]
        resp = await client.get(f"/api/v1/bookmarks/{bm_id}/odata", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert [row["name"] for row in resp.json()["value"]] == ["Corp"]
        assert resp.json()["@odata.count"] == 1
        # The connection was handed back before the outbound fetch.
        assert eol_env["held"] == [False]

    async def test_odata_feed_needs_eol_view(self, client, db, eol_env):
        admin = eol_env["admin"]
        body = {"query": EOL_QUERY, "odata_enabled": True, "visibility": "public"}
        bm_id = (await _create(client, admin, **body)).json()["id"]
        await create_role(
            db, key="no_eol", label="No EOL", permissions={**VIEWER_PERMISSIONS, "eol.view": False}
        )
        reader = await create_user(db, email="no-eol@test.com", role="no_eol")
        resp = await client.get(f"/api/v1/bookmarks/{bm_id}/odata", headers=auth_headers(reader))
        assert resp.status_code == 403
        assert resp.json()["detail"] == "eol_view_required"
        assert eol_env["held"] == []
        # Control: the viewer role, which holds eol.view, reads the feed.
        viewer = eol_env["viewer"]
        ok = await client.get(f"/api/v1/bookmarks/{bm_id}/odata", headers=auth_headers(viewer))
        assert ok.status_code == 200
        assert [row["name"] for row in ok.json()["value"]] == ["Corp"]


class TestQueryViewEolWrite:
    """Saving a view that holds an ``eol_status`` condition needs ``eol.view``,
    the permission evaluating it needs: create, patch, and a collaborator's
    edit of a shared view that already holds it."""

    @pytest.fixture
    async def no_eol(self, db, query_env):
        """A viewer-like role without ``eol.view``; the plain ``viewer`` role
        (which holds it) is the control."""
        await create_role(
            db,
            key="no_eol",
            label="No EOL",
            # bookmarks.share: a collaborator's edit of a shared view needs it.
            permissions={**VIEWER_PERMISSIONS, "eol.view": False, "bookmarks.share": True},
        )
        return await create_user(db, email="no-eol-writer@test.com", role="no_eol")

    async def test_create_is_refused_without_eol_view(self, client, db, query_env, no_eol):
        resp = await _create(client, no_eol, query=EOL_QUERY)
        assert resp.status_code == 403
        assert resp.json()["detail"] == "eol_view_required"
        assert (await db.execute(select(Bookmark))).scalars().all() == []

    async def test_empty_alone_is_refused_too(self, client, db, query_env, no_eol):
        hop = {**EOL_QUERY["related"][0], "where": {"eol_status": ["__empty__"]}}
        resp = await _create(client, no_eol, query={**EOL_QUERY, "related": [hop]})
        assert resp.status_code == 403
        assert resp.json()["detail"] == "eol_view_required"

    async def test_create_is_allowed_with_eol_view(self, client, db, query_env, no_eol):
        resp = await _create(client, query_env["viewer"], query=EOL_QUERY)
        assert resp.status_code == 201
        assert resp.json()["query"] == EOL_QUERY
        # The same writer without the permission saves a query without it.
        plain = await _create(client, no_eol, query=QUERY_WITHOUT_EOL)
        assert plain.status_code == 201

    async def test_patch_is_refused_without_eol_view(self, client, db, query_env, no_eol):
        bm_id = (await _create(client, no_eol, query=QUERY_WITHOUT_EOL)).json()["id"]
        resp = await client.patch(
            f"/api/v1/bookmarks/{bm_id}", json={"query": EOL_QUERY}, headers=auth_headers(no_eol)
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == "eol_view_required"
        stored = await db.get(Bookmark, uuid.UUID(bm_id))
        await db.refresh(stored)
        assert stored.query == QUERY_WITHOUT_EOL

    async def test_patch_is_allowed_with_eol_view(self, client, db, query_env, no_eol):
        viewer = query_env["viewer"]
        bm_id = (await _create(client, viewer, query=QUERY_WITHOUT_EOL)).json()["id"]
        resp = await client.patch(
            f"/api/v1/bookmarks/{bm_id}", json={"query": EOL_QUERY}, headers=auth_headers(viewer)
        )
        assert resp.status_code == 200
        assert resp.json()["query"] == EOL_QUERY

    async def test_a_collaborator_editing_a_shared_eol_view_needs_it(
        self, client, db, query_env, no_eol
    ):
        """The stored query grants nothing: unlike an owner's pick, the
        condition already in the view does not exempt the collaborator."""
        resp = await _create(
            client,
            query_env["admin"],
            query=EOL_QUERY,
            visibility="shared",
            shared_with=[{"user_id": str(no_eol.id), "can_edit": True}],
        )
        assert resp.status_code == 201, resp.text
        bm_id = resp.json()["id"]
        refused = await client.patch(
            f"/api/v1/bookmarks/{bm_id}", json={"query": EOL_QUERY}, headers=auth_headers(no_eol)
        )
        assert refused.status_code == 403
        assert refused.json()["detail"] == "eol_view_required"
        # Control: the same collaborator may take the condition out.
        edited = await client.patch(
            f"/api/v1/bookmarks/{bm_id}",
            json={"query": QUERY_WITHOUT_EOL},
            headers=auth_headers(no_eol),
        )
        assert edited.status_code == 200, edited.text
        assert edited.json()["query"] == QUERY_WITHOUT_EOL


#: ``EOL_QUERY`` without its condition.
QUERY_WITHOUT_EOL = {
    "type": "Organization",
    "related": [{"relation": "orgUsesApp", "type": "Application"}],
}


@pytest.fixture
async def tag_env(db, query_env):
    """On top of ``query_env``: Alpha carries Gold, Beta carries Silver (group
    Tier, Application only); group Hq (Organization only) holds Main."""
    apps = {
        c.name: c
        for c in (await db.execute(select(Card).where(Card.type == "Application"))).scalars()
    }
    tier = await create_tag_group(db, name="Tier", restrict_to_types=["Application"])
    hq = await create_tag_group(db, name="Hq", restrict_to_types=["Organization"])
    tags = {
        "Gold": await create_tag(db, group=tier, name="Gold", cards=[apps["Alpha"]]),
        "Silver": await create_tag(db, group=tier, name="Silver", cards=[apps["Beta"]]),
        "Main": await create_tag(db, group=hq, name="Main"),
    }
    return {**query_env, "tags": {k: str(v.id) for k, v in tags.items()}}


def _tag_query(*tag_ids: str) -> dict:
    """Organizations that use an Application carrying any of ``tag_ids``."""
    return {
        "type": "Organization",
        "related": [
            {"relation": "orgUsesApp", "type": "Application", "where": {"tags": list(tag_ids)}}
        ],
    }


class TestQueryViewTags:
    async def test_create_stores_the_tags_verbatim(self, client, db, tag_env):
        query = _tag_query(tag_env["tags"]["Silver"], tag_env["tags"]["Gold"])
        resp = await _create(client, tag_env["admin"], query=query)
        assert resp.status_code == 201, resp.text
        assert resp.json()["query"] == query
        stored = await db.get(Bookmark, uuid.UUID(resp.json()["id"]))
        assert stored.query == query

    async def test_a_tag_of_a_group_for_other_types_is_refused(self, client, db, tag_env):
        resp = await _create(client, tag_env["admin"], query=_tag_query(tag_env["tags"]["Main"]))
        assert resp.status_code == 400
        assert resp.json()["detail"] == "tag_not_for_type"

    async def test_an_unknown_tag_is_refused(self, client, db, tag_env):
        resp = await _create(client, tag_env["admin"], query=_tag_query(str(uuid.uuid4())))
        assert resp.status_code == 400
        assert resp.json()["detail"] == "unknown_tag"

    async def test_patch_to_a_tag_query_is_checked(self, client, db, tag_env):
        admin = tag_env["admin"]
        bm_id = (await _create(client, admin, query=ORG_QUERY)).json()["id"]
        bad = await client.patch(
            f"/api/v1/bookmarks/{bm_id}",
            json={"query": _tag_query(tag_env["tags"]["Main"])},
            headers=auth_headers(admin),
        )
        assert bad.status_code == 400
        assert bad.json()["detail"] == "tag_not_for_type"
        query = _tag_query(tag_env["tags"]["Gold"])
        ok = await client.patch(
            f"/api/v1/bookmarks/{bm_id}", json={"query": query}, headers=auth_headers(admin)
        )
        assert ok.status_code == 200
        assert ok.json()["query"] == query

    async def test_odata_feed_applies_the_tags(self, client, db, tag_env):
        admin = tag_env["admin"]
        for tag, names in (("Silver", ["Team"]), ("Gold", ["Corp"])):
            bm_id = (
                await _create(
                    client, admin, query=_tag_query(tag_env["tags"][tag]), odata_enabled=True
                )
            ).json()["id"]
            resp = await client.get(f"/api/v1/bookmarks/{bm_id}/odata", headers=auth_headers(admin))
            assert resp.status_code == 200
            assert [row["name"] for row in resp.json()["value"]] == names
            assert resp.json()["@odata.count"] == 1


async def _card_ids(db) -> dict[str, str]:
    rows = await db.execute(select(Card.name, Card.id))
    return {name: str(card_id) for name, card_id in rows.all()}


def _cards_query(app_ids: list[str], **where) -> dict:
    """Organizations that use one of the Applications ``app_ids``."""
    return {
        "type": "Organization",
        "related": [
            {
                "relation": "orgUsesApp",
                "type": "Application",
                "where": {"cards": app_ids, **where},
            }
        ],
    }


async def _deny_viewer(db, type_key: str) -> None:
    ct = (await db.execute(select(CardType).where(CardType.key == type_key))).scalar_one()
    ct.role_permissions = {"viewer": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()


class TestQueryViewCards:
    async def test_create_stores_the_cards_and_the_flag_verbatim(self, client, db, query_env):
        ids = await _card_ids(db)
        query = {
            **_cards_query([ids["Beta"], ids["Alpha"]], include_descendants=True),
            "where": {"cards": [ids["Corp"]]},
        }
        resp = await _create(client, query_env["admin"], query=query)
        assert resp.status_code == 201, resp.text
        assert resp.json()["query"] == query
        stored = await db.get(Bookmark, uuid.UUID(resp.json()["id"]))
        assert stored.query == query

    @pytest.mark.parametrize("pick", ["missing", "Corp", "not-a-uuid"])
    async def test_an_unknown_or_wrong_type_card_is_refused(self, client, db, query_env, pick):
        ids = await _card_ids(db)
        value = {"missing": str(uuid.uuid4()), "Corp": ids["Corp"]}.get(pick, pick)
        resp = await _create(client, query_env["admin"], query=_cards_query([value]))
        assert resp.status_code == 400
        assert resp.json()["detail"] == "unknown_card"

    async def test_the_flag_without_cards_is_refused(self, client, db, query_env):
        query = {"type": "Organization", "where": {"include_descendants": True}}
        resp = await _create(client, query_env["admin"], query=query)
        assert resp.status_code == 400
        assert resp.json()["detail"] == "descendants_without_cards"

    async def test_a_writer_cannot_pin_a_card_hidden_from_them(self, client, db, query_env):
        ids = await _card_ids(db)
        await _deny_viewer(db, "Application")
        viewer = query_env["viewer"]
        resp = await _create(client, viewer, query=_cards_query([ids["Alpha"]]))
        assert resp.status_code == 400
        assert resp.json()["detail"] == "unknown_card"
        assert "Alpha" not in resp.text
        # Control: a card they can read is accepted, and so is the hidden one
        # for the admin.
        ok = {"type": "Organization", "where": {"cards": [ids["Corp"]]}}
        assert (await _create(client, viewer, query=ok)).status_code == 201
        admin = await _create(client, query_env["admin"], query=_cards_query([ids["Alpha"]]))
        assert admin.status_code == 201

    async def test_a_patch_cannot_pin_a_card_hidden_from_the_writer(self, client, db, query_env):
        ids = await _card_ids(db)
        await _deny_viewer(db, "Application")
        viewer = query_env["viewer"]
        bm_id = (await _create(client, viewer, query={"type": "Organization", "where": {}})).json()[
            "id"
        ]
        resp = await client.patch(
            f"/api/v1/bookmarks/{bm_id}",
            json={"query": _cards_query([ids["Alpha"]])},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "unknown_card"
        ok = {"type": "Organization", "where": {"cards": [ids["Team"]]}}
        patched = await client.patch(
            f"/api/v1/bookmarks/{bm_id}", json={"query": ok}, headers=auth_headers(viewer)
        )
        assert patched.status_code == 200
        assert patched.json()["query"] == ok

    async def test_odata_feed_applies_the_cards(self, client, db, query_env):
        ids = await _card_ids(db)
        admin = query_env["admin"]
        for picked, names in (
            (["Beta"], ["Team"]),
            (["Alpha", "Beta"], ["Corp", "Team"]),
        ):
            query = _cards_query([ids[n] for n in picked])
            bm_id = (await _create(client, admin, query=query, odata_enabled=True)).json()["id"]
            resp = await client.get(f"/api/v1/bookmarks/{bm_id}/odata", headers=auth_headers(admin))
            assert resp.status_code == 200
            assert [row["name"] for row in resp.json()["value"]] == names
            assert resp.json()["@odata.count"] == len(names)

    async def test_odata_feed_applies_a_start_pick(self, client, db, query_env):
        ids = await _card_ids(db)
        admin = query_env["admin"]
        query = {"type": "Organization", "where": {"cards": [ids["Solo"], ids["Team"]]}}
        bm_id = (await _create(client, admin, query=query, odata_enabled=True)).json()["id"]
        resp = await client.get(f"/api/v1/bookmarks/{bm_id}/odata", headers=auth_headers(admin))
        assert [row["name"] for row in resp.json()["value"]] == ["Solo", "Team"]


class TestQueryViewCollaborators:
    """A ``can_edit`` collaborator who cannot read the owner's pick can still
    edit the view around it, but cannot add a pick hidden from them."""

    async def _shared_view(self, client, db, query_env, query=None):
        ids = await _card_ids(db)
        await create_role(
            db,
            key="collab",
            label="Collab",
            permissions={
                "inventory.view": True,
                "bookmarks.manage": True,
                "bookmarks.share": True,
            },
        )
        collab = await create_user(db, email="collab@test.com", role="collab")
        ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
        ct.role_permissions = {"collab": {"inventory.view": False}}
        await db.flush()
        PermissionService.invalidate_type_permission_cache()
        resp = await _create(
            client,
            query_env["admin"],
            query=query(ids) if query else _cards_query([ids["Alpha"]]),
            visibility="shared",
            shared_with=[{"user_id": str(collab.id), "can_edit": True}],
        )
        assert resp.status_code == 201, resp.text
        return ids, collab, resp.json()["id"]

    async def test_keeps_the_owners_hidden_pick_while_editing(self, client, db, query_env):
        ids, collab, bm_id = await self._shared_view(client, db, query_env)
        query = _cards_query([ids["Alpha"]], lifecycle_phase=["active"])
        resp = await client.patch(
            f"/api/v1/bookmarks/{bm_id}", json={"query": query}, headers=auth_headers(collab)
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["query"] == query
        stored = await db.get(Bookmark, uuid.UUID(bm_id))
        assert stored.query == query

    async def test_cannot_add_a_new_hidden_pick(self, client, db, query_env):
        ids, collab, bm_id = await self._shared_view(client, db, query_env)
        resp = await client.patch(
            f"/api/v1/bookmarks/{bm_id}",
            json={"query": _cards_query([ids["Alpha"], ids["Beta"]])},
            headers=auth_headers(collab),
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "unknown_card"
        assert "Beta" not in resp.text

    async def test_the_owners_pick_is_trusted_only_where_it_names_a_card(
        self, client, db, query_env
    ):
        """Trust skips the read check, never the type check: the owner's
        Application pick moved to the Organization start is refused."""
        ids, collab, bm_id = await self._shared_view(client, db, query_env)
        moved = {"type": "Organization", "where": {"cards": [ids["Alpha"]]}}
        resp = await client.patch(
            f"/api/v1/bookmarks/{bm_id}", json={"query": moved}, headers=auth_headers(collab)
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "unknown_card"

    async def test_keeps_the_owners_hidden_pick_on_a_later_line(self, client, db, query_env):
        def stack(ids, **where):
            return {
                "any_of": [
                    {"type": "Initiative"},
                    _cards_query([ids["Alpha"]], **where),
                ]
            }

        ids, collab, bm_id = await self._shared_view(client, db, query_env, stack)
        edited = stack(ids, lifecycle_phase=["active"])
        resp = await client.patch(
            f"/api/v1/bookmarks/{bm_id}", json={"query": edited}, headers=auth_headers(collab)
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["query"] == edited
        added = {"any_of": [{"type": "Initiative"}, _cards_query([ids["Alpha"], ids["Beta"]])]}
        refused = await client.patch(
            f"/api/v1/bookmarks/{bm_id}", json={"query": added}, headers=auth_headers(collab)
        )
        assert refused.status_code == 400
        assert refused.json()["detail"] == "unknown_card"


class TestQueryViewScopeLoad:
    """The writer's read scope is loaded only for a query that picks a card."""

    @pytest.fixture
    def loads(self, monkeypatch):
        calls: list[object] = []
        load = CardReadScope.load

        async def spy(db, user, *args, **kwargs):
            calls.append(user)
            return await load(db, user, *args, **kwargs)

        monkeypatch.setattr(CardReadScope, "load", spy)
        return calls

    async def test_a_tag_query_loads_no_scope(self, client, db, tag_env, loads):
        admin = tag_env["admin"]
        resp = await _create(client, admin, query=_tag_query(tag_env["tags"]["Gold"]))
        assert resp.status_code == 201, resp.text
        patched = await client.patch(
            f"/api/v1/bookmarks/{resp.json()['id']}",
            json={"query": _tag_query(tag_env["tags"]["Silver"])},
            headers=auth_headers(admin),
        )
        assert patched.status_code == 200, patched.text
        assert loads == []

    async def test_a_cards_query_loads_the_scope(self, client, db, query_env, loads):
        ids = await _card_ids(db)
        admin = query_env["admin"]
        resp = await _create(client, admin, query=_cards_query([ids["Alpha"]]))
        assert resp.status_code == 201, resp.text
        assert len(loads) == 1
        patched = await client.patch(
            f"/api/v1/bookmarks/{resp.json()['id']}",
            json={"query": _cards_query([ids["Beta"]])},
            headers=auth_headers(admin),
        )
        assert patched.status_code == 200, patched.text
        assert len(loads) == 2


APP_AFFECTED = {
    "type": "Application",
    "related": [{"relation": "initAffectsApp", "type": "Initiative"}],
}
APP_USED = {
    "type": "Application",
    "related": [{"relation": "orgUsesApp", "type": "Organization"}],
}
ORG_USES = {
    "type": "Organization",
    "related": [{"relation": "orgUsesApp", "type": "Application"}],
}
TWO_TYPE_STACK = {"any_of": [APP_AFFECTED, ORG_USES]}


class TestQueryViewStacks:
    async def test_create_stores_the_stack_on_both_types(self, client, db, query_env):
        resp = await _create(
            client, query_env["admin"], filters={"groupBy": "subtype"}, query=TWO_TYPE_STACK
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["query"] == TWO_TYPE_STACK
        assert data["card_type"] is None
        assert data["filters"] == {"groupBy": "subtype", "types": ["Application", "Organization"]}
        stored = await db.get(Bookmark, uuid.UUID(data["id"]))
        assert stored.query == TWO_TYPE_STACK
        assert stored.card_type is None

    async def test_a_single_type_all_of_sets_the_card_type(self, client, db, query_env):
        query = {"all_of": [APP_AFFECTED, APP_USED]}
        resp = await _create(client, query_env["admin"], query=query)
        assert resp.status_code == 201, resp.text
        assert resp.json()["query"] == query
        assert resp.json()["card_type"] == "Application"
        assert resp.json()["filters"] == {"types": ["Application"]}

    @pytest.mark.parametrize(
        "body",
        [
            {"card_type": "Application"},
            {"filters": {"types": ["Application"]}},
            {"filters": {"types": ["Application", "Initiative"]}},
        ],
    )
    async def test_a_contradicting_type_is_refused(self, client, db, query_env, body):
        resp = await _create(client, query_env["admin"], query=TWO_TYPE_STACK, **body)
        assert resp.status_code == 400
        assert resp.json()["detail"] == "query_type_mismatch"

    @pytest.mark.parametrize(
        ("query", "code"),
        [
            ({"any_of": [ORG_USES]}, "any_of_needs_two"),
            ({"all_of": [ORG_USES, APP_USED]}, "all_of_type_mismatch"),
            ({"any_of": [ORG_USES, {"type": "Nope"}]}, "unknown_card_type"),
        ],
    )
    async def test_a_bad_stack_is_refused(self, client, db, query_env, query, code):
        resp = await _create(client, query_env["admin"], query=query)
        assert resp.status_code == 400
        assert resp.json()["detail"] == code

    async def test_patch_from_one_type_to_two_resets_the_facets(self, client, db, query_env):
        admin = query_env["admin"]
        created = await _create(
            client, admin, query=ORG_QUERY, filters={"types": ["Organization"], "groupBy": "x"}
        )
        bm_id = created.json()["id"]
        resp = await client.patch(
            f"/api/v1/bookmarks/{bm_id}",
            json={"query": TWO_TYPE_STACK},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["query"] == TWO_TYPE_STACK
        assert data["card_type"] is None
        assert data["filters"] == base_view_filters(["Application", "Organization"])

    async def test_patch_within_the_same_types_keeps_the_facets(self, client, db, query_env):
        admin = query_env["admin"]
        created = await _create(
            client, admin, query=TWO_TYPE_STACK, filters={"groupBy": "x", "search": "a"}
        )
        bm_id = created.json()["id"]
        swapped = {"any_of": [ORG_USES, APP_USED]}
        resp = await client.patch(
            f"/api/v1/bookmarks/{bm_id}", json={"query": swapped}, headers=auth_headers(admin)
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["filters"] == {
            "groupBy": "x",
            "search": "a",
            "types": ["Organization", "Application"],
        }
        assert resp.json()["card_type"] is None

    async def test_odata_feed_over_two_card_types(self, client, db, query_env):
        admin = query_env["admin"]
        created = await _create(client, admin, query=TWO_TYPE_STACK, odata_enabled=True)
        bm_id = created.json()["id"]
        resp = await client.get(f"/api/v1/bookmarks/{bm_id}/odata", headers=auth_headers(admin))
        assert resp.status_code == 200
        rows = resp.json()["value"]
        assert [(row["type"], row["name"]) for row in rows] == [
            ("Application", "Alpha"),
            ("Organization", "Corp"),
            ("Organization", "Team"),
        ]
        assert resp.json()["@odata.count"] == 3

    async def test_odata_feed_of_an_and_group(self, client, db, query_env):
        admin = query_env["admin"]
        query = {"all_of": [APP_AFFECTED, APP_USED]}
        created = await _create(client, admin, query=query, odata_enabled=True)
        resp = await client.get(
            f"/api/v1/bookmarks/{created.json()['id']}/odata", headers=auth_headers(admin)
        )
        assert [row["name"] for row in resp.json()["value"]] == ["Alpha"]
        assert resp.json()["@odata.count"] == 1

    async def test_odata_feed_hides_a_denied_groups_type(self, client, db, query_env):
        """The viewer is denied Application: the feed of a public two-type
        view lists only the Organizations, and none through a hidden app."""
        admin = query_env["admin"]
        created = await _create(
            client, admin, query=TWO_TYPE_STACK, odata_enabled=True, visibility="public"
        )
        await _deny_viewer(db, "Application")
        resp = await client.get(
            f"/api/v1/bookmarks/{created.json()['id']}/odata",
            headers=auth_headers(query_env["viewer"]),
        )
        assert resp.status_code == 200
        assert resp.json()["value"] == []
        assert resp.json()["@odata.count"] == 0
        org_only = {"any_of": [APP_AFFECTED, {"type": "Organization"}]}
        other = await _create(
            client, admin, query=org_only, odata_enabled=True, visibility="public"
        )
        resp = await client.get(
            f"/api/v1/bookmarks/{other.json()['id']}/odata",
            headers=auth_headers(query_env["viewer"]),
        )
        assert [row["name"] for row in resp.json()["value"]] == ["Corp", "Solo", "Team"]
