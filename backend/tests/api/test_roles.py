"""Integration tests for the /roles endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

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
