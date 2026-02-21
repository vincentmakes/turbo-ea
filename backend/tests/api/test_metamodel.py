"""Integration tests for the /metamodel endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import pytest

from app.core.permissions import VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)


@pytest.fixture
async def metamodel_env(db):
    """Prerequisite data shared by all metamodel tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "viewer": viewer}


# ---------------------------------------------------------------------------
# Card types — CRUD
# ---------------------------------------------------------------------------


class TestListTypes:
    async def test_list_types(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")

        response = await client.get(
            "/api/v1/metamodel/types",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        keys = [t["key"] for t in response.json()]
        assert "Application" in keys

    async def test_hidden_types_excluded_by_default(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        ct = await create_card_type(db, key="HiddenType", label="Hidden")
        ct.is_hidden = True
        await db.flush()

        response = await client.get(
            "/api/v1/metamodel/types",
            headers=auth_headers(admin),
        )
        keys = [t["key"] for t in response.json()]
        assert "HiddenType" not in keys

    async def test_include_hidden(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        ct = await create_card_type(db, key="HiddenType", label="Hidden")
        ct.is_hidden = True
        await db.flush()

        response = await client.get(
            "/api/v1/metamodel/types?include_hidden=true",
            headers=auth_headers(admin),
        )
        keys = [t["key"] for t in response.json()]
        assert "HiddenType" in keys


class TestCreateType:
    async def test_create_custom_type(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        response = await client.post(
            "/api/v1/metamodel/types",
            json={"key": "CustomWidget", "label": "Custom Widget"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 201
        data = response.json()
        assert data["key"] == "CustomWidget"
        assert data["built_in"] is False
        # Default stakeholder roles injected
        role_keys = [r["key"] for r in data["stakeholder_roles"]]
        assert "responsible" in role_keys
        assert "observer" in role_keys

    async def test_duplicate_key_rejected(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")

        response = await client.post(
            "/api/v1/metamodel/types",
            json={"key": "Application", "label": "Duplicate"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_viewer_cannot_create(self, client, db, metamodel_env):
        viewer = metamodel_env["viewer"]
        response = await client.post(
            "/api/v1/metamodel/types",
            json={"key": "Blocked", "label": "Blocked"},
            headers=auth_headers(viewer),
        )
        assert response.status_code == 403


class TestUpdateType:
    async def test_update_label(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")

        response = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"label": "Enterprise Application"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["label"] == "Enterprise Application"

    async def test_update_nonexistent_returns_404(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        response = await client.patch(
            "/api/v1/metamodel/types/Nonexistent",
            json={"label": "Nope"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 404


class TestDeleteType:
    async def test_soft_delete_builtin(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        ct = await create_card_type(db, key="Application", label="Application")
        ct.built_in = True
        await db.flush()

        response = await client.delete(
            "/api/v1/metamodel/types/Application",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["status"] == "hidden"

    async def test_hard_delete_custom_no_cards(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Custom", label="Custom")

        response = await client.delete(
            "/api/v1/metamodel/types/Custom",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["status"] == "deleted"

    async def test_cannot_delete_custom_with_cards(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Custom", label="Custom")
        await create_card(db, card_type="Custom", name="A Card", user_id=admin.id)

        response = await client.delete(
            "/api/v1/metamodel/types/Custom",
            headers=auth_headers(admin),
        )
        assert response.status_code == 400


# ---------------------------------------------------------------------------
# Field / section / option usage
# ---------------------------------------------------------------------------


class TestFieldUsage:
    async def test_field_usage_counts_cards(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(
            db,
            key="Application",
            label="Application",
            fields_schema=[
                {"section": "General", "fields": [{"key": "cost", "type": "number", "weight": 1}]}
            ],
        )
        await create_card(
            db,
            card_type="Application",
            name="App1",
            user_id=admin.id,
            attributes={"cost": 100},
        )
        await create_card(
            db,
            card_type="Application",
            name="App2",
            user_id=admin.id,
            attributes={},
        )

        response = await client.get(
            "/api/v1/metamodel/types/Application/field-usage?field_key=cost",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["card_count"] == 1

    async def test_section_usage(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(
            db,
            key="Application",
            label="Application",
            fields_schema=[
                {
                    "section": "General",
                    "fields": [
                        {"key": "cost", "type": "number", "weight": 1},
                        {"key": "risk", "type": "text", "weight": 1},
                    ],
                }
            ],
        )
        await create_card(
            db,
            card_type="Application",
            name="App1",
            user_id=admin.id,
            attributes={"risk": "high"},
        )

        response = await client.get(
            "/api/v1/metamodel/types/Application/section-usage?field_keys=cost,risk",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["card_count"] == 1

    async def test_option_usage_single_select(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(
            db,
            key="Application",
            label="Application",
            fields_schema=[
                {
                    "section": "General",
                    "fields": [
                        {
                            "key": "risk",
                            "type": "single_select",
                            "weight": 1,
                            "options": [
                                {"key": "low", "label": "Low"},
                                {"key": "high", "label": "High"},
                            ],
                        }
                    ],
                }
            ],
        )
        await create_card(
            db,
            card_type="Application",
            name="App1",
            user_id=admin.id,
            attributes={"risk": "high"},
        )

        response = await client.get(
            "/api/v1/metamodel/types/Application/option-usage?field_key=risk&option_key=high",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["card_count"] == 1


# ---------------------------------------------------------------------------
# Relation types — CRUD
# ---------------------------------------------------------------------------


class TestRelationTypeCRUD:
    async def test_create_relation_type(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")

        response = await client.post(
            "/api/v1/metamodel/relation-types",
            json={
                "key": "app_to_itc",
                "label": "Uses",
                "source_type_key": "Application",
                "target_type_key": "ITComponent",
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 201
        data = response.json()
        assert data["key"] == "app_to_itc"
        assert data["source_type_key"] == "Application"
        assert data["target_type_key"] == "ITComponent"

    async def test_duplicate_source_target_rejected(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )

        response = await client.post(
            "/api/v1/metamodel/relation-types",
            json={
                "key": "app_to_itc_2",
                "label": "Also Uses",
                "source_type_key": "Application",
                "target_type_key": "ITComponent",
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_invalid_source_type_rejected(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")

        response = await client.post(
            "/api/v1/metamodel/relation-types",
            json={
                "key": "bad_rel",
                "label": "Bad",
                "source_type_key": "Nonexistent",
                "target_type_key": "Application",
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_list_relation_types(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )

        response = await client.get(
            "/api/v1/metamodel/relation-types",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        keys = [r["key"] for r in response.json()]
        assert "app_to_itc" in keys

    async def test_filter_by_type_key(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_card_type(db, key="DataObject", label="Data Object")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )
        await create_relation_type(
            db,
            key="app_to_data",
            source_type_key="Application",
            target_type_key="DataObject",
        )

        response = await client.get(
            "/api/v1/metamodel/relation-types?type_key=ITComponent",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        keys = [r["key"] for r in response.json()]
        assert "app_to_itc" in keys
        assert "app_to_data" not in keys

    async def test_update_relation_type(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )

        response = await client.patch(
            "/api/v1/metamodel/relation-types/app_to_itc",
            json={"label": "Runs On"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["label"] == "Runs On"

    async def test_cannot_change_endpoints_with_instances(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_card_type(db, key="DataObject", label="Data Object")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )
        c1 = await create_card(db, card_type="Application", name="App", user_id=admin.id)
        c2 = await create_card(db, card_type="ITComponent", name="ITC", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=c1.id, target_id=c2.id)

        response = await client.patch(
            "/api/v1/metamodel/relation-types/app_to_itc",
            json={"target_type_key": "DataObject"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_delete_relation_type_no_instances(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )

        response = await client.delete(
            "/api/v1/metamodel/relation-types/app_to_itc",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["status"] == "deleted"

    async def test_delete_with_instances_returns_409(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )
        c1 = await create_card(db, card_type="Application", name="App", user_id=admin.id)
        c2 = await create_card(db, card_type="ITComponent", name="ITC", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=c1.id, target_id=c2.id)

        response = await client.delete(
            "/api/v1/metamodel/relation-types/app_to_itc",
            headers=auth_headers(admin),
        )
        assert response.status_code == 409

    async def test_force_delete_with_instances(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )
        c1 = await create_card(db, card_type="Application", name="App", user_id=admin.id)
        c2 = await create_card(db, card_type="ITComponent", name="ITC", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=c1.id, target_id=c2.id)

        response = await client.delete(
            "/api/v1/metamodel/relation-types/app_to_itc?force=true",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200

    async def test_instance_count(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )
        c1 = await create_card(db, card_type="Application", name="App", user_id=admin.id)
        c2 = await create_card(db, card_type="ITComponent", name="ITC", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=c1.id, target_id=c2.id)

        response = await client.get(
            "/api/v1/metamodel/relation-types/app_to_itc/instance-count",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["instance_count"] == 1


class TestRestoreRelationType:
    async def test_restore_hidden(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
            built_in=True,
            is_hidden=True,
        )

        response = await client.post(
            "/api/v1/metamodel/relation-types/app_to_itc/restore",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["is_hidden"] is False

    async def test_restore_non_hidden_returns_400(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )

        response = await client.post(
            "/api/v1/metamodel/relation-types/app_to_itc/restore",
            headers=auth_headers(admin),
        )
        assert response.status_code == 400
