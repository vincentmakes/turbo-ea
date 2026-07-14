"""Integration tests for the /relations endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.permissions import VIEWER_PERMISSIONS
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
async def rel_env(db):
    """Prerequisite data for relation tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions=VIEWER_PERMISSIONS,
    )
    app_type = await create_card_type(db, key="Application", label="Application")
    itc_type = await create_card_type(db, key="ITComponent", label="IT Component")
    rt = await create_relation_type(
        db,
        key="app_to_itc",
        label="Uses",
        source_type_key="Application",
        target_type_key="ITComponent",
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    source = await create_card(
        db,
        card_type="Application",
        name="Source App",
        user_id=admin.id,
    )
    target = await create_card(
        db,
        card_type="ITComponent",
        name="Target ITC",
        user_id=admin.id,
    )
    return {
        "admin": admin,
        "viewer": viewer,
        "app_type": app_type,
        "itc_type": itc_type,
        "rt": rt,
        "source": source,
        "target": target,
    }


# ---------------------------------------------------------------
# POST /relations  (create)
# ---------------------------------------------------------------


class TestCreateRelation:
    async def test_admin_can_create(self, client, db, rel_env):
        admin = rel_env["admin"]
        resp = await client.post(
            "/api/v1/relations",
            json={
                "type": "app_to_itc",
                "source_id": str(rel_env["source"].id),
                "target_id": str(rel_env["target"].id),
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["type"] == "app_to_itc"
        assert data["source"]["name"] == "Source App"
        assert data["target"]["name"] == "Target ITC"

    async def test_create_with_attributes_round_trips(self, client, db, rel_env):
        """Creating a relation with `attributes` persists them as-is so the
        flowDirection editor in the UI can read the value back after a
        page reload. The endpoint does not need to know about the
        flowDirection key — it just stores the JSONB blob."""
        admin = rel_env["admin"]
        resp = await client.post(
            "/api/v1/relations",
            json={
                "type": "app_to_itc",
                "source_id": str(rel_env["source"].id),
                "target_id": str(rel_env["target"].id),
                "attributes": {"flowDirection": "forward"},
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        rel_id = resp.json()["id"]

        get_resp = await client.get(
            f"/api/v1/relations?card_id={rel_env['source'].id}",
            headers=auth_headers(admin),
        )
        match = next(r for r in get_resp.json() if r["id"] == rel_id)
        assert match["attributes"] == {"flowDirection": "forward"}

    async def test_viewer_cannot_create(self, client, db, rel_env):
        viewer = rel_env["viewer"]
        resp = await client.post(
            "/api/v1/relations",
            json={
                "type": "app_to_itc",
                "source_id": str(rel_env["source"].id),
                "target_id": str(rel_env["target"].id),
            },
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------
# GET /relations  (list)
# ---------------------------------------------------------------


class TestListRelations:
    async def test_list_returns_relations(self, client, db, rel_env):
        admin = rel_env["admin"]
        await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_env["source"].id,
            target_id=rel_env["target"].id,
        )
        resp = await client.get(
            "/api/v1/relations",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert data[0]["type"] == "app_to_itc"

    async def test_filter_by_card_id(self, client, db, rel_env):
        admin = rel_env["admin"]
        await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_env["source"].id,
            target_id=rel_env["target"].id,
        )
        resp = await client.get(
            f"/api/v1/relations?card_id={rel_env['source'].id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert len(resp.json()) >= 1

    async def test_viewer_can_list(self, client, db, rel_env):
        viewer = rel_env["viewer"]
        resp = await client.get(
            "/api/v1/relations",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 200

    async def test_list_includes_target_subtype(self, client, db, rel_env):
        """The relation payload embeds the source/target card's `subtype` so
        the card-detail Relations panel can group related cards by subtype
        (#792). A target without a subtype still exposes the key as null."""
        admin = rel_env["admin"]
        typed_target = await create_card(
            db,
            card_type="ITComponent",
            name="Typed ITC",
            subtype="Software",
            user_id=admin.id,
        )
        await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_env["source"].id,
            target_id=typed_target.id,
        )
        await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_env["source"].id,
            target_id=rel_env["target"].id,
        )
        resp = await client.get(
            f"/api/v1/relations?card_id={rel_env['source'].id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        by_name = {r["target"]["name"]: r["target"] for r in resp.json()}
        assert by_name["Typed ITC"]["subtype"] == "Software"
        # Card created without a subtype: key present, value null.
        assert "subtype" in by_name["Target ITC"]
        assert by_name["Target ITC"]["subtype"] is None


# ---------------------------------------------------------------
# PATCH /relations/{id}  (update)
# ---------------------------------------------------------------


class TestUpdateRelation:
    async def test_update_attributes(self, client, db, rel_env):
        admin = rel_env["admin"]
        rel = await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_env["source"].id,
            target_id=rel_env["target"].id,
        )
        resp = await client.patch(
            f"/api/v1/relations/{rel.id}",
            json={"description": "Updated desc"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["description"] == "Updated desc"

    async def test_patch_attributes_replaces_value(self, client, db, rel_env):
        """PATCH with attributes replaces the JSONB blob — the popover
        on the relation row uses this to flip flowDirection between
        bidirectional / forward / reverse."""
        admin = rel_env["admin"]
        rel = await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_env["source"].id,
            target_id=rel_env["target"].id,
            attributes={"flowDirection": "forward"},
        )
        resp = await client.patch(
            f"/api/v1/relations/{rel.id}",
            json={"attributes": {"flowDirection": "bidirectional"}},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["attributes"] == {"flowDirection": "bidirectional"}

    async def test_update_nonexistent_returns_404(self, client, db, rel_env):
        admin = rel_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.patch(
            f"/api/v1/relations/{fake_id}",
            json={"description": "nope"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_viewer_cannot_update(self, client, db, rel_env):
        viewer = rel_env["viewer"]
        rel = await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_env["source"].id,
            target_id=rel_env["target"].id,
        )
        resp = await client.patch(
            f"/api/v1/relations/{rel.id}",
            json={"description": "hack"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------
# DELETE /relations/{id}
# ---------------------------------------------------------------


class TestDeleteRelation:
    async def test_admin_can_delete(self, client, db, rel_env):
        admin = rel_env["admin"]
        rel = await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_env["source"].id,
            target_id=rel_env["target"].id,
        )
        resp = await client.delete(
            f"/api/v1/relations/{rel.id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

    async def test_delete_nonexistent_returns_404(self, client, db, rel_env):
        admin = rel_env["admin"]
        resp = await client.delete(
            f"/api/v1/relations/{uuid.uuid4()}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_viewer_cannot_delete(self, client, db, rel_env):
        viewer = rel_env["viewer"]
        rel = await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_env["source"].id,
            target_id=rel_env["target"].id,
        )
        resp = await client.delete(
            f"/api/v1/relations/{rel.id}",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403
