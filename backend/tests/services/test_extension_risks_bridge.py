"""The SDK risks bridge (SDK 1.9): grant gating, provenance-only creation
through the same writer as ``POST /risks``, owner-todo + notification
parity, the extension-key prefix on ``source_ref`` and the dedupe lookup
built on it, updates restricted to the extension's own rows and never to
the status workflow, and audit batches.

Same harness as the other bridge tests: the bridge opens its own sessions
via ``async_session`` (patched to the savepoint-rollback test session) and
the in-memory ``extension_registry`` singleton is driven directly."""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.config import settings
from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.models.notification import Notification
from app.models.risk import Risk, RiskCard
from app.models.todo import Todo
from app.services.extensions import risks_bridge as bridge_mod
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.registry import ExtensionInfo, extension_registry
from app.services.extensions.risks_bridge import ExtensionRisks
from app.services.extensions.sdk import ExtensionDataError, ExtensionPermissionError, ExtRisk
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

NOW = datetime.now(timezone.utc)
KEY = "sample-rules"


def load_registry(*, grants: list[str], enabled: bool = True, status: str = "installed") -> None:
    extension_registry.clear()
    extension_registry.load_installed(
        [
            ExtensionInfo(
                key=KEY,
                name="Sample Rules",
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
    other = await create_card(db, card_type="Application", name="CRM")
    archived = await create_card(db, card_type="Application", name="Legacy", status="ARCHIVED")
    owner = await create_user(db, email="owner@test.com", role="member", display_name="Owner")
    return {"active": active, "other": other, "archived": archived, "owner": owner}


async def _batches(db) -> list[MutationBatch]:
    return list((await db.execute(select(MutationBatch))).scalars().all())


class TestGating:
    async def test_no_grant_blocks_reads_and_writes(self, db, env):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionRisks(KEY)
        with pytest.raises(ExtensionPermissionError):
            await bridge.get(str(uuid.uuid4()))
        with pytest.raises(ExtensionPermissionError):
            await bridge.list_for_card(env["active"].id)
        with pytest.raises(ExtensionPermissionError):
            await bridge.create(title="x")

    async def test_read_grant_does_not_allow_create(self, db, env):
        load_registry(grants=["core.risks.read"])
        bridge = ExtensionRisks(KEY)
        assert await bridge.get(str(uuid.uuid4())) is None
        assert await bridge.list_for_card(str(env["active"].id)) == []
        with pytest.raises(ExtensionPermissionError):
            await bridge.create(title="x")

    async def test_write_grant_implies_read(self, db, env):
        load_registry(grants=["core.risks.write"])
        bridge = ExtensionRisks(KEY)
        created = await bridge.create(title="Implied read")
        assert (await bridge.get(created.id)).id == created.id

    async def test_disabled_extension_is_refused(self, db, env):
        load_registry(grants=["core.risks.write"], enabled=False)
        with pytest.raises(ExtensionPermissionError):
            await ExtensionRisks(KEY).create(title="x")

    async def test_kill_switch_blocks_writes_not_reads(self, db, env, monkeypatch):
        load_registry(grants=["core.risks.write"])
        bridge = ExtensionRisks(KEY)
        created = await bridge.create(title="Before")
        monkeypatch.setattr(settings, "EXTENSION_WRITES_ENABLED", False)
        with pytest.raises(ExtensionPermissionError):
            await bridge.create(title="After")
        assert (await bridge.get(created.id)).title == "Before"


class TestCreate:
    async def test_creates_with_provenance_owner_todo_and_events(self, db, env):
        load_registry(grants=["core.risks.write"])
        bridge = ExtensionRisks(KEY)
        out = await bridge.create(
            title="Unowned cost centre",
            description="Annual cost above threshold with no owner",
            category="financial",
            probability="high",
            impact="critical",
            owner_id=str(env["owner"].id),
            target_resolution_date="2027-01-31",
            card_ids=[str(env["active"].id), str(env["other"].id), str(env["active"].id)],
            source_ref="rule-1:" + str(env["active"].id)[:8],
        )
        assert isinstance(out, ExtRisk)
        assert out.reference.startswith("R-")
        assert out.source_type == "extension"
        # The key prefix is stored but stripped on the way out.
        assert out.source_ref == "rule-1:" + str(env["active"].id)[:8]
        row = await db.get(Risk, uuid.UUID(out.id))
        assert row.source_ref == f"{KEY}:rule-1:" + str(env["active"].id)[:8]
        assert row.created_by is None
        assert row.initial_level == "critical"
        assert row.owner_id == env["owner"].id
        assert set(out.linked_card_ids) == {str(env["active"].id), str(env["other"].id)}
        assert out.target_resolution_date == "2027-01-31"

        # Owner's system todo + risk_assigned notification, exactly as REST.
        todo = (await db.execute(select(Todo).where(Todo.is_system.is_(True)))).scalar_one_or_none()
        assert todo is not None and todo.assigned_to == env["owner"].id
        assert todo.created_by is None
        notes = (
            (await db.execute(select(Notification).where(Notification.type == "risk_assigned")))
            .scalars()
            .all()
        )
        assert [n.user_id for n in notes] == [env["owner"].id]

        # One risk.added event per linked card, stamped with the extension key.
        events = (
            (await db.execute(select(Event).where(Event.event_type == "risk.added")))
            .scalars()
            .all()
        )
        assert {e.card_id for e in events} == {env["active"].id, env["other"].id}
        assert all(e.data.get("ext") == KEY for e in events)
        assert all(e.data.get("origin") == "ext" for e in events)
        assert all(e.user_id is None for e in events)

        # Audit: one committed ext batch whose summary names the risk.
        batches = await _batches(db)
        assert len(batches) == 1
        assert batches[0].tool_name == f"ext:{KEY}"
        assert batches[0].origin == "ext"
        assert batches[0].committed_at is not None
        assert batches[0].summary["reference"] == out.reference
        assert all(e.batch_id == batches[0].id for e in events)

    async def test_shares_the_reference_sequence_with_rest(self, client, db, env):
        load_registry(grants=["core.risks.write"])
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        resp = await client.post(
            "/api/v1/risks", json={"title": "Manual"}, headers=auth_headers(admin)
        )
        assert resp.status_code == 200, resp.text
        first = resp.json()["reference"]
        out = await ExtensionRisks(KEY).create(title="From bridge")
        assert int(out.reference[2:]) == int(first[2:]) + 1

    async def test_validation_before_any_session(self, db, env):
        load_registry(grants=["core.risks.write"])
        bridge = ExtensionRisks(KEY)
        with pytest.raises(ExtensionDataError):
            await bridge.create(title="   ")
        with pytest.raises(ExtensionDataError):
            await bridge.create(title="x", category="nonsense")
        with pytest.raises(ExtensionDataError):
            await bridge.create(title="x", probability="always")
        with pytest.raises(ExtensionDataError):
            await bridge.create(title="x", impact="huge")
        with pytest.raises(ExtensionDataError):
            await bridge.create(title="x", target_resolution_date="31/01/2027")
        with pytest.raises(ExtensionDataError):
            await bridge.create(title="x", source_ref="r" * 70)
        assert await _batches(db) == []

    async def test_refuses_unknown_archived_cards_and_inactive_owner(self, db, env):
        load_registry(grants=["core.risks.write"])
        bridge = ExtensionRisks(KEY)
        with pytest.raises(ExtensionDataError, match="not found"):
            await bridge.create(title="x", card_ids=[str(uuid.uuid4())])
        with pytest.raises(ExtensionDataError, match="archived"):
            await bridge.create(title="x", card_ids=[str(env["archived"].id)])
        with pytest.raises(ExtensionDataError, match="not found"):
            await bridge.create(title="x", owner_id=str(uuid.uuid4()))
        inactive = await create_user(db, email="gone@test.com", role="member")
        inactive.is_active = False
        await db.flush()
        with pytest.raises(ExtensionDataError, match="deactivated"):
            await bridge.create(title="x", owner_id=str(inactive.id))
        assert (await db.execute(select(Risk))).scalars().all() == []


class TestLookups:
    async def test_find_by_source_ref_is_scoped_to_the_extension(self, db, env):
        load_registry(grants=["core.risks.write"])
        mine = ExtensionRisks(KEY)
        created = await mine.create(title="Mine", source_ref="rule-1:abc")
        assert (await mine.find_by_source_ref("rule-1:abc")).id == created.id
        assert await mine.find_by_source_ref("rule-1:zzz") is None
        assert await mine.find_by_source_ref("") is None

        # Another extension writing the same bare ref never collides.
        extension_registry.clear()
        extension_registry.load_installed(
            [
                ExtensionInfo(
                    key="other-ext",
                    name="Other",
                    version="1.0.0",
                    status="installed",
                    enabled=True,
                    manifest={"grants": ["core.risks.write"]},
                )
            ]
        )
        extension_registry.set_license(
            LicenseDocument(
                licensee="ACME",
                customer_id="cus_1",
                issued_at=NOW - timedelta(days=1),
                grace_days=30,
                entitlements=[Entitlement(extension_key="other-ext", expires_at=None)],
            )
        )
        other = ExtensionRisks("other-ext")
        assert await other.find_by_source_ref("rule-1:abc") is None
        theirs = await other.create(title="Theirs", source_ref="rule-1:abc")
        assert theirs.id != created.id
        assert (await other.find_by_source_ref("rule-1:abc")).id == theirs.id

    async def test_list_for_card(self, db, env):
        load_registry(grants=["core.risks.write"])
        bridge = ExtensionRisks(KEY)
        a = await bridge.create(title="A", card_ids=[str(env["active"].id)])
        await bridge.create(title="B", card_ids=[str(env["other"].id)])
        listed = await bridge.list_for_card(str(env["active"].id))
        assert [r.id for r in listed] == [a.id]
        assert await bridge.list_for_card("not-a-uuid") == []


class TestUpdate:
    async def test_updates_own_row_and_keeps_owner_todo_in_step(self, db, env):
        load_registry(grants=["core.risks.write"])
        bridge = ExtensionRisks(KEY)
        created = await bridge.create(title="Old", source_ref="r1")
        out = await bridge.update(
            created.id,
            title="New",
            description="More",
            owner_id=str(env["owner"].id),
            target_resolution_date="2027-06-30",
            add_card_ids=[str(env["active"].id)],
        )
        assert out.title == "New"
        assert out.owner_id == str(env["owner"].id)
        assert out.target_resolution_date == "2027-06-30"
        assert out.linked_card_ids == (str(env["active"].id),)
        todo = (await db.execute(select(Todo).where(Todo.is_system.is_(True)))).scalar_one_or_none()
        assert todo is not None and todo.assigned_to == env["owner"].id
        links = (
            (await db.execute(select(RiskCard).where(RiskCard.risk_id == uuid.UUID(created.id))))
            .scalars()
            .all()
        )
        assert len(links) == 1
        # Clearing the owner removes the system todo; status is untouched.
        cleared = await bridge.update(created.id, clear_owner=True)
        assert cleared.owner_id is None
        assert cleared.status == "identified"
        assert (
            await db.execute(select(Todo).where(Todo.is_system.is_(True)))
        ).scalar_one_or_none() is None

    async def test_cannot_touch_status_or_someone_elses_risk(self, client, db, env):
        load_registry(grants=["core.risks.write"])
        bridge = ExtensionRisks(KEY)
        created = await bridge.create(title="Mine")
        # No status parameter exists on the bridge at all.
        with pytest.raises(TypeError):
            await bridge.update(created.id, status="closed")  # type: ignore[call-arg]
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        resp = await client.post(
            "/api/v1/risks", json={"title": "Manual"}, headers=auth_headers(admin)
        )
        assert resp.status_code == 200, resp.text
        manual_id = resp.json()["id"]
        with pytest.raises(ExtensionDataError, match="not filed by extension"):
            await bridge.update(manual_id, title="Hijacked")
        assert (await db.get(Risk, uuid.UUID(manual_id))).title == "Manual"

    async def test_update_rejects_conflicting_flags_and_unknown_risk(self, db, env):
        load_registry(grants=["core.risks.write"])
        bridge = ExtensionRisks(KEY)
        created = await bridge.create(title="Mine")
        with pytest.raises(ExtensionDataError):
            await bridge.update(created.id, owner_id=str(env["owner"].id), clear_owner=True)
        with pytest.raises(ExtensionDataError):
            await bridge.update(
                created.id,
                target_resolution_date="2027-01-01",
                clear_target_resolution_date=True,
            )
        with pytest.raises(ExtensionDataError, match="not found"):
            await bridge.update(str(uuid.uuid4()), title="x")
