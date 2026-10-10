"""Shared and public bookmarks: who sees a view, who may edit it, and the
shape every bookmark is returned in.

``test_bookmarks.py`` covers private bookmarks; this file covers sharing
(``_sync_shares``), the list filters that read it, and ``_serialize``.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.api.v1.bookmarks import _serialize
from app.core.permissions import VIEWER_PERMISSIONS
from tests.conftest import auth_headers, create_role, create_user

# ---------------------------------------------------------------------------
# _serialize (pure)
# ---------------------------------------------------------------------------

OWNER = uuid.uuid4()
BOB = uuid.uuid4()
CAROL = uuid.uuid4()
CREATED = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)


def _bm(**overrides):
    fields = {
        "id": uuid.uuid4(),
        "user_id": OWNER,
        "name": "My view",
        "card_type": "Application",
        "filters": {"status": "ACTIVE"},
        "columns": ["name"],
        "column_state": [{"colId": "name"}],
        "column_filter_model": {"name": {"type": "contains"}},
        "sort": {"field": "name"},
        "is_default": True,
        "visibility": "shared",
        "odata_enabled": True,
        "created_at": CREATED,
        "shared_with_users": [
            SimpleNamespace(id=BOB, display_name="Bob", email="bob@test.com"),
            SimpleNamespace(id=CAROL, display_name="Carol", email="carol@test.com"),
        ],
        "_owner": SimpleNamespace(display_name="Olivia"),
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


class TestSerialize:
    def test_the_owner_sees_everything(self):
        bm = _bm()
        got = _serialize(bm, OWNER, {BOB: True}, "https://ea.example")
        assert got == {
            "id": str(bm.id),
            "name": "My view",
            "card_type": "Application",
            "filters": {"status": "ACTIVE"},
            "columns": ["name"],
            "column_state": [{"colId": "name"}],
            "column_filter_model": {"name": {"type": "contains"}},
            "sort": {"field": "name"},
            "is_default": True,
            "visibility": "shared",
            "odata_enabled": True,
            "owner_id": str(OWNER),
            "owner_name": "Olivia",
            "is_owner": True,
            "can_edit": True,
            "shared_with": [
                {
                    "user_id": str(BOB),
                    "display_name": "Bob",
                    "email": "bob@test.com",
                    "can_edit": True,
                },
                {
                    "user_id": str(CAROL),
                    "display_name": "Carol",
                    "email": "carol@test.com",
                    "can_edit": False,  # absent from the permissions: read-only
                },
            ],
            "created_at": "2026-01-02T03:04:05+00:00",
            "odata_url": f"https://ea.example/api/v1/bookmarks/{bm.id}/odata",
        }

    @pytest.mark.parametrize(
        ("perms", "expected"),
        [({BOB: True}, True), ({BOB: False}, False), ({CAROL: True}, False), ({}, False)],
    )
    def test_a_recipient_edits_only_with_the_flag(self, perms, expected):
        got = _serialize(_bm(), BOB, perms)
        assert (got["is_owner"], got["can_edit"]) == (False, expected)

    def test_no_permissions_at_all_is_read_only(self):
        got = _serialize(_bm(), BOB, None)
        assert got["can_edit"] is False
        assert [s["can_edit"] for s in got["shared_with"]] == [False, False]

    def test_defaults_for_an_unset_row(self):
        bm = _bm(
            visibility=None,
            odata_enabled=None,
            created_at=None,
            shared_with_users=[],
            _owner=None,
        )
        got = _serialize(bm, OWNER)
        assert got["visibility"] == "private"
        assert got["odata_enabled"] is False
        assert got["created_at"] is None
        assert got["shared_with"] == []
        assert got["owner_name"] is None
        assert got["odata_url"] is None

    def test_a_row_without_an_owner_attribute_has_no_owner_name(self):
        bm = _bm()
        del bm._owner
        assert _serialize(bm, OWNER)["owner_name"] is None

    @pytest.mark.parametrize(("odata", "base"), [(False, "https://ea.example"), (True, "")])
    def test_odata_url_needs_the_feed_and_a_base(self, odata, base):
        assert _serialize(_bm(odata_enabled=odata), OWNER, None, base)["odata_url"] is None


# ---------------------------------------------------------------------------
# Sharing through the API
# ---------------------------------------------------------------------------


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    return {
        "owner": await create_user(db, email="owner@test.com", role="admin"),
        "bob": await create_user(db, email="bob@test.com", role="admin"),
        "carol": await create_user(db, email="carol@test.com", role="admin"),
        "dave": await create_user(db, email="dave@test.com", role="admin"),
    }


async def _create(client, user, **body):
    resp = await client.post(
        "/api/v1/bookmarks", json={"name": "View", **body}, headers=auth_headers(user)
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _list(client, user, filter_="all"):
    resp = await client.get(f"/api/v1/bookmarks?filter={filter_}", headers=auth_headers(user))
    assert resp.status_code == 200, resp.text
    return {b["name"]: b for b in resp.json()}


def _shares(bookmark):
    return {s["user_id"]: s["can_edit"] for s in bookmark["shared_with"]}


class TestShares:
    async def test_shared_users_and_their_edit_flags_are_stored(self, client, env):
        bm = await _create(
            client,
            env["owner"],
            visibility="shared",
            shared_with=[
                {"user_id": str(env["bob"].id), "can_edit": True},
                {"user_id": str(env["carol"].id)},
            ],
        )
        assert _shares(bm) == {str(env["bob"].id): True, str(env["carol"].id): False}

    async def test_unknown_and_malformed_users_are_skipped(self, client, env):
        bm = await _create(
            client,
            env["owner"],
            visibility="shared",
            shared_with=[
                {"user_id": str(uuid.uuid4())},
                {"user_id": "not-a-uuid"},
                {"user_id": str(env["bob"].id)},
            ],
        )
        assert _shares(bm) == {str(env["bob"].id): False}

    async def test_a_private_view_stores_no_shares(self, client, env):
        bm = await _create(
            client, env["owner"], shared_with=[{"user_id": str(env["bob"].id), "can_edit": True}]
        )
        assert bm["visibility"] == "private"
        assert bm["shared_with"] == []

    async def test_an_update_replaces_the_share_list(self, client, env):
        bm = await _create(
            client,
            env["owner"],
            visibility="shared",
            shared_with=[{"user_id": str(env["bob"].id)}, {"user_id": str(env["carol"].id)}],
        )
        resp = await client.patch(
            f"/api/v1/bookmarks/{bm['id']}",
            json={"shared_with": [{"user_id": str(env["carol"].id), "can_edit": True}]},
            headers=auth_headers(env["owner"]),
        )
        assert resp.status_code == 200, resp.text
        assert _shares(resp.json()) == {str(env["carol"].id): True}

    async def test_an_update_with_unknown_users_only_clears_the_list(self, client, env):
        bm = await _create(
            client, env["owner"], visibility="shared", shared_with=[{"user_id": str(env["bob"].id)}]
        )
        resp = await client.patch(
            f"/api/v1/bookmarks/{bm['id']}",
            json={"shared_with": [{"user_id": "nope"}]},
            headers=auth_headers(env["owner"]),
        )
        assert resp.json()["shared_with"] == []

    async def test_making_a_view_private_drops_its_shares(self, client, env):
        bm = await _create(
            client, env["owner"], visibility="shared", shared_with=[{"user_id": str(env["bob"].id)}]
        )
        resp = await client.patch(
            f"/api/v1/bookmarks/{bm['id']}",
            json={"visibility": "private", "shared_with": [{"user_id": str(env["bob"].id)}]},
            headers=auth_headers(env["owner"]),
        )
        assert resp.json()["shared_with"] == []
        assert "View" not in await _list(client, env["bob"], "shared")


class TestRecipients:
    @pytest.fixture
    async def shared(self, client, env):
        return await _create(
            client,
            env["owner"],
            visibility="shared",
            shared_with=[
                {"user_id": str(env["bob"].id), "can_edit": True},
                {"user_id": str(env["carol"].id), "can_edit": False},
            ],
        )

    async def test_a_recipient_sees_it_with_their_own_edit_flag(self, client, env, shared):
        bob_view = (await _list(client, env["bob"], "shared"))["View"]
        carol_view = (await _list(client, env["carol"], "all"))["View"]
        assert (bob_view["is_owner"], bob_view["can_edit"]) == (False, True)
        assert (carol_view["is_owner"], carol_view["can_edit"]) == (False, False)
        assert bob_view["owner_name"] == env["owner"].display_name

    async def test_someone_else_does_not_see_it(self, client, env, shared):
        assert await _list(client, env["dave"], "all") == {}
        assert await _list(client, env["dave"], "shared") == {}

    async def test_an_editor_may_rename_it(self, client, env, shared):
        resp = await client.patch(
            f"/api/v1/bookmarks/{shared['id']}",
            json={"name": "Renamed"},
            headers=auth_headers(env["bob"]),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["name"] == "Renamed"
        assert resp.json()["can_edit"] is True

    async def test_a_read_only_recipient_may_not(self, client, env, shared):
        resp = await client.patch(
            f"/api/v1/bookmarks/{shared['id']}",
            json={"name": "Renamed"},
            headers=auth_headers(env["carol"]),
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == "You don't have permission to edit this view"

    @pytest.mark.parametrize(
        "change",
        [{"visibility": "public"}, {"shared_with": []}, {"odata_enabled": True}],
    )
    async def test_only_the_owner_changes_who_sees_it(self, client, env, shared, change):
        resp = await client.patch(
            f"/api/v1/bookmarks/{shared['id']}", json=change, headers=auth_headers(env["bob"])
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == (
            "Only the owner can change visibility, sharing, or OData settings"
        )


class TestListFilters:
    async def test_each_filter_reads_its_own_set(self, client, env):
        await _create(client, env["owner"], name="Mine")
        await _create(client, env["dave"], name="Public", visibility="public")
        await _create(
            client,
            env["dave"],
            name="Shared",
            visibility="shared",
            shared_with=[{"user_id": str(env["owner"].id)}],
        )
        await _create(client, env["dave"], name="Dave's own")

        assert set(await _list(client, env["owner"], "my")) == {"Mine"}
        assert set(await _list(client, env["owner"], "public")) == {"Public"}
        assert set(await _list(client, env["owner"], "shared")) == {"Shared"}
        assert set(await _list(client, env["owner"], "all")) == {"Mine", "Public", "Shared"}


class TestVisibilityAndOdata:
    async def test_an_unknown_visibility_is_refused(self, client, env):
        resp = await client.post(
            "/api/v1/bookmarks",
            json={"name": "V", "visibility": "everyone"},
            headers=auth_headers(env["owner"]),
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "visibility must be private, public, or shared"

    async def test_an_unknown_visibility_is_refused_on_update(self, client, env):
        bm = await _create(client, env["owner"])
        resp = await client.patch(
            f"/api/v1/bookmarks/{bm['id']}",
            json={"visibility": "everyone"},
            headers=auth_headers(env["owner"]),
        )
        assert resp.status_code == 400

    async def test_an_odata_view_carries_its_feed_url(self, client, env):
        bm = await _create(client, env["owner"], odata_enabled=True)
        assert bm["odata_enabled"] is True
        assert bm["odata_url"].endswith(f"/api/v1/bookmarks/{bm['id']}/odata")

    async def test_a_viewer_may_not_share(self, client, db, env):
        viewer = await create_user(db, email="viewer@test.com", role="viewer")
        if VIEWER_PERMISSIONS.get("bookmarks.share"):
            pytest.skip("viewers may share in this permission set")
        resp = await client.post(
            "/api/v1/bookmarks",
            json={"name": "V", "visibility": "public"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403
