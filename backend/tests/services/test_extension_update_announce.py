"""Who gets told that an extension was updated, and when nobody does.

The audience rule is the whole design of this feature: an extension is not the
platform, so "everyone" is usually wrong, but "administrators only" leaves the
people who actually use it to find out by bumping into the change.
"""

from __future__ import annotations

import pytest

from app.services.extensions import update_announce as ua
from app.services.extensions.update_announce import build_update_digest, resolve_audience
from tests.conftest import create_role, create_user


class _Entitlement:
    def __init__(self, usable: bool):
        self.usable = usable


class _Registry:
    def __init__(self, usable: bool = True):
        self._usable = usable

    def entitlement(self, key: str):
        return _Entitlement(self._usable)


@pytest.fixture
def usable(monkeypatch):
    monkeypatch.setattr(ua, "extension_registry", _Registry(usable=True))


@pytest.fixture
def unlicensed(monkeypatch):
    monkeypatch.setattr(ua, "extension_registry", _Registry(usable=False))


@pytest.fixture
def registers_permissions(monkeypatch):
    """Stand in for a BACKEND extension whose keys reached the core registry."""
    monkeypatch.setattr(
        ua,
        "_has_registered_permissions",
        lambda key: key == "acme",
    )


@pytest.fixture
def registers_nothing(monkeypatch):
    """A content pack or metamodel contribution: no permission surface at all."""
    monkeypatch.setattr(ua, "_has_registered_permissions", lambda key: False)


async def _digest(db, **kw):
    payload = {
        "key": "acme",
        "name": "Acme",
        "from_version": "1.0.0",
        "to_version": "1.1.0",
    }
    payload.update(kw)
    return await build_update_digest(db, **payload)


# ---------------------------------------------------------------------------
# When nothing is announced
# ---------------------------------------------------------------------------


class TestSilence:
    async def test_a_first_install_is_not_an_update(self, db, usable, registers_nothing):
        await create_role(db, key="admin", permissions={"*": True})
        await create_user(db, role="admin", email="a@example.com")

        assert await _digest(db, from_version=None) == []

    async def test_a_reinstall_of_the_same_version_says_nothing(
        self, db, usable, registers_nothing
    ):
        await create_role(db, key="admin", permissions={"*": True})
        await create_user(db, role="admin", email="a@example.com")

        assert await _digest(db, from_version="1.1.0", to_version="1.1.0") == []

    async def test_a_downgrade_says_nothing(self, db, usable, registers_nothing):
        await create_role(db, key="admin", permissions={"*": True})
        await create_user(db, role="admin", email="a@example.com")

        assert await _digest(db, from_version="1.2.0", to_version="1.1.0") == []

    async def test_an_unlicensed_extension_announces_nothing(
        self, db, unlicensed, registers_nothing
    ):
        """It is not running, so a release note about it is noise."""
        await create_role(db, key="admin", permissions={"*": True})
        await create_user(db, role="admin", email="a@example.com")

        assert await _digest(db) == []


# ---------------------------------------------------------------------------
# The audience
# ---------------------------------------------------------------------------


class TestAudience:
    async def test_permission_holders_and_admins_only(self, db, usable, registers_permissions):
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="ops", label="Ops", permissions={"ext.acme.view": True})
        await create_role(db, key="other", label="Other", permissions={"ext.zzz.view": True})
        await create_role(db, key="member", label="Member", permissions={"inventory.edit": True})

        admin = await create_user(db, role="admin", email="admin@example.com")
        ops = await create_user(db, role="ops", email="ops@example.com")
        await create_user(db, role="other", email="other@example.com")
        await create_user(db, role="member", email="member@example.com")

        rows = await _digest(db)

        assert {r["user_id"] for r in rows} == {admin.id, ops.id}

    async def test_any_one_of_its_keys_is_enough(self, db, usable, registers_permissions):
        """An extension declares several keys; holding one means you use it."""
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="mgr", label="Manager", permissions={"ext.acme.manage": True})
        await create_user(db, role="admin", email="admin@example.com")
        mgr = await create_user(db, role="mgr", email="mgr@example.com")

        rows = await _digest(db)

        assert mgr.id in {r["user_id"] for r in rows}

    async def test_a_permission_set_to_false_does_not_count(
        self, db, usable, registers_permissions
    ):
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="off", label="Off", permissions={"ext.acme.view": False})
        admin = await create_user(db, role="admin", email="admin@example.com")
        await create_user(db, role="off", email="off@example.com")

        assert {r["user_id"] for r in await _digest(db)} == {admin.id}

    async def test_an_extension_with_no_permissions_reaches_everyone(
        self, db, usable, registers_nothing
    ):
        """A content pack's card types are simply part of the inventory."""
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="member", label="Member", permissions={"inventory.view": True})
        admin = await create_user(db, role="admin", email="admin@example.com")
        member = await create_user(db, role="member", email="member@example.com")

        assert {r["user_id"] for r in await _digest(db)} == {admin.id, member.id}

    async def test_deactivated_users_are_skipped(self, db, usable, registers_nothing):
        await create_role(db, key="member", label="Member", permissions={"inventory.view": True})
        active = await create_user(db, role="member", email="active@example.com")
        gone = await create_user(db, role="member", email="gone@example.com")
        gone.is_active = False
        await db.flush()

        assert {r["user_id"] for r in await _digest(db)} == {active.id}

    async def test_nobody_to_tell_is_an_empty_digest(self, db, usable, registers_permissions):
        await create_role(db, key="member", label="Member", permissions={"inventory.view": True})
        await create_user(db, role="member", email="member@example.com")

        assert await _digest(db) == []

    async def test_resolve_audience_is_reusable_on_its_own(self, db, usable, registers_nothing):
        await create_role(db, key="member", label="Member", permissions={})
        member = await create_user(db, role="member", email="member@example.com")

        assert await resolve_audience(db, "acme") == [member.id]


# ---------------------------------------------------------------------------
# The payload
# ---------------------------------------------------------------------------


class TestPayload:
    async def test_carries_versions_and_never_the_notes(self, db, usable, registers_nothing):
        """Freezing markdown into every row would grow the table by
        notes x users x release; it is resolved on read instead."""
        await create_role(db, key="admin", permissions={"*": True})
        await create_user(db, role="admin", email="admin@example.com")

        row = (await _digest(db))[0]

        assert row["data"] == {
            "key": "acme",
            "name": "Acme",
            "from_version": "1.0.0",
            "to_version": "1.1.0",
        }
        assert "notes" not in row["data"]
        assert "1.1.0" in row["title"] and "Acme" in row["title"]
        assert row["link"] == "/admin/extensions"

    async def test_each_recipient_gets_its_own_payload_dict(self, db, usable, registers_nothing):
        await create_role(db, key="member", label="Member", permissions={})
        await create_user(db, role="member", email="a@example.com")
        await create_user(db, role="member", email="b@example.com")

        rows = await _digest(db)

        assert len(rows) == 2
        assert rows[0]["data"] is not rows[1]["data"]
