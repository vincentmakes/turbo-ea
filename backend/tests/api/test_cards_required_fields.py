"""Integration tests for mandatory (required) field enforcement on card writes.

The rule (issue #931 follow-up): a write may never transition a required field
from non-empty to empty. Creation stays permissive — cards may be born with
required fields still empty (they just score 0 data quality until filled) —
and writing empty over already-empty passes, so imports and incomplete cards
keep working. Boolean and readonly (calculated) fields are exempt.
"""

from __future__ import annotations

import pytest

from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)

_SCHEMA = [
    {
        "section": "General",
        "fields": [
            {"key": "criticality", "label": "Criticality", "type": "text", "required": True},
            {
                "key": "hostingModel",
                "label": "Hosting Model",
                "type": "multiple_select",
                "required": True,
                "options": [
                    {"key": "cloud", "label": "Cloud"},
                    {"key": "onprem", "label": "On-premise"},
                ],
            },
            {"key": "isGdpr", "label": "GDPR", "type": "boolean", "required": True},
            {
                "key": "computedScore",
                "label": "Score",
                "type": "number",
                "required": True,
                "readonly": True,
            },
            {"key": "notes", "label": "Notes", "type": "text"},
        ],
    }
]


@pytest.fixture
async def required_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_card_type(db, key="StrictApp", label="Strict App", fields_schema=_SCHEMA)
    admin = await create_user(db, email="admin@test.com", role="admin")
    return {"admin": admin}


class TestCreateStaysPermissive:
    async def test_create_without_required_fields_is_allowed(self, client, db, required_env):
        response = await client.post(
            "/api/v1/cards",
            json={"type": "StrictApp", "name": "Incomplete"},
            headers=auth_headers(required_env["admin"]),
        )
        assert response.status_code == 201
        # The mandatory-field gate pins the score to 0 until the fields are filled.
        assert response.json()["data_quality"] == 0.0


class TestPatchRejectsClearing:
    async def test_clearing_required_text_field_is_rejected(self, client, db, required_env):
        card = await create_card(
            db, card_type="StrictApp", attributes={"criticality": "high", "notes": "n"}
        )
        response = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"attributes": {"criticality": "", "notes": "n"}},
            headers=auth_headers(required_env["admin"]),
        )
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["code"] == "required_field_empty"
        assert detail["field_keys"] == ["criticality"]
        assert "Criticality" in detail["message"]

    async def test_clearing_required_multiselect_is_rejected(self, client, db, required_env):
        card = await create_card(db, card_type="StrictApp", attributes={"hostingModel": ["cloud"]})
        response = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"attributes": {"hostingModel": []}},
            headers=auth_headers(required_env["admin"]),
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "required_field_empty"

    async def test_attribute_wipe_payload_is_rejected(self, client, db, required_env):
        """`{"attributes": {}}` is a full-replace wipe and must be caught."""
        card = await create_card(db, card_type="StrictApp", attributes={"criticality": "high"})
        response = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"attributes": {}},
            headers=auth_headers(required_env["admin"]),
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "required_field_empty"

    async def test_empty_over_empty_is_allowed(self, client, db, required_env):
        """A card born incomplete stays editable — writing empty over empty passes."""
        card = await create_card(db, card_type="StrictApp", attributes={})
        response = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"attributes": {"notes": "updated"}},
            headers=auth_headers(required_env["admin"]),
        )
        assert response.status_code == 200
        assert response.json()["attributes"]["notes"] == "updated"

    async def test_filling_required_field_is_allowed(self, client, db, required_env):
        card = await create_card(db, card_type="StrictApp", attributes={"criticality": "high"})
        response = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"attributes": {"criticality": "low", "hostingModel": ["cloud"]}},
            headers=auth_headers(required_env["admin"]),
        )
        assert response.status_code == 200

    async def test_boolean_and_readonly_required_are_exempt(self, client, db, required_env):
        card = await create_card(
            db,
            card_type="StrictApp",
            attributes={"criticality": "high", "isGdpr": True, "computedScore": 42},
        )
        # Dropping the boolean and the readonly field is fine; the enforced
        # required field rides along untouched.
        response = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"attributes": {"criticality": "high"}},
            headers=auth_headers(required_env["admin"]),
        )
        assert response.status_code == 200


class TestBulkPatchRejectsClearing:
    async def test_bulk_clearing_required_field_is_rejected(self, client, db, required_env):
        card1 = await create_card(
            db, card_type="StrictApp", name="C1", attributes={"criticality": "high"}
        )
        card2 = await create_card(db, card_type="StrictApp", name="C2", attributes={})
        response = await client.patch(
            "/api/v1/cards/bulk",
            json={
                "ids": [str(card1.id), str(card2.id)],
                "updates": {"attributes": {"criticality": None}},
            },
            headers=auth_headers(required_env["admin"]),
        )
        # card1 has the value → clearing it must be rejected (card2 alone would pass).
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "required_field_empty"

    async def test_bulk_empty_over_empty_is_allowed(self, client, db, required_env):
        card = await create_card(db, card_type="StrictApp", name="C3", attributes={})
        response = await client.patch(
            "/api/v1/cards/bulk",
            json={
                "ids": [str(card.id)],
                "updates": {"attributes": {"notes": "bulk"}},
            },
            headers=auth_headers(required_env["admin"]),
        )
        assert response.status_code == 200
