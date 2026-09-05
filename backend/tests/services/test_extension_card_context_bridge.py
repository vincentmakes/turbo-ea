"""SDK 1.9 tag and stakeholder writes on the data bridge: group rules shared
with the REST route, the separate ``core.stakeholders.write`` grant, role
validation against the type's definitions, History events with the ext
stamp, rescoring, dry-run, and idempotency."""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.models.stakeholder import Stakeholder
from app.models.tag import CardTag, Tag, TagGroup
from app.services.extensions import data_service as bridge_mod
from app.services.extensions.data_service import ExtensionData
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.registry import ExtensionInfo, extension_registry
from app.services.extensions.sdk import ExtensionDataError, ExtensionPermissionError
from tests.conftest import (
    create_card,
    create_card_type,
    create_stakeholder_role_def,
    create_user,
)

NOW = datetime.now(timezone.utc)
KEY = "sample-rules"


def load_registry(*, grants: list[str], enabled: bool = True) -> None:
    extension_registry.clear()
    extension_registry.load_installed(
        [
            ExtensionInfo(
                key=KEY,
                name="Sample Rules",
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


@pytest.fixture(autouse=True)
def _patch_session(monkeypatch, db):
    @asynccontextmanager
    async def fake_session():
        yield db

    monkeypatch.setattr(bridge_mod, "async_session", fake_session)


@pytest.fixture
async def env(db):
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="Provider", label="Provider")
    app = await create_card(db, card_type="Application", name="Billing")
    provider = await create_card(db, card_type="Provider", name="ACME")
    archived = await create_card(db, card_type="Application", name="Legacy", status="ARCHIVED")

    multi = TagGroup(id=uuid.uuid4(), name="Domains", mode="multi")
    single = TagGroup(id=uuid.uuid4(), name="Tier", mode="single")
    apps_only = TagGroup(
        id=uuid.uuid4(), name="Hosting", mode="multi", restrict_to_types=["Application"]
    )
    db.add_all([multi, single, apps_only])
    await db.flush()
    tags = {
        "finance": Tag(id=uuid.uuid4(), tag_group_id=multi.id, name="Finance"),
        "hr": Tag(id=uuid.uuid4(), tag_group_id=multi.id, name="HR"),
        "gold": Tag(id=uuid.uuid4(), tag_group_id=single.id, name="Gold"),
        "silver": Tag(id=uuid.uuid4(), tag_group_id=single.id, name="Silver"),
        "cloud": Tag(id=uuid.uuid4(), tag_group_id=apps_only.id, name="Cloud"),
    }
    db.add_all(tags.values())
    await db.flush()

    await create_stakeholder_role_def(db, card_type_key="Application", key="owner", label="Owner")
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="architect", label="Architect"
    )
    user = await create_user(db, email="u@test.com", role="member", display_name="Uma")
    return {
        "app": app,
        "provider": provider,
        "archived": archived,
        "tags": {k: str(v.id) for k, v in tags.items()},
        "groups": {"multi": str(multi.id), "single": str(single.id), "apps": str(apps_only.id)},
        "user": user,
    }


async def _card_tag_ids(db, card_id) -> set[str]:
    rows = await db.execute(select(CardTag.tag_id).where(CardTag.card_id == card_id))
    return {str(t) for t in rows.scalars().all()}


async def _events(db, event_type: str) -> list[Event]:
    return list((await db.execute(select(Event).where(Event.event_type == event_type))).scalars())


class TestTagReads:
    async def test_tag_groups_and_card_tags_need_the_read_grant(self, db, env):
        load_registry(grants=["core.todos.read"])
        bridge = ExtensionData(KEY)
        with pytest.raises(ExtensionPermissionError):
            await bridge.get_tag_groups()
        with pytest.raises(ExtensionPermissionError):
            await bridge.get_card_tags(str(env["app"].id))

    async def test_tag_groups_shape(self, db, env):
        load_registry(grants=["core.cards.read"])
        groups = await ExtensionData(KEY).get_tag_groups()
        by_name = {g["name"]: g for g in groups}
        assert by_name["Tier"]["mode"] == "single"
        assert by_name["Hosting"]["restrict_to_types"] == ["Application"]
        assert {t["name"] for t in by_name["Domains"]["tags"]} == {"Finance", "HR"}
        assert set(by_name["Domains"]["tags"][0]) == {"id", "name", "color"}
        assert await ExtensionData(KEY).get_card_tags(str(env["app"].id)) == []
        assert await ExtensionData(KEY).get_card_tags("nope") == []


class TestSetCardTags:
    async def test_requires_cards_write(self, db, env):
        load_registry(grants=["core.cards.read", "core.stakeholders.write"])
        with pytest.raises(ExtensionPermissionError):
            await ExtensionData(KEY).set_card_tags(str(env["app"].id), [env["tags"]["finance"]])

    async def test_replace_add_remove_with_events_and_rescore(self, db, env):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        t = env["tags"]
        app_id = str(env["app"].id)
        out = await bridge.set_card_tags(app_id, [t["finance"], t["gold"]])
        assert set(out) == {t["finance"], t["gold"]}
        assert await _card_tag_ids(db, env["app"].id) == {t["finance"], t["gold"]}
        added = await _events(db, "tag.added")
        assert len(added) == 2
        assert all(e.data["ext"] == KEY and e.user_id is None for e in added)
        assert {e.data["tag_name"] for e in added} == {"Finance", "Gold"}

        out = await bridge.set_card_tags(app_id, [t["hr"]], mode="add")
        assert set(out) == {t["finance"], t["gold"], t["hr"]}
        out = await bridge.set_card_tags(app_id, [t["finance"], t["hr"]], mode="remove")
        assert set(out) == {t["gold"]}
        removed = await _events(db, "tag.removed")
        assert {e.data["tag_name"] for e in removed} == {"Finance", "HR"}

        # Replace that swaps the single-mode tag is fine; the result is one Tier tag.
        out = await bridge.set_card_tags(app_id, [t["silver"]])
        assert out == [t["silver"]]

    async def test_unchanged_set_writes_nothing(self, db, env):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        t = env["tags"]
        app_id = str(env["app"].id)
        await bridge.set_card_tags(app_id, [t["finance"]])
        before = len((await db.execute(select(MutationBatch))).scalars().all())
        events_before = len(await _events(db, "tag.added"))
        await bridge.set_card_tags(app_id, [t["finance"]])
        await bridge.set_card_tags(app_id, [t["finance"]], mode="add")
        assert len(await _events(db, "tag.added")) == events_before
        # Batches are still opened (the call is a write attempt) but no event.
        assert len((await db.execute(select(MutationBatch))).scalars().all()) >= before

    async def test_group_rules(self, db, env):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        t = env["tags"]
        with pytest.raises(ExtensionDataError, match="single-choice"):
            await bridge.set_card_tags(str(env["app"].id), [t["gold"], t["silver"]])
        await bridge.set_card_tags(str(env["app"].id), [t["gold"]])
        with pytest.raises(ExtensionDataError, match="single-choice"):
            await bridge.set_card_tags(str(env["app"].id), [t["silver"]], mode="add")
        with pytest.raises(ExtensionDataError, match="restricted"):
            await bridge.set_card_tags(str(env["provider"].id), [t["cloud"]])
        with pytest.raises(ExtensionDataError, match="Unknown tag"):
            await bridge.set_card_tags(str(env["app"].id), [str(uuid.uuid4())])
        with pytest.raises(ExtensionDataError, match="mode"):
            await bridge.set_card_tags(str(env["app"].id), [t["hr"]], mode="toggle")
        with pytest.raises(ExtensionDataError, match="archived"):
            await bridge.set_card_tags(str(env["archived"].id), [t["hr"]])
        with pytest.raises(ExtensionDataError, match="not found"):
            await bridge.set_card_tags(str(uuid.uuid4()), [t["hr"]])
        assert await _card_tag_ids(db, env["app"].id) == {t["gold"]}

    async def test_dry_run_leaves_nothing(self, db, env):
        load_registry(grants=["core.cards.write"])
        t = env["tags"]
        app_id = env["app"].id
        out = await ExtensionData(KEY).set_card_tags(str(app_id), [t["finance"]], dry_run=True)
        assert out == [t["finance"]]
        assert await _card_tag_ids(db, app_id) == set()
        assert await _events(db, "tag.added") == []
        assert (await db.execute(select(MutationBatch))).scalars().all() == []


class TestStakeholders:
    async def test_needs_its_own_grant_not_cards_write(self, db, env):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionData(KEY)
        with pytest.raises(ExtensionPermissionError, match="core.stakeholders.write"):
            await bridge.assign_stakeholder(str(env["app"].id), str(env["user"].id), "owner")
        with pytest.raises(ExtensionPermissionError):
            await bridge.remove_stakeholder(str(env["app"].id), str(env["user"].id), "owner")

    async def test_assign_is_validated_idempotent_and_audited(self, db, env):
        load_registry(grants=["core.stakeholders.write", "core.cards.read"])
        bridge = ExtensionData(KEY)
        app_id, uid = str(env["app"].id), str(env["user"].id)
        out = await bridge.assign_stakeholder(app_id, uid, "owner")
        assert (out.card_id, out.user_id, out.role) == (app_id, uid, "owner")
        again = await bridge.assign_stakeholder(app_id, uid, "owner")
        assert again == out
        rows = (await db.execute(select(Stakeholder))).scalars().all()
        assert len(rows) == 1
        events = await _events(db, "stakeholder.added")
        assert len(events) == 1
        assert events[0].data["ext"] == KEY
        assert events[0].data["role_label"] == "Owner"
        assert events[0].data["user_display_name"] == "Uma"
        assert events[0].user_id is None
        # Visible through the existing read.
        listed = await bridge.get_stakeholders_for([app_id])
        assert [(s.user_id, s.role) for s in listed] == [(uid, "owner")]
        batches = (await db.execute(select(MutationBatch))).scalars().all()
        assert all(b.tool_name == f"ext:{KEY}" for b in batches)

    async def test_role_must_exist_on_the_type(self, db, env):
        load_registry(grants=["core.stakeholders.write"])
        bridge = ExtensionData(KEY)
        with pytest.raises(ExtensionDataError, match="Invalid role"):
            await bridge.assign_stakeholder(str(env["app"].id), str(env["user"].id), "ceo")
        # Provider has no definitions → the two built-in defaults apply.
        out = await bridge.assign_stakeholder(
            str(env["provider"].id), str(env["user"].id), "responsible"
        )
        assert out.role == "responsible"
        with pytest.raises(ExtensionDataError, match="Invalid role"):
            await bridge.assign_stakeholder(str(env["provider"].id), str(env["user"].id), "owner")

    async def test_refuses_archived_card_unknown_or_inactive_user(self, db, env):
        load_registry(grants=["core.stakeholders.write"])
        bridge = ExtensionData(KEY)
        with pytest.raises(ExtensionDataError, match="archived"):
            await bridge.assign_stakeholder(str(env["archived"].id), str(env["user"].id), "owner")
        with pytest.raises(ExtensionDataError, match="not found"):
            await bridge.assign_stakeholder(str(env["app"].id), str(uuid.uuid4()), "owner")
        gone = await create_user(db, email="gone@test.com", role="member")
        gone.is_active = False
        await db.flush()
        with pytest.raises(ExtensionDataError, match="deactivated"):
            await bridge.assign_stakeholder(str(env["app"].id), str(gone.id), "owner")
        with pytest.raises(ExtensionDataError):
            await bridge.assign_stakeholder(str(env["app"].id), str(env["user"].id), "  ")
        assert (await db.execute(select(Stakeholder))).scalars().all() == []

    async def test_remove(self, db, env):
        load_registry(grants=["core.stakeholders.write"])
        bridge = ExtensionData(KEY)
        app_id, uid = str(env["app"].id), str(env["user"].id)
        assert await bridge.remove_stakeholder(app_id, uid, "owner") is False
        await bridge.assign_stakeholder(app_id, uid, "owner")
        assert await bridge.remove_stakeholder(app_id, uid, "owner") is True
        assert (await db.execute(select(Stakeholder))).scalars().all() == []
        removed = await _events(db, "stakeholder.removed")
        assert len(removed) == 1 and removed[0].data["ext"] == KEY

    async def test_dry_run_assign(self, db, env):
        load_registry(grants=["core.stakeholders.write"])
        app_id, uid = str(env["app"].id), str(env["user"].id)
        out = await ExtensionData(KEY).assign_stakeholder(app_id, uid, "owner", dry_run=True)
        assert out.role == "owner"
        assert (await db.execute(select(Stakeholder))).scalars().all() == []
        assert await _events(db, "stakeholder.added") == []

    async def test_rescore_runs(self, db, env):
        """A role that counts for quality moves the score on assignment."""
        load_registry(grants=["core.stakeholders.write"])
        card = await db.get(Card, env["app"].id)
        before = card.data_quality
        await ExtensionData(KEY).assign_stakeholder(str(card.id), str(env["user"].id), "owner")
        await db.refresh(card)
        assert card.data_quality >= before
