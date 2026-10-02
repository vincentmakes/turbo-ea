"""The ServiceNow sync engine and REST client against a fake Table API.

``patch_httpx_client`` routes every ``httpx.AsyncClient`` the service
builds through ``snow_table_handler`` (``tests/seams.py``), so the pull
and push syncs run end to end — fetch, match, diff, stage, apply — on
the test database with no network.
"""

from __future__ import annotations

import json
import uuid

import httpx
import pytest
from sqlalchemy import select

import app.services.servicenow_service as snow
from app.models.card import Card
from app.models.event import Event
from app.models.servicenow import (
    SnowConnection,
    SnowFieldMapping,
    SnowIdentityMap,
    SnowMapping,
    SnowStagedRecord,
    SnowSyncRun,
)
from app.services.servicenow_service import ServiceNowClient, SyncEngine, encrypt_credentials
from tests.conftest import create_card, create_card_type, create_role, create_user
from tests.seams import patch_httpx_client, snow_table_handler

INSTANCE = "https://acme.service-now.com"
TABLE = "cmdb_ci_appl"
S1, S2, S3, S4, S9 = ("1" * 32, "2" * 32, "3" * 32, "4" * 32, "9" * 32)
PULL_ZERO = {"fetched": 0, "created": 0, "updated": 0, "deleted": 0, "skipped": 0, "errors": 0}


def _rec(sys_id: str, name: str, **extra) -> dict:
    return {
        "sys_id": sys_id,
        "name": name,
        "short_description": f"{name} desc",
        "busines_criticality": "1 - most critical",
        "install_date": "2021-05-01 00:00:00",
        **extra,
    }


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    conn = SnowConnection(
        name="SNOW",
        instance_url=INSTANCE,
        auth_type="basic",
        credentials=encrypt_credentials({"username": "u", "password": "p"}),
    )
    db.add(conn)
    await db.flush()
    mapping = SnowMapping(
        connection_id=conn.id,
        card_type_key="Application",
        snow_table=TABLE,
        sync_mode="conservative",
        max_deletion_ratio=0.5,
    )
    db.add(mapping)
    await db.flush()
    fms = [
        SnowFieldMapping(
            mapping_id=mapping.id, turbo_field="name", snow_field="name", is_identity=True
        ),
        SnowFieldMapping(
            mapping_id=mapping.id, turbo_field="description", snow_field="short_description"
        ),
        SnowFieldMapping(
            mapping_id=mapping.id,
            turbo_field="attributes.criticality",
            snow_field="busines_criticality",
            transform_type="value_map",
            transform_config={"mapping": {"1 - most critical": "critical"}},
        ),
        # A constant: no source column, written on every inbound record.
        SnowFieldMapping(
            mapping_id=mapping.id,
            turbo_field="attributes.origin",
            snow_field="",
            default_value="servicenow",
        ),
        SnowFieldMapping(
            mapping_id=mapping.id,
            turbo_field="lifecycle.active",
            snow_field="install_date",
            transform_type="date_format",
        ),
        # The one outbound column.
        SnowFieldMapping(
            mapping_id=mapping.id,
            turbo_field="attributes.owner",
            snow_field="owned_by",
            direction="turbo_leads",
        ),
    ]
    db.add_all(fms)
    await db.flush()
    return {"admin": admin, "conn": conn, "mapping": mapping, "fms": fms}


def _engine(db, monkeypatch, handler):
    seen = patch_httpx_client(monkeypatch, snow, handler)
    client = ServiceNowClient(INSTANCE, {"username": "u", "password": "p"})
    return SyncEngine(db, client), seen


async def _identity(db, env, card, sys_id, *, created_by_sync=True) -> SnowIdentityMap:
    row = SnowIdentityMap(
        connection_id=env["conn"].id,
        mapping_id=env["mapping"].id,
        card_id=card.id,
        snow_sys_id=sys_id,
        snow_table=TABLE,
        created_by_sync=created_by_sync,
    )
    db.add(row)
    await db.flush()
    return row


async def _staged(db, run) -> list[SnowStagedRecord]:
    rows = (
        await db.execute(select(SnowStagedRecord).where(SnowStagedRecord.sync_run_id == run.id))
    ).scalars()
    return sorted(rows, key=lambda s: s.snow_sys_id)


async def _assert_stats_persisted(db, run) -> None:
    """The counts the run reports in memory are the counts its row holds.

    ``populate_existing`` overwrites the instance from the table, so the
    expectation is copied first — comparing the refreshed object with
    itself would prove nothing.
    """
    expected = dict(run.stats or {})
    row = (
        await db.execute(
            select(SnowSyncRun)
            .where(SnowSyncRun.id == run.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert row.stats == expected


async def _identity_rows(db) -> dict[str, SnowIdentityMap]:
    return {e.snow_sys_id: e for e in (await db.execute(select(SnowIdentityMap))).scalars()}


async def _events(db, event_type) -> list[Event]:
    return (await db.execute(select(Event).where(Event.event_type == event_type))).scalars().all()


async def _card(db, env, name, **attrs):
    card = await create_card(db, card_type="Application", name=name, user_id=env["admin"].id)
    for key, value in attrs.items():
        setattr(card, key, value)
    await db.flush()
    return card


# ---------------------------------------------------------------------------
# Pull — staging
# ---------------------------------------------------------------------------


class TestPullStaging:
    async def test_stages_creates_updates_and_skips(self, db, env, monkeypatch):
        env["mapping"].filter_query = "active=true"
        changed = await _card(db, env, "Changed", description="old")
        same = await _card(
            db,
            env,
            "Same",
            description="Same desc",
            attributes={"criticality": "critical", "origin": "servicenow"},
            lifecycle={"active": "2021-05-01"},
        )
        await _identity(db, env, changed, S2)
        await _identity(db, env, same, S3)
        records = [_rec(S1, "Fresh"), _rec(S2, "Changed"), _rec(S3, "Same")]
        engine, seen = _engine(db, monkeypatch, snow_table_handler(records=records))

        run = await engine.pull_sync(
            env["mapping"], env["fms"], user_id=env["admin"].id, auto_apply=False
        )
        assert run.status == "completed" and run.direction == "pull"
        assert run.completed_at is not None and run.created_by == env["admin"].id
        assert run.stats == {**PULL_ZERO, "fetched": 3, "created": 1, "updated": 1, "skipped": 1}
        await _assert_stats_persisted(db, run)

        staged = {s.snow_sys_id: s for s in await _staged(db, run)}
        fresh = staged[S1]
        assert (fresh.action, fresh.card_id, fresh.status) == ("create", None, "pending")
        assert fresh.snow_data == records[0] and fresh.mapping_id == env["mapping"].id
        update = staged[S2]
        assert update.action == "update" and update.card_id == changed.id
        assert update.diff == {
            "description": {"old": "old", "new": "Changed desc"},
            "attributes.criticality": {"old": None, "new": "critical"},
            "attributes.origin": {"old": None, "new": "servicenow"},
            "lifecycle.active": {"old": None, "new": "2021-05-01"},
        }
        assert staged[S3].action == "skip" and staged[S3].diff is None
        assert staged[S3].card_id == same.id
        assert changed.description == "old"  # nothing applied yet

        (request,) = seen
        params = request.url.params
        assert params["sysparm_fields"] == (
            "sys_id,name,short_description,busines_criticality,install_date,owned_by"
        )
        assert params["sysparm_query"] == "active=true"
        assert params["sysparm_limit"] == "500" and params["sysparm_offset"] == "0"

    async def test_identity_fields_match_existing_cards_by_name(self, db, env, monkeypatch):
        exact = await _card(db, env, "Billing")
        fuzzy = await _card(db, env, "Customer Portal")
        await _card(db, env, "Legacy", status="ARCHIVED")
        records = [
            _rec(S1, "Billing"),
            _rec(S2, "customer portal"),  # case differs: fuzzy ratio 1.0
            _rec(S3, "Legacy"),  # only an archived card carries the name
            _rec(S4, "Totally new"),
        ]
        engine, _ = _engine(db, monkeypatch, snow_table_handler(records=records))
        run = await engine.pull_sync(env["mapping"], env["fms"], auto_apply=False)
        staged = {s.snow_sys_id: s for s in await _staged(db, run)}
        assert staged[S1].action == "update" and staged[S1].card_id == exact.id
        assert staged[S2].action == "update" and staged[S2].card_id == fuzzy.id
        assert staged[S3].action == "create" and staged[S4].action == "create"
        assert run.stats["created"] == 2 and run.stats["updated"] == 2

    async def test_pagination_follows_the_total_count(self, db, env, monkeypatch):
        records = [_rec(f"{i:032x}", f"App {i}") for i in range(1, 601)]
        engine, seen = _engine(db, monkeypatch, snow_table_handler(records=records))
        run = await engine.pull_sync(env["mapping"], env["fms"], auto_apply=False)
        assert [r.url.params["sysparm_offset"] for r in seen] == ["0", "500"]
        assert run.stats["fetched"] == 600 and run.stats["created"] == 600
        assert len(await _staged(db, run)) == 600

    async def test_records_without_a_sys_id_are_ignored_and_failures_counted(
        self, db, env, monkeypatch
    ):
        records = [{"name": "No id"}, _rec(S1, "Boom"), _rec(S2, "Fine")]
        engine, _ = _engine(db, monkeypatch, snow_table_handler(records=records))
        original = engine._process_pull_record

        async def flaky(run, mapping, fms, identity_fields, record, sys_id, id_map, **kw):
            if record["name"] == "Boom":
                raise RuntimeError("bad record")
            return await original(run, mapping, fms, identity_fields, record, sys_id, id_map, **kw)

        monkeypatch.setattr(engine, "_process_pull_record", flaky)
        run = await engine.pull_sync(env["mapping"], env["fms"], auto_apply=False)
        assert run.status == "completed"
        assert run.stats == {**PULL_ZERO, "fetched": 3, "created": 1, "errors": 1}
        await _assert_stats_persisted(db, run)
        assert [s.snow_sys_id for s in await _staged(db, run)] == [S2]

    async def test_a_fetch_failure_fails_the_run(self, db, env, monkeypatch):
        engine, _ = _engine(db, monkeypatch, snow_table_handler(fail_status=500))
        run = await engine.pull_sync(env["mapping"], env["fms"])
        assert run.status == "failed" and run.error_message == "Sync operation failed"
        assert run.completed_at is not None and run.stats == PULL_ZERO
        assert await _staged(db, run) == []


# ---------------------------------------------------------------------------
# Pull — apply
# ---------------------------------------------------------------------------


class TestPullApply:
    async def test_auto_apply_creates_cards_identity_rows_and_history(self, db, env, monkeypatch):
        records = [_rec(S1, "Billing"), _rec(S2, "CRM", busines_criticality="odd", install_date="")]
        engine, _ = _engine(db, monkeypatch, snow_table_handler(records=records))
        run = await engine.pull_sync(env["mapping"], env["fms"], user_id=env["admin"].id)
        assert run.status == "completed"
        assert run.stats == {**PULL_ZERO, "fetched": 2, "created": 2}
        await _assert_stats_persisted(db, run)

        cards = {c.name: c for c in (await db.execute(select(Card))).scalars()}
        billing = cards["Billing"]
        assert billing.type == "Application" and billing.approval_status == "DRAFT"
        assert billing.description == "Billing desc"
        assert billing.attributes == {"criticality": "critical", "origin": "servicenow"}
        assert billing.lifecycle == {"active": "2021-05-01"}
        assert cards["CRM"].attributes["criticality"] == "odd"  # unmapped values pass through
        assert cards["CRM"].lifecycle.get("active") is None

        ids = await _identity_rows(db)
        assert ids[S1].card_id == billing.id and ids[S1].created_by_sync is True
        assert ids[S1].snow_table == TABLE and ids[S1].last_synced_at is not None
        assert ids[S1].mapping_id == env["mapping"].id
        staged = await _staged(db, run)
        assert {s.status for s in staged} == {"applied"} and all(s.card_id for s in staged)
        events = await _events(db, "card.created")
        assert {e.card_id for e in events} == {billing.id, cards["CRM"].id}
        assert all(e.data["source"] == "servicenow_sync" for e in events)
        assert all(e.user_id == env["admin"].id for e in events)

    async def test_update_applies_the_diff_and_records_the_change(self, db, env, monkeypatch):
        card = await _card(
            db,
            env,
            "Billing",
            description="old",
            attributes={"criticality": "medium", "keep": 1},
            lifecycle={"plan": "2020-01-01"},
        )
        entry = await _identity(db, env, card, S1)
        engine, _ = _engine(db, monkeypatch, snow_table_handler(records=[_rec(S1, "Billing")]))
        run = await engine.pull_sync(env["mapping"], env["fms"], user_id=env["admin"].id)
        assert run.stats == {**PULL_ZERO, "fetched": 1, "updated": 1}
        await _assert_stats_persisted(db, run)

        assert card.description == "Billing desc"
        assert card.attributes == {"criticality": "critical", "keep": 1, "origin": "servicenow"}
        assert card.lifecycle == {"plan": "2020-01-01", "active": "2021-05-01"}
        assert entry.last_synced_at is not None
        (event,) = await _events(db, "card.updated")
        changes = event.data["changes"]
        assert changes["description"] == {"old": "old", "new": "Billing desc"}
        assert changes["attributes"] == {
            "old": {"criticality": "medium", "keep": 1},
            "new": card.attributes,
        }
        assert changes["lifecycle"] == {"old": {"plan": "2020-01-01"}, "new": card.lifecycle}

    async def test_skip_staging_applies_inline_and_still_counts(self, db, env, monkeypatch):
        env["mapping"].skip_staging = True
        records = [_rec(S1, "Billing"), _rec(S2, "CRM")]
        engine, _ = _engine(db, monkeypatch, snow_table_handler(records=records))
        run = await engine.pull_sync(env["mapping"], env["fms"], user_id=env["admin"].id)
        assert await _staged(db, run) == []
        assert len((await db.execute(select(Card))).scalars().all()) == 2
        assert run.stats == {**PULL_ZERO, "fetched": 2, "created": 2}
        # The second count lands after the first card's flush — it must still
        # reach the row.
        await _assert_stats_persisted(db, run)

    async def test_a_failing_record_is_marked_and_the_rest_apply(self, db, env, monkeypatch):
        records = [_rec(S1, "Boom"), _rec(S2, "Fine")]
        engine, _ = _engine(db, monkeypatch, snow_table_handler(records=records))
        original = engine._apply_create

        async def flaky(staged, mapping, fms, actor_id=None):
            if staged.snow_data.get("name") == "Boom":
                raise RuntimeError("cannot")
            return await original(staged, mapping, fms, actor_id)

        monkeypatch.setattr(engine, "_apply_create", flaky)
        run = await engine.pull_sync(env["mapping"], env["fms"], user_id=env["admin"].id)
        assert run.status == "completed"
        staged = {s.snow_sys_id: s for s in await _staged(db, run)}
        assert staged[S1].status == "error" and staged[S1].error_message == "Failed to apply record"
        assert staged[S2].status == "applied"
        assert [c.name for c in (await db.execute(select(Card))).scalars()] == ["Fine"]

    async def test_apply_staged_without_a_mapping_does_nothing(self, db, env, monkeypatch):
        run = SnowSyncRun(connection_id=env["conn"].id, mapping_id=None, stats={})
        db.add(run)
        await db.flush()
        engine, _ = _engine(db, monkeypatch, snow_table_handler())
        assert await engine._apply_staged(run) == {
            "created": 0,
            "updated": 0,
            "deleted": 0,
            "errors": 0,
        }

    async def test_update_and_delete_ignore_rows_without_a_live_card(self, db, env, monkeypatch):
        engine, _ = _engine(db, monkeypatch, snow_table_handler())
        run = SnowSyncRun(connection_id=env["conn"].id, mapping_id=env["mapping"].id, stats={})
        db.add(run)
        await db.flush()
        ghost = uuid.uuid4()
        archived = await _card(db, env, "Already", status="ARCHIVED")
        rows = [
            SnowStagedRecord(
                sync_run_id=run.id,
                mapping_id=env["mapping"].id,
                snow_sys_id=S1,
                action="update",
                diff={"name": {"old": "a", "new": "b"}},
                card_id=None,
            ),
            SnowStagedRecord(
                sync_run_id=run.id,
                mapping_id=env["mapping"].id,
                snow_sys_id=S2,
                action="update",
                diff={},
                card_id=ghost,
            ),
            SnowStagedRecord(
                sync_run_id=run.id, mapping_id=env["mapping"].id, snow_sys_id=S3, action="delete"
            ),
            SnowStagedRecord(
                sync_run_id=run.id,
                mapping_id=env["mapping"].id,
                snow_sys_id=S4,
                action="delete",
                card_id=ghost,
            ),
            SnowStagedRecord(
                sync_run_id=run.id,
                mapping_id=env["mapping"].id,
                snow_sys_id=S9,
                action="delete",
                card_id=archived.id,
            ),
        ]
        db.add_all(rows)
        await db.flush()
        applied = await engine._apply_staged(run)
        assert applied == {"created": 0, "updated": 2, "deleted": 3, "errors": 0}
        assert {s.status for s in await _staged(db, run)} == {"applied"}
        assert await _events(db, "card.updated") == [] and await _events(db, "card.archived") == []

    async def test_an_update_covers_every_field_kind(self, db, env, monkeypatch):
        engine, _ = _engine(db, monkeypatch, snow_table_handler())
        card = await _card(db, env, "Old")
        run = SnowSyncRun(connection_id=env["conn"].id, mapping_id=env["mapping"].id, stats={})
        db.add(run)
        await db.flush()
        staged = SnowStagedRecord(
            sync_run_id=run.id,
            mapping_id=env["mapping"].id,
            snow_sys_id=S1,
            action="update",
            card_id=card.id,
            diff={
                "name": {"old": "Old", "new": "New"},
                "subtype": {"old": None, "new": "saas"},
                "description": {"old": None, "new": "d"},
                "lifecycle.endOfLife": {"old": None, "new": "2030-01-01"},
                "attributes.x": {"old": None, "new": 1},
            },
        )
        await engine._apply_update(staged, env["fms"], env["admin"].id)
        assert (card.name, card.subtype, card.description) == ("New", "saas", "d")
        assert card.lifecycle["endOfLife"] == "2030-01-01" and card.attributes["x"] == 1
        (event,) = await _events(db, "card.updated")
        assert event.data["changes"]["name"] == {"old": "Old", "new": "New"}
        assert event.data["changes"]["subtype"] == {"old": None, "new": "saas"}


# ---------------------------------------------------------------------------
# Deletions
# ---------------------------------------------------------------------------


class TestDeletions:
    async def _mapped(self, db, env) -> dict[str, Card]:
        cards = {}
        for key, sys_id, by_sync in (
            ("E1", S1, True),
            ("E2", S2, True),
            ("E3", S3, False),
            ("E4", S4, False),
        ):
            cards[key] = await _card(db, env, key)
            await _identity(db, env, cards[key], sys_id, created_by_sync=by_sync)
        return cards

    async def test_conservative_mode_archives_only_what_the_sync_created(
        self, db, env, monkeypatch
    ):
        cards = await self._mapped(db, env)
        engine, _ = _engine(db, monkeypatch, snow_table_handler(records=[_rec(S1, "E1")]))
        run = await engine.pull_sync(env["mapping"], env["fms"], user_id=env["admin"].id)
        assert run.stats["deleted"] == 1 and run.stats["updated"] == 1
        await _assert_stats_persisted(db, run)
        deletes = [s for s in await _staged(db, run) if s.action == "delete"]
        assert [s.card_id for s in deletes] == [cards["E2"].id]
        assert deletes[0].status == "applied" and deletes[0].snow_data == {}
        assert cards["E2"].status == "ARCHIVED" and cards["E2"].archived_at is not None
        assert cards["E3"].status == "ACTIVE" and cards["E4"].status == "ACTIVE"
        assert set(await _identity_rows(db)) == {S1, S3, S4}
        (event,) = await _events(db, "card.archived")
        assert event.card_id == cards["E2"].id and event.data["source"] == "servicenow_sync"

    async def test_strict_mode_is_held_back_by_the_deletion_ratio(self, db, env, monkeypatch):
        cards = await self._mapped(db, env)
        env["mapping"].sync_mode = "strict"
        engine, _ = _engine(db, monkeypatch, snow_table_handler(records=[_rec(S1, "E1")]))
        run = await engine.pull_sync(env["mapping"], env["fms"], auto_apply=False)
        assert run.stats["deleted"] == 0  # 3 of 4 orphaned > 0.5

        env["mapping"].max_deletion_ratio = 1.0
        run = await engine.pull_sync(env["mapping"], env["fms"], auto_apply=False)
        assert run.stats["deleted"] == 3
        assert {s.card_id for s in await _staged(db, run) if s.action == "delete"} == {
            cards["E2"].id,
            cards["E3"].id,
            cards["E4"].id,
        }

    async def test_additive_mode_and_a_complete_fetch_stage_no_deletions(
        self, db, env, monkeypatch
    ):
        await self._mapped(db, env)
        records = [_rec(S1, "E1")]
        env["mapping"].sync_mode = "additive"
        engine, _ = _engine(db, monkeypatch, snow_table_handler(records=records))
        run = await engine.pull_sync(env["mapping"], env["fms"], auto_apply=False)
        assert run.stats["deleted"] == 0

        env["mapping"].sync_mode = "strict"
        records.extend([_rec(S2, "E2"), _rec(S3, "E3"), _rec(S4, "E4")])
        run = await engine.pull_sync(env["mapping"], env["fms"], auto_apply=False)
        assert run.stats["deleted"] == 0 and run.stats["fetched"] == 4


# ---------------------------------------------------------------------------
# Push
# ---------------------------------------------------------------------------


class TestPush:
    async def test_push_updates_mapped_cards_and_creates_the_rest(self, db, env, monkeypatch):
        mapped = await _card(db, env, "Mapped", attributes={"owner": "Ann"})
        fresh = await _card(db, env, "Fresh", attributes={"owner": "Bob"})
        await _card(db, env, "Broken")
        await _card(db, env, "Archived", status="ARCHIVED", attributes={"owner": "Zed"})
        entry = await _identity(db, env, mapped, S1)
        engine, seen = _engine(db, monkeypatch, snow_table_handler(created_sys_id=S9))
        original = engine.client.create_record

        async def flaky(table, data):
            if data.get("owned_by") is None:
                raise RuntimeError("no owner")
            return await original(table, data)

        monkeypatch.setattr(engine.client, "create_record", flaky)
        run = await engine.push_sync(env["mapping"], env["fms"], user_id=env["admin"].id)
        assert run.status == "completed" and run.direction == "push"
        assert run.stats == {"processed": 3, "created": 1, "updated": 1, "skipped": 0, "errors": 1}
        await _assert_stats_persisted(db, run)

        (patch,) = [r for r in seen if r.method == "PATCH"]
        assert patch.url.path == f"/api/now/table/{TABLE}/{S1}"
        assert json.loads(patch.content) == {"owned_by": "Ann"}
        (post,) = [r for r in seen if r.method == "POST"]
        assert post.url.path == f"/api/now/table/{TABLE}"
        assert json.loads(post.content) == {"owned_by": "Bob"}
        ids = await _identity_rows(db)
        assert ids[S9].card_id == fresh.id and ids[S9].created_by_sync is True
        assert entry.last_synced_at is not None

    async def test_push_without_outbound_fields_completes_at_once(self, db, env, monkeypatch):
        await _card(db, env, "X")
        engine, seen = _engine(db, monkeypatch, snow_table_handler())
        inbound_only = [fm for fm in env["fms"] if fm.direction != "turbo_leads"]
        run = await engine.push_sync(env["mapping"], inbound_only)
        assert run.status == "completed" and run.stats["processed"] == 0 and seen == []

    async def test_push_counts_a_refusal_as_an_error(self, db, env, monkeypatch):
        await _card(db, env, "X", attributes={"owner": "Ann"})
        engine, _ = _engine(db, monkeypatch, snow_table_handler(fail_status=500))
        run = await engine.push_sync(env["mapping"], env["fms"])
        assert run.status == "completed"
        assert run.stats == {"processed": 1, "created": 0, "updated": 0, "skipped": 0, "errors": 1}
        await _assert_stats_persisted(db, run)
        assert await _identity_rows(db) == {}


# ---------------------------------------------------------------------------
# REST client (no database)
# ---------------------------------------------------------------------------


class TestClient:
    async def test_table_api_calls(self, monkeypatch):
        seen = patch_httpx_client(
            monkeypatch,
            snow,
            snow_table_handler(
                tables=[{"name": "cmdb_ci", "label": "CI"}],
                dictionary=[{"element": "name"}],
                records=[{"sys_id": S1}],
                created_sys_id=S2,
            ),
        )
        client = ServiceNowClient(INSTANCE + "/", {"username": "u", "password": "p"})
        assert client.instance_url == INSTANCE

        assert await client.list_tables() == [{"name": "cmdb_ci", "label": "CI"}]
        assert seen[-1].url.params["sysparm_query"] == "ORDERBYlabel"
        assert seen[-1].headers["Authorization"].startswith("Basic ")
        await client.list_tables("cmdb")
        assert seen[-1].url.params["sysparm_query"] == "nameLIKEcmdb^ORlabelLIKEcmdb^ORDERBY label"

        assert await client.list_table_fields("cmdb_ci") == [{"element": "name"}]
        assert seen[-1].url.params["sysparm_query"] == "name=cmdb_ci^internal_type!=collection"
        assert await client.list_table_fields("bad table") == []

        assert await client.fetch_records("cmdb_ci", fields=["name"], query="q", limit=5) == (
            [{"sys_id": S1}],
            1,
        )
        params = seen[-1].url.params
        assert params["sysparm_fields"] == "sys_id,name" and params["sysparm_query"] == "q"
        assert params["sysparm_limit"] == "5"
        assert await client.fetch_records("bad table") == ([], 0)

        assert (await client.create_record("cmdb_ci", {"name": "n"}))["sys_id"] == S2
        assert seen[-1].headers["Content-Type"] == "application/json"
        assert (await client.update_record("cmdb_ci", S1, {"name": "m"}))["name"] == "m"
        with pytest.raises(ValueError):
            await client.create_record("bad table", {})
        with pytest.raises(ValueError):
            await client.update_record("cmdb_ci", "nope", {})
        with pytest.raises(ValueError):
            await client.update_record("bad table", S1, {})

        await client.close()
        assert client._client is not None and client._client.is_closed
        await client.close()  # idempotent
        await client.list_tables()  # a closed client is rebuilt
        assert not client._client.is_closed

        oauth = ServiceNowClient(INSTANCE, {"access_token": "tok"}, "oauth2")
        await oauth.list_tables()
        assert seen[-1].headers["Authorization"] == "Bearer tok"

    async def test_connection_test_outcomes(self, monkeypatch):
        holder = {"handler": snow_table_handler(tables=[{"name": "x"}])}
        patch_httpx_client(monkeypatch, snow, lambda request: holder["handler"](request))
        client = ServiceNowClient(INSTANCE, {"username": "u", "password": "p"})
        assert await client.test_connection() == (True, "Connection successful")

        holder["handler"] = snow_table_handler(fail_status=403)
        assert await client.test_connection() == (False, "Connection failed: HTTP 403")

        def down(request):
            raise httpx.ConnectError("down")

        holder["handler"] = down
        assert await client.test_connection() == (False, "Connection failed")

    def test_credentials_round_trip_and_bad_token(self):
        stored = encrypt_credentials({"username": "u"})
        assert set(stored) == {"_enc"}
        assert snow.decrypt_credentials(stored) == {"username": "u"}
        assert snow.decrypt_credentials({"username": "legacy"}) == {"username": "legacy"}
        assert snow.decrypt_credentials({"_enc": "garbage"}) == {}
