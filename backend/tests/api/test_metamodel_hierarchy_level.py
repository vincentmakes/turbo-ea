"""Metamodel auto-injection of the hierarchyLevel field (#810).

Creating or updating a type with has_hierarchy=True must auto-add a readonly
number field keyed ``hierarchyLevel``; disabling hierarchy removes the injected
field def (but not card data); a pre-existing admin ``hierarchyLevel`` field is
never hijacked.
"""

from __future__ import annotations

import pytest

from app.core.permissions import VIEWER_PERMISSIONS
from app.services.hierarchy import HIERARCHY_LEVEL_KEY
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user


@pytest.fixture
async def mm_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    return {"admin": admin}


def _field_keys(schema):
    return [f.get("key") for s in schema for f in s.get("fields", [])]


class TestMetamodelInjection:
    async def test_create_hierarchical_type_injects_field(self, client, db, mm_env):
        admin = mm_env["admin"]
        r = await client.post(
            "/api/v1/metamodel/types",
            json={"key": "Widget", "label": "Widget", "has_hierarchy": True, "fields_schema": []},
            headers=auth_headers(admin),
        )
        assert r.status_code == 201, r.text
        assert HIERARCHY_LEVEL_KEY in _field_keys(r.json()["fields_schema"])

    async def test_create_non_hierarchical_type_no_field(self, client, db, mm_env):
        admin = mm_env["admin"]
        r = await client.post(
            "/api/v1/metamodel/types",
            json={"key": "Widget", "label": "Widget", "has_hierarchy": False, "fields_schema": []},
            headers=auth_headers(admin),
        )
        assert r.status_code == 201, r.text
        assert HIERARCHY_LEVEL_KEY not in _field_keys(r.json()["fields_schema"])

    async def test_enable_hierarchy_injects_and_backfills(self, client, db, mm_env):
        admin = mm_env["admin"]
        await create_card_type(db, key="Widget", label="Widget", has_hierarchy=False)
        root = await create_card(db, card_type="Widget", name="Root")
        child = await create_card(db, card_type="Widget", name="Child", parent_id=root.id)

        r = await client.patch(
            "/api/v1/metamodel/types/Widget",
            json={"has_hierarchy": True},
            headers=auth_headers(admin),
        )
        assert r.status_code == 200, r.text
        assert HIERARCHY_LEVEL_KEY in _field_keys(r.json()["fields_schema"])

        # Existing cards were backfilled.
        await db.refresh(root)
        await db.refresh(child)
        assert root.attributes[HIERARCHY_LEVEL_KEY] == 1
        assert child.attributes[HIERARCHY_LEVEL_KEY] == 2

    async def test_disable_hierarchy_removes_field_keeps_data(self, client, db, mm_env):
        admin = mm_env["admin"]
        await create_card_type(
            db,
            key="Widget",
            label="Widget",
            has_hierarchy=True,
            fields_schema=[
                {
                    "section": "General",
                    "fields": [
                        {
                            "key": HIERARCHY_LEVEL_KEY,
                            "label": "Hierarchy Level",
                            "type": "number",
                            "readonly": True,
                            "weight": 0,
                        },
                    ],
                }
            ],
        )
        card = await create_card(
            db, card_type="Widget", name="C", attributes={HIERARCHY_LEVEL_KEY: 1}
        )

        r = await client.patch(
            "/api/v1/metamodel/types/Widget",
            json={"has_hierarchy": False},
            headers=auth_headers(admin),
        )
        assert r.status_code == 200, r.text
        # Field def stripped ...
        assert HIERARCHY_LEVEL_KEY not in _field_keys(r.json()["fields_schema"])
        # ... but the stored attribute value survives.
        await db.refresh(card)
        assert card.attributes[HIERARCHY_LEVEL_KEY] == 1

    async def test_existing_admin_field_not_hijacked(self, client, db, mm_env):
        admin = mm_env["admin"]
        # Admin already owns a hierarchyLevel field with a different shape.
        custom = {"key": HIERARCHY_LEVEL_KEY, "label": "My Level", "type": "text", "weight": 1}
        await create_card_type(
            db,
            key="Widget",
            label="Widget",
            has_hierarchy=True,
            fields_schema=[{"section": "General", "fields": [custom]}],
        )
        r = await client.patch(
            "/api/v1/metamodel/types/Widget",
            json={"label": "Widget!"},
            headers=auth_headers(admin),
        )
        assert r.status_code == 200, r.text
        fields = [
            f
            for s in r.json()["fields_schema"]
            for f in s.get("fields", [])
            if f["key"] == HIERARCHY_LEVEL_KEY
        ]
        # Still exactly one, still the admin's text field (never duplicated/overwritten).
        assert len(fields) == 1
        assert fields[0]["type"] == "text"
        assert fields[0]["label"] == "My Level"
