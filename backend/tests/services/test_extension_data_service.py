"""The SDK inventory data bridge, read half (SDK 1.5): grant gating,
wire-shaped payloads, and GET /cards filter parity.

Same harness as the todos/users bridge tests: the bridge opens its own
sessions via ``async_session`` (patched to the savepoint-rollback test
session) and the in-memory ``extension_registry`` singleton is driven
directly.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.services.extensions import data_service as bridge_mod
from app.services.extensions.data_service import ExtensionData
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.registry import ExtensionInfo, extension_registry
from app.services.extensions.sdk import ExtCard, ExtensionPermissionError
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
)

NOW = datetime.now(timezone.utc)
KEY = "sample-connector"


def load_registry(*, grants: list[str], enabled: bool = True, status: str = "installed") -> None:
    extension_registry.clear()
    extension_registry.load_installed(
        [
            ExtensionInfo(
                key=KEY,
                name="Sample Connector",
                version="1.0.0",
                status=status,
                enabled=enabled,
                manifest={"grants": grants},
            )
        ]
    )
    extension_registry.set_license(
        LicenseDocument(
            licensee="ACME",
            customer_id="cus_1",
            issued_at=NOW - timedelta(days=1),
            grace_days=30,
            entitlements=[Entitlement(extension_key=KEY, expires_at=None)],
        )
    )


@pytest.fixture(autouse=True)
def _registry_cleanup():
    extension_registry.clear()
    yield
    extension_registry.clear()


@pytest.fixture(autouse=True)
def _patch_session(monkeypatch, db):
    @asynccontextmanager
    async def fake_session():
        yield db

    monkeypatch.setattr(bridge_mod, "async_session", fake_session)


@pytest.fixture
async def env(db):
    app_type = await create_card_type(db, key="Application", label="Application")
    itc_type = await create_card_type(db, key="ITComponent", label="IT Component")
    hidden_type = await create_card_type(db, key="HiddenType", label="Hidden", is_hidden=True)
    rt = await create_relation_type(db, key="app_to_itc")
    app = await create_card(db, card_type="Application", name="Billing Service")
    micro = await create_card(
        db, card_type="Application", name="Auth Service", subtype="Microservice"
    )
    archived = await create_card(
        db, card_type="Application", name="Legacy Portal", status="ARCHIVED"
    )
    hidden_card = await create_card(db, card_type="HiddenType", name="Ghost")
    itc = await create_card(db, card_type="ITComponent", name="PostgreSQL")
    rel = await create_relation(db, type_key="app_to_itc", source_id=app.id, target_id=itc.id)
    return {
        "app_type": app_type,
        "itc_type": itc_type,
        "hidden_type": hidden_type,
        "rt": rt,
        "app": app,
        "micro": micro,
        "archived": archived,
        "hidden_card": hidden_card,
        "itc": itc,
        "rel": rel,
    }


class TestGrantGating:
    async def test_no_grant_blocks_every_read(self, db, env):
        load_registry(grants=[])
        bridge = ExtensionData(KEY)
        with pytest.raises(ExtensionPermissionError):
            await bridge.get_card(str(env["app"].id))
        with pytest.raises(ExtensionPermissionError):
            await bridge.search_cards()
        with pytest.raises(ExtensionPermissionError):
            await bridge.get_relations(str(env["app"].id))
        with pytest.raises(ExtensionPermissionError):
            await bridge.get_card_types()
        with pytest.raises(ExtensionPermissionError):
            await bridge.get_relation_types()

    async def test_other_core_grants_do_not_imply_cards(self, db, env):
        load_registry(grants=["core.todos.read", "core.users.read"])
        bridge = ExtensionData(KEY)
        with pytest.raises(ExtensionPermissionError):
            await bridge.get_card(str(env["app"].id))

    async def test_write_grant_implies_read(self, db, env):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        assert await bridge.get_card(str(env["app"].id)) is not None

    async def test_disable_revokes_mid_run(self, db, env):
        load_registry(grants=["core.cards.read"])
        bridge = ExtensionData(KEY)
        assert await bridge.get_card(str(env["app"].id)) is not None
        load_registry(grants=["core.cards.read"], enabled=False)
        with pytest.raises(ExtensionPermissionError):
            await bridge.get_card(str(env["app"].id))

    async def test_unlicensed_revokes(self, db, env):
        load_registry(grants=["core.cards.read"])
        extension_registry.set_license(None)
        bridge = ExtensionData(KEY)
        with pytest.raises(ExtensionPermissionError):
            await bridge.get_card(str(env["app"].id))


class TestGetCard:
    async def test_returns_wire_shaped_card(self, db, env):
        load_registry(grants=["core.cards.read"])
        card = await ExtensionData(KEY).get_card(str(env["app"].id))
        assert isinstance(card, ExtCard)
        assert card.id == str(env["app"].id)
        assert card.name == "Billing Service"
        assert card.type == "Application"
        assert isinstance(card.attributes, dict)
        # Frozen — a handler can never mutate a card through the payload.
        with pytest.raises(AttributeError):
            card.name = "x"  # type: ignore[misc]

    async def test_missing_or_malformed_id_returns_none(self, db, env):
        load_registry(grants=["core.cards.read"])
        bridge = ExtensionData(KEY)
        assert await bridge.get_card("not-a-uuid") is None
        assert await bridge.get_card("00000000-0000-0000-0000-000000000000") is None


class TestSearchCards:
    async def test_filters_by_type_and_subtype(self, db, env):
        load_registry(grants=["core.cards.read"])
        bridge = ExtensionData(KEY)
        page = await bridge.search_cards(type="Application")
        names = {c.name for c in page.items}
        assert names == {"Billing Service", "Auth Service"}
        micro_page = await bridge.search_cards(type="Application", subtype="Microservice")
        assert [c.name for c in micro_page.items] == ["Auth Service"]

    async def test_excludes_archived_unless_asked(self, db, env):
        load_registry(grants=["core.cards.read"])
        bridge = ExtensionData(KEY)
        active = await bridge.search_cards(type="Application")
        assert "Legacy Portal" not in {c.name for c in active.items}
        everything = await bridge.search_cards(type="Application", include_archived=True)
        assert "Legacy Portal" in {c.name for c in everything.items}

    async def test_hidden_type_cards_never_surface(self, db, env):
        load_registry(grants=["core.cards.read"])
        page = await ExtensionData(KEY).search_cards()
        assert "Ghost" not in {c.name for c in page.items}

    async def test_search_and_pagination(self, db, env):
        load_registry(grants=["core.cards.read"])
        bridge = ExtensionData(KEY)
        hits = await bridge.search_cards(search="billing")
        assert [c.name for c in hits.items] == ["Billing Service"]
        page1 = await bridge.search_cards(type="Application", page=1, page_size=1)
        page2 = await bridge.search_cards(type="Application", page=2, page_size=1)
        assert page1.total == 2 and page2.total == 2
        assert len(page1.items) == 1 and len(page2.items) == 1
        assert page1.items[0].id != page2.items[0].id

    async def test_page_size_is_capped(self, db, env):
        load_registry(grants=["core.cards.read"])
        page = await ExtensionData(KEY).search_cards(page_size=999999)
        assert page.page_size == bridge_mod.MAX_PAGE_SIZE


class TestGetRelations:
    async def test_both_directions(self, db, env):
        load_registry(grants=["core.cards.read"])
        bridge = ExtensionData(KEY)
        from_app = await bridge.get_relations(str(env["app"].id))
        from_itc = await bridge.get_relations(str(env["itc"].id))
        assert [r.id for r in from_app] == [str(env["rel"].id)]
        assert [r.id for r in from_itc] == [str(env["rel"].id)]
        assert from_app[0].source_id == str(env["app"].id)
        assert from_app[0].target_id == str(env["itc"].id)

    async def test_archived_endpoint_hides_relation(self, db, env):
        load_registry(grants=["core.cards.read"])
        env["itc"].status = "ARCHIVED"
        await db.flush()
        assert await ExtensionData(KEY).get_relations(str(env["app"].id)) == []

    async def test_malformed_id_returns_empty(self, db, env):
        load_registry(grants=["core.cards.read"])
        assert await ExtensionData(KEY).get_relations("nope") == []


class TestMetamodelSnapshots:
    async def test_card_types_are_plain_dicts_excluding_hidden(self, db, env):
        load_registry(grants=["core.cards.read"])
        types = await ExtensionData(KEY).get_card_types()
        keys = {t["key"] for t in types}
        assert "Application" in keys and "ITComponent" in keys
        assert "HiddenType" not in keys
        app = next(t for t in types if t["key"] == "Application")
        assert set(app) >= {"key", "label", "has_hierarchy", "fields_schema", "subtypes"}

    async def test_relation_types_are_plain_dicts(self, db, env):
        load_registry(grants=["core.cards.read"])
        rts = await ExtensionData(KEY).get_relation_types()
        rt = next(r for r in rts if r["key"] == "app_to_itc")
        assert rt["source_type_key"] == "Application"
        assert rt["target_type_key"] == "ITComponent"


class TestSessionDiscipline:
    def test_every_public_method_opens_its_own_short_session(self):
        """Source-level guard (same style as test_db_session_holding): the
        bridge must open ``async_session`` per call and never accept a
        caller's session — that is what keeps a slow extension handler from
        pinning a pooled connection."""
        src = Path(bridge_mod.__file__).read_text(encoding="utf-8")
        assert "async with async_session() as db" in src
        assert "Depends(" not in src
