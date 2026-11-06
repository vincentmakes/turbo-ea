"""Integration tests: how a related card shared by several cards is attributed.

Discussion #1362: one Initiative worth 50 000 improves two Business
Capabilities. The cost treemap built around Business Capability with
*Initiative · Budget* as its source showed 50 000 on each capability and a
100 000 total. ``attribution=full`` (the default) keeps the per-tile number but
counts each related card once in the total; ``attribution=split`` shares the
cost equally between the cards it links to. The capability heatmap's Total
Cost and the ``group_by`` mode follow the same rule.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.services.fiscal_year import current_fiscal_year
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

THIS_YEAR = current_fiscal_year(1)
AGG = "Initiative:costBudget"


def _cost_fields(key: str) -> list[dict]:
    return [{"section": "Cost", "fields": [{"key": key, "type": "cost", "weight": 0}]}]


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    await create_card_type(db, key="BusinessCapability", fields_schema=[])
    await create_card_type(db, key="Initiative", fields_schema=_cost_fields("costBudget"))
    await create_card_type(db, key="Application", fields_schema=_cost_fields("costTotalAnnual"))
    await create_relation_type(
        db,
        key="relInitToCap",
        source_type_key="Initiative",
        target_type_key="BusinessCapability",
    )
    # A second relation type over the same pair: parallel links count once.
    await create_relation_type(
        db,
        key="relInitAlsoCap",
        source_type_key="Initiative",
        target_type_key="BusinessCapability",
    )
    await create_relation_type(
        db,
        key="relAppToCap",
        source_type_key="Application",
        target_type_key="BusinessCapability",
    )
    return {"admin": admin}


async def _cap(db, name, **kwargs):
    return await create_card(db, card_type="BusinessCapability", name=name, **kwargs)


async def _init(db, name, cost):
    return await create_card(db, card_type="Initiative", name=name, attributes={"costBudget": cost})


async def _app(db, name, cost):
    return await create_card(
        db, card_type="Application", name=name, attributes={"costTotalAnnual": cost}
    )


async def _link(db, src, tgt, type_key="relInitToCap"):
    await create_relation(db, type_key=type_key, source_id=src.id, target_id=tgt.id)


async def _treemap(client, user, **params):
    params.setdefault("type", "BusinessCapability")
    resp = await client.get(
        "/api/v1/reports/cost-treemap", params=params, headers=auth_headers(user)
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _by_name(data) -> dict[str, dict]:
    return {i["name"]: i for i in data["items"]}


@pytest.fixture
async def shared(db, env):
    """Init (50 000) improves A and B; Init2 (10 000) improves C only."""
    a, b, c = await _cap(db, "Cap A"), await _cap(db, "Cap B"), await _cap(db, "Cap C")
    init = await _init(db, "Init", 50_000)
    init2 = await _init(db, "Init2", 10_000)
    await _link(db, init, a)
    await _link(db, init, a, "relInitAlsoCap")  # parallel relation type
    await _link(db, init, b)
    await _link(db, init2, c)
    return {"a": a, "b": b, "c": c, "init": init, "init2": init2}


class TestAggregateAttribution:
    async def test_full_counts_a_shared_initiative_once_in_the_total_and_marks_both_tiles(
        self, client, env, shared
    ):
        """#1362: the tiles keep the full cost, the total counts Init once."""
        data = await _treemap(client, env["admin"], aggregate=AGG)
        by = _by_name(data)
        assert {n: i["cost"] for n, i in by.items()} == {
            "Cap A": 50_000,
            "Cap B": 50_000,
            "Cap C": 10_000,
        }
        assert data["total"] == 60_000
        init_id, init2_id = str(shared["init"].id), str(shared["init2"].id)
        assert data["source_costs"] == {init_id: 50_000, init2_id: 10_000}
        assert by["Cap A"]["source_ids"] == [init_id]
        assert by["Cap B"]["source_ids"] == [init_id]
        assert by["Cap C"]["source_ids"] == [init2_id]
        assert data["attribution"] == "full"

    async def test_split_divides_a_shared_initiative_between_its_capabilities(
        self, client, env, shared
    ):
        data = await _treemap(client, env["admin"], aggregate=AGG, attribution="split")
        assert {n: i["cost"] for n, i in _by_name(data).items()} == {
            "Cap A": 25_000,
            "Cap B": 25_000,
            "Cap C": 10_000,
        }
        assert data["total"] == 60_000
        assert data["attribution"] == "split"
        # source_costs stays the full cost of each source.
        assert data["source_costs"][str(shared["init"].id)] == 50_000

    async def test_split_denominator_counts_live_active_primaries_only(self, client, db, env):
        a = await _cap(db, "Cap A")
        retired = await _cap(db, "Retired", lifecycle={"endOfLife": f"{THIS_YEAR - 1:04d}-12-31"})
        archived = await _cap(db, "Archived", status="ARCHIVED")
        init = await _init(db, "Init", 50_000)
        for cap in (a, retired, archived):
            await _link(db, init, cap)

        data = await _treemap(client, env["admin"], aggregate=AGG, attribution="split")
        assert {n: i["cost"] for n, i in _by_name(data).items()} == {"Cap A": 50_000}
        assert data["total"] == 50_000

    async def test_split_denominator_ignores_a_hidden_primary(self, client, db, env):
        await create_role(db, key="analyst", label="Analyst", permissions={"costs.view": True})
        analyst = await create_user(db, email="analyst@test.com", role="analyst")
        await create_stakeholder_role_def(
            db,
            card_type_key="BusinessCapability",
            key="owner",
            permissions={"card.view": True},
        )
        a, b = await _cap(db, "Cap A"), await _cap(db, "Cap B")
        init = await _init(db, "Init", 50_000)
        await _link(db, init, a)
        await _link(db, init, b)
        db.add(Stakeholder(card_id=a.id, user_id=analyst.id, role="owner"))
        ct = (
            await db.execute(select(CardType).where(CardType.key == "BusinessCapability"))
        ).scalar_one()
        ct.role_permissions = {"analyst": {"inventory.view": False}}
        await db.flush()
        PermissionService.invalidate_type_permission_cache()

        data = await _treemap(client, analyst, aggregate=AGG, attribution="split")
        assert {n: i["cost"] for n, i in _by_name(data).items()} == {"Cap A": 50_000}
        assert str(b.id) not in str(data)

        # Control: the admin sees both, each with half.
        admin_data = await _treemap(client, env["admin"], aggregate=AGG, attribution="split")
        assert {n: i["cost"] for n, i in _by_name(admin_data).items()} == {
            "Cap A": 25_000,
            "Cap B": 25_000,
        }

    async def test_split_share_is_unchanged_by_parent_card_id_drill(self, client, db, env, shared):
        app = await _app(db, "App", 1)
        await _link(db, app, shared["a"], "relAppToCap")

        split = await _treemap(
            client, env["admin"], aggregate=AGG, attribution="split", parent_card_id=app.id
        )
        assert {n: i["cost"] for n, i in _by_name(split).items()} == {"Cap A": 25_000}
        assert split["total"] == 25_000
        assert split["source_costs"] == {str(shared["init"].id): 50_000}

        full = await _treemap(client, env["admin"], aggregate=AGG, parent_card_id=app.id)
        assert {n: i["cost"] for n, i in _by_name(full).items()} == {"Cap A": 50_000}
        assert full["total"] == 50_000


class TestDrillDownAttribution:
    async def test_drill_down_split_divides_by_the_parents_type_link_count(
        self, client, env, shared
    ):
        params = {
            "type": "Initiative",
            "cost_field": "costBudget",
            "parent_card_id": str(shared["a"].id),
        }
        split = await _treemap(client, env["admin"], attribution="split", **params)
        assert {n: i["cost"] for n, i in _by_name(split).items()} == {"Init": 25_000}
        assert split["total"] == 25_000
        assert "source_costs" not in split

        full = await _treemap(client, env["admin"], **params)
        assert {n: i["cost"] for n, i in _by_name(full).items()} == {"Init": 50_000}
        assert full["total"] == 50_000

    async def test_drill_down_split_of_an_unshared_card_keeps_its_cost(self, client, env, shared):
        data = await _treemap(
            client,
            env["admin"],
            type="Initiative",
            cost_field="costBudget",
            parent_card_id=str(shared["c"].id),
            attribution="split",
        )
        assert {n: i["cost"] for n, i in _by_name(data).items()} == {"Init2": 10_000}
        assert data["total"] == 10_000

    async def test_drill_into_an_archived_parent_still_lists_its_related_cards(
        self, client, db, env, shared
    ):
        # A saved drill into a card archived since: the parent only has to be
        # readable, so its related cards are still listed.
        archived = await _cap(db, "Archived Cap", status="ARCHIVED")
        init3 = await _init(db, "Init3", 60_000)
        await _link(db, init3, archived)
        await _link(db, init3, shared["a"])
        await _link(db, init3, shared["b"])
        init4 = await _init(db, "Init4", 8_000)
        await _link(db, init4, archived)
        params = {
            "type": "Initiative",
            "cost_field": "costBudget",
            "parent_card_id": str(archived.id),
        }

        full = await _treemap(client, env["admin"], **params)
        assert {n: i["cost"] for n, i in _by_name(full).items()} == {
            "Init3": 60_000,
            "Init4": 8_000,
        }
        assert full["total"] == 68_000

        # The split denominator counts ACTIVE live capabilities only: Init3 is
        # shared between A and B (not the archived parent), and Init4 links no
        # active capability, so it keeps its whole cost.
        split = await _treemap(client, env["admin"], attribution="split", **params)
        assert {n: i["cost"] for n, i in _by_name(split).items()} == {
            "Init3": 30_000,
            "Init4": 8_000,
        }
        assert split["total"] == 38_000

    async def test_attribution_without_aggregate_or_parent_changes_nothing(
        self, client, env, shared
    ):
        params = {"type": "Initiative", "cost_field": "costBudget"}
        full = await _treemap(client, env["admin"], **params)
        split = await _treemap(client, env["admin"], attribution="split", **params)
        assert full["items"] == split["items"]
        assert {n: i["cost"] for n, i in _by_name(split).items()} == {
            "Init": 50_000,
            "Init2": 10_000,
        }
        assert split["total"] == full["total"] == 60_000


@pytest.mark.parametrize(
    "route", ["/api/v1/reports/cost-treemap", "/api/v1/reports/capability-heatmap"]
)
@pytest.mark.parametrize("value", ["half", "Full"])
async def test_invalid_attribution_is_400(client, env, route, value):
    params = {"attribution": value}
    if route.endswith("heatmap"):
        params["metric"] = "total_cost"
    resp = await client.get(route, params=params, headers=auth_headers(env["admin"]))
    assert resp.status_code == 400
    assert resp.json()["detail"] == f"Invalid attribution: {value!r}"


class TestGroupByAttribution:
    async def _setup(self, db):
        marketing, sales = await _cap(db, "Marketing"), await _cap(db, "Sales")
        crm = await _app(db, "CRM", 100)
        await _link(db, crm, sales, "relAppToCap")
        await _link(db, crm, marketing, "relAppToCap")
        await _app(db, "Lonely", 40)

    async def _grouped(self, client, env, **params):
        return await _treemap(
            client,
            env["admin"],
            type="Application",
            cost_field="costTotalAnnual",
            group_by="BusinessCapability",
            **params,
        )

    async def test_group_by_full_lists_a_card_under_every_group(self, client, db, env):
        await self._setup(db)
        data = await self._grouped(client, env)
        crm = _by_name(data)["CRM"]
        assert crm["groups"] == ["Marketing", "Sales"]
        assert crm["group"] == "Marketing"
        assert {g["name"]: g["cost"] for g in data["groups"]} == {
            "Marketing": 100,
            "Sales": 100,
            "Ungrouped": 40,
        }

    async def test_group_by_split_shares_a_card_between_its_groups(self, client, db, env):
        await self._setup(db)
        data = await self._grouped(client, env, attribution="split")
        assert {g["name"]: g["cost"] for g in data["groups"]} == {
            "Marketing": 50,
            "Sales": 50,
            "Ungrouped": 40,
        }
        # The item itself keeps its own cost.
        assert _by_name(data)["CRM"]["cost"] == 100

    async def test_group_by_ungrouped_keeps_full_cost(self, client, db, env):
        await self._setup(db)
        data = await self._grouped(client, env, attribution="split")
        lonely = _by_name(data)["Lonely"]
        assert lonely["groups"] == []
        assert lonely["group"] == "Ungrouped"
        assert {g["name"]: g["cost"] for g in data["groups"]}["Ungrouped"] == 40


class TestHeatmapAttribution:
    async def _setup(self, db):
        x, y = await _cap(db, "Cap X"), await _cap(db, "Cap Y")
        app = await _app(db, "Shared App", 300)
        await _link(db, app, x, "relAppToCap")
        await _link(db, app, y, "relAppToCap")
        return x, y, app

    async def _heatmap(self, client, env, **params):
        resp = await client.get(
            "/api/v1/reports/capability-heatmap",
            params={"metric": "total_cost", **params},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200, resp.text
        return resp.json()

    async def test_heatmap_full_counts_a_shared_app_on_each_capability(self, client, db, env):
        await self._setup(db)
        data = await self._heatmap(client, env)
        assert {i["name"]: i["total_cost"] for i in data["items"]} == {
            "Cap X": 300,
            "Cap Y": 300,
        }
        assert data["attribution"] == "full"

    async def test_heatmap_split_divides_an_app_between_its_capabilities(self, client, db, env):
        await self._setup(db)
        data = await self._heatmap(client, env, attribution="split")
        assert {i["name"]: i["total_cost"] for i in data["items"]} == {
            "Cap X": 150,
            "Cap Y": 150,
        }
        assert data["attribution"] == "split"

    async def test_heatmap_app_carries_its_capability_ids(self, client, db, env):
        x, y, app = await self._setup(db)
        data = await self._heatmap(client, env)
        apps = {a["id"]: a for i in data["items"] for a in i["apps"]}
        assert apps[str(app.id)]["capability_ids"] == sorted([str(x.id), str(y.id)])
