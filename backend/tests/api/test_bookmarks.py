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
from app.models.relation_type import RelationType
from app.services.card_query import base_view_filters
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
    await create_card_type(db, key="Organization", label="Organization")
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="Initiative", label="Initiative")
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
