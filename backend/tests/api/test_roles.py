"""Integration tests for the /roles endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

from app.core.permissions import VIEWER_PERMISSIONS
from tests.conftest import auth_headers, create_role, create_user

# ---------------------------------------------------------------------------
# GET /roles
# ---------------------------------------------------------------------------


class TestListRoles:
    async def test_list_roles(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        await create_role(db, key="member", label="Member", permissions={}, is_system=False)
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.get(
            "/api/v1/roles",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        keys = [r["key"] for r in response.json()]
        assert "admin" in keys
        assert "member" in keys

    async def test_list_excludes_archived_by_default(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        role = await create_role(db, key="old_role", label="Old", permissions={}, is_system=False)
        role.is_archived = True
        await db.flush()
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.get(
            "/api/v1/roles",
            headers=auth_headers(admin),
        )
        keys = [r["key"] for r in response.json()]
        assert "old_role" not in keys

    async def test_list_includes_archived_when_requested(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        role = await create_role(db, key="old_role", label="Old", permissions={}, is_system=False)
        role.is_archived = True
        await db.flush()
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.get(
            "/api/v1/roles?include_archived=true",
            headers=auth_headers(admin),
        )
        keys = [r["key"] for r in response.json()]
        assert "old_role" in keys

    async def test_user_count_included(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        await create_user(db, email="admin@test.com", role="admin")
        await create_user(db, email="admin2@test.com", role="admin")

        admin = await create_user(db, email="admin3@test.com", role="admin")
        response = await client.get(
            "/api/v1/roles",
            headers=auth_headers(admin),
        )
        admin_role = next(r for r in response.json() if r["key"] == "admin")
        assert admin_role["user_count"] >= 2


# ---------------------------------------------------------------------------
# GET /roles — payload shaping (RBAC matrix is admin.roles-only)
# ---------------------------------------------------------------------------


class TestRolePayloadShaping:
    async def _setup(self, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
        admin = await create_user(db, email="admin@test.com", role="admin")
        viewer = await create_user(db, email="viewer@test.com", role="viewer")
        return admin, viewer

    async def test_admin_sees_permissions_and_counts(self, client, db):
        admin, _ = await self._setup(db)
        resp = await client.get("/api/v1/roles", headers=auth_headers(admin))
        assert resp.status_code == 200
        row = next(r for r in resp.json() if r["key"] == "admin")
        assert "permissions" in row
        assert "user_count" in row

    async def test_non_admin_gets_trimmed_roles(self, client, db):
        """A viewer (no admin.roles) can resolve labels/colors but not the
        permission matrix or per-role user counts."""
        _, viewer = await self._setup(db)
        resp = await client.get("/api/v1/roles", headers=auth_headers(viewer))
        assert resp.status_code == 200
        for row in resp.json():
            assert "key" in row and "label" in row and "color" in row
            assert "permissions" not in row
            assert "user_count" not in row

    async def test_non_admin_get_single_role_trimmed(self, client, db):
        _, viewer = await self._setup(db)
        resp = await client.get("/api/v1/roles/admin", headers=auth_headers(viewer))
        assert resp.status_code == 200
        body = resp.json()
        assert body["key"] == "admin"
        assert "permissions" not in body
        assert "user_count" not in body


# ---------------------------------------------------------------------------
# GET /roles/permissions-schema
# ---------------------------------------------------------------------------


class TestPermissionsSchema:
    async def test_returns_schema(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.get(
            "/api/v1/roles/permissions-schema",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
        assert len(data) > 0


# ---------------------------------------------------------------------------
# POST /roles
# ---------------------------------------------------------------------------


class TestCreateRole:
    async def test_create_role(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.post(
            "/api/v1/roles",
            json={
                "key": "custom_role",
                "label": "Custom Role",
                "permissions": {"inventory.view": True},
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 201
        data = response.json()
        assert data["key"] == "custom_role"
        assert data["is_system"] is False
        assert data["user_count"] == 0

    async def test_duplicate_key_returns_409(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.post(
            "/api/v1/roles",
            json={"key": "admin", "label": "Another Admin"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 409

    async def test_invalid_key_pattern_rejected(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.post(
            "/api/v1/roles",
            json={"key": "UPPER_CASE", "label": "Bad Key"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 422

    async def test_unknown_permission_key_rejected(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.post(
            "/api/v1/roles",
            json={
                "key": "bad_perms",
                "label": "Bad Perms",
                "permissions": {"fake.permission": True},
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 422

    async def test_create_as_default_clears_existing(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        old_default = await create_role(
            db, key="old_default", label="Old Default", permissions={}, is_system=False
        )
        old_default.is_default = True
        await db.flush()
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.post(
            "/api/v1/roles",
            json={
                "key": "new_default",
                "label": "New Default",
                "is_default": True,
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 201


# ---------------------------------------------------------------------------
# PATCH /roles/{key}
# ---------------------------------------------------------------------------


class TestUpdateRole:
    async def test_update_label(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        await create_role(db, key="member", label="Member", permissions={}, is_system=False)
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.patch(
            "/api/v1/roles/member",
            json={"label": "Team Member"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["label"] == "Team Member"

    async def test_update_nonexistent_returns_404(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.patch(
            "/api/v1/roles/nonexistent",
            json={"label": "Nope"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 404

    async def test_cannot_remove_admin_wildcard(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.patch(
            "/api/v1/roles/admin",
            json={"permissions": {"inventory.view": True}},
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_cannot_update_archived_role(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        role = await create_role(
            db, key="archived_role", label="Archived", permissions={}, is_system=False
        )
        role.is_archived = True
        await db.flush()
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.patch(
            "/api/v1/roles/archived_role",
            json={"label": "Updated"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 400


# ---------------------------------------------------------------------------
# POST /roles/{key}/archive + /restore
# ---------------------------------------------------------------------------


class TestArchiveRestoreRole:
    async def test_archive_role(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        await create_role(db, key="custom", label="Custom", permissions={}, is_system=False)
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.post(
            "/api/v1/roles/custom/archive",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["is_archived"] is True
        assert response.json()["archived_at"] is not None

    async def test_cannot_archive_system_role(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.post(
            "/api/v1/roles/admin/archive",
            headers=auth_headers(admin),
        )
        assert response.status_code == 403

    async def test_cannot_archive_default_role(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        role = await create_role(
            db, key="default_role", label="Default", permissions={}, is_system=False
        )
        role.is_default = True
        await db.flush()
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.post(
            "/api/v1/roles/default_role/archive",
            headers=auth_headers(admin),
        )
        assert response.status_code == 409

    async def test_cannot_archive_already_archived(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        role = await create_role(
            db, key="already", label="Already", permissions={}, is_system=False
        )
        role.is_archived = True
        await db.flush()
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.post(
            "/api/v1/roles/already/archive",
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_restore_role(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        role = await create_role(
            db, key="restored", label="Restored", permissions={}, is_system=False
        )
        role.is_archived = True
        await db.flush()
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.post(
            "/api/v1/roles/restored/restore",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["is_archived"] is False

    async def test_restore_non_archived_returns_400(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        await create_role(db, key="active", label="Active", permissions={}, is_system=False)
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.post(
            "/api/v1/roles/active/restore",
            headers=auth_headers(admin),
        )
        assert response.status_code == 400


# ---------------------------------------------------------------------------
# Legacy app-level permission keys (pre-024 names)
# ---------------------------------------------------------------------------


class TestLegacyPermissionKeys:
    """A role map carrying the pre-024 permission names.

    Migration 033 renamed these in place, so an install that ran it is clean.
    They can still arrive afterwards through a workspace bundle exported from an
    instance that never did — and the roles admin renders only the keys the
    schema endpoint returns while resending the stored map verbatim, so such a
    key is invisible, un-removable, and would otherwise fail every save.
    """

    async def test_patch_with_legacy_keys_saves_and_renames_them(self, client, db):
        from sqlalchemy import select

        from app.models.role import Role

        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        await create_role(
            db,
            key="member",
            label="Member",
            is_system=False,
            permissions={"inventory.view": True, "subscriptions.view": True},
        )
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.patch(
            "/api/v1/roles/member",
            # What the admin panel sends: the stored map echoed back.
            json={
                "label": "Team Member",
                "permissions": {"inventory.view": True, "subscriptions.view": True},
            },
            headers=auth_headers(admin),
        )

        assert response.status_code == 200
        assert response.json()["label"] == "Team Member"
        stored = (
            await db.execute(select(Role.permissions).where(Role.key == "member"))
        ).scalar_one()
        # Renamed, not dropped — the role keeps the access it had.
        assert stored == {"inventory.view": True, "stakeholders.view": True}

    async def test_rename_preserves_a_false_value(self, client, db):
        """A role that did not hold the permission must not gain it."""
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        await create_role(db, key="member", label="Member", is_system=False, permissions={})
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.patch(
            "/api/v1/roles/member",
            json={"permissions": {"subscriptions.manage": False}},
            headers=auth_headers(admin),
        )

        assert response.status_code == 200
        assert response.json()["permissions"] == {"stakeholders.manage": False}

    async def test_create_renames_legacy_keys(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.post(
            "/api/v1/roles",
            json={
                "key": "auditor",
                "label": "Auditor",
                "permissions": {"inventory.quality_seal": True},
            },
            headers=auth_headers(admin),
        )

        assert response.status_code == 201
        assert response.json()["permissions"] == {"inventory.approval_status": True}

    async def test_unknown_key_still_rejected_alongside_a_legacy_one(self, client, db):
        """Forgiving the three known leftovers must not open the guard generally."""
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        await create_role(db, key="member", label="Member", is_system=False, permissions={})
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.patch(
            "/api/v1/roles/member",
            json={"permissions": {"subscriptions.view": True, "fake.permission": True}},
            headers=auth_headers(admin),
        )

        assert response.status_code == 422
        messages = " ".join(d.get("msg", "") for d in response.json()["detail"])
        assert "fake.permission" in messages
        assert "subscriptions.view" not in messages

    async def test_admin_wildcard_is_untouched(self, client, db):
        """`*` is a real app-level grant and must survive the rename pass."""
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.patch(
            "/api/v1/roles/admin",
            json={"permissions": {"*": True}},
            headers=auth_headers(admin),
        )

        assert response.status_code == 200
        assert response.json()["permissions"] == {"*": True}
