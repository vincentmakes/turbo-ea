"""The SDK users bridge (SDK 1.3): grant gating and the least-privilege
payload.

Same harness as the todos-bridge tests: the bridge opens its own sessions
via ``async_session`` (patched to the savepoint-rollback test session) and
the in-memory ``extension_registry`` singleton is driven directly."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest

from app.api.v1.users import _user_response_lite
from app.services.extensions import users_bridge as bridge_mod
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.registry import ExtensionInfo, extension_registry
from app.services.extensions.sdk import ExtensionPermissionError
from app.services.extensions.users_bridge import ExtensionUsers, _to_ext_user
from tests.conftest import create_role, create_user

NOW = datetime.now(timezone.utc)
KEY = "jira-sync"


def load_registry(*, grants: list[str], enabled: bool = True, status: str = "installed") -> None:
    extension_registry.clear()
    extension_registry.load_installed(
        [
            ExtensionInfo(
                key=KEY,
                name="Jira Sync",
                version="1.0.0",
                status=status,
                enabled=enabled,
                manifest={"grants": grants},
            )
        ]
    )
    extension_registry.set_license(
        LicenseDocument(
            licensee="ACME",
            customer_id="cus_1",
            issued_at=NOW - timedelta(days=1),
            grace_days=30,
            entitlements=[Entitlement(extension_key=KEY, expires_at=None)],
        )
    )


@pytest.fixture(autouse=True)
def _registry_cleanup():
    extension_registry.clear()
    yield
    extension_registry.clear()


@pytest.fixture(autouse=True)
def _patch_session(monkeypatch, db):
    @asynccontextmanager
    async def fake_session():
        yield db

    monkeypatch.setattr(bridge_mod, "async_session", fake_session)


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    active = await create_user(db, email="Active@Test.com", role="admin")
    inactive = await create_user(db, email="gone@test.com", role="admin")
    inactive.is_active = False
    await db.flush()
    return {"active": active, "inactive": inactive}


class TestGrantGating:
    async def test_no_grant_blocks_every_read(self, db, env):
        load_registry(grants=[])
        bridge = ExtensionUsers(KEY)
        with pytest.raises(ExtensionPermissionError):
            await bridge.list()
        with pytest.raises(ExtensionPermissionError):
            await bridge.get(str(env["active"].id))
        with pytest.raises(ExtensionPermissionError):
            await bridge.find_by_email("active@test.com")

    async def test_other_core_grants_do_not_imply_users(self, db, env):
        load_registry(grants=["core.todos.read", "core.todos.write"])
        bridge = ExtensionUsers(KEY)
        with pytest.raises(ExtensionPermissionError):
            await bridge.list()

    async def test_disable_revokes_mid_run(self, db, env):
        load_registry(grants=["core.users.read"])
        bridge = ExtensionUsers(KEY)
        assert await bridge.get(str(env["active"].id)) is not None
        load_registry(grants=["core.users.read"], enabled=False)
        with pytest.raises(ExtensionPermissionError):
            await bridge.get(str(env["active"].id))


class TestReads:
    async def test_list_excludes_inactive_by_default(self, db, env):
        load_registry(grants=["core.users.read"])
        bridge = ExtensionUsers(KEY)
        emails = {u.email for u in await bridge.list()}
        assert env["active"].email in emails
        assert env["inactive"].email not in emails
        all_emails = {u.email for u in await bridge.list(include_inactive=True)}
        assert env["inactive"].email in all_emails

    async def test_get_returns_wire_shaped_user(self, db, env):
        load_registry(grants=["core.users.read"])
        bridge = ExtensionUsers(KEY)
        user = await bridge.get(str(env["active"].id))
        assert user is not None
        assert user.id == str(env["active"].id)
        assert user.email == env["active"].email
        assert user.is_active is True

    async def test_get_missing_returns_none(self, db, env):
        load_registry(grants=["core.users.read"])
        bridge = ExtensionUsers(KEY)
        assert await bridge.get("not-a-uuid") is None
        assert await bridge.get("00000000-0000-0000-0000-000000000000") is None

    async def test_find_by_email_is_case_insensitive(self, db, env):
        load_registry(grants=["core.users.read"])
        bridge = ExtensionUsers(KEY)
        hit = await bridge.find_by_email("  ACTIVE@test.COM ")
        assert hit is not None and hit.id == str(env["active"].id)
        assert await bridge.find_by_email("nobody@test.com") is None
        assert await bridge.find_by_email("") is None


class TestPayloadShape:
    async def test_ext_user_pins_the_lite_response_shape(self, db, env):
        """ExtUser deliberately duplicates ``_user_response_lite`` (the
        least-privilege payload core's pickers get). This pin fails if
        either side drifts, forcing a conscious decision."""
        lite_keys = set(_user_response_lite(env["active"]).keys())
        ext_keys = set(vars(_to_ext_user(env["active"])).keys())
        assert ext_keys == lite_keys
