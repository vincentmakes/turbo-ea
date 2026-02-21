"""Integration tests for the stakeholder role definition endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

from tests.conftest import (
    auth_headers,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

# ---------------------------------------------------------------------------
# GET /metamodel/types/{type_key}/stakeholder-roles
# ---------------------------------------------------------------------------


class TestListStakeholderRoles:
    async def test_list_roles_for_type(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="observer", label="Observer"
        )

        response = await client.get(
            "/api/v1/metamodel/types/Application/stakeholder-roles",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        keys = [r["key"] for r in response.json()]
        assert "responsible" in keys
        assert "observer" in keys

    async def test_excludes_archived_by_default(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="archived_role",
            label="Archived",
            is_archived=True,
        )

        response = await client.get(
            "/api/v1/metamodel/types/Application/stakeholder-roles",
            headers=auth_headers(admin),
        )
        keys = [r["key"] for r in response.json()]
        assert "archived_role" not in keys

    async def test_nonexistent_type_returns_404(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.get(
            "/api/v1/metamodel/types/Nonexistent/stakeholder-roles",
            headers=auth_headers(admin),
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# POST /metamodel/types/{type_key}/stakeholder-roles
# ---------------------------------------------------------------------------


class TestCreateStakeholderRole:
    async def test_create_role(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles",
            json={
                "key": "technical_owner",
                "label": "Technical Owner",
                "permissions": {"card.view": True, "card.edit": True},
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 201
        data = response.json()
        assert data["key"] == "technical_owner"
        assert data["card_type_key"] == "Application"
        assert data["stakeholder_count"] == 0

    async def test_duplicate_key_returns_409(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles",
            json={"key": "responsible", "label": "Duplicate"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 409

    async def test_invalid_key_pattern_rejected(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles",
            json={"key": "BAD-KEY!", "label": "Bad"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 422

    async def test_unknown_permission_key_rejected(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles",
            json={
                "key": "bad_perms",
                "label": "Bad",
                "permissions": {"fake.permission": True},
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 422

    async def test_wildcard_not_allowed(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles",
            json={
                "key": "wildcard_role",
                "label": "Wildcard",
                "permissions": {"*": True},
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 422

    async def test_nonexistent_type_returns_404(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.post(
            "/api/v1/metamodel/types/Nonexistent/stakeholder-roles",
            json={"key": "test_role", "label": "Test"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# PATCH /metamodel/types/{type_key}/stakeholder-roles/{role_key}
# ---------------------------------------------------------------------------


class TestUpdateStakeholderRole:
    async def test_update_label(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )

        response = await client.patch(
            "/api/v1/metamodel/types/Application/stakeholder-roles/responsible",
            json={"label": "Primary Owner"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["label"] == "Primary Owner"

    async def test_cannot_update_archived(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="old_role",
            label="Old",
            is_archived=True,
        )

        response = await client.patch(
            "/api/v1/metamodel/types/Application/stakeholder-roles/old_role",
            json={"label": "Updated"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_nonexistent_returns_404(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")

        response = await client.patch(
            "/api/v1/metamodel/types/Application/stakeholder-roles/nonexistent",
            json={"label": "Nope"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# POST .../archive + .../restore
# ---------------------------------------------------------------------------


class TestArchiveRestoreStakeholderRole:
    async def test_archive_role(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="observer", label="Observer"
        )

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles/observer/archive",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["is_archived"] is True

    async def test_cannot_archive_last_active_role(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="only_role", label="Only Role"
        )

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles/only_role/archive",
            headers=auth_headers(admin),
        )
        assert response.status_code == 409

    async def test_cannot_archive_already_archived(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="already",
            label="Already",
            is_archived=True,
        )

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles/already/archive",
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_restore_role(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="archived_role",
            label="Archived",
            is_archived=True,
        )

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles/archived_role/restore",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["is_archived"] is False

    async def test_restore_non_archived_returns_400(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="active_role", label="Active"
        )

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles/active_role/restore",
            headers=auth_headers(admin),
        )
        assert response.status_code == 400


# ---------------------------------------------------------------------------
# GET /stakeholder-roles/permissions-schema
# ---------------------------------------------------------------------------


class TestCardPermissionsSchema:
    async def test_returns_schema(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.get(
            "/api/v1/stakeholder-roles/permissions-schema",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
        assert len(data) > 0
