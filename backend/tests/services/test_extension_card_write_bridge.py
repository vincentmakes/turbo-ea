"""The SDK inventory data bridge, write half (SDK 1.5): guardrails, audit
provenance, batching, dry-run, and the merge semantics.

Same harness as the read-half tests; writes additionally assert the
``ext:{key}`` mutation-batch trail and the ``data["ext"]`` event stamp the
event dispatcher's self-origin filter keys off.
"""

from __future__ import annotations

import uuid
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


async def _inbound(db) -> MutationBatch:
    """A stored batch, as an MCP call into an extension route opens one."""
    from app.services import mutation_batch_service

    row = await mutation_batch_service.create_batch(
        db, tool_name="call_extension_write", actor=None, origin="mcp", dry_run=False
    )
    await db.flush()
    return row


async def _ext_batch(db) -> MutationBatch:
    return (
        await db.execute(select(MutationBatch).where(MutationBatch.tool_name == f"ext:{KEY}"))
    ).scalar_one()


class TestSingleOpInboundBatch:
    """The implicit single-op batch of a write made outside any batch() scope
    names the inbound request batch too (the call_extension_write promise),
    but only when that id names a stored batch."""

    async def test_single_op_write_records_the_inbound_batch(self, db, env):
        from app.services.event_bus import request_batch_id

        load_registry(grants=["core.cards.write"])
        inbound = await _inbound(db)
        token = request_batch_id.set(inbound.id)
        try:
            await ExtensionData(KEY).create_card(type="Application", name="Single")
            assert request_batch_id.get() == inbound.id
        finally:
            request_batch_id.reset(token)
        batch = await _ext_batch(db)
        assert batch.committed_at is not None
        assert batch.summary == {"via_batch_id": str(inbound.id)}

    async def test_single_op_write_ignores_an_unknown_inbound_id(self, db, env):
        from app.services.event_bus import request_batch_id

        load_registry(grants=["core.cards.write"])
        token = request_batch_id.set(uuid.uuid4())
        try:
            await ExtensionData(KEY).create_card(type="Application", name="Forged")
        finally:
            request_batch_id.reset(token)
        assert (await _ext_batch(db)).summary is None

    async def test_single_op_write_without_an_inbound_batch(self, db, env):
        load_registry(grants=["core.cards.write"])
        await ExtensionData(KEY).create_card(type="Application", name="Plain")
        assert (await _ext_batch(db)).summary is None

    async def test_single_op_summary_helper(self, db, env):
        inbound = await _inbound(db)
        assert await bridge_mod.single_op_summary(db, None, None) is None
        assert await bridge_mod.single_op_summary(db, None, {"a": 1}) == {"a": 1}
        assert await bridge_mod.single_op_summary(db, uuid.uuid4(), {"a": 1}) == {"a": 1}
        assert await bridge_mod.single_op_summary(db, inbound.id, None) == {
            "via_batch_id": str(inbound.id)
        }
        assert await bridge_mod.single_op_summary(db, inbound.id, {"a": 1}) == {
            "a": 1,
            "via_batch_id": str(inbound.id),
        }


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


class TestParentId:
    """Fixed in 2.157.3: a malformed parent id reached ``uuid.UUID`` raw and
    escaped as a ``ValueError`` rather than the bridge's own error."""

    async def test_a_malformed_parent_is_refused_and_an_empty_one_clears(self, db, env):
        await create_card_type(db, key="Capability", label="Capability", has_hierarchy=True)
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        parent = await bridge.create_card(type="Capability", name="P")
        child = await bridge.create_card(type="Capability", name="C", parent_id=parent.id)
        for raw in ("nope", 7):
            with pytest.raises(ExtensionDataError, match=f"Invalid parent_id: {raw!r}"):
                await bridge.update_card(child.id, {"parent_id": raw})
        assert (await bridge.update_card(child.id, {"name": "C2"})).parent_id == parent.id
        moved = await bridge.update_card(child.id, {"parent_id": parent.id.upper()})
        assert moved.parent_id == parent.id
        assert (await bridge.update_card(child.id, {"parent_id": ""})).parent_id is None

    async def test_the_parent_filter_finds_the_children_and_refuses_a_malformed_id(self, db, env):
        await create_card_type(db, key="Capability", label="Capability", has_hierarchy=True)
        parent = await create_card(db, card_type="Capability", name="P")
        child = await create_card(db, card_type="Capability", name="C", parent_id=parent.id)
        await create_card(db, card_type="Capability", name="Root")
        load_registry(grants=["core.cards.read"])
        bridge = ExtensionData(KEY)
        page = await bridge.search_cards(parent_id=str(parent.id))
        assert ([c.id for c in page.items], page.total) == ([str(child.id)], 1)
        with pytest.raises(ExtensionDataError, match="Invalid parent_id: 'nope'"):
            await bridge.search_cards(parent_id="nope")


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

    async def test_archived_children_do_not_gate_the_archive(self, db, env):
        """#1382: only an active child needs ``cascade_children``."""
        load_registry(grants=["core.cards.write"])
        parent = await create_card(db, card_type="Application", name="Parent")
        child = await create_card(
            db, card_type="Application", name="Child", parent_id=parent.id, status="ARCHIVED"
        )
        await ExtensionData(KEY).archive_card(str(parent.id))
        await db.refresh(parent)
        await db.refresh(child)
        assert parent.status == "ARCHIVED"
        assert child.parent_id == parent.id

    async def test_the_refusal_counts_active_children_only(self, db, env):
        load_registry(grants=["core.cards.write"])
        parent = await create_card(db, card_type="Application", name="Parent")
        await create_card(
            db, card_type="Application", name="Gone", parent_id=parent.id, status="ARCHIVED"
        )
        await create_card(db, card_type="Application", name="Live", parent_id=parent.id)
        with pytest.raises(ExtensionDataError, match=r"has 1 child card\(s\)"):
            await ExtensionData(KEY).archive_card(str(parent.id))

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

    async def test_the_lifecycle_is_replaced_when_given_and_kept_when_not(self, db, env):
        """SDK 1.20: the POST /relations semantics — given, it replaces the
        stored dates (``{}`` clears them); omitted, they stay."""
        load_registry(grants=["core.cards.write"])
        app = await create_card(db, card_type="Application", name="Src")
        itc = await create_card(db, card_type="ITComponent", name="Tgt")
        bridge = ExtensionData(KEY)
        ends = {"type": "app_to_itc", "source_id": str(app.id), "target_id": str(itc.id)}
        rel = await bridge.upsert_relation(**ends, lifecycle={"active": "2027-01-01"})
        assert rel.lifecycle == {"active": "2027-01-01"}
        kept = await bridge.upsert_relation(**ends, description="no dates sent")
        assert kept.lifecycle == {"active": "2027-01-01"}
        replaced = await bridge.upsert_relation(**ends, lifecycle={"endOfLife": "2030-01-01"})
        assert replaced.lifecycle == {"endOfLife": "2030-01-01"}
        cleared = await bridge.upsert_relation(**ends, lifecycle={})
        assert cleared.lifecycle == {}

    @pytest.mark.parametrize("lifecycle", [{"sunset": "2030-01-01"}, {"active": "soon"}])
    async def test_a_bad_lifecycle_is_refused_before_any_write(self, db, env, lifecycle):
        load_registry(grants=["core.cards.write"])
        app = await create_card(db, card_type="Application", name="Src")
        itc = await create_card(db, card_type="ITComponent", name="Tgt")
        with pytest.raises(ExtensionDataError, match="lifecycle"):
            await ExtensionData(KEY).upsert_relation(
                type="app_to_itc",
                source_id=str(app.id),
                target_id=str(itc.id),
                lifecycle=lifecycle,
            )
        assert list((await db.execute(select(Relation))).scalars().all()) == []


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

    async def test_empty_batch_leaves_no_row(self, db, env):
        # SDK 1.13: "sync ran, nothing changed" is not an audit event. A scope
        # that recorded no write must not appear in the Audit Log with a
        # Rollback that would reverse nothing.
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        async with bridge.batch("nightly sync") as handle:
            assert handle.id
            await bridge.search_cards(type="Application")
        assert await _batches(db) == []

    async def test_empty_batch_on_exception_leaves_no_row(self, db, env):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        with pytest.raises(RuntimeError, match="upstream down"):
            async with bridge.batch("nightly sync"):
                raise RuntimeError("upstream down")
        assert await _batches(db) == []
        assert bridge_mod.active_batch_id() is None

    async def test_batch_with_one_write_is_committed(self, db, env):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        async with bridge.batch("nightly sync"):
            await bridge.create_card(type="Application", name="Only one")
        batches = await _batches(db)
        assert len(batches) == 1
        assert batches[0].committed_at is not None
        assert batches[0].summary == {"label": "nightly sync", "writes": 1}

    async def test_batch_records_the_inbound_mcp_batch(self, db, env):
        # SDK 1.18: an MCP tool call into an extension route carries its own
        # batch id on the request; the extension's bridge writes made while
        # serving it name that batch, so the Audit Log can link the two.
        from app.services import mutation_batch_service
        from app.services.event_bus import request_batch_id

        load_registry(grants=["core.cards.write"])
        inbound = await mutation_batch_service.create_batch(
            db, tool_name="call_extension_write", actor=None, origin="mcp", dry_run=False
        )
        await db.flush()
        token = request_batch_id.set(inbound.id)
        try:
            bridge = ExtensionData(KEY)
            async with bridge.batch("via mcp") as handle:
                await bridge.create_card(type="Application", name="Via MCP")
            # The inbound id is restored once the scope closes.
            assert request_batch_id.get() == inbound.id
        finally:
            request_batch_id.reset(token)
        ext_batch = await db.get(MutationBatch, uuid.UUID(handle.id))
        assert ext_batch.summary == {
            "label": "via mcp",
            "writes": 1,
            "via_batch_id": str(inbound.id),
        }

    async def test_an_unknown_inbound_batch_id_is_not_recorded(self, db, env):
        # The header is only a parsed UUID: an id naming no stored batch is
        # never written into the audit trail.
        from app.services.event_bus import request_batch_id

        load_registry(grants=["core.cards.write"])
        token = request_batch_id.set(uuid.uuid4())
        try:
            bridge = ExtensionData(KEY)
            async with bridge.batch("forged") as handle:
                await bridge.create_card(type="Application", name="Forged")
        finally:
            request_batch_id.reset(token)
        ext_batch = await db.get(MutationBatch, uuid.UUID(handle.id))
        assert ext_batch.summary == {"label": "forged", "writes": 1}

    def test_batch_summary_helper(self):
        assert bridge_mod.batch_summary("l", 3, None) == {"label": "l", "writes": 3}
        assert bridge_mod.batch_summary("l", 3, "abc") == {
            "label": "l",
            "writes": 3,
            "via_batch_id": "abc",
        }

    async def test_batch_yields_its_audit_id(self, db, env):
        # SDK 1.8: the handle names the batch the writes landed in.
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        async with bridge.batch("nightly sync") as handle:
            created = await bridge.create_card(type="Application", name="Handled")
        batches = await _batches(db)
        assert len(batches) == 1
        assert handle.id == str(batches[0].id)
        assert handle.label == "nightly sync"
        events = (
            (await db.execute(select(Event).where(Event.card_id == created.id))).scalars().all()
        )
        assert events and all(str(e.batch_id) == handle.id for e in events)

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


class TestRefusalText:
    """A refusal raised inside the write reaches the extension as the core
    message, on the dry-run and the in-batch paths alike."""

    MESSAGE = "Invalid value for select field(s): 'Criticality' got 'nope'; valid options: high."

    async def test_a_dry_run_refusal_carries_the_message(self, db, env):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        with pytest.raises(ExtensionDataError) as exc:
            await bridge.create_card(
                type="Application", name="Bad", attributes={"criticality": "nope"}, dry_run=True
            )
        assert str(exc.value) == self.MESSAGE

    async def test_an_in_batch_refusal_carries_the_message(self, db, env):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        with pytest.raises(ExtensionDataError) as exc:
            async with bridge.batch("sync"):
                await bridge.create_card(
                    type="Application", name="Bad", attributes={"criticality": "nope"}
                )
        assert str(exc.value) == self.MESSAGE


@pytest.mark.parametrize(
    "detail,text",
    [
        ({"error": "x", "message": "Readable."}, "Readable."),
        ({"error": "x", "message": ""}, "{'error': 'x', 'message': ''}"),
        ("Plain text", "Plain text"),
        (None, "None"),
    ],
)
def test_http_detail_text(detail, text):
    assert bridge_mod.http_detail_text(detail) == text


MAINTAIN = ["core.cards.write", "core.cards.maintain_lifecycle"]


def load_two(*, other_grants: list[str] | None = None, other_enabled: bool = True) -> None:
    """``KEY`` with the maintain grants, plus a second extension ``other-ext``."""
    load_registry(grants=MAINTAIN)
    extension_registry.load_installed(
        [
            *extension_registry.all(),
            ExtensionInfo(
                key="other-ext",
                name="Other Ext",
                version="1.0.0",
                status="installed",
                enabled=other_enabled,
                manifest={"grants": MAINTAIN if other_grants is None else other_grants},
            ),
        ]
    )
    extension_registry.set_license(
        LicenseDocument(
            licensee="ACME",
            customer_id="cus_1",
            issued_at=NOW - timedelta(days=1),
            grace_days=30,
            entitlements=[
                Entitlement(extension_key=KEY, expires_at=None),
                Entitlement(extension_key="other-ext", expires_at=None),
            ],
        )
    )


async def _card_events(db, card_id) -> list[Event]:
    rows = await db.execute(
        select(Event).where(Event.card_id == card_id, Event.event_type == "card.updated")
    )
    return list(rows.scalars().all())


class TestMaintainLifecycle:
    async def test_sets_phases_claims_them_and_clamps_manual_dates(self, db, env):
        load_registry(grants=MAINTAIN)
        card = await create_card(
            db,
            card_type="Application",
            name="Inherit",
            lifecycle={"plan": "2018-01-01", "phaseOut": "2040-01-01"},
        )
        out = await ExtensionData(KEY).maintain_lifecycle(
            str(card.id), {"endOfLife": "2030-01-01", "active": "2020-01-01"}
        )
        assert out.lifecycle == {
            "plan": "2018-01-01",
            "active": "2020-01-01",
            "phaseOut": "2030-01-01",
            "endOfLife": "2030-01-01",
        }
        assert out.lifecycle_maintained == {"ext": KEY, "phases": ["active", "endOfLife"]}
        await db.refresh(card)
        assert card.lifecycle_maintained == {"ext": KEY, "phases": ["active", "endOfLife"]}
        assert card.lifecycle == out.lifecycle

    async def test_emits_exactly_one_event_in_the_changes_shape(self, db, env):
        load_registry(grants=MAINTAIN)
        card = await create_card(
            db, card_type="Application", name="Evented", lifecycle={"plan": "2019-01-01"}
        )
        await ExtensionData(KEY).maintain_lifecycle(str(card.id), {"active": "2020-01-01"})
        events = await _card_events(db, card.id)
        assert len(events) == 1
        data = events[0].data
        assert data["ext"] == KEY
        assert data["changes"]["lifecycle"] == {
            "old": {"plan": "2019-01-01"},
            "new": {"plan": "2019-01-01", "active": "2020-01-01"},
        }
        assert data["changes"]["lifecycle_maintained"] == {
            "old": None,
            "new": {"ext": KEY, "phases": ["active"]},
        }
        batch = await _ext_batch(db)
        assert events[0].batch_id == batch.id

    async def test_marker_only_change_records_only_the_marker(self, db, env):
        load_registry(grants=MAINTAIN)
        card = await create_card(
            db, card_type="Application", name="Same dates", lifecycle={"active": "2020-01-01"}
        )
        await ExtensionData(KEY).maintain_lifecycle(str(card.id), {"active": "2020-01-01"})
        (event,) = await _card_events(db, card.id)
        assert set(event.data["changes"]) == {"lifecycle_maintained"}

    async def test_a_call_that_changes_nothing_writes_nothing(self, db, env):
        load_registry(grants=MAINTAIN)
        card = await create_card(db, card_type="Application", name="Stable")
        bridge = ExtensionData(KEY)
        await bridge.maintain_lifecycle(str(card.id), {"active": "2020-01-01"})
        events_before = len(await _card_events(db, card.id))
        batches_before = len(await _batches(db))
        out = await bridge.maintain_lifecycle(str(card.id), {"active": "2020-01-01"})
        assert out.lifecycle == {"active": "2020-01-01"}
        assert len(await _card_events(db, card.id)) == events_before == 1
        assert len(await _batches(db)) == batches_before

    async def test_dry_run_previews_without_writing(self, db, env):
        load_registry(grants=MAINTAIN)
        card = await create_card(db, card_type="Application", name="Preview")
        card_id = card.id
        out = await ExtensionData(KEY).maintain_lifecycle(
            str(card_id), {"active": "2020-01-01"}, dry_run=True
        )
        assert out.lifecycle == {"active": "2020-01-01"}
        assert out.lifecycle_maintained == {"ext": KEY, "phases": ["active"]}
        fresh = (await db.execute(select(Card).where(Card.id == card_id))).scalar_one()
        assert fresh.lifecycle_maintained is None
        assert not (fresh.lifecycle or {}).get("active")
        assert await _card_events(db, card_id) == []
        assert await _batches(db) == []

    @pytest.mark.parametrize(
        "grants",
        [
            ["core.cards.write"],
            ["core.cards.maintain_lifecycle"],
            ["core.cards.read"],
            # Reading is not writing: the maintain grant needs the WRITE grant.
            ["core.cards.read", "core.cards.maintain_lifecycle"],
        ],
    )
    async def test_both_grants_are_required(self, db, env, grants):
        load_registry(grants=grants)
        card = await create_card(db, card_type="Application", name="Gated")
        with pytest.raises(ExtensionPermissionError):
            await ExtensionData(KEY).maintain_lifecycle(str(card.id), {"active": "2020-01-01"})
        with pytest.raises(ExtensionPermissionError):
            await ExtensionData(KEY).release_lifecycle(str(card.id))

    @pytest.mark.parametrize(
        ("values", "message"),
        [
            ({}, "non-empty"),
            ("2020-01-01", "non-empty"),
            ({"bogus": "2020-01-01"}, "unknown phase 'bogus'"),
            ({"active": "soon"}, "'active' is not a date"),
            ({"active": 20200101}, "'active' is not a date"),
        ],
    )
    async def test_bad_values_are_refused(self, db, env, values, message):
        load_registry(grants=MAINTAIN)
        card = await create_card(db, card_type="Application", name="Bad")
        with pytest.raises(ExtensionDataError, match=message):
            await ExtensionData(KEY).maintain_lifecycle(str(card.id), values)
        assert await _batches(db) == []

    async def test_dates_are_normalised_and_none_removes(self, db, env):
        load_registry(grants=MAINTAIN)
        card = await create_card(
            db, card_type="Application", name="Norm", lifecycle={"endOfLife": "2030-01-01"}
        )
        out = await ExtensionData(KEY).maintain_lifecycle(
            str(card.id), {"active": "2020-01-01T10:00:00", "endOfLife": None}
        )
        assert out.lifecycle == {"active": "2020-01-01"}
        assert out.lifecycle_maintained == {"ext": KEY, "phases": ["active", "endOfLife"]}

    def test_values_validation_messages(self):
        normalise = bridge_mod.normalise_maintained_values
        with pytest.raises(ExtensionDataError) as exc:
            normalise({})
        assert str(exc.value) == (
            "values must be a non-empty object of phase → date (or None to remove it)"
        )
        with pytest.raises(ExtensionDataError) as exc:
            normalise({"bogus": "2020-01-01"})
        assert str(exc.value) == (
            "lifecycle: unknown phase 'bogus' "
            "(expected one of plan, phaseIn, active, phaseOut, endOfLife)"
        )
        # A date object is not a date STRING; only strings are read.
        from datetime import date

        with pytest.raises(ExtensionDataError, match="'active' is not a date"):
            normalise({"active": date(2020, 1, 1)})

    def test_empty_and_none_remove_and_later_values_still_count(self):
        out = bridge_mod.normalise_maintained_values(
            {"endOfLife": "", "phaseOut": None, "active": "2020-1-2"}
        )
        assert out == {"endOfLife": None, "phaseOut": None, "active": "2020-01-02"}

    async def test_an_invalid_card_id_is_named(self, db, env):
        load_registry(grants=MAINTAIN)
        with pytest.raises(ExtensionDataError, match=r"^Invalid card id: 'nope'$"):
            await ExtensionData(KEY).maintain_lifecycle("nope", {"active": "2020-01-01"})

    async def test_a_card_deleted_before_the_write_is_reported(self, db, env, monkeypatch):
        load_registry(grants=MAINTAIN)
        card = await create_card(db, card_type="Application", name="Vanishing")
        card_id = card.id
        bridge = ExtensionData(KEY)
        original = bridge._write

        async def deleting_write(op, **kwargs):
            # Another session deletes the card between the read and the write.
            await db.delete(card)
            await db.flush()
            return await original(op, **kwargs)

        monkeypatch.setattr(bridge, "_write", deleting_write)
        with pytest.raises(ExtensionDataError, match=rf"^Card {card_id} not found$"):
            await bridge.maintain_lifecycle(str(card_id), {"active": "2020-01-01"})

    async def test_dry_run_publishes_no_event(self, db, env, monkeypatch):
        from app.services.event_bus import event_bus

        load_registry(grants=MAINTAIN)
        card = await create_card(db, card_type="Application", name="Quiet")
        published: list = []

        async def spy(*args, **kwargs):
            published.append(args)

        monkeypatch.setattr(event_bus, "publish", spy)
        await ExtensionData(KEY).maintain_lifecycle(
            str(card.id), {"active": "2020-01-01"}, dry_run=True
        )
        assert published == []

    async def test_unknown_card_is_refused(self, db, env):
        load_registry(grants=MAINTAIN)
        with pytest.raises(ExtensionDataError, match="not found"):
            await ExtensionData(KEY).maintain_lifecycle(str(uuid.uuid4()), {"active": "2020-01-01"})

    async def test_a_foreign_effective_claim_is_refused(self, db, env):
        load_two()
        card = await create_card(
            db,
            card_type="Application",
            name="Taken",
            lifecycle={"active": "2019-01-01"},
            lifecycle_maintained={"ext": "other-ext", "phases": ["active"]},
        )
        # Refused by the bridge itself, before any audit batch is opened.
        with pytest.raises(
            ExtensionDataError,
            match=f"^The lifecycle of card {card.id} is maintained by the extension Other Ext$",
        ):
            await ExtensionData(KEY).maintain_lifecycle(str(card.id), {"active": "2020-01-01"})
        assert await _batches(db) == []
        await db.refresh(card)
        assert card.lifecycle == {"active": "2019-01-01"}
        assert card.lifecycle_maintained == {"ext": "other-ext", "phases": ["active"]}

    async def test_an_ineffective_claim_is_taken_over(self, db, env):
        load_two(other_enabled=False)
        card = await create_card(
            db,
            card_type="Application",
            name="Orphaned",
            lifecycle={"active": "2019-01-01"},
            lifecycle_maintained={"ext": "other-ext", "phases": ["active"]},
        )
        out = await ExtensionData(KEY).maintain_lifecycle(str(card.id), {"active": "2020-01-01"})
        assert out.lifecycle_maintained == {"ext": KEY, "phases": ["active"]}
        assert out.lifecycle == {"active": "2020-01-01"}

    async def test_plain_update_card_cannot_move_its_own_maintained_phase(self, db, env):
        load_registry(grants=MAINTAIN)
        card = await create_card(db, card_type="Application", name="Own plain")
        bridge = ExtensionData(KEY)
        await bridge.maintain_lifecycle(str(card.id), {"active": "2020-01-01"})
        with pytest.raises(ExtensionDataError, match="set automatically"):
            await bridge.update_card(str(card.id), {"lifecycle": {"active": "2021-01-01"}})
        # …nor plant a claim through the plain write.
        with pytest.raises(ExtensionDataError, match="not writable"):
            await bridge.update_card(str(card.id), {"lifecycle_maintained": None})
        # A manual phase still moves, and the maintained one is carried over.
        out = await bridge.update_card(str(card.id), {"lifecycle": {"plan": "2019-01-01"}})
        assert out.lifecycle == {"plan": "2019-01-01", "active": "2020-01-01"}

    async def test_release_clears_only_its_own_claim(self, db, env):
        load_two()
        mine = await create_card(db, card_type="Application", name="Mine")
        bridge = ExtensionData(KEY)
        await bridge.maintain_lifecycle(str(mine.id), {"active": "2020-01-01"})
        out = await bridge.release_lifecycle(str(mine.id))
        assert out.lifecycle_maintained is None
        assert out.lifecycle == {"active": "2020-01-01"}
        events = await _card_events(db, mine.id)
        assert len(events) == 2
        assert events[-1].data["changes"] == {
            "lifecycle_maintained": {"old": {"ext": KEY, "phases": ["active"]}, "new": None}
        }

        theirs = await create_card(
            db,
            card_type="Application",
            name="Theirs",
            lifecycle_maintained={"ext": "other-ext", "phases": ["active"]},
        )
        batches = len(await _batches(db))
        out = await bridge.release_lifecycle(str(theirs.id))
        assert out.lifecycle_maintained == {"ext": "other-ext", "phases": ["active"]}
        assert await _card_events(db, theirs.id) == []
        assert len(await _batches(db)) == batches

    async def test_release_dry_run_writes_nothing(self, db, env):
        load_registry(grants=MAINTAIN)
        card = await create_card(
            db,
            card_type="Application",
            name="Release preview",
            lifecycle_maintained={"ext": KEY, "phases": ["active"]},
        )
        card_id = card.id
        out = await ExtensionData(KEY).release_lifecycle(str(card_id), dry_run=True)
        assert out.lifecycle_maintained is None
        fresh = (await db.execute(select(Card).where(Card.id == card_id))).scalar_one()
        assert fresh.lifecycle_maintained == {"ext": KEY, "phases": ["active"]}
        assert await _batches(db) == []

    async def test_approval_breaks_only_when_dates_move(self, db, env):
        load_registry(grants=MAINTAIN)
        card = await create_card(
            db,
            card_type="Application",
            name="Approved",
            lifecycle={"active": "2020-01-01"},
            approval_status="APPROVED",
        )
        bridge = ExtensionData(KEY)
        out = await bridge.maintain_lifecycle(str(card.id), {"active": "2020-01-01"})
        assert out.approval_status == "APPROVED"
        out = await bridge.release_lifecycle(str(card.id))
        assert out.approval_status == "APPROVED"
        out = await bridge.maintain_lifecycle(str(card.id), {"active": "2021-01-01"})
        assert out.approval_status == "BROKEN"
        (event,) = [e for e in await _card_events(db, card.id) if "lifecycle" in e.data["changes"]]
        assert event.data["changes"]["approval_status"] == {"old": "APPROVED", "new": "BROKEN"}

    async def test_joins_an_open_batch_and_rolls_back_both_fields(self, db, env):
        from app.services.rollback_service import execute_rollback
        from tests.conftest import create_user

        load_registry(grants=MAINTAIN)
        actor = await create_user(db, role="admin")
        card = await create_card(
            db, card_type="Application", name="Rolled", lifecycle={"plan": "2019-01-01"}
        )
        bridge = ExtensionData(KEY)
        async with bridge.batch("inherit") as handle:
            await bridge.maintain_lifecycle(str(card.id), {"active": "2020-01-01"})
            await bridge.update_card(str(card.id), {"description": "touched"})
        batches = await _batches(db)
        assert [b.id for b in batches] == [uuid.UUID(str(handle.id))]
        assert batches[0].summary["writes"] == 2

        result = await execute_rollback(db, batches[0], actor.id, force=True)
        restore = [r for r in result["results"] if r["op"] == "restore_card_fields"]
        assert restore and all(r["status"] == "ok" for r in restore)
        assert all("locked_phases" not in r for r in restore)
        await db.refresh(card)
        assert card.lifecycle == {"plan": "2019-01-01"}
        assert card.lifecycle_maintained is None

    async def test_update_card_refuses_a_maintainer_that_does_not_own_the_claim(self, db, env):
        from fastapi import HTTPException

        from app.services import card_write_service

        load_two()
        card = await create_card(
            db,
            card_type="Application",
            name="Guarded",
            lifecycle={"active": "2019-01-01"},
            lifecycle_maintained={"ext": "other-ext", "phases": ["active"]},
        )
        actor = card_write_service.WriteActor(user_id=None, display_name="x", ext_key=KEY)
        with pytest.raises(HTTPException) as exc:
            await card_write_service.update_card(
                db, actor, card, {"lifecycle": {"active": "2020-01-01"}}, lifecycle_maintainer=KEY
            )
        assert exc.value.status_code == 409
        assert exc.value.detail == (
            "The lifecycle of this card is maintained by the extension Other Ext"
        )
        assert card.lifecycle == {"active": "2019-01-01"}
        # The owner itself passes, and may move the claim.
        owner = card_write_service.WriteActor(user_id=None, display_name="o", ext_key="other-ext")
        assert await card_write_service.update_card(
            db,
            owner,
            card,
            {"lifecycle": {"active": "2020-01-01"}, "lifecycle_maintained": None},
            lifecycle_maintainer="other-ext",
        )
        assert card.lifecycle == {"active": "2020-01-01"}
        assert card.lifecycle_maintained is None
