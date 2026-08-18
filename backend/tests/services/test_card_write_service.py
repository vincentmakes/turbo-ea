"""The extracted card write service (B0): REST-parity semantics callable
without a request, plus the actor model the extension bridge builds on.

The REST routes' own API tests remain the authoritative behaviour pin —
they now exercise these code paths through the routes. These tests cover
what the routes cannot: calling the service directly, and calling it as a
non-user actor (``user_id=None``, ``ext_key`` set) the way the extension
data bridge does.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.event import Event
from app.services import card_write_service as svc
from app.services.card_write_service import WriteActor
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation_type,
    create_user,
)

USER_ACTOR_EMAIL = "writer@test.com"


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
                    {"key": "website", "label": "Website", "type": "url"},
                    {
                        "key": "criticality",
                        "label": "Criticality",
                        "type": "single_select",
                        "options": [{"key": "high", "label": "High"}],
                    },
                ],
            }
        ],
    )
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_relation_type(db, key="app_to_itc")
    user = await create_user(db, email=USER_ACTOR_EMAIL)
    return {"user": user}


def ext_actor() -> WriteActor:
    return WriteActor(user_id=None, display_name="Sample Connector", ext_key="sample-connector")


class TestCreateCard:
    async def test_create_as_user_actor(self, db, env):
        actor = WriteActor.from_user(env["user"])
        card = await svc.create_card(db, actor, type_key="Application", name="Billing")
        assert card.id is not None
        assert card.created_by == env["user"].id
        assert card.approval_status == "DRAFT"

    async def test_create_as_extension_actor_stamps_events(self, db, env):
        card = await svc.create_card(db, ext_actor(), type_key="Application", name="From Ext")
        assert card.created_by is None
        await db.flush()
        events = (await db.execute(select(Event).where(Event.card_id == card.id))).scalars().all()
        assert events, "card.created event must be persisted"
        assert all(e.data.get("ext") == "sample-connector" for e in events)

    async def test_user_actor_events_carry_no_ext_stamp(self, db, env):
        actor = WriteActor.from_user(env["user"])
        card = await svc.create_card(db, actor, type_key="Application", name="Human Made")
        await db.flush()
        events = (await db.execute(select(Event).where(Event.card_id == card.id))).scalars().all()
        assert events and all("ext" not in (e.data or {}) for e in events)

    async def test_validation_matches_rest(self, db, env):
        actor = ext_actor()
        with pytest.raises(HTTPException) as exc:
            await svc.create_card(
                db,
                actor,
                type_key="Application",
                name="Bad URL",
                attributes={"website": "javascript:alert(1)"},
            )
        assert exc.value.status_code == 422
        with pytest.raises(HTTPException) as exc:
            await svc.create_card(
                db,
                actor,
                type_key="Application",
                name="Bad Option",
                attributes={"criticality": "nope"},
            )
        assert exc.value.status_code == 422

    async def test_sibling_name_uniqueness(self, db, env):
        actor = ext_actor()
        await svc.create_card(db, actor, type_key="Application", name="Twin")
        with pytest.raises(HTTPException):
            await svc.create_card(db, actor, type_key="Application", name="Twin")

    async def test_dry_run_emits_no_events(self, db, env):
        card = await svc.create_card(
            db, ext_actor(), type_key="Application", name="Preview Only", dry_run=True
        )
        events = (await db.execute(select(Event).where(Event.card_id == card.id))).scalars().all()
        assert events == []


class TestUpdateCard:
    async def test_update_merges_and_reports_change(self, db, env):
        card = await create_card(db, card_type="Application", name="Before")
        changed = await svc.update_card(db, ext_actor(), card, {"name": "After"})
        assert changed is True
        assert card.name == "After"
        assert card.updated_by is None  # extension actor has no user id

    async def test_noop_update_reports_unchanged(self, db, env):
        card = await create_card(db, card_type="Application", name="Same")
        assert await svc.update_card(db, ext_actor(), card, {"name": "Same"}) is False

    async def test_approval_breaks_on_substantive_change(self, db, env):
        card = await create_card(
            db, card_type="Application", name="Approved", approval_status="APPROVED"
        )
        await svc.update_card(db, ext_actor(), card, {"description": "new"})
        assert card.approval_status == "BROKEN"

    async def test_select_validation_on_update(self, db, env):
        card = await create_card(db, card_type="Application", name="Sel")
        with pytest.raises(HTTPException):
            await svc.update_card(db, ext_actor(), card, {"attributes": {"criticality": "bad"}})


class TestArchive:
    async def test_archive_set_flips_and_stamps(self, db, env):
        card = await create_card(db, card_type="Application", name="Retiring")
        flipped, children, related = await svc.archive_card_set(
            db,
            ext_actor(),
            card,
            child_strategy=None,
            descendants=[],
            related_card_ids=[],
            full_affected=[],
            direct_children=[],
        )
        assert [c.id for c in flipped] == [card.id]
        assert card.status == "ARCHIVED"
        assert children == [] and related == []
        events = (
            (
                await db.execute(
                    select(Event).where(
                        Event.card_id == card.id, Event.event_type == "card.archived"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert events and events[0].data.get("ext") == "sample-connector"


class TestUpsertRelation:
    async def test_creates_then_merges_idempotently(self, db, env):
        app = await create_card(db, card_type="Application", name="Src")
        itc = await create_card(db, card_type="ITComponent", name="Tgt")
        rel, reused, changed = await svc.upsert_relation(
            db,
            ext_actor(),
            type_key="app_to_itc",
            source_id=app.id,
            target_id=itc.id,
        )
        assert reused is False and changed == []
        rel2, reused2, changed2 = await svc.upsert_relation(
            db,
            ext_actor(),
            type_key="app_to_itc",
            source_id=app.id,
            target_id=itc.id,
            description="now described",
        )
        assert rel2.id == rel.id
        assert reused2 is True and changed2 == ["description"]
        assert rel2.description == "now described"


class TestNoCommit:
    def test_service_never_commits_or_rolls_back(self):
        """Source guard for the CLAUDE.md session rule: a helper must never
        commit or roll back a session it was handed."""
        import pathlib

        src = pathlib.Path(svc.__file__).read_text(encoding="utf-8")
        assert "db.commit()" not in src
        assert "db.rollback()" not in src
