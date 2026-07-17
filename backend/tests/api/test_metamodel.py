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


class TestTypeColor:
    async def test_recolor_builtin_type(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application", built_in=True)

        response = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"color": "#B5D5FF"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["color"] == "#B5D5FF"

    @pytest.mark.parametrize("bad", ["blue", "#12345", "#12345g", "#1234567", 123, None])
    async def test_invalid_color_rejected_on_update(self, client, db, metamodel_env, bad):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application", built_in=True)

        response = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"color": bad},
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_invalid_color_rejected_on_create(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        response = await client.post(
            "/api/v1/metamodel/types",
            json={"key": "BadColor", "label": "Bad Color", "color": "not-a-color"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_default_color_serialized_for_builtin(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application", built_in=True)

        response = await client.get(
            "/api/v1/metamodel/types/Application",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        # Seed default for Application, regardless of the current color
        assert response.json()["default_color"] == "#0f7eb5"

    async def test_default_color_none_for_custom_type(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        response = await client.post(
            "/api/v1/metamodel/types",
            json={"key": "CustomWidget", "label": "Custom Widget", "color": "#123456"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 201
        assert response.json()["default_color"] is None

    async def test_reset_roundtrip(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application", built_in=True)

        await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"color": "#FFFFB5"},
            headers=auth_headers(admin),
        )
        response = await client.get(
            "/api/v1/metamodel/types/Application", headers=auth_headers(admin)
        )
        default = response.json()["default_color"]

        response = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"color": default},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["color"] == "#0f7eb5"


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

    async def test_self_relation_allowed_alongside_successor(self, client, db, metamodel_env):
        # A built-in successor self-relation must not block a custom self-relation
        # on the same pair (regression for discussion #690).
        admin = metamodel_env["admin"]
        await create_card_type(db, key="DataObject", label="Data Object")
        await create_relation_type(
            db,
            key="relDataObjectSuccessor",
            label="succeeds",
            source_type_key="DataObject",
            target_type_key="DataObject",
            built_in=True,
        )

        response = await client.post(
            "/api/v1/metamodel/relation-types",
            json={
                "key": "do_to_do",
                "label": "Derived From",
                "source_type_key": "DataObject",
                "target_type_key": "DataObject",
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 201

        # A second non-successor self-relation on the same pair is still rejected.
        response = await client.post(
            "/api/v1/metamodel/relation-types",
            json={
                "key": "do_to_do_2",
                "label": "Also Derived From",
                "source_type_key": "DataObject",
                "target_type_key": "DataObject",
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


class TestRelationAttributeValues:
    """Manage the relation 'type' picker (attributes_schema options).

    Built-in fields/options are locked-but-hideable; custom ones are fully
    editable; clients can never mint built-in entries.
    """

    BUILTIN_SCHEMA = [
        {
            "key": "usageType",
            "label": "Usage Type",
            "type": "single_select",
            "built_in": True,
            "options": [
                {"key": "owner", "label": "Owner", "color": "#1976d2", "built_in": True},
                {"key": "user", "label": "User", "color": "#66bb6a", "built_in": True},
            ],
        },
    ]

    async def _make_builtin_rel(self, db):
        await create_card_type(db, key="Organization", label="Organization")
        await create_card_type(db, key="Application", label="Application")
        rt = await create_relation_type(
            db,
            key="relOrgToApp",
            source_type_key="Organization",
            target_type_key="Application",
            built_in=True,
        )
        rt.attributes_schema = [dict(f) for f in self.BUILTIN_SCHEMA]
        await db.flush()
        return rt

    def _schema_with(self, options):
        return [
            {
                "key": "usageType",
                "label": "Usage Type",
                "type": "single_select",
                "built_in": True,
                "options": options,
            }
        ]

    async def test_add_custom_value_to_builtin_field(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await self._make_builtin_rel(db)

        new_opts = [
            {"key": "owner", "label": "Owner", "color": "#1976d2", "built_in": True},
            {"key": "user", "label": "User", "color": "#66bb6a", "built_in": True},
            {"key": "operator", "label": "Operator", "color": "#9c27b0"},
        ]
        response = await client.patch(
            "/api/v1/metamodel/relation-types/relOrgToApp",
            json={"attributes_schema": self._schema_with(new_opts)},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        opts = response.json()["attributes_schema"][0]["options"]
        by_key = {o["key"]: o for o in opts}
        assert by_key["operator"]["built_in"] is False
        assert by_key["owner"]["built_in"] is True
        assert {"owner", "user", "operator"} <= set(by_key)

    async def test_edit_builtin_value_label_rejected(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await self._make_builtin_rel(db)

        bad_opts = [
            {"key": "owner", "label": "Proprietor", "color": "#1976d2", "built_in": True},
            {"key": "user", "label": "User", "color": "#66bb6a", "built_in": True},
        ]
        response = await client.patch(
            "/api/v1/metamodel/relation-types/relOrgToApp",
            json={"attributes_schema": self._schema_with(bad_opts)},
            headers=auth_headers(admin),
        )
        assert response.status_code == 403

    async def test_remove_builtin_value_rejected(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await self._make_builtin_rel(db)

        response = await client.patch(
            "/api/v1/metamodel/relation-types/relOrgToApp",
            json={
                "attributes_schema": self._schema_with(
                    [{"key": "owner", "label": "Owner", "color": "#1976d2", "built_in": True}]
                )
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 403

    async def test_remove_builtin_field_rejected(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await self._make_builtin_rel(db)

        response = await client.patch(
            "/api/v1/metamodel/relation-types/relOrgToApp",
            json={"attributes_schema": []},
            headers=auth_headers(admin),
        )
        assert response.status_code == 403

    async def test_hide_builtin_value_allowed(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await self._make_builtin_rel(db)

        hidden_opts = [
            {"key": "owner", "label": "Owner", "color": "#1976d2", "built_in": True},
            {
                "key": "user",
                "label": "User",
                "color": "#66bb6a",
                "built_in": True,
                "hidden": True,
            },
        ]
        response = await client.patch(
            "/api/v1/metamodel/relation-types/relOrgToApp",
            json={"attributes_schema": self._schema_with(hidden_opts)},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        opts = {o["key"]: o for o in response.json()["attributes_schema"][0]["options"]}
        assert opts["user"]["hidden"] is True
        assert opts["owner"].get("hidden", False) is False

    async def test_add_new_dimension_to_relation_without_one(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="BusinessCapability", label="Business Capability")
        await create_relation_type(
            db,
            key="relAppToBC",
            source_type_key="Application",
            target_type_key="BusinessCapability",
            built_in=True,
        )

        response = await client.patch(
            "/api/v1/metamodel/relation-types/relAppToBC",
            json={
                "attributes_schema": [
                    {
                        "key": "supportType",
                        "label": "Support Type",
                        "type": "single_select",
                        "options": [{"key": "primary", "label": "Primary"}],
                    }
                ]
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        schema = response.json()["attributes_schema"]
        assert schema[0]["key"] == "supportType"
        assert schema[0]["built_in"] is False
        assert schema[0]["options"][0]["built_in"] is False

    async def test_client_cannot_mint_builtin_value(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="BusinessCapability", label="Business Capability")
        await create_relation_type(
            db,
            key="relAppToBC",
            source_type_key="Application",
            target_type_key="BusinessCapability",
            built_in=True,
        )

        response = await client.patch(
            "/api/v1/metamodel/relation-types/relAppToBC",
            json={
                "attributes_schema": [
                    {
                        "key": "supportType",
                        "label": "Support Type",
                        "type": "single_select",
                        "built_in": True,
                        "options": [{"key": "primary", "label": "Primary", "built_in": True}],
                    }
                ]
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        schema = response.json()["attributes_schema"]
        assert schema[0]["built_in"] is False
        assert schema[0]["options"][0]["built_in"] is False

    async def test_custom_relation_values_fully_editable(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        rt = await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
            built_in=False,
        )
        rt.attributes_schema = [
            {
                "key": "tier",
                "label": "Tier",
                "type": "single_select",
                "built_in": False,
                "options": [{"key": "a", "label": "A", "built_in": False}],
            }
        ]
        await db.flush()

        # Rename + remove the custom option freely.
        response = await client.patch(
            "/api/v1/metamodel/relation-types/app_to_itc",
            json={
                "attributes_schema": [
                    {
                        "key": "tier",
                        "label": "Renamed Tier",
                        "type": "single_select",
                        "options": [{"key": "b", "label": "B"}],
                    }
                ]
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        schema = response.json()["attributes_schema"]
        assert schema[0]["label"] == "Renamed Tier"
        assert [o["key"] for o in schema[0]["options"]] == ["b"]


# ---------------------------------------------------------------------------
# Lineage ("Supports Lineage") — auto-provision the successor relation type
# (issue #729)
# ---------------------------------------------------------------------------


class TestSuccessorRelationType:
    """Enabling has_successors must auto-create the self-referential
    rel{Key}Successor relation type the card-detail lineage section needs."""

    async def _fetch(self, client, admin, key):
        """Return the relation type dict for ``key`` (incl. hidden), or None."""
        resp = await client.get(
            "/api/v1/metamodel/relation-types?include_hidden=true",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        return next((r for r in resp.json() if r["key"] == key), None)

    async def test_enable_via_patch_creates_relation_type(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Widget", label="Widget")

        resp = await client.patch(
            "/api/v1/metamodel/types/Widget",
            json={"has_successors": True},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["has_successors"] is True

        rt = await self._fetch(client, admin, "relWidgetSuccessor")
        assert rt is not None
        assert rt["source_type_key"] == "Widget"
        assert rt["target_type_key"] == "Widget"
        assert rt["is_hidden"] is False
        assert rt["built_in"] is False
        assert rt["label"] == "succeeds"
        assert rt["translations"]  # non-empty i18n
        assert rt["translations"]["label"].get("en") == "succeeds"

    async def test_idempotent(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Widget", label="Widget")

        for _ in range(2):
            resp = await client.patch(
                "/api/v1/metamodel/types/Widget",
                json={"has_successors": True},
                headers=auth_headers(admin),
            )
            assert resp.status_code == 200

        listing = await client.get(
            "/api/v1/metamodel/relation-types?include_hidden=true",
            headers=auth_headers(admin),
        )
        matches = [r for r in listing.json() if r["key"] == "relWidgetSuccessor"]
        assert len(matches) == 1

    async def test_reenable_unhides(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Widget", label="Widget")

        # Enable, then hide the auto-created relation type manually.
        await client.patch(
            "/api/v1/metamodel/types/Widget",
            json={"has_successors": True},
            headers=auth_headers(admin),
        )
        await client.patch(
            "/api/v1/metamodel/relation-types/relWidgetSuccessor",
            json={"is_hidden": True},
            headers=auth_headers(admin),
        )
        hidden = await self._fetch(client, admin, "relWidgetSuccessor")
        assert hidden["is_hidden"] is True

        # Re-running the enable must un-hide the same row, not insert a second.
        await client.patch(
            "/api/v1/metamodel/types/Widget",
            json={"has_successors": True},
            headers=auth_headers(admin),
        )
        listing = await client.get(
            "/api/v1/metamodel/relation-types?include_hidden=true",
            headers=auth_headers(admin),
        )
        matches = [r for r in listing.json() if r["key"] == "relWidgetSuccessor"]
        assert len(matches) == 1
        assert matches[0]["is_hidden"] is False

    async def test_create_type_with_flag_creates_relation_type(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        resp = await client.post(
            "/api/v1/metamodel/types",
            json={"key": "Widget", "label": "Widget", "has_successors": True},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201

        rt = await self._fetch(client, admin, "relWidgetSuccessor")
        assert rt is not None
        assert rt["source_type_key"] == rt["target_type_key"] == "Widget"

    async def test_disable_leaves_relation_type(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Widget", label="Widget")
        await client.patch(
            "/api/v1/metamodel/types/Widget",
            json={"has_successors": True},
            headers=auth_headers(admin),
        )
        # Disabling must NOT delete the relation type (no silent data loss).
        await client.patch(
            "/api/v1/metamodel/types/Widget",
            json={"has_successors": False},
            headers=auth_headers(admin),
        )
        rt = await self._fetch(client, admin, "relWidgetSuccessor")
        assert rt is not None
        assert rt["is_hidden"] is False

    async def test_self_heal_when_flag_set_but_missing(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        # Simulate an install already in the #729 state: flag on, no relation type.
        ct = await create_card_type(db, key="Widget", label="Widget")
        ct.has_successors = True
        await db.flush()
        assert await self._fetch(client, admin, "relWidgetSuccessor") is None

        # Any save while has_successors stays true should provision the missing one.
        resp = await client.patch(
            "/api/v1/metamodel/types/Widget",
            json={"label": "Widget Renamed"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        rt = await self._fetch(client, admin, "relWidgetSuccessor")
        assert rt is not None
