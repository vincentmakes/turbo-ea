"""Integration tests for `POST /relations/bulk`."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.relations import _resolve_ref_input
from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.card_type import CardType
from app.models.event import Event
from app.models.relation import Relation
from app.schemas.relation import RelationRefInput
from app.services.card_resolver import Candidate, ResolveResult
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)


@pytest.fixture
async def rel_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_relation_type(
        db,
        key="app_to_itc",
        label="depends on",
        source_type_key="Application",
        target_type_key="ITComponent",
        cardinality="n:m",
    )
    await create_relation_type(
        db,
        key="primary_owner",
        label="primarily owns",
        source_type_key="Application",
        target_type_key="ITComponent",
        cardinality="1:1",
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    app1 = await create_card(db, card_type="Application", name="App One", user_id=admin.id)
    app2 = await create_card(db, card_type="Application", name="App Two", user_id=admin.id)
    itc1 = await create_card(db, card_type="ITComponent", name="DB", user_id=admin.id)
    itc2 = await create_card(db, card_type="ITComponent", name="Cache", user_id=admin.id)
    await db.commit()
    return {
        "admin": admin,
        "viewer": viewer,
        "app1": app1,
        "app2": app2,
        "itc1": itc1,
        "itc2": itc2,
    }


async def test_bulk_upsert_creates_new_relation(client, db, rel_env):
    admin = rel_env["admin"]
    payload = {
        "operations": [
            {
                "row_index": 1,
                "action": "upsert",
                "type": "app_to_itc",
                "source": {"id": str(rel_env["app1"].id)},
                "target": {"id": str(rel_env["itc1"].id)},
            }
        ]
    }
    resp = await client.post("/api/v1/relations/bulk", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["upserted"] == 1
    assert body["failed"] == 0


async def test_bulk_resolves_source_and_target_by_name(client, db, rel_env):
    admin = rel_env["admin"]
    payload = {
        "operations": [
            {
                "row_index": 1,
                "action": "upsert",
                "type": "app_to_itc",
                "source": {"type": "Application", "name": "App One"},
                "target": {"type": "ITComponent", "name": "DB"},
            }
        ]
    }
    resp = await client.post("/api/v1/relations/bulk", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200, resp.text
    assert resp.json()["upserted"] == 1
    rows = await db.execute(select(Relation).where(Relation.type == "app_to_itc"))
    rels = list(rows.scalars().all())
    assert len(rels) == 1
    assert rels[0].source_id == rel_env["app1"].id
    assert rels[0].target_id == rel_env["itc1"].id


async def test_bulk_delete_removes_relation(client, db, rel_env):
    admin = rel_env["admin"]
    rel = await create_relation(
        db,
        type_key="app_to_itc",
        source_id=rel_env["app1"].id,
        target_id=rel_env["itc1"].id,
    )
    await db.commit()
    payload = {
        "operations": [
            {
                "row_index": 1,
                "action": "delete",
                "type": "app_to_itc",
                "source": {"id": str(rel_env["app1"].id)},
                "target": {"id": str(rel_env["itc1"].id)},
            }
        ]
    }
    resp = await client.post("/api/v1/relations/bulk", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 1
    existing = await db.get(Relation, rel.id)
    assert existing is None


async def test_bulk_cardinality_violation_fails_row(client, db, rel_env):
    """1:1 relation type forbids a second relation from the same source."""
    admin = rel_env["admin"]
    payload = {
        "operations": [
            {
                "row_index": 1,
                "action": "upsert",
                "type": "primary_owner",
                "source": {"id": str(rel_env["app1"].id)},
                "target": {"id": str(rel_env["itc1"].id)},
            },
            {
                "row_index": 2,
                "action": "upsert",
                "type": "primary_owner",
                "source": {"id": str(rel_env["app1"].id)},
                "target": {"id": str(rel_env["itc2"].id)},
            },
        ]
    }
    resp = await client.post("/api/v1/relations/bulk", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200
    body = resp.json()
    assert body["upserted"] == 1
    assert body["failed"] == 1
    failed = next(r for r in body["results"] if r["row_index"] == 2)
    assert "Cardinality" in (failed["error"] or "")


async def test_bulk_unknown_relation_type_fails_row(client, db, rel_env):
    admin = rel_env["admin"]
    payload = {
        "operations": [
            {
                "row_index": 1,
                "action": "upsert",
                "type": "not_a_real_type",
                "source": {"id": str(rel_env["app1"].id)},
                "target": {"id": str(rel_env["itc1"].id)},
            }
        ]
    }
    resp = await client.post("/api/v1/relations/bulk", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200
    body = resp.json()
    assert body["failed"] == 1
    assert "Unknown relation type" in (body["results"][0]["error"] or "")


async def test_bulk_missing_source_card_isolates_failure(client, db, rel_env):
    """A relation whose source id does not exist in `cards` hits a foreign-key
    violation at flush time. Without a per-op savepoint that failure would
    poison the whole transaction and every later op would cascade with
    "transaction has been rolled back". The failing op must be isolated so a
    following valid op still upserts."""
    admin = rel_env["admin"]
    ghost_id = str(uuid.uuid4())  # not present in cards
    payload = {
        "operations": [
            {
                "row_index": 1,
                "action": "upsert",
                "type": "app_to_itc",
                "source": {"id": ghost_id},
                "target": {"id": str(rel_env["itc1"].id)},
            },
            {
                "row_index": 2,
                "action": "upsert",
                "type": "app_to_itc",
                "source": {"id": str(rel_env["app1"].id)},
                "target": {"id": str(rel_env["itc1"].id)},
            },
        ]
    }
    resp = await client.post("/api/v1/relations/bulk", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["upserted"] == 1, body
    assert body["failed"] == 1, body
    row2 = next(r for r in body["results"] if r["row_index"] == 2)
    assert row2["status"] == "upserted"
    # The good relation actually persisted.
    rows = await db.execute(select(Relation).where(Relation.type == "app_to_itc"))
    rels = list(rows.scalars().all())
    assert len(rels) == 1
    assert rels[0].source_id == rel_env["app1"].id


async def test_bulk_dry_run_validates_without_persisting(client, db, rel_env):
    """Dry-run preview used by the MCP `upsert_relations_bulk` tool:
    every validator runs, but nothing persists."""
    admin = rel_env["admin"]
    payload = {
        "operations": [
            {
                "row_index": 1,
                "action": "upsert",
                "type": "app_to_itc",
                "source": {"id": str(rel_env["app1"].id)},
                "target": {"id": str(rel_env["itc1"].id)},
            }
        ],
        "dry_run": True,
    }
    resp = await client.post("/api/v1/relations/bulk", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["dry_run"] is True
    assert body["upserted"] == 1  # would-be-upserted
    # No relation actually persisted.
    rows = await db.execute(select(Relation).where(Relation.type == "app_to_itc"))
    assert list(rows.scalars().all()) == []


async def test_bulk_viewer_forbidden(client, db, rel_env):
    viewer = rel_env["viewer"]
    payload = {
        "operations": [
            {
                "row_index": 1,
                "action": "upsert",
                "type": "app_to_itc",
                "source": {"id": str(rel_env["app1"].id)},
                "target": {"id": str(rel_env["itc1"].id)},
            }
        ]
    }
    resp = await client.post("/api/v1/relations/bulk", json=payload, headers=auth_headers(viewer))
    assert resp.status_code == 403


async def test_bulk_swapped_id_refs_are_stored_in_the_type_direction(client, db, rel_env):
    """Id refs are not type-checked like name refs, so a pair sent the other way
    round is turned into the relation type's direction (#1140)."""
    payload = {
        "operations": [
            {
                "row_index": 1,
                "type": "app_to_itc",
                "source": {"id": str(rel_env["itc1"].id)},
                "target": {"id": str(rel_env["app1"].id)},
                "attributes": {"flowDirection": "reverse"},
            }
        ]
    }
    resp = await client.post(
        "/api/v1/relations/bulk", json=payload, headers=auth_headers(rel_env["admin"])
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["upserted"] == 1
    rels = (await db.execute(select(Relation).where(Relation.type == "app_to_itc"))).scalars()
    rels = list(rels.all())
    assert len(rels) == 1
    assert (rels[0].source_id, rels[0].target_id) == (rel_env["app1"].id, rel_env["itc1"].id)
    assert rels[0].attributes == {"flowDirection": "reverse"}


async def test_bulk_swapped_delete_removes_the_relation(client, db, rel_env):
    rel = await create_relation(
        db,
        type_key="app_to_itc",
        source_id=rel_env["app1"].id,
        target_id=rel_env["itc1"].id,
    )
    await db.commit()
    payload = {
        "operations": [
            {
                "row_index": 1,
                "action": "delete",
                "type": "app_to_itc",
                "source": {"id": str(rel_env["itc1"].id)},
                "target": {"id": str(rel_env["app1"].id)},
            }
        ]
    }
    resp = await client.post(
        "/api/v1/relations/bulk", json=payload, headers=auth_headers(rel_env["admin"])
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["deleted"] == 1
    assert await db.get(Relation, rel.id) is None


# ---------------------------------------------------------------------------
# Reference resolution (pure — no database)
# ---------------------------------------------------------------------------


class _FakeResolver:
    """Records every lookup and answers with one fixed outcome."""

    def __init__(self, outcome):
        self.outcome = outcome
        self.calls: list[tuple[str, str]] = []

    def resolve(self, type_key, ref):
        self.calls.append((type_key, ref))
        return self.outcome


_RT = SimpleNamespace(source_type_key="Application", target_type_key="ITComponent")


def _resolve(ref, *, endpoint="source", outcome=None):
    resolver = _FakeResolver(outcome or ResolveResult(status="missing"))
    try:
        return _resolve_ref_input(ref, _RT, endpoint=endpoint, resolver=resolver), resolver
    except HTTPException as exc:
        return exc, resolver


class TestResolveRefInput:
    def test_an_id_is_used_as_is_without_a_lookup(self):
        card_id = uuid.uuid4()
        got, resolver = _resolve(RelationRefInput(id=str(card_id), name="ignored"))
        assert got == card_id
        assert resolver.calls == []

    def test_a_malformed_id_names_its_end(self):
        got, _ = _resolve(RelationRefInput(id="nope"), endpoint="target")
        assert (got.status_code, got.detail) == (422, "Invalid target UUID: nope")

    def test_an_omitted_type_is_the_relation_types_own(self):
        card_id = uuid.uuid4()
        outcome = ResolveResult(status="resolved", card_id=card_id)
        got, resolver = _resolve(RelationRefInput(name="DB"), endpoint="target", outcome=outcome)
        assert got == card_id
        assert resolver.calls == [("ITComponent", "DB")]

    def test_a_matching_type_is_accepted(self):
        outcome = ResolveResult(status="resolved", card_id=uuid.uuid4())
        _, resolver = _resolve(RelationRefInput(type="Application", name="App"), outcome=outcome)
        assert resolver.calls == [("Application", "App")]

    def test_another_type_is_refused_before_any_lookup(self):
        got, resolver = _resolve(RelationRefInput(type="ITComponent", name="DB"))
        assert got.status_code == 422
        assert got.detail == (
            "Source type 'ITComponent' does not match relation type's expected source 'Application'"
        )
        assert resolver.calls == []

    def test_a_reference_needs_a_name(self):
        got, resolver = _resolve(RelationRefInput(type="ITComponent"), endpoint="target")
        assert (got.status_code, got.detail) == (422, "Target reference is missing a name")
        assert resolver.calls == []

    def test_path_segments_are_escaped_and_joined(self):
        outcome = ResolveResult(status="resolved", card_id=uuid.uuid4())
        _, resolver = _resolve(
            RelationRefInput(parent_path=["A/B", "C\\D"], name="E/F"), outcome=outcome
        )
        assert resolver.calls == [("Application", "A\\/B / C\\\\D / E\\/F")]

    def test_a_miss_names_the_reference(self):
        got, _ = _resolve(RelationRefInput(parent_path=["Root"], name="DB"), endpoint="target")
        assert (got.status_code, got.detail) == (422, "Target not found: Root / DB")

    def test_resolved_without_an_id_is_a_miss(self):
        got, _ = _resolve(RelationRefInput(name="App"), outcome=ResolveResult(status="resolved"))
        assert got.detail == "Source not found: App"

    def test_an_ambiguous_reference_lists_three_candidates(self):
        candidates = [
            Candidate(id=uuid.uuid4(), parent_path=(), name="App"),
            Candidate(id=uuid.uuid4(), parent_path=("Sales",), name="App"),
            Candidate(id=uuid.uuid4(), parent_path=("A", "B"), name="App"),
            Candidate(id=uuid.uuid4(), parent_path=("Never",), name="App"),
        ]
        outcome = ResolveResult(status="ambiguous", card_id=uuid.uuid4(), candidates=candidates)
        got, _ = _resolve(RelationRefInput(name="App"), outcome=outcome)
        assert got.status_code == 422
        assert got.detail == (
            "Source reference is ambiguous (App). Candidates: App, Sales / App, A / B / App"
        )

    def test_an_ambiguous_reference_without_candidates(self):
        got, _ = _resolve(RelationRefInput(name="App"), outcome=ResolveResult(status="ambiguous"))
        assert got.detail == "Source reference is ambiguous (App). Candidates: "


# ---------------------------------------------------------------------------
# Update path, events and cardinality
# ---------------------------------------------------------------------------


def _op(rel_env, *, row=1, action="upsert", type_="app_to_itc", src="app1", tgt="itc1", **extra):
    return {
        "row_index": row,
        "action": action,
        "type": type_,
        "source": {"id": str(rel_env[src].id)},
        "target": {"id": str(rel_env[tgt].id)},
        **extra,
    }


async def _bulk(client, user, *ops, dry_run=False):
    resp = await client.post(
        "/api/v1/relations/bulk",
        json={"operations": list(ops), "dry_run": dry_run},
        headers=auth_headers(user),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _events(db, event_type):
    rows = await db.execute(select(Event).where(Event.event_type == event_type))
    return list(rows.scalars().all())


class TestBulkUpdatePath:
    async def test_an_existing_relation_takes_the_new_fields(self, client, db, rel_env):
        rel = await create_relation(
            db,
            source_id=rel_env["app1"].id,
            target_id=rel_env["itc1"].id,
            attributes={"usage": "old"},
        )
        await db.commit()
        body = await _bulk(
            client,
            rel_env["admin"],
            _op(rel_env, attributes={"usage": "new"}, description="Primary store"),
        )
        assert body["results"] == [
            {"row_index": 1, "status": "upserted", "relation_id": str(rel.id), "error": None}
        ]
        assert (body["upserted"], body["deleted"], body["failed"]) == (1, 0, 0)
        await db.refresh(rel)
        assert rel.attributes == {"usage": "new"}
        assert rel.description == "Primary store"
        updated = await _events(db, "relation.updated")
        assert {e.card_id for e in updated} == {rel_env["app1"].id, rel_env["itc1"].id}
        assert all(e.data["fields"] == ["attributes", "description"] for e in updated)
        assert all(e.user_id == rel_env["admin"].id for e in updated)

    async def test_an_unchanged_upsert_records_nothing(self, client, db, rel_env):
        rel = await create_relation(
            db,
            source_id=rel_env["app1"].id,
            target_id=rel_env["itc1"].id,
            attributes={"usage": "same"},
        )
        await db.commit()
        body = await _bulk(client, rel_env["admin"], _op(rel_env, attributes={"usage": "same"}))
        assert body["results"][0]["status"] == "upserted"
        assert body["results"][0]["relation_id"] == str(rel.id)
        assert await _events(db, "relation.updated") == []
        assert await _events(db, "relation.created") == []

    async def test_only_the_changed_field_is_named(self, client, db, rel_env):
        await create_relation(db, source_id=rel_env["app1"].id, target_id=rel_env["itc1"].id)
        await db.commit()
        await _bulk(client, rel_env["admin"], _op(rel_env, description="Cache tier"))
        updated = await _events(db, "relation.updated")
        assert [e.data["fields"] for e in updated] == [["description"], ["description"]]


class TestBulkEvents:
    async def test_a_created_relation_is_recorded_on_both_cards(self, client, db, rel_env):
        body = await _bulk(client, rel_env["admin"], _op(rel_env))
        created = await _events(db, "relation.created")
        assert {e.card_id for e in created} == {rel_env["app1"].id, rel_env["itc1"].id}
        assert {e.data["id"] for e in created} == {body["results"][0]["relation_id"]}
        assert {e.data["source_name"] for e in created} == {"App One"}
        assert {e.data["target_name"] for e in created} == {"DB"}

    async def test_a_deleted_relation_is_recorded_on_both_cards(self, client, db, rel_env):
        rel = await create_relation(db, source_id=rel_env["app1"].id, target_id=rel_env["itc1"].id)
        await db.commit()
        await _bulk(client, rel_env["admin"], _op(rel_env, action="delete"))
        deleted = await _events(db, "relation.deleted")
        assert {e.card_id for e in deleted} == {rel_env["app1"].id, rel_env["itc1"].id}
        assert {e.data["id"] for e in deleted} == {str(rel.id)}
        assert {e.data["target_name"] for e in deleted} == {"DB"}

    async def test_a_dry_run_records_nothing(self, client, db, rel_env):
        await _bulk(client, rel_env["admin"], _op(rel_env), dry_run=True)
        assert await _events(db, "relation.created") == []

    async def test_a_failed_row_records_nothing(self, client, db, rel_env):
        body = await _bulk(client, rel_env["admin"], _op(rel_env, type_="primary_owner"))
        assert body["upserted"] == 1
        body = await _bulk(
            client, rel_env["admin"], _op(rel_env, type_="primary_owner", tgt="itc2")
        )
        assert body["failed"] == 1
        created = await _events(db, "relation.created")
        assert len(created) == 2  # the first request's pair only

    async def test_deleting_a_missing_relation_is_a_noop(self, client, db, rel_env):
        body = await _bulk(client, rel_env["admin"], _op(rel_env, action="delete"))
        assert body["results"] == [
            {"row_index": 1, "status": "noop", "relation_id": None, "error": None}
        ]
        assert (body["upserted"], body["deleted"], body["failed"]) == (0, 0, 0)
        assert await _events(db, "relation.deleted") == []


class TestBulkCardinality:
    async def test_one_to_one_refuses_a_second_relation_to_the_target(self, client, db, rel_env):
        await create_relation(
            db, type_key="primary_owner", source_id=rel_env["app1"].id, target_id=rel_env["itc1"].id
        )
        await db.commit()
        body = await _bulk(
            client, rel_env["admin"], _op(rel_env, type_="primary_owner", src="app2")
        )
        assert body["results"][0]["error"] == (
            "Cardinality 1:1 forbids a second 'primary_owner' relation to this target"
        )

    async def test_one_to_one_refuses_a_second_relation_from_the_source(self, client, db, rel_env):
        await create_relation(
            db, type_key="primary_owner", source_id=rel_env["app1"].id, target_id=rel_env["itc1"].id
        )
        await db.commit()
        body = await _bulk(
            client, rel_env["admin"], _op(rel_env, type_="primary_owner", tgt="itc2")
        )
        assert body["results"][0]["error"] == (
            "Cardinality 1:1 forbids a second 'primary_owner' relation from this source"
        )

    async def test_upserting_the_existing_pair_is_not_a_second_relation(self, client, db, rel_env):
        rel = await create_relation(
            db, type_key="primary_owner", source_id=rel_env["app1"].id, target_id=rel_env["itc1"].id
        )
        await db.commit()
        body = await _bulk(
            client, rel_env["admin"], _op(rel_env, type_="primary_owner", description="Owner")
        )
        assert body["results"][0]["status"] == "upserted"
        assert body["results"][0]["relation_id"] == str(rel.id)

    async def test_one_to_many_allows_one_relation_per_source(self, client, db, rel_env):
        await create_relation_type(
            db,
            key="hosted_on",
            label="hosted on",
            source_type_key="Application",
            target_type_key="ITComponent",
            cardinality="1:n",
        )
        await create_relation(
            db, type_key="hosted_on", source_id=rel_env["app1"].id, target_id=rel_env["itc1"].id
        )
        await db.commit()
        body = await _bulk(
            client,
            rel_env["admin"],
            _op(rel_env, row=1, type_="hosted_on", tgt="itc2"),
            _op(rel_env, row=2, type_="hosted_on", src="app2"),
        )
        by_row = {r["row_index"]: r for r in body["results"]}
        assert by_row[1]["error"] == (
            "Cardinality 1:n forbids a second 'hosted_on' relation from this source"
        )
        assert by_row[2]["status"] == "upserted"  # a second source to the same target

    async def test_many_to_many_is_unconstrained(self, client, db, rel_env):
        await create_relation(db, source_id=rel_env["app1"].id, target_id=rel_env["itc1"].id)
        await db.commit()
        body = await _bulk(
            client,
            rel_env["admin"],
            _op(rel_env, row=1, tgt="itc2"),
            _op(rel_env, row=2, src="app2"),
        )
        assert body["upserted"] == 2


class TestBulkReadScope:
    async def test_a_hidden_card_is_not_found(self, client, db, rel_env):
        member = await create_user(db, email="member@test.com", role="member")
        ct = (await db.execute(select(CardType).where(CardType.key == "ITComponent"))).scalar_one()
        ct.role_permissions = {"member": {"inventory.view": False}}
        await db.commit()
        PermissionService.invalidate_type_permission_cache()
        try:
            body = await _bulk(
                client,
                member,
                _op(rel_env, row=1),
                {
                    "row_index": 2,
                    "type": "app_to_itc",
                    "source": {"name": "App One"},
                    "target": {"name": "DB"},
                },
            )
        finally:
            PermissionService.invalidate_type_permission_cache()
        by_row = {r["row_index"]: r for r in body["results"]}
        assert by_row[1]["error"] == "Card not found"
        assert by_row[2]["error"] == "Target not found: DB"
        assert body["failed"] == 2
        rows = await db.execute(select(Relation).where(Relation.type == "app_to_itc"))
        assert list(rows.scalars().all()) == []
