"""Extension-gated field capabilities on the metamodel API.

Custom (`ext.*`) field types are inert core plumbing: authorable only when an
installed, licensed extension grants `metamodel.custom_field_types`. The free
core (no extensions) must downgrade a new one on write, while an already-stored
custom type is grandfathered so a lapse never blocks edits or mutates data.

Field help text is a core feature since 2.174.0 (#1297): it is written exactly
as sent, with or without any grant.
"""

from __future__ import annotations

import pytest

from app.services.extensions.registry import extension_registry
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)

BOTH_GRANTS = {"metamodel.field_help", "metamodel.custom_field_types"}


@pytest.fixture
async def admin(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    return await create_user(db, email="admin@test.com", role="admin")


@pytest.fixture(autouse=True)
def _clear_registry():
    extension_registry.clear()
    yield
    extension_registry.clear()


def _schema_with_gated_field():
    return [
        {
            "section": "Details",
            "fields": [
                {
                    "key": "score",
                    "label": "Score",
                    "type": "ext.plus.rating",
                    "config": {"min": 1, "max": 5},
                    "help": "Rate 1 to 5.",
                    "helpTranslations": {"en": "Rate 1 to 5.", "de": "Bewerten 1 bis 5."},
                }
            ],
        }
    ]


def _field(type_json: dict) -> dict:
    return type_json["fields_schema"][0]["fields"][0]


class TestUngatedStripsGatedAttributes:
    async def test_create_keeps_help_and_strips_custom_type(self, client, db, admin):
        resp = await client.post(
            "/api/v1/metamodel/types",
            headers=auth_headers(admin),
            json={"key": "Gadget", "label": "Gadget", "fields_schema": _schema_with_gated_field()},
        )
        assert resp.status_code == 201
        f = _field(resp.json())
        # Custom type coerced to text; help text is core (#1297) and kept.
        assert f["type"] == "text"
        assert f["help"] == "Rate 1 to 5."
        assert f["helpTranslations"] == {"en": "Rate 1 to 5.", "de": "Bewerten 1 bis 5."}

    async def test_create_keeps_help_on_a_plain_field(self, client, db, admin):
        schema = [
            {
                "section": "Details",
                "fields": [
                    {
                        "key": "owner",
                        "label": "Owner",
                        "type": "text",
                        "help": "Who answers for it.",
                        "helpTranslations": {"fr": "Qui en répond."},
                    }
                ],
            }
        ]
        resp = await client.post(
            "/api/v1/metamodel/types",
            headers=auth_headers(admin),
            json={"key": "Gadget", "label": "Gadget", "fields_schema": schema},
        )
        assert resp.status_code == 201
        f = _field(resp.json())
        assert f["type"] == "text"
        assert f["help"] == "Who answers for it."
        assert f["helpTranslations"] == {"fr": "Qui en répond."}


class TestBuiltInTypesAreNeverGated:
    async def test_percentage_survives_without_any_grant(self, client, db, admin):
        # #1111: `percentage` is a free built-in like `number`, so the strip
        # that coerces ungranted `ext.*` types to text must leave it alone.
        schema = [
            {
                "section": "Delivery",
                "fields": [{"key": "progress", "label": "Progress", "type": "percentage"}],
            }
        ]
        resp = await client.post(
            "/api/v1/metamodel/types",
            headers=auth_headers(admin),
            json={"key": "Gadget", "label": "Gadget", "fields_schema": schema},
        )
        assert resp.status_code == 201
        assert _field(resp.json())["type"] == "percentage"


class TestGrantedKeepsGatedAttributes:
    async def test_create_keeps_help_and_custom_type(self, client, db, admin, monkeypatch):
        monkeypatch.setattr(
            extension_registry, "granted_capabilities", lambda now=None: set(BOTH_GRANTS)
        )
        resp = await client.post(
            "/api/v1/metamodel/types",
            headers=auth_headers(admin),
            json={"key": "Gadget", "label": "Gadget", "fields_schema": _schema_with_gated_field()},
        )
        assert resp.status_code == 201
        f = _field(resp.json())
        assert f["type"] == "ext.plus.rating"
        assert f["config"] == {"min": 1, "max": 5}
        assert f["help"] == "Rate 1 to 5."
        assert f["helpTranslations"]["de"] == "Bewerten 1 bis 5."


class TestGrandfathering:
    async def test_ungated_update_preserves_stored_help(self, client, db, admin):
        # Seed a type that already carries help + a custom type (direct DB write
        # bypasses gating, simulating a value authored while licensed).
        await create_card_type(
            db,
            key="Gadget",
            label="Gadget",
            fields_schema=_schema_with_gated_field(),
        )
        await db.commit()

        # Ungated PATCH that leaves the gated attributes intact but changes an
        # unrelated attribute must NOT strip the grandfathered values.
        resp = await client.patch(
            "/api/v1/metamodel/types/Gadget",
            headers=auth_headers(admin),
            json={"label": "Gadget renamed", "fields_schema": _schema_with_gated_field()},
        )
        assert resp.status_code == 200
        f = _field(resp.json())
        assert f["type"] == "ext.plus.rating"
        assert f["help"] == "Rate 1 to 5."

    async def test_ungated_update_writes_changed_help_as_sent(self, client, db, admin):
        await create_card_type(
            db,
            key="Gadget",
            label="Gadget",
            fields_schema=_schema_with_gated_field(),
        )
        await db.commit()

        # Changing the help text needs no grant (#1297): it is written as sent,
        # while the grandfathered custom type stays untouched.
        changed = _schema_with_gated_field()
        changed[0]["fields"][0]["help"] = "Rate from one (poor) to five (excellent)."
        changed[0]["fields"][0]["helpTranslations"] = {"fr": "Notez de 1 à 5."}
        resp = await client.patch(
            "/api/v1/metamodel/types/Gadget",
            headers=auth_headers(admin),
            json={"fields_schema": changed},
        )
        assert resp.status_code == 200
        f = _field(resp.json())
        assert f["help"] == "Rate from one (poor) to five (excellent)."
        assert f["helpTranslations"] == {"fr": "Notez de 1 à 5."}
        assert f["type"] == "ext.plus.rating"

    async def test_ungated_update_clears_help_as_sent(self, client, db, admin):
        await create_card_type(
            db,
            key="Gadget",
            label="Gadget",
            fields_schema=_schema_with_gated_field(),
        )
        await db.commit()

        cleared = _schema_with_gated_field()
        del cleared[0]["fields"][0]["help"]
        del cleared[0]["fields"][0]["helpTranslations"]
        resp = await client.patch(
            "/api/v1/metamodel/types/Gadget",
            headers=auth_headers(admin),
            json={"fields_schema": cleared},
        )
        assert resp.status_code == 200
        f = _field(resp.json())
        assert "help" not in f
        assert "helpTranslations" not in f

    async def test_ungated_update_reverts_a_changed_custom_type(self, client, db, admin):
        await create_card_type(
            db,
            key="Gadget",
            label="Gadget",
            fields_schema=_schema_with_gated_field(),
        )
        await db.commit()

        # Switching to a DIFFERENT custom type without the grant is not
        # grandfathered: the stored value is not ext.*-free, so it falls to text.
        changed = _schema_with_gated_field()
        changed[0]["fields"][0]["type"] = "ext.plus.stars"
        resp = await client.patch(
            "/api/v1/metamodel/types/Gadget",
            headers=auth_headers(admin),
            json={"fields_schema": changed},
        )
        assert resp.status_code == 200
        assert _field(resp.json())["type"] == "text"


class TestContributedFieldRemovalPreservesData:
    async def test_removing_ext_field_keeps_card_values(self, client, db, admin):
        """Dropping an extension-owned field must not hard-delete card data."""
        ext_schema = [
            {
                "section": "ESG Metrics",
                "ext": "esg-pack",
                "fields": [
                    {
                        "key": "esgRating",
                        "label": "ESG Rating",
                        "type": "number",
                        "ext": "esg-pack",
                    }
                ],
            }
        ]
        await create_card_type(db, key="Gadget", label="Gadget", fields_schema=ext_schema)
        card = await create_card(db, card_type="Gadget", name="G1", attributes={"esgRating": 4})
        await db.commit()

        # Admin edits the type and drops the contributed field entirely.
        resp = await client.patch(
            "/api/v1/metamodel/types/Gadget",
            headers=auth_headers(admin),
            json={"fields_schema": [{"section": "ESG Metrics", "fields": []}]},
        )
        assert resp.status_code == 200

        await db.refresh(card)
        # The stored value survives so re-enabling the extension restores it.
        assert card.attributes.get("esgRating") == 4
