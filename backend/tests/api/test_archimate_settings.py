"""Integration tests for ArchiMate feature flag endpoints."""

from __future__ import annotations

import pytest

from tests.conftest import auth_headers, create_role, create_user


@pytest.fixture
async def archimate_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions={"inventory.view": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    return {"admin": admin, "member": member}


class TestArchiMateFeatureFlag:
    async def test_get_archimate_enabled_default_false(self, client, db, archimate_env):
        admin = archimate_env["admin"]
        resp = await client.get(
            "/api/v1/settings/archimate-enabled",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["enabled"] is False

    async def test_enable_archimate_requires_admin(self, client, db, archimate_env):
        member = archimate_env["member"]
        resp = await client.patch(
            "/api/v1/settings/archimate-enabled",
            json={"enabled": True},
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_admin_can_enable_archimate(self, client, db, archimate_env):
        admin = archimate_env["admin"]
        resp = await client.patch(
            "/api/v1/settings/archimate-enabled",
            json={"enabled": True},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        resp2 = await client.get(
            "/api/v1/settings/archimate-enabled",
            headers=auth_headers(admin),
        )
        assert resp2.json()["enabled"] is True

    async def test_bootstrap_includes_archimate_enabled(self, client, db, archimate_env):
        admin = archimate_env["admin"]
        resp = await client.get(
            "/api/v1/settings/bootstrap",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "archimate_enabled" in data
        assert data["archimate_enabled"] is False

    async def test_disabling_hides_archimate_types(self, client, db, archimate_env):
        from app.models.card_type import CardType
        from app.plugins.archimate.seed import seed_archimate_metamodel
        from sqlalchemy import select

        await seed_archimate_metamodel(db)
        await db.commit()

        admin = archimate_env["admin"]
        await client.patch(
            "/api/v1/settings/archimate-enabled",
            json={"enabled": False},
            headers=auth_headers(admin),
        )

        result = await db.execute(
            select(CardType).where(
                CardType.plugin_id == "archimate",
                CardType.is_hidden == False,  # noqa: E712
            )
        )
        visible = result.scalars().all()
        assert len(visible) == 0, "All archimate types should be hidden when disabled"
