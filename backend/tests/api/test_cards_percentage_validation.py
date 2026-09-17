"""A ``percentage`` attribute is a number between 0 and 100 (#1111).

The type renders as a progress bar, so a value outside the bar is meaningless
rather than merely odd — the only numeric range check in the metamodel, and
the first one, so it is pinned on every write path a client can reach.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.core.permissions import MEMBER_PERMISSIONS
from app.services.card_write_service import _validate_percentage_attributes
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

SCHEMA = [
    {
        "section": "Delivery",
        "fields": [
            {"key": "progress", "label": "Progress", "type": "percentage", "weight": 1},
            {"key": "notes", "label": "Notes", "type": "text", "weight": 1},
        ],
    }
]


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_card_type(db, key="Initiative", label="Initiative", fields_schema=SCHEMA)
    admin = await create_user(db, email="admin@test.com", role="admin")
    return {"admin": admin, "headers": auth_headers(admin)}


class TestValidator:
    @pytest.mark.parametrize("value", [0, 100, 42.5, None, ""])
    async def test_accepts_bounds_decimals_and_blanks(self, db, env, value):
        await _validate_percentage_attributes(db, "Initiative", {"progress": value})

    @pytest.mark.parametrize("value", [-1, 101, 100.01, "abc", "50", True, [50]])
    async def test_rejects_out_of_range_and_non_numbers(self, db, env, value):
        with pytest.raises(HTTPException) as exc:
            await _validate_percentage_attributes(db, "Initiative", {"progress": value})
        assert exc.value.status_code == 422
        assert "between 0 and 100" in exc.value.detail

    async def test_other_field_types_are_ignored(self, db, env):
        await _validate_percentage_attributes(db, "Initiative", {"notes": "150"})

    async def test_unknown_type_is_a_noop(self, db, env):
        await _validate_percentage_attributes(db, "Nope", {"progress": 999})


class TestRoutes:
    async def test_create_rejects_and_accepts(self, client, env):
        bad = await client.post(
            "/api/v1/cards",
            json={"type": "Initiative", "name": "Bad", "attributes": {"progress": 120}},
            headers=env["headers"],
        )
        assert bad.status_code == 422
        good = await client.post(
            "/api/v1/cards",
            json={"type": "Initiative", "name": "Good", "attributes": {"progress": 35}},
            headers=env["headers"],
        )
        assert good.status_code == 201
        assert good.json()["attributes"]["progress"] == 35

    async def test_patch_rejects(self, client, db, env):
        card = await create_card(db, card_type="Initiative", name="Rollout")
        await db.commit()
        resp = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"attributes": {"progress": -5}},
            headers=env["headers"],
        )
        assert resp.status_code == 422

    async def test_bulk_create_rejects(self, client, env):
        resp = await client.post(
            "/api/v1/cards/bulk-create",
            json={
                "cards": [{"type": "Initiative", "name": "Bulk", "attributes": {"progress": 101}}]
            },
            headers=env["headers"],
        )
        assert resp.status_code == 422
