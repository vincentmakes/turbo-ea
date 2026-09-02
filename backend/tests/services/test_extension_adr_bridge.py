"""The SDK decisions bridge (SDK 1.8): grant gating, drafts only, the
extension's own attribute namespace, active linked cards, and audit
provenance shared with the REST route's reference sequence.

Same harness as the other bridge tests: the bridge opens its own sessions
via ``async_session`` (patched to the savepoint-rollback test session) and
the in-memory ``extension_registry`` singleton is driven directly."""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import select

from app.config import settings
from app.models.architecture_decision import ArchitectureDecision
from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.services.extensions import adr_bridge as bridge_mod
from app.services.extensions.adr_bridge import ExtensionDecisions
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.registry import ExtensionInfo, extension_registry
from app.services.extensions.sdk import ExtDecision, ExtensionDataError, ExtensionPermissionError
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

NOW = datetime.now(timezone.utc)
KEY = "sample-planner"


def load_registry(*, grants: list[str], enabled: bool = True, status: str = "installed") -> None:
    extension_registry.clear()
    extension_registry.load_installed(
        [
            ExtensionInfo(
                key=KEY,
                name="Sample Planner",
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
    await create_card_type(db, key="Application", label="Application")
    active = await create_card(db, card_type="Application", name="Billing")
    archived = await create_card(db, card_type="Application", name="Legacy", status="ARCHIVED")
    return {"active": active, "archived": archived}


async def _batches(db) -> list[MutationBatch]:
    return list((await db.execute(select(MutationBatch))).scalars().all())


class TestGating:
    async def test_no_grant_blocks_get_and_create(self, db, env):
        load_registry(grants=[])
        bridge = ExtensionDecisions(KEY)
        with pytest.raises(ExtensionPermissionError):
            await bridge.get(str(uuid.uuid4()))
        with pytest.raises(ExtensionPermissionError):
            await bridge.create_draft(title="x")

    async def test_read_grant_does_not_allow_create(self, db, env):
        load_registry(grants=["core.adr.read"])
        bridge = ExtensionDecisions(KEY)
        assert await bridge.get(str(uuid.uuid4())) is None
        with pytest.raises(ExtensionPermissionError):
            await bridge.create_draft(title="x")

    async def test_write_grant_implies_read(self, db, env):
        load_registry(grants=["core.adr.write"])
        bridge = ExtensionDecisions(KEY)
        created = await bridge.create_draft(title="Implied read")
        assert (await bridge.get(created.id)).id == created.id

    async def test_other_core_grants_do_not_imply_adr(self, db, env):
        load_registry(grants=["core.cards.write", "core.todos.write", "core.users.read"])
        bridge = ExtensionDecisions(KEY)
        with pytest.raises(ExtensionPermissionError):
            await bridge.get(str(uuid.uuid4()))
        with pytest.raises(ExtensionPermissionError):
            await bridge.create_draft(title="x")

    async def test_disable_revokes_mid_run(self, db, env):
        load_registry(grants=["core.adr.write"])
        bridge = ExtensionDecisions(KEY)
        await bridge.create_draft(title="works")
        load_registry(grants=["core.adr.write"], enabled=False)
        with pytest.raises(ExtensionPermissionError):
            await bridge.create_draft(title="blocked")

    async def test_kill_switch_pauses_create_but_not_get(self, db, env, monkeypatch):
        load_registry(grants=["core.adr.write"])
        bridge = ExtensionDecisions(KEY)
        created = await bridge.create_draft(title="before")
        monkeypatch.setattr(settings, "EXTENSION_WRITES_ENABLED", False)
        with pytest.raises(ExtensionPermissionError, match="EXTENSION_WRITES_ENABLED"):
            await bridge.create_draft(title="paused")
        assert await bridge.get(created.id) is not None


class TestCreateDraft:
    async def test_creates_a_draft_with_reference_links_and_wire_shape(self, db, env):
        load_registry(grants=["core.adr.write"])
        out = await ExtensionDecisions(KEY).create_draft(
            title="Consolidate billing",
            context="Two billing systems",
            decision="Keep one",
            consequences="Migration in 2027",
            alternatives_considered="Keep both",
            linked_card_ids=[str(env["active"].id)],
        )
        assert isinstance(out, ExtDecision)
        assert out.status == "draft"
        assert out.revision_number == 1
        assert out.reference_number == "ADR-001"
        assert out.linked_card_ids == (str(env["active"].id),)
        assert out.attributes == {}
        assert isinstance(out.created_at, str)
        row = (
            await db.execute(
                select(ArchitectureDecision).where(ArchitectureDecision.id == uuid.UUID(out.id))
            )
        ).scalar_one()
        assert row.created_by is None
        assert row.context == "Two billing systems"

    async def test_status_is_never_a_parameter(self, db, env):
        load_registry(grants=["core.adr.write"])
        with pytest.raises(TypeError):
            await ExtensionDecisions(KEY).create_draft(title="x", status="signed")  # type: ignore[call-arg]

    async def test_reference_sequence_continues_after_existing_rows(self, db, env):
        load_registry(grants=["core.adr.write"])
        db.add(ArchitectureDecision(reference_number="ADR-041", title="Human"))
        await db.flush()
        out = await ExtensionDecisions(KEY).create_draft(title="Next")
        assert out.reference_number == "ADR-042"

    async def test_route_and_bridge_share_one_sequence(self, db, env, client):
        load_registry(grants=["core.adr.write"])
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        first = await client.post(
            "/api/v1/adr", json={"title": "Human first"}, headers=auth_headers(admin)
        )
        assert first.status_code == 201 and first.json()["reference_number"] == "ADR-001"
        second = await ExtensionDecisions(KEY).create_draft(title="Extension second")
        assert second.reference_number == "ADR-002"
        third = await client.post(
            "/api/v1/adr", json={"title": "Human third"}, headers=auth_headers(admin)
        )
        assert third.json()["reference_number"] == "ADR-003"

    async def test_own_namespace_attributes_are_stored(self, db, env):
        load_registry(grants=["core.adr.write"])
        out = await ExtensionDecisions(KEY).create_draft(
            title="Bag",
            attributes={f"ext.{KEY}.scenario_id": "s1", f"ext.{KEY}.dropped": None},
        )
        assert out.attributes == {f"ext.{KEY}.scenario_id": "s1"}

    async def test_foreign_namespace_attributes_refused(self, db, env):
        load_registry(grants=["core.adr.write"])
        with pytest.raises(ExtensionDataError, match="namespaced"):
            await ExtensionDecisions(KEY).create_draft(title="Bag", attributes={"ext.other.x": 1})

    async def test_non_namespaced_attributes_refused(self, db, env):
        load_registry(grants=["core.adr.write"])
        with pytest.raises(ExtensionDataError, match="namespaced"):
            await ExtensionDecisions(KEY).create_draft(title="Bag", attributes={"savings": 1})

    async def test_blank_title_refused(self, db, env):
        load_registry(grants=["core.adr.write"])
        with pytest.raises(ExtensionDataError, match="title"):
            await ExtensionDecisions(KEY).create_draft(title="   ")

    async def test_malformed_missing_and_archived_cards_refused(self, db, env):
        load_registry(grants=["core.adr.write"])
        bridge = ExtensionDecisions(KEY)
        with pytest.raises(ExtensionDataError, match="Invalid card id"):
            await bridge.create_draft(title="x", linked_card_ids=["nope"])
        with pytest.raises(ExtensionDataError, match="not found"):
            await bridge.create_draft(title="x", linked_card_ids=[str(uuid.uuid4())])
        with pytest.raises(ExtensionDataError, match="archived"):
            await bridge.create_draft(title="x", linked_card_ids=[str(env["archived"].id)])
        # Nothing landed for the refused calls.
        assert (await db.execute(select(ArchitectureDecision))).scalars().all() == []

    async def test_duplicate_card_ids_link_once(self, db, env):
        load_registry(grants=["core.adr.write"])
        cid = str(env["active"].id)
        out = await ExtensionDecisions(KEY).create_draft(title="Dup", linked_card_ids=[cid, cid])
        assert out.linked_card_ids == (cid,)

    async def test_audited_as_ext_mutation_batch_with_no_events(self, db, env):
        load_registry(grants=["core.adr.write"])
        out = await ExtensionDecisions(KEY).create_draft(
            title="Audited", linked_card_ids=[str(env["active"].id)]
        )
        batches = await _batches(db)
        assert len(batches) == 1
        batch = batches[0]
        assert batch.tool_name == f"ext:{KEY}"
        assert batch.origin == "ext"
        assert batch.actor_user_id is None
        assert batch.committed_at is not None
        assert batch.summary["reference_number"] == out.reference_number
        assert batch.summary["decision_id"] == out.id
        # Parity with POST /adr: creating a decision publishes no event.
        assert (await db.execute(select(Event))).scalars().all() == []

    async def test_related_decisions_passthrough(self, db, env):
        load_registry(grants=["core.adr.write"])
        out = await ExtensionDecisions(KEY).create_draft(
            title="Related", related_decisions=[{"type": "scenario", "id": "s1"}]
        )
        row = (
            await db.execute(
                select(ArchitectureDecision).where(ArchitectureDecision.id == uuid.UUID(out.id))
            )
        ).scalar_one()
        assert row.related_decisions == [{"type": "scenario", "id": "s1"}]


class TestGet:
    async def test_returns_wire_shaped_decision_with_links(self, db, env):
        load_registry(grants=["core.adr.write"])
        bridge = ExtensionDecisions(KEY)
        created = await bridge.create_draft(
            title="Read back", linked_card_ids=[str(env["active"].id)]
        )
        got = await bridge.get(created.id)
        assert got == created

    async def test_missing_or_malformed_id_returns_none(self, db, env):
        load_registry(grants=["core.adr.read"])
        bridge = ExtensionDecisions(KEY)
        assert await bridge.get("nope") is None
        assert await bridge.get(str(uuid.uuid4())) is None

    async def test_read_sees_decisions_created_by_humans(self, db, env):
        load_registry(grants=["core.adr.read"])
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        user = await create_user(db, email="h@test.com", role="admin")
        row = ArchitectureDecision(reference_number="ADR-009", title="Human", created_by=user.id)
        db.add(row)
        await db.flush()
        got = await ExtensionDecisions(KEY).get(str(row.id))
        assert got is not None and got.reference_number == "ADR-009"


class TestSessionDiscipline:
    def test_every_public_method_opens_its_own_short_session(self):
        src = Path(bridge_mod.__file__).read_text(encoding="utf-8")
        assert "async with async_session() as db" in src
        assert "Depends(" not in src
