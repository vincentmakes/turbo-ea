"""A role a directory role map sets cannot be edited in the Users admin.

While a native SSO role map (``general_settings["sso"]["role_map"]``) or the
reverse-proxy map is in force, a federated account's role is re-asserted at
every sign-in, so a hand edit would silently revert. The admin payload says so
(``role_managed_externally``) and the API refuses the change — only when the
role actually changes, judged on the account as the edit leaves it.
"""

from __future__ import annotations

import pytest

from app.config import settings
from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.user import User
from tests.conftest import auth_headers, create_role, create_user, stored_role
from tests.seams import ai_settings

MANAGED = "This user's role is managed by the identity provider"

NATIVE_SSO = {
    "enabled": True,
    "provider": "okta",
    "domain": "dev-1.okta.com",
    "client_id": "cid",
    "role_claim": "groups",
    "role_map": [{"value": "EA-Admins", "role": "admin"}],
}


@pytest.fixture(autouse=True)
def _proxy_map_off(monkeypatch):
    """Pinned off so only the native map is in play unless a test turns it on."""
    monkeypatch.setattr(settings, "PROXY_AUTH_ENABLED", False)
    monkeypatch.setattr(settings, "PROXY_AUTH_ROLE_MAP", [])


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    fed = await create_user(db, email="fed@test.com", role="viewer")
    fed.auth_provider = "sso"
    fed.password_hash = None
    fed2 = await create_user(db, email="fed2@test.com", role="member")
    fed2.auth_provider = "sso"
    fed2.password_hash = None
    local = await create_user(db, email="local@test.com", role="viewer")
    await db.flush()
    return {"admin": admin, "fed": fed, "fed2": fed2, "local": local}


async def _sso(db, **overrides):
    await ai_settings(db, general={"sso": {**NATIVE_SSO, **overrides}})


async def _flags(client, env) -> dict[str, bool]:
    resp = await client.get(
        "/api/v1/users", params={"include_inactive": True}, headers=auth_headers(env["admin"])
    )
    assert resp.status_code == 200
    return {u["email"]: u["role_managed_externally"] for u in resp.json()}


async def _patch(client, env, user, **body):
    return await client.patch(
        f"/api/v1/users/{user.id}", json=body, headers=auth_headers(env["admin"])
    )


class TestThePayloadFlag:
    async def test_a_federated_user_is_flagged_while_a_map_is_in_force(self, client, db, env):
        await _sso(db)
        assert await _flags(client, env) == {
            "admin@test.com": False,
            "fed@test.com": True,
            "fed2@test.com": True,
            "local@test.com": False,
        }

    async def test_the_single_user_read_carries_the_flag(self, client, db, env):
        await _sso(db)
        resp = await client.get(
            f"/api/v1/users/{env['fed'].id}", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 200
        assert resp.json()["role_managed_externally"] is True

    async def test_the_own_profile_read_carries_the_flag(self, client, db, env):
        await _sso(db)
        resp = await client.get(f"/api/v1/users/{env['fed'].id}", headers=auth_headers(env["fed"]))
        assert resp.status_code == 200
        assert resp.json()["role_managed_externally"] is True

    @pytest.mark.parametrize(
        "overrides",
        [
            {"enabled": False},
            {"role_map": []},
            {"role_claim": ""},
            {"provider": "google"},
            {"provider": "microsoft", "tenant_id": "organizations"},
        ],
    )
    async def test_nobody_is_flagged_when_the_map_is_off(self, client, db, env, overrides):
        await _sso(db, **overrides)
        assert set((await _flags(client, env)).values()) == {False}

    async def test_nobody_is_flagged_without_sso_settings(self, client, db, env):
        assert set((await _flags(client, env)).values()) == {False}

    async def test_a_non_admin_gets_no_flag(self, client, db, env):
        await _sso(db)
        resp = await client.get("/api/v1/users", headers=auth_headers(env["local"]))
        assert resp.status_code == 200
        assert all("role_managed_externally" not in u for u in resp.json())

    async def test_the_proxy_map_flags_federated_users(self, client, db, env, monkeypatch):
        monkeypatch.setattr(settings, "PROXY_AUTH_ENABLED", True)
        monkeypatch.setattr(settings, "PROXY_AUTH_ROLE_MAP", [("ea-admins", "admin")])
        monkeypatch.setattr(settings, "PROXY_AUTH_SHARED_SECRET", "s3cret")
        flags = await _flags(client, env)
        assert flags["fed@test.com"] is True and flags["local@test.com"] is False

    async def test_an_untrusted_proxy_map_flags_nobody(self, client, db, env, monkeypatch):
        monkeypatch.setattr(settings, "PROXY_AUTH_ENABLED", True)
        monkeypatch.setattr(settings, "PROXY_AUTH_ROLE_MAP", [("ea-admins", "admin")])
        monkeypatch.setattr(settings, "PROXY_AUTH_SHARED_SECRET", "")
        monkeypatch.setattr(settings, "PROXY_AUTH_MODE", "azure_easyauth")
        monkeypatch.setattr(settings, "PROXY_AUTH_VERIFY_ID_TOKEN", False)
        assert set((await _flags(client, env)).values()) == {False}


class TestUpdateUser:
    async def test_changing_a_managed_role_is_refused(self, client, db, env):
        await _sso(db)
        resp = await _patch(client, env, env["fed"], role="member")
        assert resp.status_code == 400
        assert resp.json() == {"detail": MANAGED}
        assert await stored_role(db, User, "fed@test.com") == "viewer"

    async def test_re_sending_the_same_role_is_accepted(self, client, db, env):
        await _sso(db)
        resp = await _patch(client, env, env["fed"], role="viewer", display_name="Fed Renamed")
        assert resp.status_code == 200, resp.text
        assert resp.json()["display_name"] == "Fed Renamed"
        assert resp.json()["role_managed_externally"] is True

    async def test_a_local_user_stays_editable(self, client, db, env):
        await _sso(db)
        resp = await _patch(client, env, env["local"], role="member")
        assert resp.status_code == 200, resp.text
        assert resp.json()["role_managed_externally"] is False
        assert await stored_role(db, User, "local@test.com") == "member"

    async def test_a_federated_user_is_editable_while_the_map_is_off(self, client, db, env):
        await _sso(db, role_map=[])
        resp = await _patch(client, env, env["fed"], role="member")
        assert resp.status_code == 200, resp.text
        assert await stored_role(db, User, "fed@test.com") == "member"

    async def test_switching_to_local_sign_in_in_the_same_edit_unlocks_the_role(
        self, client, db, env
    ):
        await _sso(db)
        resp = await _patch(client, env, env["fed"], role="member", auth_provider="local")
        assert resp.status_code == 200, resp.text
        assert await stored_role(db, User, "fed@test.com") == "member"
        assert resp.json()["role_managed_externally"] is False

    async def test_switching_to_sso_in_the_same_edit_locks_the_role(self, client, db, env):
        await _sso(db)
        resp = await _patch(client, env, env["local"], role="member", auth_provider="sso")
        assert resp.status_code == 400
        assert resp.json() == {"detail": MANAGED}
        assert await stored_role(db, User, "local@test.com") == "viewer"

    async def test_the_proxy_map_locks_the_role_too(self, client, db, env, monkeypatch):
        monkeypatch.setattr(settings, "PROXY_AUTH_ENABLED", True)
        monkeypatch.setattr(settings, "PROXY_AUTH_ROLE_MAP", [("ea-admins", "admin")])
        monkeypatch.setattr(settings, "PROXY_AUTH_SHARED_SECRET", "s3cret")
        resp = await _patch(client, env, env["fed"], role="member")
        assert resp.status_code == 400
        assert resp.json() == {"detail": MANAGED}


class TestBulkUpdate:
    async def _bulk(self, client, env, users, **updates):
        return await client.patch(
            "/api/v1/users/bulk",
            json={"ids": [str(u.id) for u in users], "updates": updates},
            headers=auth_headers(env["admin"]),
        )

    async def test_a_role_change_touching_managed_users_is_refused_whole(self, client, db, env):
        await _sso(db)
        resp = await self._bulk(client, env, [env["local"], env["fed2"], env["fed"]], role="member")
        assert resp.status_code == 400
        # fed2 already holds "member": only the users whose role would change count.
        assert resp.json() == {
            "detail": "The role of these users is managed by the identity provider: "
            "fed@test.com. Deselect them first."
        }
        assert await stored_role(db, User, "local@test.com") == "viewer"
        assert await stored_role(db, User, "fed@test.com") == "viewer"

    async def test_every_managed_user_is_named_in_order(self, client, db, env):
        await _sso(db)
        resp = await self._bulk(client, env, [env["fed2"], env["fed"]], role="admin")
        assert resp.status_code == 400
        assert resp.json() == {
            "detail": "The role of these users is managed by the identity provider: "
            "fed2@test.com, fed@test.com. Deselect them first."
        }

    async def test_a_role_every_managed_user_already_holds_is_accepted(self, client, db, env):
        await _sso(db)
        resp = await self._bulk(client, env, [env["local"], env["fed"]], role="viewer")
        assert resp.status_code == 200, resp.text
        flags = {u["email"]: u["role_managed_externally"] for u in resp.json()}
        assert flags == {"local@test.com": False, "fed@test.com": True}

    async def test_deactivating_managed_users_is_not_a_role_change(self, client, db, env):
        await _sso(db)
        resp = await self._bulk(client, env, [env["fed"]], is_active=False)
        assert resp.status_code == 200, resp.text

    async def test_local_users_stay_bulk_editable(self, client, db, env):
        await _sso(db)
        resp = await self._bulk(client, env, [env["local"]], role="member")
        assert resp.status_code == 200, resp.text
        assert await stored_role(db, User, "local@test.com") == "member"

    async def test_without_a_map_federated_users_are_bulk_editable(self, client, db, env):
        resp = await self._bulk(client, env, [env["fed"], env["fed2"]], role="member")
        assert resp.status_code == 200, resp.text
        assert await stored_role(db, User, "fed@test.com") == "member"
