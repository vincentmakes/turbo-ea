"""Integration tests for the built-in hierarchyLevel attribute (#810 / #812).

Covers: create-time sync for a non-BusinessCapability hierarchical type,
descendant re-leveling + calculation re-run on re-parent, non-hierarchical
types never receiving the attribute, and BusinessCapability keeping both
capabilityLevel and the new raw hierarchyLevel.
"""

from __future__ import annotations

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.calculation import Calculation
from tests.conftest import auth_headers, create_card_type, create_role, create_user


@pytest.fixture
async def hier_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_card_type(
        db,
        key="Organization",
        label="Organization",
        has_hierarchy=True,
        fields_schema=[
            {
                "section": "General",
                "fields": [
                    {
                        "key": "hierarchyLevel",
                        "label": "Hierarchy Level",
                        "type": "number",
                        "readonly": True,
                        "weight": 0,
                    },
                    {"key": "depthScore", "label": "Depth Score", "type": "number", "weight": 0},
                ],
            }
        ],
    )
    await create_card_type(db, key="Provider", label="Provider", has_hierarchy=False)
    admin = await create_user(db, email="admin@test.com", role="admin")
    return {"admin": admin}


class TestHierarchyLevelSync:
    async def test_create_sets_level_by_depth(self, client, db, hier_env):
        admin = hier_env["admin"]

        async def make(name, parent_id=None):
            r = await client.post(
                "/api/v1/cards",
                json={"type": "Organization", "name": name, "parent_id": parent_id},
                headers=auth_headers(admin),
            )
            assert r.status_code == 201, r.text
            return r.json()

        root = await make("Root")
        child = await make("Child", root["id"])
        grandchild = await make("GC", child["id"])

        assert root["attributes"]["hierarchyLevel"] == 1
        assert child["attributes"]["hierarchyLevel"] == 2
        assert grandchild["attributes"]["hierarchyLevel"] == 3

    async def test_non_hierarchical_type_never_gets_attribute(self, client, db, hier_env):
        admin = hier_env["admin"]
        r = await client.post(
            "/api/v1/cards",
            json={"type": "Provider", "name": "Acme"},
            headers=auth_headers(admin),
        )
        assert r.status_code == 201, r.text
        assert "hierarchyLevel" not in (r.json().get("attributes") or {})

    async def test_reparent_updates_descendants_and_reruns_calc(self, client, db, hier_env):
        admin = hier_env["admin"]

        # A calculation that mirrors the live hierarchy_level into depthScore.
        db.add(
            Calculation(
                name="depth",
                target_type_key="Organization",
                target_field_key="depthScore",
                formula="hierarchy_level",
                is_active=True,
                execution_order=0,
            )
        )
        await db.flush()

        async def make(name, parent_id=None):
            r = await client.post(
                "/api/v1/cards",
                json={"type": "Organization", "name": name, "parent_id": parent_id},
                headers=auth_headers(admin),
            )
            assert r.status_code == 201, r.text
            return r.json()

        root = await make("Root")
        mid = await make("Mid", root["id"])
        leaf = await make("Leaf", mid["id"])

        # leaf starts at level 3, depthScore 3
        assert leaf["attributes"]["hierarchyLevel"] == 3
        assert leaf["attributes"]["depthScore"] == 3

        # Re-parent Mid up to be a root → Mid becomes L1, Leaf becomes L2.
        r = await client.patch(
            f"/api/v1/cards/{mid['id']}",
            json={"parent_id": None},
            headers=auth_headers(admin),
        )
        assert r.status_code == 200, r.text

        leaf_after = (
            await client.get(f"/api/v1/cards/{leaf['id']}", headers=auth_headers(admin))
        ).json()
        assert leaf_after["attributes"]["hierarchyLevel"] == 2
        # The calc re-ran on the descendant during the cascade.
        assert leaf_after["attributes"]["depthScore"] == 2


class TestBusinessCapabilityBothLevels:
    async def test_bizcap_gets_both_level_fields(self, client, db, hier_env):
        admin = hier_env["admin"]
        # Minimal BusinessCapability type with both level fields present.
        await create_card_type(
            db,
            key="BusinessCapability",
            label="Business Capability",
            has_hierarchy=True,
            fields_schema=[
                {
                    "section": "Capability Information",
                    "fields": [
                        {
                            "key": "capabilityLevel",
                            "label": "Capability Level",
                            "type": "single_select",
                            "readonly": True,
                            "weight": 0,
                            "options": [
                                {"key": k, "label": k}
                                for k in ["Macro", "L1", "L2", "L3", "L4", "L5"]
                            ],
                        },
                        {
                            "key": "hierarchyLevel",
                            "label": "Hierarchy Level",
                            "type": "number",
                            "readonly": True,
                            "weight": 0,
                        },
                    ],
                }
            ],
        )

        async def make(name, parent_id=None, attributes=None):
            r = await client.post(
                "/api/v1/cards",
                json={
                    "type": "BusinessCapability",
                    "name": name,
                    "parent_id": parent_id,
                    "attributes": attributes or {},
                },
                headers=auth_headers(admin),
            )
            assert r.status_code == 201, r.text
            return r.json()

        # A macro root, pinned via its attribute.
        macro = await make("Macro Cap", attributes={"capabilityLevel": "Macro"})
        child = await make("Child Cap", macro["id"])

        # Macro keeps capabilityLevel=Macro but gets a raw hierarchyLevel of 1.
        assert macro["attributes"]["capabilityLevel"] == "Macro"
        assert macro["attributes"]["hierarchyLevel"] == 1
        # Macro's child resolves to L1 (macro occupies position 0) with raw level 2.
        assert child["attributes"]["capabilityLevel"] == "L1"
        assert child["attributes"]["hierarchyLevel"] == 2
