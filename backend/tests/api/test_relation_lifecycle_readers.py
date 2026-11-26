"""Current-state endpoints stop counting a relation that is not in effect.

A relation may carry its own lifecycle (migration 180). Every endpoint that
shows "the landscape now" — the landscape, matrix, data-quality and EOL
reports, a card's relation summary and descendant roll-up, the bulk path's
cardinality guard, a published portal, the BPM reports and the TurboLens
dependency graph — counts only the relations in effect today. Each test runs
over the four relations in ``tests/relation_windows.py``: an undated one and
one in effect count, a planned one and an ended one do not. Permission
behaviour is unchanged and pinned alongside.

Integration tests requiring a PostgreSQL test database.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import update

from app.models.relation import Relation
from app.models.web_portal import WebPortal
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)
from tests.relation_windows import COUNTING, WINDOWS


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="nobody", label="Nobody", permissions={})
    admin = await create_user(db, email="admin@test.com", role="admin")
    nobody = await create_user(db, email="nobody@test.com", role="nobody")
    for key in ("Application", "ITComponent", "Organization"):
        await create_card_type(db, key=key, label=key)
    await create_card_type(
        db, key="BusinessCapability", label="Business Capability", has_hierarchy=True
    )
    await create_relation_type(
        db, key="relAppToITC", source_type_key="Application", target_type_key="ITComponent"
    )
    await create_relation_type(
        db, key="relOrgToApp", source_type_key="Organization", target_type_key="Application"
    )
    await create_relation_type(
        db,
        key="relCapToApp",
        source_type_key="BusinessCapability",
        target_type_key="Application",
    )
    return SimpleNamespace(admin=admin, nobody=nobody)


async def _fan(db, *, hub_type, peer_type, rel_type, hub_is_source=True, hub_name="Hub"):
    """One hub card linked to one peer per window (peers named after them)."""
    hub = await create_card(db, card_type=hub_type, name=hub_name)
    peers = {}
    for name, lifecycle in WINDOWS.items():
        peers[name] = await create_card(db, card_type=peer_type, name=name)
        src, tgt = (hub, peers[name]) if hub_is_source else (peers[name], hub)
        await create_relation(
            db, type_key=rel_type, source_id=src.id, target_id=tgt.id, lifecycle=lifecycle
        )
    return hub, peers


async def _get(client, user, url, **params):
    resp = await client.get(url, params=params, headers=auth_headers(user))
    assert resp.status_code == 200, resp.text
    return resp.json()


# ── /reports/landscape ───────────────────────────────────────────────────────


class TestLandscape:
    async def test_a_card_is_grouped_only_through_a_relation_in_effect(self, client, db, env):
        await _fan(
            db,
            hub_type="Organization",
            peer_type="Application",
            rel_type="relOrgToApp",
            hub_name="Finance",
        )
        data = await _get(
            client,
            env.admin,
            "/api/v1/reports/landscape",
            type="Application",
            group_by="Organization",
        )
        assert [g["name"] for g in data["groups"]] == ["Finance"]
        assert sorted(i["name"] for i in data["groups"][0]["items"]) == COUNTING
        assert sorted(i["name"] for i in data["ungrouped"]) == ["ended", "planned"]

    async def test_permission_unchanged(self, client, env):
        resp = await client.get("/api/v1/reports/landscape", headers=auth_headers(env.nobody))
        assert resp.status_code == 403


# ── /reports/matrix ──────────────────────────────────────────────────────────


class TestMatrix:
    async def test_only_relations_in_effect_are_cells(self, client, db, env):
        hub, peers = await _fan(
            db, hub_type="Application", peer_type="ITComponent", rel_type="relAppToITC"
        )
        data = await _get(
            client,
            env.admin,
            "/api/v1/reports/matrix",
            row_type="Application",
            col_type="ITComponent",
        )
        # Every card is still an axis entry; only the cells follow the dates.
        assert sorted(c["name"] for c in data["columns"]) == sorted(WINDOWS)
        names = {c["id"]: c["name"] for c in data["columns"]}
        assert sorted(names[i["col_id"]] for i in data["intersections"]) == COUNTING
        assert {i["row_id"] for i in data["intersections"]} == {str(hub.id)}

    async def test_an_attribute_filter_still_applies(self, client, db, env):
        await create_relation_type(
            db,
            key="relAppToITCAttr",
            source_type_key="Application",
            target_type_key="ITComponent",
            attributes_schema=[{"key": "critical", "type": "boolean"}],
        )
        hub, peers = await _fan(
            db, hub_type="Application", peer_type="ITComponent", rel_type="relAppToITCAttr"
        )
        await db.execute(
            update(Relation)
            .where(Relation.type == "relAppToITCAttr", Relation.target_id == peers["undated"].id)
            .values(attributes={"critical": True})
        )
        await db.flush()
        data = await _get(
            client,
            env.admin,
            "/api/v1/reports/matrix",
            row_type="Application",
            col_type="ITComponent",
            relation_types="relAppToITCAttr",
            attr="relAppToITCAttr.critical:true",
        )
        names = {c["id"]: c["name"] for c in data["columns"]}
        assert [names[i["col_id"]] for i in data["intersections"]] == ["undated"]


# ── /reports/data-quality and the inventory's orphaned filter ────────────────


class TestOrphanedSurfaces:
    @pytest.fixture
    async def fan(self, db, env):
        hub, peers = await _fan(
            db, hub_type="Application", peer_type="ITComponent", rel_type="relAppToITC"
        )
        await create_card(db, card_type="ITComponent", name="lonely")
        return hub, peers

    async def test_the_kpi_counts_cards_with_only_planned_or_ended_relations(
        self, client, env, fan
    ):
        data = await _get(client, env.admin, "/api/v1/reports/data-quality")
        assert data["total_items"] == 6
        assert data["orphaned"] == 3  # ended, planned, lonely — the hub stays connected

    async def test_the_drill_down_lists_the_same_cards(self, client, env, fan):
        data = await _get(client, env.admin, "/api/v1/reports/data-quality/cards", scope="orphaned")
        assert sorted(i["name"] for i in data["items"]) == ["ended", "lonely", "planned"]

    async def test_the_inventory_filter_lists_the_same_cards(self, client, env, fan):
        data = await _get(client, env.admin, "/api/v1/cards", orphaned="true")
        assert sorted(i["name"] for i in data["items"]) == ["ended", "lonely", "planned"]


# ── /reports/eol ─────────────────────────────────────────────────────────────


class TestEolImpact:
    async def test_only_an_application_related_now_is_impacted(self, client, db, env):
        await create_relation_type(
            db, key="relITCToApp", source_type_key="ITComponent", target_type_key="Application"
        )
        await _fan(
            db,
            hub_type="ITComponent",
            peer_type="Application",
            rel_type="relITCToApp",
            hub_name="Box",
        )
        with patch(
            "app.services.eol_service.fetch_product_cycles", new=AsyncMock(return_value=None)
        ):
            data = await _get(client, env.admin, "/api/v1/reports/eol")
        box = next(i for i in data["items"] if i["name"] == "Box")
        assert sorted(a["name"] for a in box["affected_apps"]) == COUNTING


# ── a card's relation summary and descendant roll-up ─────────────────────────


class TestCardRelationCounts:
    async def test_the_relation_summary_counts_relations_in_effect(self, client, db, env):
        hub, peers = await _fan(
            db, hub_type="Application", peer_type="ITComponent", rel_type="relAppToITC"
        )
        data = await _get(client, env.admin, f"/api/v1/cards/{hub.id}/relation-summary")
        assert [(r["relation_type_key"], r["direction"], r["count"]) for r in data["by_type"]] == [
            ("relAppToITC", "outgoing", 2)
        ]
        for name, expected in (("undated", 1), ("current", 1), ("planned", 0), ("ended", 0)):
            peer = await _get(client, env.admin, f"/api/v1/cards/{peers[name].id}/relation-summary")
            assert sum(r["count"] for r in peer["by_type"]) == expected, name

    async def test_the_relation_summary_permission_unchanged(self, client, db, env):
        hub = await create_card(db, card_type="Application", name="Hub")
        resp = await client.get(
            f"/api/v1/cards/{hub.id}/relation-summary", headers=auth_headers(env.nobody)
        )
        assert resp.status_code in (403, 404)

    @pytest.fixture
    async def tree(self, db, env):
        root = await create_card(db, card_type="BusinessCapability", name="Root")
        child = await create_card(
            db, card_type="BusinessCapability", name="Child", parent_id=root.id
        )
        apps = {}
        for name, lifecycle in WINDOWS.items():
            apps[name] = await create_card(db, card_type="Application", name=name)
            await create_relation(
                db,
                type_key="relCapToApp",
                source_id=child.id,
                target_id=apps[name].id,
                lifecycle=lifecycle,
            )
        return root, apps

    async def _rollup(self, client, env, root):
        data = await _get(
            client, env.admin, f"/api/v1/cards/{root.id}/descendant-relations/summary"
        )
        return [(e["relation_type_key"], e["direction"], e["count"]) for e in data]

    async def test_the_roll_up_counts_descendants_relations_in_effect(self, client, env, tree):
        root, _apps = tree
        assert await self._rollup(client, env, root) == [("relCapToApp", "outgoing", 2)]

    async def test_a_direct_link_hides_a_peer_only_while_it_is_in_effect(
        self, client, db, env, tree
    ):
        root, apps = tree
        # Ended: the root no longer owns the link, so the roll-up still says it.
        await create_relation(
            db,
            type_key="relCapToApp",
            source_id=root.id,
            target_id=apps["undated"].id,
            lifecycle=WINDOWS["ended"],
        )
        assert await self._rollup(client, env, root) == [("relCapToApp", "outgoing", 2)]
        # In effect: the root holds it directly, so it is not new information.
        await create_relation(
            db, type_key="relCapToApp", source_id=root.id, target_id=apps["current"].id
        )
        assert await self._rollup(client, env, root) == [("relCapToApp", "outgoing", 1)]


# ── the bulk path's cardinality guard ────────────────────────────────────────


class TestCardinalityRoom:
    @pytest.fixture
    async def one_to_one(self, db, env):
        rt = await create_relation_type(
            db,
            key="relPrimary",
            source_type_key="Application",
            target_type_key="ITComponent",
            cardinality="1:1",
        )
        app = await create_card(db, card_type="Application", name="App")
        itc = await create_card(db, card_type="ITComponent", name="ITC")
        return rt, app, itc

    @pytest.mark.parametrize(
        ("window", "has_room"),
        [
            ("undated", False),
            ("current", False),
            ("planned", True),
            ("ended", True),
        ],
    )
    async def test_only_a_relation_in_effect_takes_the_source_room(
        self, db, env, one_to_one, window, has_room
    ):
        from app.api.v1.relations import _require_cardinality_room

        rt, app, itc = one_to_one
        await create_relation(
            db, type_key="relPrimary", source_id=app.id, target_id=itc.id, lifecycle=WINDOWS[window]
        )
        other = await create_card(db, card_type="ITComponent", name="Other")
        if has_room:
            await _require_cardinality_room(db, rt, app.id, other.id)
        else:
            with pytest.raises(HTTPException) as exc:
                await _require_cardinality_room(db, rt, app.id, other.id)
            assert exc.value.status_code == 422
            assert "from this source" in exc.value.detail

    @pytest.mark.parametrize(
        ("window", "has_room"),
        [
            ("undated", False),
            ("current", False),
            ("planned", True),
            ("ended", True),
        ],
    )
    async def test_only_a_relation_in_effect_takes_the_target_room(
        self, db, env, one_to_one, window, has_room
    ):
        from app.api.v1.relations import _require_cardinality_room

        rt, app, itc = one_to_one
        await create_relation(
            db, type_key="relPrimary", source_id=app.id, target_id=itc.id, lifecycle=WINDOWS[window]
        )
        other = await create_card(db, card_type="Application", name="Other")
        if has_room:
            await _require_cardinality_room(db, rt, other.id, itc.id)
        else:
            with pytest.raises(HTTPException) as exc:
                await _require_cardinality_room(db, rt, other.id, itc.id)
            assert exc.value.status_code == 422
            assert "to this target" in exc.value.detail

    async def test_the_bulk_endpoint_lets_an_ended_relation_be_replaced(
        self, client, db, env, one_to_one
    ):
        _rt, app, itc = one_to_one
        await create_relation(
            db,
            type_key="relPrimary",
            source_id=app.id,
            target_id=itc.id,
            lifecycle=WINDOWS["ended"],
        )
        other = await create_card(db, card_type="ITComponent", name="Successor")
        payload = {
            "operations": [
                {
                    "row_index": 1,
                    "action": "upsert",
                    "type": "relPrimary",
                    "source": {"id": str(app.id)},
                    "target": {"id": str(other.id)},
                }
            ]
        }
        resp = await client.post(
            "/api/v1/relations/bulk", json=payload, headers=auth_headers(env.admin)
        )
        assert resp.status_code == 200, resp.text
        assert (resp.json()["upserted"], resp.json()["failed"]) == (1, 0)

    async def test_the_bulk_endpoint_still_refuses_a_second_relation_in_effect(
        self, client, db, env, one_to_one
    ):
        _rt, app, itc = one_to_one
        await create_relation(db, type_key="relPrimary", source_id=app.id, target_id=itc.id)
        other = await create_card(db, card_type="ITComponent", name="Second")
        payload = {
            "operations": [
                {
                    "row_index": 1,
                    "action": "upsert",
                    "type": "relPrimary",
                    "source": {"id": str(app.id)},
                    "target": {"id": str(other.id)},
                }
            ]
        }
        resp = await client.post(
            "/api/v1/relations/bulk", json=payload, headers=auth_headers(env.admin)
        )
        assert (resp.json()["upserted"], resp.json()["failed"]) == (0, 1)


# ── a published portal ───────────────────────────────────────────────────────


class TestPublicPortal:
    @pytest.fixture
    async def portal(self, db, env):
        db.add(
            WebPortal(
                name="Apps",
                slug="apps",
                card_type="Application",
                is_published=True,
                created_by=env.admin.id,
                card_config={"toggles": {"rel:relAppToITC": {"card": True, "detail": True}}},
            )
        )
        await db.flush()
        return await _fan(
            db, hub_type="Application", peer_type="ITComponent", rel_type="relAppToITC"
        )

    async def test_a_card_publishes_only_its_relations_in_effect(self, client, portal):
        resp = await client.get("/api/v1/web-portals/public/apps/cards")
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert [i["name"] for i in items] == ["Hub"]
        assert sorted(r["related_name"] for r in items[0]["relations"]) == COUNTING

    async def test_relation_options_offer_only_cards_related_now(self, client, portal):
        resp = await client.get(
            "/api/v1/web-portals/public/apps/relation-options?type_key=ITComponent"
        )
        assert resp.status_code == 200
        assert sorted(o["name"] for o in resp.json()) == COUNTING

    @pytest.mark.parametrize(
        ("window", "total"), [("undated", 1), ("current", 1), ("planned", 0), ("ended", 0)]
    )
    async def test_the_relation_filter_matches_only_through_a_relation_in_effect(
        self, client, portal, window, total
    ):
        _hub, peers = portal
        resp = await client.get(
            "/api/v1/web-portals/public/apps/cards",
            params={"related_type": "relAppToITC", "related_id": str(peers[window].id)},
        )
        assert resp.status_code == 200
        assert resp.json()["total"] == total


# ── BPM reports ──────────────────────────────────────────────────────────────


@pytest.fixture
async def bpm(db, env):
    for key in ("BusinessProcess", "BusinessContext"):
        await create_card_type(db, key=key, label=key)
    for key, target in (
        ("relProcessToBC", "BusinessCapability"),
        ("relProcessToApp", "Application"),
        ("relProcessDependency", "BusinessProcess"),
        ("relProcessToOrg", "Organization"),
        ("relProcessToBizCtx", "BusinessContext"),
    ):
        await create_relation_type(
            db, key=key, source_type_key="BusinessProcess", target_type_key=target
        )
    return env


class TestBpmReports:
    async def test_capability_process_matrix(self, client, db, bpm):
        proc, caps = await _fan(
            db,
            hub_type="BusinessProcess",
            peer_type="BusinessCapability",
            rel_type="relProcessToBC",
        )
        data = await _get(client, bpm.admin, "/api/v1/reports/bpm/capability-process-matrix")
        names = {c["id"]: c["name"] for c in data["columns"]}
        assert sorted(names) == sorted(str(caps[n].id) for n in COUNTING)
        assert sorted(names[c["capability_id"]] for c in data["cells"]) == COUNTING

    async def test_process_application_matrix(self, client, db, bpm):
        await _fan(
            db, hub_type="BusinessProcess", peer_type="Application", rel_type="relProcessToApp"
        )
        data = await _get(client, bpm.admin, "/api/v1/reports/bpm/process-application-matrix")
        assert sorted(c["name"] for c in data["columns"]) == COUNTING
        assert len(data["cells"]) == 2

    async def test_process_dependencies(self, client, db, bpm):
        hub, peers = await _fan(
            db,
            hub_type="BusinessProcess",
            peer_type="BusinessProcess",
            rel_type="relProcessDependency",
        )
        data = await _get(client, bpm.admin, "/api/v1/reports/bpm/process-dependencies")
        assert sorted(e["target"] for e in data["edges"]) == sorted(
            str(peers[n].id) for n in COUNTING
        )
        assert sorted(n["name"] for n in data["nodes"]) == sorted(["Hub", *COUNTING])

    async def test_capability_heatmap_counts_processes_related_now(self, client, db, bpm):
        cap, _procs = await _fan(
            db,
            hub_type="BusinessCapability",
            peer_type="BusinessProcess",
            rel_type="relProcessToBC",
            hub_is_source=False,
        )
        data = await _get(
            client, bpm.admin, "/api/v1/reports/bpm/capability-heatmap", metric="process_count"
        )
        assert [(i["name"], i["metric_value"]) for i in data["items"]] == [("Hub", 2)]

    async def test_process_map_links_only_relations_in_effect(self, client, db, bpm):
        await _fan(
            db, hub_type="BusinessProcess", peer_type="Application", rel_type="relProcessToApp"
        )
        data = await _get(client, bpm.admin, "/api/v1/reports/bpm/process-map")
        assert len(data["items"]) == 1
        item = data["items"][0]
        assert item["app_count"] == 2
        assert sorted(a["name"] for a in item["apps"]) == COUNTING

    async def test_value_stream_matrix_places_a_process_only_through_a_relation_in_effect(
        self, client, db, bpm
    ):
        orgs = {}
        for name, lifecycle in WINDOWS.items():
            orgs[name] = await create_card(db, card_type="Organization", name=f"org-{name}")
            proc = await create_card(db, card_type="BusinessProcess", name=f"proc-{name}")
            await create_relation(
                db,
                type_key="relProcessToOrg",
                source_id=proc.id,
                target_id=orgs[name].id,
                lifecycle=lifecycle,
            )
        data = await _get(client, bpm.admin, "/api/v1/reports/bpm/value-stream-matrix")
        assert sorted(data["cells"]) == sorted(str(orgs[n].id) for n in COUNTING)
        assert sorted(p["name"] for p in data["unassigned"]) == ["proc-ended", "proc-planned"]

    async def test_permission_unchanged(self, client, bpm):
        resp = await client.get(
            "/api/v1/reports/bpm/capability-process-matrix", headers=auth_headers(bpm.nobody)
        )
        assert resp.status_code == 403


# ── TurboLens dependency graph ───────────────────────────────────────────────


class TestTurboLensObjectiveDependencies:
    async def test_the_graph_follows_only_relations_in_effect(self, client, db, env):
        await create_card_type(db, key="Objective", label="Objective")
        await create_relation_type(
            db,
            key="relObjectiveToBC",
            source_type_key="Objective",
            target_type_key="BusinessCapability",
        )
        objective, caps = await _fan(
            db,
            hub_type="Objective",
            peer_type="BusinessCapability",
            rel_type="relObjectiveToBC",
            hub_name="Grow",
        )
        data = await _get(
            client,
            env.admin,
            "/api/v1/turbolens/architect/objective-dependencies",
            objective_ids=str(objective.id),
        )
        assert sorted(n["name"] for n in data["nodes"]) == sorted(["Grow", *COUNTING])
        assert sorted(e["target"] for e in data["edges"]) == sorted(
            str(caps[n].id) for n in COUNTING
        )

    async def test_permission_unchanged(self, client, env):
        resp = await client.get(
            "/api/v1/turbolens/architect/objective-dependencies",
            headers=auth_headers(env.nobody),
        )
        assert resp.status_code == 403
