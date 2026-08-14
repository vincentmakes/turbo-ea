"""Select-typed attribute values must be declared options (#940).

Free text used to be accepted verbatim into a single/multiple select field —
the mass-edit dialog and the inventory grid both offered a bare text box — so
the card ended up holding a value that renders as an unknown chip and that no
filter or report can group. The UI now offers pickers; these tests pin the
server side so no other client can reintroduce it.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.api.v1.cards import _check_select_options
from app.core.permissions import MEMBER_PERMISSIONS
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

SCHEMA = [
    {
        "section": "General",
        "fields": [
            {
                "key": "riskLevel",
                "label": "Risk Level",
                "type": "single_select",
                "weight": 1,
                "options": [{"key": "low", "label": "Low"}, {"key": "high", "label": "High"}],
            },
            {
                "key": "regions",
                "label": "Regions",
                "type": "multiple_select",
                "weight": 1,
                "options": [{"key": "emea", "label": "EMEA"}, {"key": "apac", "label": "APAC"}],
            },
            {
                "key": "tier",
                "label": "Tier",
                "type": "single_select",
                "weight": 1,
                "readonly": True,
                "options": [{"key": "gold", "label": "Gold"}],
            },
            {"key": "notes", "label": "Notes", "type": "text", "weight": 1},
        ],
    }
]


# ---------------------------------------------------------------------------
# Pure checker — no database
# ---------------------------------------------------------------------------


class TestCheckSelectOptions:
    def test_accepts_declared_options(self):
        _check_select_options("Application", SCHEMA, {"riskLevel": "low"}, {})
        _check_select_options("Application", SCHEMA, {"regions": ["emea", "apac"]}, {})

    def test_rejects_free_text_single_select(self):
        with pytest.raises(HTTPException) as exc:
            _check_select_options("Application", SCHEMA, {"riskLevel": "medium"}, {})
        assert exc.value.status_code == 422
        assert exc.value.detail["code"] == "invalid_option_value"
        assert exc.value.detail["field_keys"] == ["riskLevel"]

    def test_rejects_unknown_key_in_multiple_select(self):
        with pytest.raises(HTTPException) as exc:
            _check_select_options("Application", SCHEMA, {"regions": ["emea", "nowhere"]}, {})
        assert "'nowhere'" in exc.value.detail["message"]

    def test_rejects_bare_string_for_multiple_select(self):
        # The reported bug: the mass-edit text box wrote a string into a field
        # that holds a list. Rejected rather than comma-split — silent coercion
        # is how the bad data got in.
        with pytest.raises(HTTPException) as exc:
            _check_select_options("Application", SCHEMA, {"regions": "emea"}, {})
        assert "expects a list" in exc.value.detail["message"]

    @pytest.mark.parametrize("empty", [None, "", []])
    def test_empty_values_pass(self, empty):
        """Clearing a field is not a validation failure."""
        _check_select_options("Application", SCHEMA, {"riskLevel": empty, "regions": empty}, {})

    def test_readonly_fields_are_skipped(self):
        # The calculation engine writes computed values into readonly select
        # targets; same exemption _check_required_not_cleared makes.
        _check_select_options("Application", SCHEMA, {"tier": "not-an-option"}, {})

    def test_unchanged_legacy_value_is_grandfathered(self):
        """Re-saving a card that already holds a bad value must not fail."""
        _check_select_options(
            "Application", SCHEMA, {"riskLevel": "legacy"}, {"riskLevel": "legacy"}
        )

    def test_changing_a_legacy_value_to_another_bad_one_still_fails(self):
        with pytest.raises(HTTPException):
            _check_select_options(
                "Application", SCHEMA, {"riskLevel": "still-bad"}, {"riskLevel": "legacy"}
            )

    def test_untouched_keys_are_ignored(self):
        """A partial payload must not be judged on keys it does not carry."""
        _check_select_options("Application", SCHEMA, {"notes": "hi"}, {"riskLevel": "legacy"})

    def test_no_schema_is_a_noop(self):
        _check_select_options("Application", None, {"riskLevel": "anything"}, {})


# ---------------------------------------------------------------------------
# HTTP endpoints
# ---------------------------------------------------------------------------


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_card_type(db, key="Application", label="Application", fields_schema=SCHEMA)
    admin = await create_user(db, email="admin@test.com", role="admin")
    return {"admin": admin}


class TestCreateCard:
    async def test_rejects_free_text_select(self, client, db, env):
        response = await client.post(
            "/api/v1/cards",
            json={
                "type": "Application",
                "name": "Bad App",
                "attributes": {"regions": "somewhere"},
            },
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "invalid_option_value"

    async def test_accepts_declared_options(self, client, db, env):
        response = await client.post(
            "/api/v1/cards",
            json={
                "type": "Application",
                "name": "Good App",
                "attributes": {"regions": ["emea"], "riskLevel": "high"},
            },
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 201
        assert response.json()["attributes"]["regions"] == ["emea"]


class TestPatchCard:
    async def test_rejects_free_text_select(self, client, db, env):
        card = await create_card(db, name="App")
        response = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"attributes": {"regions": "typed by hand"}},
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 422
        assert response.json()["detail"]["field_keys"] == ["regions"]

    async def test_accepts_option_keys(self, client, db, env):
        card = await create_card(db, name="App")
        response = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"attributes": {"regions": ["emea", "apac"]}},
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 200
        assert response.json()["attributes"]["regions"] == ["emea", "apac"]

    async def test_clearing_is_allowed(self, client, db, env):
        card = await create_card(db, name="App", attributes={"regions": ["emea"]})
        response = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"attributes": {"regions": None}},
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 200
        assert response.json()["attributes"]["regions"] is None

    async def test_legacy_bad_value_stays_editable(self, client, db, env):
        """A card that already carries an invalid value must not become
        un-editable — the write path only judges what is actually changing."""
        card = await create_card(db, name="App", attributes={"regions": "legacy free text"})
        response = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"attributes": {"regions": "legacy free text", "notes": "still editable"}},
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 200
        assert response.json()["attributes"]["notes"] == "still editable"


class TestBulkEndpoints:
    async def test_bulk_update_rejects_free_text_select(self, client, db, env):
        card = await create_card(db, name="App")
        response = await client.patch(
            "/api/v1/cards/bulk",
            json={"ids": [str(card.id)], "updates": {"attributes": {"riskLevel": "medium"}}},
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "invalid_option_value"

    async def test_bulk_update_accepts_option_keys(self, client, db, env):
        card = await create_card(db, name="App")
        response = await client.patch(
            "/api/v1/cards/bulk",
            json={"ids": [str(card.id)], "updates": {"attributes": {"riskLevel": "low"}}},
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 200

    async def test_bulk_create_rejects_free_text_select(self, client, db, env):
        response = await client.post(
            "/api/v1/cards/bulk-create",
            json={
                "cards": [
                    {
                        "row_index": 1,
                        "type": "Application",
                        "name": "Bad Row",
                        "attributes": {"regions": ["made up"]},
                    }
                ]
            },
            headers=auth_headers(env["admin"]),
        )
        # bulk-create reports per row rather than failing the batch, so the
        # importer can show the offending spreadsheet row.
        assert response.status_code == 200
        body = response.json()
        assert body["created"] == 0 and body["failed"] == 1
        assert "valid options: emea, apac" in body["results"][0]["error"]
