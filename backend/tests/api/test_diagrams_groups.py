"""Integration tests for the Diagrams gallery redesign:
filtering/search, per-user favorites, and custom groups.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_card,
    create_role,
    create_user,
)


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin", display_name="Ada Admin")
    member = await create_user(
        db, email="member@test.com", role="member", display_name="Mel Member"
    )
    viewer = await create_user(
        db, email="viewer@test.com", role="viewer", display_name="Val Viewer"
    )
    return {"admin": admin, "member": member, "viewer": viewer}


async def _create(client, user, **body):
    body.setdefault("data", {})
    resp = await client.post("/api/v1/diagrams", json=body, headers=auth_headers(user))
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


# -------------------------------------------------------------------
# Filtering & search
# -------------------------------------------------------------------


class TestListFilters:
    async def test_list_includes_author_and_favorite_flag(self, client, db, env):
        admin = env["admin"]
        await _create(client, admin, name="Alpha")
        resp = await client.get("/api/v1/diagrams", headers=auth_headers(admin))
        assert resp.status_code == 200
        row = resp.json()[0]
        assert row["created_by_name"] == "Ada Admin"
        assert row["is_favorite"] is False
        assert row["group_ids"] == []

    async def test_mine_filter(self, client, db, env):
        admin, member = env["admin"], env["member"]
        await _create(client, admin, name="By Admin")
        await _create(client, member, name="By Member")

        resp = await client.get("/api/v1/diagrams?mine=true", headers=auth_headers(member))
        names = [d["name"] for d in resp.json()]
        assert names == ["By Member"]

    async def test_search_by_name_and_author(self, client, db, env):
        admin, member = env["admin"], env["member"]
        await _create(client, admin, name="Payment Landscape")
        await _create(client, member, name="Logistics")

        by_name = await client.get("/api/v1/diagrams?search=payment", headers=auth_headers(admin))
        assert [d["name"] for d in by_name.json()] == ["Payment Landscape"]

        # Author search matches Mel Member's diagram only.
        by_author = await client.get("/api/v1/diagrams?search=mel", headers=auth_headers(admin))
        assert [d["name"] for d in by_author.json()] == ["Logistics"]

    async def test_search_by_contained_card(self, client, db, env):
        admin = env["admin"]
        card = await create_card(db, name="NexaCore ERP", user_id=admin.id)
        xml = f'<mxGraphModel><object cardId="{card.id}" /></mxGraphModel>'
        await _create(client, admin, name="Has The Card", data={"xml": xml})
        await _create(client, admin, name="Empty One")

        resp = await client.get("/api/v1/diagrams?search=nexacore", headers=auth_headers(admin))
        assert [d["name"] for d in resp.json()] == ["Has The Card"]

    async def test_sort_by_name(self, client, db, env):
        admin = env["admin"]
        await _create(client, admin, name="Zeta")
        await _create(client, admin, name="Alpha")
        resp = await client.get(
            "/api/v1/diagrams?sort_by=name&sort_dir=asc", headers=auth_headers(admin)
        )
        assert [d["name"] for d in resp.json()] == ["Alpha", "Zeta"]


# -------------------------------------------------------------------
# Favorites
# -------------------------------------------------------------------


class TestFavorites:
    async def test_add_list_and_filter(self, client, db, env):
        admin = env["admin"]
        did = await _create(client, admin, name="Fav Me")
        await _create(client, admin, name="Not Fav")

        add = await client.post(f"/api/v1/diagrams/{did}/favorite", headers=auth_headers(admin))
        assert add.status_code == 201

        favs = await client.get("/api/v1/diagrams/favorites", headers=auth_headers(admin))
        assert favs.json() == [did]

        filtered = await client.get("/api/v1/diagrams?favorites=true", headers=auth_headers(admin))
        rows = filtered.json()
        assert [d["name"] for d in rows] == ["Fav Me"]
        assert rows[0]["is_favorite"] is True

    async def test_add_is_idempotent(self, client, db, env):
        admin = env["admin"]
        did = await _create(client, admin, name="Fav")
        await client.post(f"/api/v1/diagrams/{did}/favorite", headers=auth_headers(admin))
        again = await client.post(f"/api/v1/diagrams/{did}/favorite", headers=auth_headers(admin))
        assert again.status_code == 201
        assert again.json()["status"] == "already_favorited"

    async def test_favorites_are_per_user(self, client, db, env):
        admin, member = env["admin"], env["member"]
        did = await _create(client, admin, name="Shared")
        await client.post(f"/api/v1/diagrams/{did}/favorite", headers=auth_headers(admin))

        member_favs = await client.get("/api/v1/diagrams/favorites", headers=auth_headers(member))
        assert member_favs.json() == []

    async def test_remove(self, client, db, env):
        admin = env["admin"]
        did = await _create(client, admin, name="Toggle")
        await client.post(f"/api/v1/diagrams/{did}/favorite", headers=auth_headers(admin))
        rm = await client.delete(f"/api/v1/diagrams/{did}/favorite", headers=auth_headers(admin))
        assert rm.status_code == 204
        favs = await client.get("/api/v1/diagrams/favorites", headers=auth_headers(admin))
        assert favs.json() == []

    async def test_remove_missing_returns_404(self, client, db, env):
        admin = env["admin"]
        did = await _create(client, admin, name="Never Faved")
        rm = await client.delete(f"/api/v1/diagrams/{did}/favorite", headers=auth_headers(admin))
        assert rm.status_code == 404


# -------------------------------------------------------------------
# Groups
# -------------------------------------------------------------------


class TestGroups:
    async def test_crud_and_membership(self, client, db, env):
        admin = env["admin"]
        did = await _create(client, admin, name="Diag")

        created = await client.post(
            "/api/v1/diagram-groups",
            json={"name": "Domain A", "color": "#60a5fa"},
            headers=auth_headers(admin),
        )
        assert created.status_code == 201
        group_id = created.json()["id"]
        assert created.json()["diagram_count"] == 0

        # Assign membership (multi-group put).
        put = await client.put(
            f"/api/v1/diagrams/{did}/groups",
            json={"group_ids": [group_id]},
            headers=auth_headers(admin),
        )
        assert put.status_code == 200
        assert put.json()["group_ids"] == [group_id]

        # Group list now reports the count.
        listing = await client.get("/api/v1/diagram-groups", headers=auth_headers(admin))
        assert listing.json()[0]["diagram_count"] == 1

        # Diagram list + detail expose group_ids; group_id filter works.
        by_group = await client.get(
            f"/api/v1/diagrams?group_id={group_id}", headers=auth_headers(admin)
        )
        assert [d["name"] for d in by_group.json()] == ["Diag"]

        detail = await client.get(f"/api/v1/diagrams/{did}", headers=auth_headers(admin))
        assert detail.json()["group_ids"] == [group_id]

    async def test_update_group(self, client, db, env):
        admin = env["admin"]
        created = await client.post(
            "/api/v1/diagram-groups",
            json={"name": "Old"},
            headers=auth_headers(admin),
        )
        sid = created.json()["id"]
        upd = await client.patch(
            f"/api/v1/diagram-groups/{sid}",
            json={"name": "New", "color": "#ef4444"},
            headers=auth_headers(admin),
        )
        assert upd.status_code == 200
        assert upd.json()["name"] == "New"
        assert upd.json()["color"] == "#ef4444"

    async def test_delete_group_keeps_diagram(self, client, db, env):
        admin = env["admin"]
        did = await _create(client, admin, name="Survivor")
        created = await client.post(
            "/api/v1/diagram-groups",
            json={"name": "Temp"},
            headers=auth_headers(admin),
        )
        sid = created.json()["id"]
        await client.put(
            f"/api/v1/diagrams/{did}/groups",
            json={"group_ids": [sid]},
            headers=auth_headers(admin),
        )
        rm = await client.delete(f"/api/v1/diagram-groups/{sid}", headers=auth_headers(admin))
        assert rm.status_code == 204

        # Diagram still exists with no groups.
        detail = await client.get(f"/api/v1/diagrams/{did}", headers=auth_headers(admin))
        assert detail.status_code == 200
        assert detail.json()["group_ids"] == []

    async def test_viewer_cannot_manage_groups(self, client, db, env):
        viewer = env["viewer"]
        resp = await client.post(
            "/api/v1/diagram-groups",
            json={"name": "Nope"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_viewer_can_list_groups(self, client, db, env):
        viewer = env["viewer"]
        resp = await client.get("/api/v1/diagram-groups", headers=auth_headers(viewer))
        assert resp.status_code == 200

    async def test_put_groups_nonexistent_diagram_404(self, client, db, env):
        admin = env["admin"]
        fake = str(uuid.uuid4())
        resp = await client.put(
            f"/api/v1/diagrams/{fake}/groups",
            json={"group_ids": []},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404
