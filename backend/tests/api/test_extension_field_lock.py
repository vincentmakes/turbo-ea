"""Guard: extension-contributed card fields are written only while the extension is live.

A field an extension contributed to a card type (stamped ``ext: <key>``) keeps
rendering forever, but its value may only CHANGE while that extension is
enabled and licensed ("gate the pen, never the page"). Every writer is
covered: single and bulk REST, bulk create, the extension data bridge, the
rollback restore, and the metamodel API that could otherwise drop the stamp.
Uses a fake extension key and the in-memory registry seam.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from app.models.calculation import Calculation
from app.models.card import Card
from app.models.card_type import CardType
from app.services import rollback_service
from app.services.extensions import data_service as bridge_mod
from app.services.extensions.data_service import ExtensionData
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.registry import ExtensionInfo, extension_registry
from app.services.extensions.sdk import ExtensionDataError
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

OWNER = "sample-ext"
CONNECTOR = "sample-connector"
LOCKED_MESSAGE = (
    "These fields are read-only because the extension that provides them "
    "is not active or licensed: Score."
)

SCHEMA = [
    {
        "section": "Sample",
        "ext": OWNER,
        "fields": [
            {"key": "score", "label": "Score", "type": "number", "ext": OWNER},
        ],
    },
    {"section": "Own", "fields": [{"key": "note", "label": "Note", "type": "text"}]},
]


def _info(key: str, **overrides) -> ExtensionInfo:
    values = dict(key=key, name=key, version="1.0.0", status="installed", enabled=True)
    values.update(overrides)
    return ExtensionInfo(**values)


def load(*, owner_licensed: bool, owner: dict | None = None) -> None:
    """The owner extension (licensed or not) plus a licensed bridge connector."""
    extension_registry.clear()
    extension_registry.load_installed(
        [
            _info(OWNER, **(owner or {})),
            _info(CONNECTOR, manifest={"grants": ["core.cards.write"]}),
        ]
    )
    entitlements = [Entitlement(extension_key=CONNECTOR, expires_at=None)]
    if owner_licensed:
        entitlements.append(Entitlement(extension_key=OWNER, expires_at=None))
    extension_registry.set_license(
        LicenseDocument(
            licensee="ACME",
            customer_id="cus_1",
            issued_at=datetime.now(timezone.utc) - timedelta(days=1),
            grace_days=30,
            entitlements=entitlements,
        )
    )


@pytest.fixture(autouse=True)
def _registry(monkeypatch):
    extension_registry.clear()
    bridge_mod.reset_rate_limiter()
    # The metamodel routes reload the registry from the database; keep the
    # in-memory one this module sets up.
    monkeypatch.setattr(extension_registry, "refresh_from_db", AsyncMock())
    yield
    extension_registry.clear()
    bridge_mod.reset_rate_limiter()


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    await create_card_type(db, key="Gadget", label="Gadget", fields_schema=SCHEMA)
    card = await create_card(
        db, card_type="Gadget", name="G1", attributes={"score": 4, "note": "a"}
    )
    other = await create_card(
        db, card_type="Gadget", name="G2", attributes={"score": 2, "note": "b"}
    )
    await db.commit()
    return {"admin": admin, "card": card, "other": other}


async def _attrs(db, card) -> dict:
    await db.refresh(card)
    return dict(card.attributes or {})


class TestSinglePatch:
    async def test_lapsed_refuses_a_change(self, client, db, env):
        load(owner_licensed=False)
        resp = await client.patch(
            f"/api/v1/cards/{env['card'].id}",
            headers=auth_headers(env["admin"]),
            json={"attributes": {"score": 5, "note": "a"}},
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == {
            "error": "extension_fields_locked",
            "message": LOCKED_MESSAGE,
            "fields": ["score"],
        }
        assert await _attrs(db, env["card"]) == {"score": 4, "note": "a"}

    async def test_lapsed_unchanged_value_passes(self, client, db, env):
        load(owner_licensed=False)
        resp = await client.patch(
            f"/api/v1/cards/{env['card'].id}",
            headers=auth_headers(env["admin"]),
            json={"attributes": {"score": 4, "note": "changed"}},
        )
        assert resp.status_code == 200
        assert await _attrs(db, env["card"]) == {"score": 4, "note": "changed"}

    async def test_lapsed_absent_value_is_carried_over(self, client, db, env):
        load(owner_licensed=False)
        resp = await client.patch(
            f"/api/v1/cards/{env['card'].id}",
            headers=auth_headers(env["admin"]),
            json={"attributes": {"note": "changed"}},
        )
        assert resp.status_code == 200
        assert resp.json()["attributes"]["score"] == 4
        assert await _attrs(db, env["card"]) == {"score": 4, "note": "changed"}

    async def test_licensed_writes(self, client, db, env):
        load(owner_licensed=True)
        resp = await client.patch(
            f"/api/v1/cards/{env['card'].id}",
            headers=auth_headers(env["admin"]),
            json={"attributes": {"score": 5, "note": "a"}},
        )
        assert resp.status_code == 200
        assert await _attrs(db, env["card"]) == {"score": 5, "note": "a"}

    async def test_disabled_extension_manifest_key_stays_locked(self, client, db, env):
        # A disable strips the field from the schema but keeps the value; the
        # manifest still names it, so it stays read-only.
        manifest = {
            "metamodel": {
                "field_sections": [
                    {"card_type": "Gadget", "fields": [{"key": "score", "label": "Score"}]}
                ]
            }
        }
        load(owner_licensed=True, owner={"enabled": False, "manifest": manifest})
        type_row = (await db.execute(select(CardType).where(CardType.key == "Gadget"))).scalar_one()
        type_row.fields_schema = [SCHEMA[1]]
        await db.commit()
        resp = await client.patch(
            f"/api/v1/cards/{env['card'].id}",
            headers=auth_headers(env["admin"]),
            json={"attributes": {"score": 9, "note": "a"}},
        )
        assert resp.status_code == 403
        assert resp.json()["detail"]["fields"] == ["score"]


class TestCreate:
    async def test_lapsed_refuses_a_value(self, client, env):
        load(owner_licensed=False)
        resp = await client.post(
            "/api/v1/cards",
            headers=auth_headers(env["admin"]),
            json={"type": "Gadget", "name": "New", "attributes": {"score": 1}},
        )
        assert resp.status_code == 403
        assert resp.json()["detail"]["error"] == "extension_fields_locked"

    async def test_lapsed_without_the_field_creates(self, client, env):
        load(owner_licensed=False)
        resp = await client.post(
            "/api/v1/cards",
            headers=auth_headers(env["admin"]),
            json={"type": "Gadget", "name": "New", "attributes": {"note": "n"}},
        )
        assert resp.status_code == 201
        assert resp.json()["attributes"] == {"note": "n"}

    async def test_licensed_creates_with_the_field(self, client, env):
        load(owner_licensed=True)
        resp = await client.post(
            "/api/v1/cards",
            headers=auth_headers(env["admin"]),
            json={"type": "Gadget", "name": "New", "attributes": {"score": 1}},
        )
        assert resp.status_code == 201
        assert resp.json()["attributes"]["score"] == 1


class TestBulkUpdate:
    async def test_lapsed_change_is_a_whole_call_403(self, client, db, env):
        load(owner_licensed=False)
        resp = await client.patch(
            "/api/v1/cards/bulk",
            headers=auth_headers(env["admin"]),
            json={
                "ids": [str(env["card"].id), str(env["other"].id)],
                "updates": {"attributes": {"score": 5}},
            },
        )
        assert resp.status_code == 403
        assert resp.json()["detail"]["error"] == "extension_fields_locked"
        assert (await _attrs(db, env["other"]))["score"] == 2

    async def test_lapsed_omitted_field_keeps_each_cards_value(self, client, db, env):
        load(owner_licensed=False)
        resp = await client.patch(
            "/api/v1/cards/bulk",
            headers=auth_headers(env["admin"]),
            json={
                "ids": [str(env["card"].id), str(env["other"].id)],
                "updates": {"attributes": {"note": "same"}},
            },
        )
        assert resp.status_code == 200
        assert await _attrs(db, env["card"]) == {"score": 4, "note": "same"}
        assert await _attrs(db, env["other"]) == {"score": 2, "note": "same"}

    async def test_licensed_bulk_writes(self, client, db, env):
        load(owner_licensed=True)
        resp = await client.patch(
            "/api/v1/cards/bulk",
            headers=auth_headers(env["admin"]),
            json={"ids": [str(env["card"].id)], "updates": {"attributes": {"score": 7}}},
        )
        assert resp.status_code == 200
        assert await _attrs(db, env["card"]) == {"score": 7}


MAINTAINED_SCHEMA = [
    {
        "section": "Sample",
        "ext": OWNER,
        "fields": [
            {"key": "score", "label": "Score", "type": "number", "ext": OWNER},
            {"key": "auto", "label": "Auto", "type": "number", "ext": OWNER, "readonly": True},
            {"key": "calc", "label": "Calc", "type": "number", "ext": OWNER},
        ],
    },
    {"section": "Own", "fields": [{"key": "note", "label": "Note", "type": "text"}]},
]


class TestServerMaintainedLockedKeys:
    """A locked key the server recomputes (a readonly field, an active
    calculation's target) is carried over silently: a stale echo of it must
    not turn an unrelated edit into a licensing 403."""

    @pytest.fixture
    async def menv(self, db, env):
        await create_card_type(db, key="Widget", label="Widget", fields_schema=MAINTAINED_SCHEMA)
        db.add(
            Calculation(
                name="Constant",
                formula="10",
                target_type_key="Widget",
                target_field_key="calc",
                is_active=True,
            )
        )
        card = await create_card(
            db,
            card_type="Widget",
            name="W1",
            attributes={"score": 4, "auto": 5, "calc": 10, "note": "a"},
        )
        await db.commit()
        return {**env, "widget": card}

    async def test_single_patch_keeps_a_stale_readonly_and_calculated_value(self, client, db, menv):
        load(owner_licensed=False)
        resp = await client.patch(
            f"/api/v1/cards/{menv['widget'].id}",
            headers=auth_headers(menv["admin"]),
            json={"attributes": {"score": 4, "auto": 1, "calc": 3, "note": "changed"}},
        )
        assert resp.status_code == 200, resp.text
        assert await _attrs(db, menv["widget"]) == {
            "score": 4,
            "auto": 5,
            "calc": 10,
            "note": "changed",
        }

    async def test_single_patch_still_refuses_an_ordinary_locked_key(self, client, db, menv):
        load(owner_licensed=False)
        resp = await client.patch(
            f"/api/v1/cards/{menv['widget'].id}",
            headers=auth_headers(menv["admin"]),
            json={"attributes": {"score": 9, "auto": 1, "calc": 3, "note": "changed"}},
        )
        assert resp.status_code == 403
        assert resp.json()["detail"]["fields"] == ["score"]

    async def test_inactive_calculation_target_is_not_maintained(self, client, db, menv):
        calc = (await db.execute(select(Calculation))).scalar_one()
        calc.is_active = False
        await db.commit()
        load(owner_licensed=False)
        resp = await client.patch(
            f"/api/v1/cards/{menv['widget'].id}",
            headers=auth_headers(menv["admin"]),
            json={"attributes": {"score": 4, "calc": 3, "note": "changed"}},
        )
        assert resp.status_code == 403
        assert resp.json()["detail"]["fields"] == ["calc"]

    async def test_bulk_patch_keeps_each_cards_maintained_value(self, client, db, menv):
        load(owner_licensed=False)
        other = await create_card(
            db,
            card_type="Widget",
            name="W2",
            attributes={"score": 2, "auto": 6, "calc": 10, "note": "b"},
        )
        await db.commit()
        resp = await client.patch(
            "/api/v1/cards/bulk",
            headers=auth_headers(menv["admin"]),
            json={
                "ids": [str(menv["widget"].id), str(other.id)],
                "updates": {"attributes": {"auto": 0, "calc": 0, "note": "same"}},
            },
        )
        assert resp.status_code == 200, resp.text
        assert await _attrs(db, menv["widget"]) == {
            "score": 4,
            "auto": 5,
            "calc": 10,
            "note": "same",
        }
        assert await _attrs(db, other) == {"score": 2, "auto": 6, "calc": 10, "note": "same"}

    async def test_bulk_patch_still_refuses_an_ordinary_locked_key(self, client, db, menv):
        load(owner_licensed=False)
        resp = await client.patch(
            "/api/v1/cards/bulk",
            headers=auth_headers(menv["admin"]),
            json={
                "ids": [str(menv["widget"].id)],
                "updates": {"attributes": {"score": 1, "auto": 0, "note": "same"}},
            },
        )
        assert resp.status_code == 403
        assert resp.json()["detail"]["fields"] == ["score"]


class TestBulkCreate:
    async def test_lapsed_row_fails_with_the_message(self, client, env):
        load(owner_licensed=False)
        resp = await client.post(
            "/api/v1/cards/bulk-create",
            headers=auth_headers(env["admin"]),
            json={
                "cards": [
                    {"row_index": 0, "type": "Gadget", "name": "A", "attributes": {"score": 3}},
                    {"row_index": 1, "type": "Gadget", "name": "B", "attributes": {"note": "x"}},
                ]
            },
        )
        assert resp.status_code == 200
        results = resp.json()["results"]
        assert results[0]["status"] == "failed"
        assert results[0]["error"] == LOCKED_MESSAGE
        assert results[1]["status"] == "created"

    async def test_licensed_row_is_created(self, client, env):
        load(owner_licensed=True)
        resp = await client.post(
            "/api/v1/cards/bulk-create",
            headers=auth_headers(env["admin"]),
            json={
                "cards": [
                    {"row_index": 0, "type": "Gadget", "name": "A", "attributes": {"score": 3}}
                ]
            },
        )
        assert resp.json()["results"][0]["status"] == "created"


class TestBridge:
    @pytest.fixture(autouse=True)
    def _session(self, monkeypatch, db):
        @asynccontextmanager
        async def fake_session():
            yield db

        monkeypatch.setattr(bridge_mod, "async_session", fake_session)

    async def test_lapsed_owner_refuses_another_extensions_write(self, db, env):
        load(owner_licensed=False)
        with pytest.raises(ExtensionDataError) as exc:
            await ExtensionData(CONNECTOR).update_card(
                str(env["card"].id), {"attributes": {"score": 9}}
            )
        assert str(exc.value) == LOCKED_MESSAGE

    async def test_lapsed_owner_lets_other_keys_through(self, db, env):
        load(owner_licensed=False)
        out = await ExtensionData(CONNECTOR).update_card(
            str(env["card"].id), {"attributes": {"note": "via bridge"}}
        )
        assert out.attributes == {"score": 4, "note": "via bridge"}

    async def test_licensed_owner_writes(self, db, env):
        load(owner_licensed=True)
        out = await ExtensionData(CONNECTOR).update_card(
            str(env["card"].id), {"attributes": {"score": 9}}
        )
        assert out.attributes["score"] == 9


class TestRollbackRestore:
    def _op(self, card, attributes: dict) -> dict:
        return {
            "op": "restore_card_fields",
            "card_id": str(card.id),
            "fields": {"attributes": attributes, "name": "Restored"},
        }

    async def test_lapsed_keeps_the_current_value_and_reports_it(self, db, env):
        load(owner_licensed=False)
        out = await rollback_service._apply_restore_card_fields(
            db, self._op(env["card"], {"score": 1, "note": "old"})
        )
        assert out["status"] == "ok"
        assert out["locked_fields"] == ["score"]
        await db.flush()
        card = (await db.execute(select(Card).where(Card.id == env["card"].id))).scalar_one()
        assert card.attributes == {"score": 4, "note": "old"}
        assert card.name == "Restored"

    async def test_lapsed_reports_a_locked_key_the_batch_added(self, db, env):
        # The snapshot is the whole column: "score" missing from it means the
        # batch added it. It cannot be removed while locked, so it stays — and
        # the op must say so rather than report a clean restore.
        load(owner_licensed=False)
        out = await rollback_service._apply_restore_card_fields(
            db, self._op(env["card"], {"note": "old"})
        )
        assert out["status"] == "ok"
        assert out["locked_fields"] == ["score"]
        await db.flush()
        card = (await db.execute(select(Card).where(Card.id == env["card"].id))).scalar_one()
        assert card.attributes == {"score": 4, "note": "old"}

    async def test_lapsed_unchanged_locked_key_is_not_reported(self, db, env):
        load(owner_licensed=False)
        out = await rollback_service._apply_restore_card_fields(
            db, self._op(env["card"], {"score": 4, "note": "old"})
        )
        assert out == {**self._op(env["card"], {"score": 4, "note": "old"}), "status": "ok"}
        assert env["card"].attributes == {"score": 4, "note": "old"}

    async def test_licensed_restores_everything(self, db, env):
        load(owner_licensed=True)
        out = await rollback_service._apply_restore_card_fields(
            db, self._op(env["card"], {"score": 1, "note": "old"})
        )
        assert out == {**self._op(env["card"], {"score": 1, "note": "old"}), "status": "ok"}
        assert env["card"].attributes == {"score": 1, "note": "old"}


def _field(type_json: dict, key: str) -> dict:
    for section in type_json["fields_schema"]:
        for f in section["fields"]:
            if f["key"] == key:
                return f
    raise AssertionError(key)


class TestMetamodel:
    async def test_types_flag_locked_fields(self, client, env):
        load(owner_licensed=False)
        resp = await client.get("/api/v1/metamodel/types", headers=auth_headers(env["admin"]))
        gadget = next(t for t in resp.json() if t["key"] == "Gadget")
        assert _field(gadget, "score")["ext_locked"] is True
        assert "ext_locked" not in _field(gadget, "note")

    async def test_types_flag_nothing_when_licensed(self, client, env):
        load(owner_licensed=True)
        resp = await client.get(
            "/api/v1/metamodel/types/Gadget", headers=auth_headers(env["admin"])
        )
        assert "ext_locked" not in _field(resp.json(), "score")

    async def test_patch_cannot_drop_or_add_a_stamp(self, client, db, env):
        load(owner_licensed=False)
        body = [
            {
                "section": "Sample",
                "fields": [
                    # stamp dropped, transient flag echoed back
                    {"key": "score", "label": "Score", "type": "number", "ext_locked": True},
                ],
            },
            {
                "section": "Own",
                # stamp invented on an admin's own field
                "fields": [{"key": "note", "label": "Note", "type": "text", "ext": OWNER}],
            },
        ]
        resp = await client.patch(
            "/api/v1/metamodel/types/Gadget",
            headers=auth_headers(env["admin"]),
            json={"fields_schema": body},
        )
        assert resp.status_code == 200
        stored = (await db.execute(select(CardType).where(CardType.key == "Gadget"))).scalar_one()
        await db.refresh(stored)
        fields = {f["key"]: f for s in stored.fields_schema for f in s["fields"]}
        assert fields["score"] == {"key": "score", "label": "Score", "type": "number", "ext": OWNER}
        assert fields["note"] == {"key": "note", "label": "Note", "type": "text"}

        # And the field is still locked for card writes.
        resp = await client.patch(
            f"/api/v1/cards/{env['card'].id}",
            headers=auth_headers(env["admin"]),
            json={"attributes": {"score": 5, "note": "a"}},
        )
        assert resp.status_code == 403

    async def test_create_type_cannot_mint_a_stamp(self, client, env):
        resp = await client.post(
            "/api/v1/metamodel/types",
            headers=auth_headers(env["admin"]),
            json={
                "key": "Widget",
                "label": "Widget",
                "fields_schema": [
                    {"section": "S", "fields": [{"key": "x", "type": "text", "ext": OWNER}]}
                ],
            },
        )
        assert resp.status_code == 201
        assert "ext" not in _field(resp.json(), "x")


class TestMetamodelHelpers:
    """The two schema helpers of ``api/v1/metamodel.py`` on malformed entries:
    a junk section or field is passed over, never the end of the walk."""

    def test_stamps_survive_junk_and_fieldless_sections(self):
        from app.services.extensions.contribution_guard import preserve_ext_schema

        old = [
            "junk",
            {"section": "No fields"},
            {"section": "Sample", "fields": ["junk", {"key": "score", "ext": OWNER}]},
        ]
        new = [
            "junk",
            {"section": "No fields"},
            {
                "section": "Sample",
                "fields": [
                    "junk",
                    {"key": "score", "ext_locked": True},
                    {"key": "note", "ext": "claimed"},
                    {"key": "plain"},
                ],
            },
        ]
        assert preserve_ext_schema(new, old, frozenset()).schema == [
            "junk",
            {"section": "No fields"},
            {
                "section": "Sample",
                "fields": [
                    "junk",
                    {"key": "score", "ext": OWNER},
                    {"key": "note"},
                    {"key": "plain"},
                ],
            },
        ]

    def test_protect_flags_alone_are_still_written(self):
        """A licensed, active owner: nothing is locked, but what it stamped is
        protected — a protected field alone, or a protected section alone,
        still gets its flag."""
        from app.api.v1.metamodel import _schema_with_lock_flags

        load(owner_licensed=True)
        stamped = {"key": "score", "label": "Score", "ext": OWNER}
        plain = {"key": "note", "label": "Note"}
        field_only = [{"section": "Own", "fields": [stamped, plain]}]
        assert _schema_with_lock_flags("Gadget", field_only) == [
            {"section": "Own", "fields": [{**stamped, "ext_protected": True}, plain]}
        ]
        section_only = [{"section": "Sample", "ext": OWNER, "fields": [plain]}]
        assert _schema_with_lock_flags("Gadget", section_only) == [
            {"section": "Sample", "ext": OWNER, "fields": [plain], "ext_protected": True}
        ]
        assert _schema_with_lock_flags("Gadget", [{"section": "Own", "fields": [plain]}]) == [
            {"section": "Own", "fields": [plain]}
        ]

    def test_lock_flags_keep_junk_and_fieldless_sections_in_place(self):
        from app.api.v1.metamodel import _schema_with_lock_flags

        extension_registry.clear()
        stamped = {"key": "score", "label": "Score", "ext": OWNER}
        schema = ["junk", {"section": "Empty"}, {"section": "Sample", "fields": [stamped]}]
        assert _schema_with_lock_flags("Gadget", schema) == [
            "junk",
            {"section": "Empty", "fields": []},
            {"section": "Sample", "fields": [{**stamped, "ext_locked": True}]},
        ]
        assert schema[2]["fields"] == [stamped]
