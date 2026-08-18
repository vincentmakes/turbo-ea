"""The SDK inventory data bridge, write half (SDK 1.5): guardrails, audit
provenance, batching, dry-run, and the merge semantics.

Same harness as the read-half tests; writes additionally assert the
``ext:{key}`` mutation-batch trail and the ``data["ext"]`` event stamp the
event dispatcher's self-origin filter keys off.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.config import settings
from app.models.card import Card
from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.models.relation import Relation
from app.services.extensions import data_service as bridge_mod
from app.services.extensions.data_service import ExtensionData
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.registry import ExtensionInfo, extension_registry
from app.services.extensions.sdk import ExtensionDataError, ExtensionPermissionError
from tests.conftest import create_card, create_card_type, create_relation_type

NOW = datetime.now(timezone.utc)
KEY = "sample-connector"


def load_registry(*, grants: list[str], enabled: bool = True) -> None:
    extension_registry.clear()
    extension_registry.load_installed(
        [
            ExtensionInfo(
                key=KEY,
                name="Sample Connector",
                version="1.0.0",
                status="installed",
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
    bridge_mod.reset_rate_limiter()
    yield
    extension_registry.clear()
    bridge_mod.reset_rate_limiter()


@pytest.fixture(autouse=True)
def _patch_session(monkeypatch, db):
    @asynccontextmanager
    async def fake_session():
        yield db

    monkeypatch.setattr(bridge_mod, "async_session", fake_session)


@pytest.fixture
async def env(db):
    await create_card_type(
        db,
        key="Application",
        label="Application",
        fields_schema=[
            {
                "section": "Main",
                "fields": [
                    {
                        "key": "criticality",
                        "label": "Criticality",
                        "type": "single_select",
                        "options": [{"key": "high", "label": "High"}],
                    }
                ],
            }
        ],
    )
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_relation_type(db, key="app_to_itc")
    return {}


async def _batches(db) -> list[MutationBatch]:
    return list((await db.execute(select(MutationBatch))).scalars().all())


class TestGating:
    async def test_read_grant_does_not_allow_writes(self, db, env):
        load_registry(grants=["core.cards.read"])
        bridge = ExtensionData(KEY)
        with pytest.raises(ExtensionPermissionError):
            await bridge.create_card(type="Application", name="Nope")

    async def test_kill_switch_pauses_writes_but_not_reads(self, db, env, monkeypatch):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        monkeypatch.setattr(settings, "EXTENSION_WRITES_ENABLED", False)
        with pytest.raises(ExtensionPermissionError, match="disabled"):
            await bridge.create_card(type="Application", name="Blocked")
        # Reads keep working — the switch only pauses mutations.
        assert (await bridge.search_cards()).total == 0
        monkeypatch.setattr(settings, "EXTENSION_WRITES_ENABLED", True)
        card = await bridge.create_card(type="Application", name="Unblocked")
        assert card.name == "Unblocked"

    async def test_lapse_revokes_writes(self, db, env):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        await bridge.create_card(type="Application", name="While Licensed")
        extension_registry.set_license(None)
        with pytest.raises(ExtensionPermissionError):
            await bridge.create_card(type="Application", name="After Lapse")


class TestCreate:
    async def test_create_persists_with_audit_trail(self, db, env):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        ext_card = await bridge.create_card(
            type="Application", name="Bridge Made", attributes={"criticality": "high"}
        )
        row = (await db.execute(select(Card).where(Card.name == "Bridge Made"))).scalar_one()
        assert str(row.id) == ext_card.id
        assert row.created_by is None
        batches = await _batches(db)
        assert len(batches) == 1
        assert batches[0].tool_name == f"ext:{KEY}"
        assert batches[0].origin == "ext"
        assert batches[0].committed_at is not None
        events = (await db.execute(select(Event).where(Event.card_id == row.id))).scalars().all()
        assert events
        for e in events:
            assert e.data.get("ext") == KEY
            assert e.batch_id == batches[0].id

    async def test_validation_error_surfaces_as_data_error(self, db, env):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        with pytest.raises(ExtensionDataError, match="Invalid value"):
            await bridge.create_card(
                type="Application", name="Bad", attributes={"criticality": "nope"}
            )

    async def test_dry_run_leaves_no_rows_events_or_batches(self, db, env):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        preview = await bridge.create_card(type="Application", name="Preview", dry_run=True)
        assert preview.name == "Preview"
        assert (
            await db.execute(select(Card).where(Card.name == "Preview"))
        ).scalar_one_or_none() is None
        assert await _batches(db) == []
        assert list((await db.execute(select(Event))).scalars().all()) == []

    async def test_dry_run_still_validates(self, db, env):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        with pytest.raises(ExtensionDataError):
            await bridge.create_card(
                type="Application",
                name="Bad Preview",
                attributes={"criticality": "invalid"},
                dry_run=True,
            )


class TestUpdate:
    async def test_attributes_merge_never_wipes(self, db, env):
        load_registry(grants=["core.cards.write"])
        card = await create_card(
            db,
            card_type="Application",
            name="Merge Target",
            attributes={"keep": "me", "criticality": "high"},
        )
        bridge = ExtensionData(KEY)
        updated = await bridge.update_card(str(card.id), {"attributes": {"added": "yes"}})
        assert updated.attributes["keep"] == "me"
        assert updated.attributes["criticality"] == "high"
        assert updated.attributes["added"] == "yes"

    async def test_none_valued_attribute_key_is_removed(self, db, env):
        load_registry(grants=["core.cards.write"])
        card = await create_card(
            db, card_type="Application", name="Del Key", attributes={"stale": "x", "keep": "y"}
        )
        bridge = ExtensionData(KEY)
        updated = await bridge.update_card(str(card.id), {"attributes": {"stale": None}})
        assert "stale" not in updated.attributes
        assert updated.attributes["keep"] == "y"

    async def test_refused_fields_error(self, db, env):
        load_registry(grants=["core.cards.write"])
        card = await create_card(db, card_type="Application", name="Immutable Bits")
        bridge = ExtensionData(KEY)
        for field in ("reference", "external_id", "status", "approval_status", "type"):
            with pytest.raises(ExtensionDataError, match="not writable"):
                await bridge.update_card(str(card.id), {field: "x"})

    async def test_missing_card_errors(self, db, env):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        with pytest.raises(ExtensionDataError, match="not found"):
            await bridge.update_card("00000000-0000-0000-0000-000000000000", {"name": "ghost"})


class TestArchive:
    async def test_archive_is_soft_and_gated_on_children(self, db, env):
        load_registry(grants=["core.cards.write"])
        parent = await create_card(db, card_type="Application", name="Parent")
        await create_card(db, card_type="Application", name="Child", parent_id=parent.id)
        bridge = ExtensionData(KEY)
        with pytest.raises(ExtensionDataError, match="cascade_children"):
            await bridge.archive_card(str(parent.id))
        await bridge.archive_card(str(parent.id), cascade_children=True)
        await db.refresh(parent)
        assert parent.status == "ARCHIVED"

    async def test_no_hard_delete_surface(self, db, env):
        bridge = ExtensionData(KEY)
        assert not hasattr(bridge, "delete_card")
        assert not hasattr(bridge, "delete_relation")


class TestUpsertRelation:
    async def test_upsert_and_idempotent_merge(self, db, env):
        load_registry(grants=["core.cards.write"])
        app = await create_card(db, card_type="Application", name="Src")
        itc = await create_card(db, card_type="ITComponent", name="Tgt")
        bridge = ExtensionData(KEY)
        rel = await bridge.upsert_relation(
            type="app_to_itc", source_id=str(app.id), target_id=str(itc.id)
        )
        again = await bridge.upsert_relation(
            type="app_to_itc",
            source_id=str(app.id),
            target_id=str(itc.id),
            description="merged",
        )
        assert again.id == rel.id
        rows = list((await db.execute(select(Relation))).scalars().all())
        assert len(rows) == 1 and rows[0].description == "merged"

    async def test_missing_endpoint_errors(self, db, env):
        load_registry(grants=["core.cards.write"])
        app = await create_card(db, card_type="Application", name="Lonely")
        bridge = ExtensionData(KEY)
        with pytest.raises(ExtensionDataError, match="not found"):
            await bridge.upsert_relation(
                type="app_to_itc",
                source_id=str(app.id),
                target_id="00000000-0000-0000-0000-000000000000",
            )


class TestBatching:
    async def test_explicit_batch_groups_writes(self, db, env):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        async with bridge.batch("nightly sync"):
            a = await bridge.create_card(type="Application", name="Batched A")
            b = await bridge.create_card(type="Application", name="Batched B")
        batches = await _batches(db)
        assert len(batches) == 1
        batch = batches[0]
        assert batch.committed_at is not None
        assert batch.summary == {"label": "nightly sync", "writes": 2}
        for cid in (a.id, b.id):
            events = (await db.execute(select(Event).where(Event.card_id == cid))).scalars().all()
            assert events and all(e.batch_id == batch.id for e in events)

    async def test_batches_cannot_nest(self, db, env):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        async with bridge.batch("outer"):
            with pytest.raises(ExtensionDataError, match="nest"):
                async with bridge.batch("inner"):
                    pass

    async def test_per_batch_write_cap(self, db, env, monkeypatch):
        load_registry(grants=["core.cards.write"])
        monkeypatch.setattr(settings, "EXTENSION_MAX_WRITES_PER_BATCH", 2)
        bridge = ExtensionData(KEY)
        with pytest.raises(ExtensionDataError, match="per-batch write cap"):
            async with bridge.batch("too big"):
                await bridge.create_card(type="Application", name="Cap 1")
                await bridge.create_card(type="Application", name="Cap 2")
                await bridge.create_card(type="Application", name="Cap 3")

    async def test_rate_cap_on_batches(self, db, env, monkeypatch):
        load_registry(grants=["core.cards.write"])
        monkeypatch.setattr(settings, "EXTENSION_MAX_BATCHES_PER_MINUTE", 2)
        bridge = ExtensionData(KEY)
        await bridge.create_card(type="Application", name="Rate 1")
        await bridge.create_card(type="Application", name="Rate 2")
        with pytest.raises(ExtensionDataError, match="rate cap"):
            await bridge.create_card(type="Application", name="Rate 3")
