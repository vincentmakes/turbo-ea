"""``cards.updated_at`` and the History tab must never disagree.

The Inventory's **Modified** column and a card's **History** tab are two views
of the same fact, and users filter the column by date to find cards nobody has
reviewed — so a card that says "changed yesterday" and shows nothing in its
history is a card nobody can triage
(`#995 <https://github.com/vincentmakes/turbo-ea/discussions/995>`_).

Two halves, one invariant:

* a write path that changes a card on a user's behalf **persists a card event**;
* a pure derived-value recompute **does not move ``updated_at`` at all**.

Note the ``card_update_sql`` fixture rather than a timestamp comparison: see its
docstring in ``conftest.py`` for why comparing ``updated_at`` before and after
can only ever pass.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.models.event import Event
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


async def _events_for(db, card_id) -> list[Event]:
    return list((await db.execute(select(Event).where(Event.card_id == card_id))).scalars().all())


@pytest.fixture
async def env(db):
    await create_role(db, key="admin")
    user = await create_user(db, role="admin")
    ct = await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="NexaCore ERP", user_id=user.id)
    await db.commit()
    return {"user": user, "type": ct, "card": card}


# ---------------------------------------------------------------------------
# Half one: a bump owes an event
# ---------------------------------------------------------------------------


class TestBumpImpliesEvent:
    async def test_assigning_a_tag_records_it(self, db, client, env, card_update_sql):
        from app.models.tag import Tag, TagGroup

        group = TagGroup(name="Lifecycle", mode="multi")
        db.add(group)
        await db.flush()
        tag = Tag(name="Critical", tag_group_id=group.id)
        db.add(tag)
        await db.commit()

        card_update_sql.clear()
        resp = await client.post(
            f"/api/v1/cards/{env['card'].id}/tags",
            json=[str(tag.id)],
            headers=auth_headers(env["user"]),
        )
        assert resp.status_code == 201

        events = await _events_for(db, env["card"].id)
        assert [e.event_type for e in events] == ["tag.added"]
        assert events[0].data["tag_name"] == "Critical"
        assert events[0].data["group_name"] == "Lifecycle"
        assert events[0].user_id == env["user"].id

    async def test_reassigning_the_same_tag_says_nothing(self, db, client, env):
        from app.models.tag import Tag, TagGroup

        group = TagGroup(name="Lifecycle", mode="multi")
        db.add(group)
        await db.flush()
        tag = Tag(name="Critical", tag_group_id=group.id)
        db.add(tag)
        await db.commit()

        headers = auth_headers(env["user"])
        url = f"/api/v1/cards/{env['card'].id}/tags"
        assert (await client.post(url, json=[str(tag.id)], headers=headers)).status_code == 201
        assert (await client.post(url, json=[str(tag.id)], headers=headers)).status_code == 201

        events = await _events_for(db, env["card"].id)
        assert [e.event_type for e in events] == ["tag.added"], (
            "an import re-posts every tag on every run — a no-op must stay silent"
        )

    async def test_removing_a_tag_records_it(self, db, client, env):
        from app.models.tag import Tag, TagGroup

        group = TagGroup(name="Lifecycle", mode="multi")
        db.add(group)
        await db.flush()
        tag = Tag(name="Critical", tag_group_id=group.id)
        db.add(tag)
        await db.commit()

        headers = auth_headers(env["user"])
        await client.post(
            f"/api/v1/cards/{env['card'].id}/tags", json=[str(tag.id)], headers=headers
        )
        resp = await client.delete(f"/api/v1/cards/{env['card'].id}/tags/{tag.id}", headers=headers)
        assert resp.status_code == 204

        events = await _events_for(db, env["card"].id)
        assert "tag.removed" in [e.event_type for e in events]

    async def test_bulk_update_leaves_unchanged_cards_alone(self, db, client, env):
        """A card in the selection whose values already match must not be re-dated."""
        untouched = await create_card(
            db, card_type="Application", name="Already Named", user_id=env["user"].id
        )
        await db.commit()
        before_updated_by = untouched.updated_by

        resp = await client.patch(
            "/api/v1/cards/bulk",
            json={
                "ids": [str(untouched.id)],
                "updates": {"name": "Already Named"},
            },
            headers=auth_headers(env["user"]),
        )
        assert resp.status_code == 200

        assert await _events_for(db, untouched.id) == []
        await db.refresh(untouched)
        assert untouched.updated_by == before_updated_by

    async def test_eol_mass_link_records_the_link(self, db, client, env):
        resp = await client.post(
            "/api/v1/eol/mass-link",
            json=[
                {
                    "card_id": str(env["card"].id),
                    "eol_product": "postgresql",
                    "eol_cycle": "16",
                }
            ],
            headers=auth_headers(env["user"]),
        )
        assert resp.status_code == 200
        assert resp.json()["count"] == 1

        events = await _events_for(db, env["card"].id)
        assert [e.event_type for e in events] == ["card.updated"]
        changed = events[0].data["changes"]["attributes"]
        assert changed["new"]["eol_product"] == "postgresql"
        assert changed["new"]["eol_cycle"] == "16"

    async def test_eol_mass_link_is_a_no_op_when_already_linked(self, db, client, env):
        body = [{"card_id": str(env["card"].id), "eol_product": "postgresql", "eol_cycle": "16"}]
        headers = auth_headers(env["user"])
        await client.post("/api/v1/eol/mass-link", json=body, headers=headers)
        resp = await client.post("/api/v1/eol/mass-link", json=body, headers=headers)

        assert resp.json()["count"] == 0
        assert len(await _events_for(db, env["card"].id)) == 1

    async def test_reparent_records_the_cascade_on_descendants(self, db, client, env):
        """Descendants dragged along by a re-parent are re-dated, so they owe an entry."""
        await create_card_type(db, key="Capability", label="Capability", has_hierarchy=True)
        root_a = await create_card(db, card_type="Capability", name="Root A")
        root_b = await create_card(db, card_type="Capability", name="Root B")
        child = await create_card(db, card_type="Capability", name="Child", parent_id=root_a.id)
        grandchild = await create_card(
            db, card_type="Capability", name="Grandchild", parent_id=child.id
        )
        await db.commit()

        resp = await client.patch(
            f"/api/v1/cards/{child.id}",
            json={"parent_id": str(root_b.id)},
            headers=auth_headers(env["user"]),
        )
        assert resp.status_code == 200

        # The moved card itself always had an event; the grandchild is the one
        # that used to be re-dated in silence.
        assert [e.event_type for e in await _events_for(db, child.id)] == ["card.updated"]
        gc_events = await _events_for(db, grandchild.id)
        assert [e.event_type for e in gc_events] == ["card.updated"]
        assert gc_events[0].data["source"] == "hierarchy_cascade"


class TestImportPathsRecordThemselves:
    """The two "import" paths the reporter would actually hit."""

    async def _migration(self, db, user):
        from app.models.migration import Migration

        mig = Migration(
            name="acme.xlsx",
            file_hash=uuid.uuid4().hex,
            source_type="leanix",
            status="previewed",
            created_by=user.id,
        )
        db.add(mig)
        await db.flush()
        return mig

    async def test_migration_apply_records_a_create(self, db, env):
        from app.models.migration import StagedRecord
        from app.services.migration.apply import _apply_single_card

        mig = await self._migration(db, env["user"])
        staged = StagedRecord(
            migration_id=mig.id,
            source_type="leanix",
            entity_kind="card",
            source_id="lx-1",
            action="create",
            source_data={"payload": {"type": "Application", "name": "Imported App"}},
        )
        db.add(staged)
        await db.flush()

        await _apply_single_card(db, staged, env["user"])

        events = await _events_for(db, staged.target_id)
        assert [e.event_type for e in events] == ["card.created"]
        assert events[0].data["source"] == "migration"
        assert events[0].data["source_type"] == "leanix"

    async def test_migration_apply_records_an_update(self, db, env):
        from app.models.migration import StagedRecord
        from app.services.migration.apply import _apply_single_card

        mig = await self._migration(db, env["user"])
        staged = StagedRecord(
            migration_id=mig.id,
            source_type="leanix",
            entity_kind="card",
            source_id="lx-2",
            action="update",
            target_id=env["card"].id,
            source_data={
                "payload": {
                    "type": "Application",
                    "name": "NexaCore ERP",
                    "attributes": {"criticality": "high"},
                }
            },
        )
        db.add(staged)
        await db.flush()

        await _apply_single_card(db, staged, env["user"])

        events = await _events_for(db, env["card"].id)
        assert [e.event_type for e in events] == ["card.updated"]
        changes = events[0].data["changes"]
        # Whole-blob old/new is the only shape HistoryTab.parseChanges renders.
        assert changes["attributes"]["old"] == {}
        assert changes["attributes"]["new"] == {"criticality": "high"}

    async def test_migration_re_apply_of_an_unchanged_snapshot_is_silent(self, db, env):
        from app.models.migration import StagedRecord
        from app.services.migration.apply import _apply_single_card

        mig = await self._migration(db, env["user"])
        payload = {"payload": {"type": "Application", "name": "NexaCore ERP"}}
        before_updated_by = env["card"].updated_by
        staged = StagedRecord(
            migration_id=mig.id,
            source_type="leanix",
            entity_kind="card",
            source_id="lx-3",
            action="update",
            target_id=env["card"].id,
            source_data=payload,
        )
        db.add(staged)
        await db.flush()

        await _apply_single_card(db, staged, env["user"])

        assert await _events_for(db, env["card"].id) == []
        assert env["card"].updated_by == before_updated_by

    async def test_servicenow_apply_persists_its_events(self, db, env):
        """The sync used to publish without `db=`, so nothing ever reached History."""
        from app.models.servicenow import SnowStagedRecord
        from app.services.servicenow_service import SyncEngine

        engine = SyncEngine(db, client=None)
        staged = SnowStagedRecord(
            sync_run_id=None,
            mapping_id=None,
            snow_sys_id="sys-1",
            snow_data={},
            card_id=env["card"].id,
            action="update",
            diff={
                "name": {"old": "NexaCore ERP", "new": "NexaCore ERP v2"},
                "attributes.criticality": {"old": None, "new": "high"},
            },
            status="pending",
        )

        await engine._apply_update(staged, [], env["user"].id)

        events = await _events_for(db, env["card"].id)
        assert [e.event_type for e in events] == ["card.updated"]
        assert events[0].user_id == env["user"].id
        changes = events[0].data["changes"]
        assert changes["name"] == {"old": "NexaCore ERP", "new": "NexaCore ERP v2"}
        assert changes["attributes"]["new"] == {"criticality": "high"}

    async def test_ppm_cost_rollup_records_itself(self, db, env, client):
        from tests.conftest import create_card_type

        await create_card_type(db, key="Initiative", label="Initiative")
        initiative = await create_card(
            db, card_type="Initiative", name="ERP Refresh", user_id=env["user"].id
        )
        await db.commit()

        resp = await client.post(
            f"/api/v1/ppm/initiatives/{initiative.id}/budgets",
            json={"fiscal_year": 2026, "category": "capex", "amount": 100000},
            headers=auth_headers(env["user"]),
        )
        assert resp.status_code in (200, 201), resp.text

        events = await _events_for(db, initiative.id)
        assert [e.event_type for e in events] == ["card.updated"]
        assert events[0].data["source"] == "ppm_cost_rollup"
        assert events[0].data["changes"]["attributes"]["new"]["costBudget"] == 100000


# ---------------------------------------------------------------------------
# Half two: housekeeping does not re-date
# ---------------------------------------------------------------------------


class TestDerivedMaintenanceDoesNotBump:
    async def test_rescore_card_type_moves_scores_but_not_modified(self, db, env, card_update_sql):
        from app.services.data_quality import rescore_card_type

        env["card"].attributes = {"owner": "Alice"}
        env["type"].fields_schema = [
            {
                "section": "Detail",
                "fields": [{"key": "owner", "label": "Owner", "type": "text", "weight": 5}],
            }
        ]
        await db.commit()

        card_update_sql.clear()
        changed = await rescore_card_type(db, "Application")
        await db.flush()

        assert changed > 0, "the rescore was a no-op — the assertion below would be vacuous"
        assert card_update_sql.statements, "expected the rescore to UPDATE the card row"
        assert not card_update_sql.bumped(), (
            "a weight change is not an edit to every card of the type"
        )

    async def test_bulk_calculation_run_does_not_bump(self, db, env, card_update_sql):
        from app.models.calculation import Calculation
        from app.services.calculation_engine import run_calculations_for_type

        db.add(
            Calculation(
                name="Constant",
                formula="42",
                target_type_key="Application",
                target_field_key="score",
                is_active=True,
            )
        )
        await db.commit()

        card_update_sql.clear()
        await run_calculations_for_type(db, "Application")

        card = (await db.execute(select(Card).where(Card.id == env["card"].id))).scalar_one()
        assert card.attributes.get("score") == 42, "the run was a no-op"
        assert not card_update_sql.bumped()

    async def test_reference_backfill_does_not_bump(self, db, env, card_update_sql):
        from app.services import card_reference

        env["type"].reference_config = {"mode": "auto", "prefix": "APP-", "start": 1}
        await db.flush()

        card_update_sql.clear()
        minted = await card_reference.backfill_references_for_type(db, env["type"])
        await db.flush()

        assert minted > 0, "nothing was minted — the assertion below would be vacuous"
        assert not card_update_sql.bumped()

    async def test_hierarchy_level_backfill_does_not_bump(self, db, card_update_sql):
        from app.services.hierarchy import backfill_hierarchy_levels_for_type

        await create_card_type(db, key="Capability", label="Capability", has_hierarchy=True)
        root = await create_card(db, card_type="Capability", name="Root")
        await create_card(db, card_type="Capability", name="Leaf", parent_id=root.id)
        await db.commit()

        card_update_sql.clear()
        updated = await backfill_hierarchy_levels_for_type(db, "Capability")
        await db.flush()

        assert updated > 0
        assert not card_update_sql.bumped()


class TestPinMechanism:
    async def test_pin_survives_an_autoflush_inside_the_block(self, db, env, card_update_sql):
        """The pin is applied at flush time, not at the end of the block.

        An autoflush *inside* ``derived_maintenance()`` would otherwise write
        ``now()`` before the block ever got a chance to restore anything.
        """
        from app.services.derived_writes import derived_maintenance

        card_update_sql.clear()
        with derived_maintenance(db):
            env["card"].data_quality = 77.0
            # Any query autoflushes the pending UPDATE.
            await db.execute(select(Card.id).where(Card.type == "Application"))
        await db.flush()

        assert card_update_sql.statements, "expected an UPDATE cards"
        assert not card_update_sql.bumped()

    async def test_a_real_edit_outside_the_block_still_bumps(self, db, env, card_update_sql):
        card_update_sql.clear()
        env["card"].description = "Changed by a human"
        await db.flush()

        assert card_update_sql.bumped(), "an ordinary content edit must still re-date the card"
