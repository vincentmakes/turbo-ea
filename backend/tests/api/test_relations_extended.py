"""Extended integration tests for the /relations endpoints.

Tests relation constraint validation: nonexistent cards, duplicates,
attribute updates, and card_id filtering (both source and target).
"""

from __future__ import annotations

import uuid

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

pytestmark = pytest.mark.anyio


@pytest.fixture
async def rel_ext_env(db):
    """Prerequisite data for extended relation tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    app_type = await create_card_type(db, key="Application", label="Application")
    itc_type = await create_card_type(db, key="ITComponent", label="IT Component")
    rt = await create_relation_type(
        db,
        key="app_to_itc",
        label="Uses",
        source_type_key="Application",
        target_type_key="ITComponent",
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    source = await create_card(db, card_type="Application", name="Source App", user_id=admin.id)
    target = await create_card(db, card_type="ITComponent", name="Target ITC", user_id=admin.id)
    return {
        "admin": admin,
        "viewer": viewer,
        "app_type": app_type,
        "itc_type": itc_type,
        "rt": rt,
        "source": source,
        "target": target,
    }


# ---------------------------------------------------------------
# Nonexistent card IDs
# ---------------------------------------------------------------


class TestRelationNonexistentCards:
    async def test_create_with_nonexistent_source(self, client, db, rel_ext_env):
        """Creating a relation with a nonexistent source card ID should fail."""
        admin = rel_ext_env["admin"]
        fake_source = str(uuid.uuid4())
        resp = await client.post(
            "/api/v1/relations",
            json={
                "type": "app_to_itc",
                "source_id": fake_source,
                "target_id": str(rel_ext_env["target"].id),
            },
            headers=auth_headers(admin),
        )
        # The DB will reject a FK violation -- could be 422 or 500
        assert resp.status_code in (400, 422, 500)

    async def test_create_with_nonexistent_target(self, client, db, rel_ext_env):
        """Creating a relation with a nonexistent target card ID should fail."""
        admin = rel_ext_env["admin"]
        fake_target = str(uuid.uuid4())
        resp = await client.post(
            "/api/v1/relations",
            json={
                "type": "app_to_itc",
                "source_id": str(rel_ext_env["source"].id),
                "target_id": fake_target,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code in (400, 422, 500)


# ---------------------------------------------------------------
# Duplicate relation
# ---------------------------------------------------------------


class TestDuplicateRelation:
    async def test_create_duplicate_relation(self, client, db, rel_ext_env):
        """Creating the same relation twice (same source, target, type) should
        either succeed (allowing duplicates) or return an error. We test that the
        endpoint handles it gracefully -- no 500 crash."""
        admin = rel_ext_env["admin"]
        payload = {
            "type": "app_to_itc",
            "source_id": str(rel_ext_env["source"].id),
            "target_id": str(rel_ext_env["target"].id),
        }

        # First creation should succeed
        resp1 = await client.post(
            "/api/v1/relations",
            json=payload,
            headers=auth_headers(admin),
        )
        assert resp1.status_code == 201

        # Second creation: either succeeds (dup allowed) or returns 4xx
        resp2 = await client.post(
            "/api/v1/relations",
            json=payload,
            headers=auth_headers(admin),
        )
        assert resp2.status_code in (201, 400, 409)


# ---------------------------------------------------------------
# Update relation attributes
# ---------------------------------------------------------------


class TestUpdateRelationAttributes:
    async def test_update_relation_attributes(self, client, db, rel_ext_env):
        """PATCH /relations/{id} should accept an attributes dict update."""
        admin = rel_ext_env["admin"]
        rel = await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_ext_env["source"].id,
            target_id=rel_ext_env["target"].id,
        )
        resp = await client.patch(
            f"/api/v1/relations/{rel.id}",
            json={"attributes": {"criticality": "high"}, "description": "Critical link"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["attributes"]["criticality"] == "high"
        assert data["description"] == "Critical link"

    async def test_update_clears_description(self, client, db, rel_ext_env):
        """Setting description to None should clear it."""
        admin = rel_ext_env["admin"]
        rel = await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_ext_env["source"].id,
            target_id=rel_ext_env["target"].id,
            attributes={"note": "original"},
        )
        # First set a description
        await client.patch(
            f"/api/v1/relations/{rel.id}",
            json={"description": "Test desc"},
            headers=auth_headers(admin),
        )
        # Then clear it
        resp = await client.patch(
            f"/api/v1/relations/{rel.id}",
            json={"description": None},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["description"] is None


# ---------------------------------------------------------------
# List relations filtered by card_id (source AND target)
# ---------------------------------------------------------------


class TestListRelationsFiltered:
    async def test_filter_by_source_card_id(self, client, db, rel_ext_env):
        """GET /relations?card_id=<source_id> should return relations where
        the card appears as source."""
        admin = rel_ext_env["admin"]
        await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_ext_env["source"].id,
            target_id=rel_ext_env["target"].id,
        )
        resp = await client.get(
            f"/api/v1/relations?card_id={rel_ext_env['source'].id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        # The source card should appear as source in at least one relation
        source_ids = {r["source_id"] for r in data}
        assert str(rel_ext_env["source"].id) in source_ids

    async def test_filter_by_target_card_id(self, client, db, rel_ext_env):
        """GET /relations?card_id=<target_id> should return relations where
        the card appears as target."""
        admin = rel_ext_env["admin"]
        await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_ext_env["source"].id,
            target_id=rel_ext_env["target"].id,
        )
        resp = await client.get(
            f"/api/v1/relations?card_id={rel_ext_env['target'].id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        # The target card should appear as target in at least one relation
        target_ids = {r["target_id"] for r in data}
        assert str(rel_ext_env["target"].id) in target_ids

    async def test_filter_by_nonexistent_card_id(self, client, db, rel_ext_env):
        """Filtering by a card_id with no relations should return empty list."""
        admin = rel_ext_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.get(
            f"/api/v1/relations?card_id={fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_card_appears_in_both_directions(self, client, db, rel_ext_env):
        """If a card is both source and target of different relations, filtering
        by its card_id returns both."""
        admin = rel_ext_env["admin"]
        # Create a second Application card
        app2 = await create_card(db, card_type="Application", name="Another App", user_id=admin.id)
        # Create a relation type where Application can be a target too
        await create_relation_type(
            db,
            key="app_to_app",
            label="App to App",
            source_type_key="Application",
            target_type_key="Application",
        )
        # source -> target (original)
        await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_ext_env["source"].id,
            target_id=rel_ext_env["target"].id,
        )
        # app2 -> source (source is now target)
        await create_relation(
            db,
            type_key="app_to_app",
            source_id=app2.id,
            target_id=rel_ext_env["source"].id,
        )

        resp = await client.get(
            f"/api/v1/relations?card_id={rel_ext_env['source'].id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        # Should find at least 2 relations
        assert len(data) >= 2
