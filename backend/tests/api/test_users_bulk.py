"""Integration tests for the /users bulk endpoints (PATCH /bulk and POST /bulk-delete)."""

from __future__ import annotations

import uuid

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_role,
    create_user,
)


@pytest.fixture
async def bulk_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer1 = await create_user(db, email="viewer1@test.com", role="viewer")
    viewer2 = await create_user(db, email="viewer2@test.com", role="viewer")
    return {"admin": admin, "member": member, "viewer1": viewer1, "viewer2": viewer2}


class TestBulkUpdate:
    async def test_admin_can_bulk_change_role(self, client, db, bulk_env):
        admin = bulk_env["admin"]
        ids = [str(bulk_env["viewer1"].id), str(bulk_env["viewer2"].id)]
        resp = await client.patch(
            "/api/v1/users/bulk",
            json={"ids": ids, "updates": {"role": "member"}},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 2
        assert all(u["role"] == "member" for u in body)

    async def test_admin_can_bulk_deactivate(self, client, db, bulk_env):
        admin = bulk_env["admin"]
        ids = [str(bulk_env["viewer1"].id), str(bulk_env["viewer2"].id)]
        resp = await client.patch(
            "/api/v1/users/bulk",
            json={"ids": ids, "updates": {"is_active": False}},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert all(u["is_active"] is False for u in resp.json())

    async def test_member_cannot_bulk_update(self, client, db, bulk_env):
        member = bulk_env["member"]
        ids = [str(bulk_env["viewer1"].id)]
        resp = await client.patch(
            "/api/v1/users/bulk",
            json={"ids": ids, "updates": {"role": "member"}},
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_unknown_role_returns_400(self, client, db, bulk_env):
        admin = bulk_env["admin"]
        resp = await client.patch(
            "/api/v1/users/bulk",
            json={
                "ids": [str(bulk_env["viewer1"].id)],
                "updates": {"role": "nope"},
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_empty_ids_returns_400(self, client, db, bulk_env):
        admin = bulk_env["admin"]
        resp = await client.patch(
            "/api/v1/users/bulk",
            json={"ids": [], "updates": {"role": "member"}},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_empty_updates_returns_400(self, client, db, bulk_env):
        admin = bulk_env["admin"]
        resp = await client.patch(
            "/api/v1/users/bulk",
            json={"ids": [str(bulk_env["viewer1"].id)], "updates": {}},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_last_admin_role_change_refused(self, client, db, bulk_env):
        """Bulk role change must not leave zero active admins."""
        admin = bulk_env["admin"]
        resp = await client.patch(
            "/api/v1/users/bulk",
            json={"ids": [str(admin.id)], "updates": {"role": "member"}},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_last_admin_deactivate_refused(self, client, db, bulk_env):
        admin = bulk_env["admin"]
        resp = await client.patch(
            "/api/v1/users/bulk",
            json={"ids": [str(admin.id)], "updates": {"is_active": False}},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_unknown_ids_returns_404(self, client, db, bulk_env):
        admin = bulk_env["admin"]
        resp = await client.patch(
            "/api/v1/users/bulk",
            json={"ids": [str(uuid.uuid4())], "updates": {"role": "member"}},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


class TestBulkDelete:
    async def test_admin_can_bulk_delete_deactivated(self, client, db, bulk_env):
        from sqlalchemy import select

        from app.models.user import User

        admin = bulk_env["admin"]
        # Deactivate the two viewers so they're eligible
        bulk_env["viewer1"].is_active = False
        bulk_env["viewer2"].is_active = False
        await db.flush()

        ids = [str(bulk_env["viewer1"].id), str(bulk_env["viewer2"].id)]
        resp = await client.post(
            "/api/v1/users/bulk-delete",
            json={"ids": ids},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["deleted"] == 2
        assert body["skipped"] == []

        remaining = (
            (await db.execute(select(User).where(User.id.in_([uuid.UUID(i) for i in ids]))))
            .scalars()
            .all()
        )
        assert remaining == []

    async def test_active_users_are_skipped(self, client, db, bulk_env):
        admin = bulk_env["admin"]
        # Mix: one active (skipped), one deactivated (deleted)
        bulk_env["viewer2"].is_active = False
        await db.flush()

        ids = [str(bulk_env["viewer1"].id), str(bulk_env["viewer2"].id)]
        resp = await client.post(
            "/api/v1/users/bulk-delete",
            json={"ids": ids},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["deleted"] == 1
        assert len(body["skipped"]) == 1
        assert body["skipped"][0]["id"] == str(bulk_env["viewer1"].id)

    async def test_cannot_delete_self_via_bulk(self, client, db, bulk_env):
        admin = bulk_env["admin"]
        resp = await client.post(
            "/api/v1/users/bulk-delete",
            json={"ids": [str(admin.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["deleted"] == 0
        assert len(body["skipped"]) == 1
        assert "your own" in body["skipped"][0]["reason"].lower()

    async def test_member_cannot_bulk_delete(self, client, db, bulk_env):
        member = bulk_env["member"]
        bulk_env["viewer1"].is_active = False
        await db.flush()
        resp = await client.post(
            "/api/v1/users/bulk-delete",
            json={"ids": [str(bulk_env["viewer1"].id)]},
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_empty_ids_returns_400(self, client, db, bulk_env):
        admin = bulk_env["admin"]
        resp = await client.post(
            "/api/v1/users/bulk-delete",
            json={"ids": []},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_last_admin_delete_refused(self, client, db, bulk_env):
        """Deleting the last admin row is blocked even when the caller has
        admin.users via a non-admin role."""
        admin = bulk_env["admin"]
        # Custom role that has admin.users without being named "admin" — this
        # is the only realistic way to exercise the last-admin guard, since
        # the admin user themselves would be filtered by the self-delete skip.
        await create_role(
            db,
            key="ops",
            label="Ops",
            permissions={"admin.users": True},
            is_system=False,
        )
        ops_user = await create_user(db, email="ops@test.com", role="ops")

        # Deactivate the sole admin so it's "deletable" per the active-only rule
        admin.is_active = False
        await db.flush()

        resp = await client.post(
            "/api/v1/users/bulk-delete",
            json={"ids": [str(admin.id)]},
            headers=auth_headers(ops_user),
        )
        # Deleting the last admin row leaves zero admins → guard rejects.
        assert resp.status_code == 400
        assert "last admin" in resp.json()["detail"].lower()
