"""Integration tests: an Initiative's PPM lines count for the current fiscal year only.

Discussion #1362 follow-up: an Initiative with 25 000 budgeted in this fiscal
year and 25 000 in the next showed 50 000 in the Cost report under "Current
fiscal year", because the PPM cost sync stores the all-years sum in
``costBudget``. The report now reads the year's slice from the lines
(``app.services.ppm_fiscal_costs``) and, when some of the lines fall outside
the year, names their all-years total as ``lifetime_cost``; the card
attribute is untouched.
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select

from app.models.app_settings import AppSettings
from app.models.card import Card
from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.services.fiscal_year import current_fiscal_year
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_budget_line,
    create_card,
    create_card_type,
    create_cost_line,
    create_relation,
    create_relation_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

THIS_YEAR = current_fiscal_year(1)
AGG = "Initiative:costBudget"
INIT_FIELDS = [
    {
        "section": "Cost",
        "fields": [
            {"key": "costBudget", "type": "cost", "weight": 0},
            {"key": "costActual", "type": "cost", "weight": 0},
        ],
    }
]


async def _set_fiscal_year_start(db, month: int) -> None:
    await db.merge(AppSettings(id="default", general_settings={"fiscalYearStart": month}))
    await db.flush()


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    await create_card_type(db, key="BusinessCapability", fields_schema=[])
    await create_card_type(db, key="Initiative", fields_schema=INIT_FIELDS)
    await create_relation_type(
        db,
        key="relInitToCap",
        source_type_key="Initiative",
        target_type_key="BusinessCapability",
    )
    return {"admin": admin}


async def _init(db, name, **attributes):
    return await create_card(db, card_type="Initiative", name=name, attributes=attributes)


async def _two_year_init(db, name="Programme"):
    """25 000 budgeted this fiscal year and 25 000 next; the card holds the
    50 000 the PPM cost sync would have written."""
    init = await _init(db, name, costBudget=50_000)
    await create_budget_line(db, initiative_id=init.id, fiscal_year=THIS_YEAR, amount=25_000)
    await create_budget_line(db, initiative_id=init.id, fiscal_year=THIS_YEAR + 1, amount=25_000)
    return init


async def _cap(db, name):
    return await create_card(db, card_type="BusinessCapability", name=name)


async def _link(db, src, tgt):
    await create_relation(db, type_key="relInitToCap", source_id=src.id, target_id=tgt.id)


async def _treemap(client, user, **params):
    resp = await client.get(
        "/api/v1/reports/cost-treemap", params=params, headers=auth_headers(user)
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _costs(data) -> dict[str, float]:
    return {i["name"]: i["cost"] for i in data["items"]}


class TestDirect:
    async def test_counts_only_this_fiscal_years_budget_lines(self, client, db, env):
        """The #1362 regression: 25k + 25k over two years is 25k this year."""
        await _two_year_init(db)
        data = await _treemap(client, env["admin"], type="Initiative", cost_field="costBudget")
        assert _costs(data) == {"Programme": 25_000}
        assert data["total"] == 25_000
        assert data["items"][0]["lifetime_cost"] == 50_000
        assert data["fiscal_year"] == THIS_YEAR

    async def test_the_card_attribute_keeps_the_all_years_total(self, client, db, env):
        init = await _two_year_init(db)
        await _treemap(client, env["admin"], type="Initiative", cost_field="costBudget")
        card = (await db.execute(select(Card).where(Card.id == init.id))).scalar_one()
        assert card.attributes["costBudget"] == 50_000

    async def test_a_single_year_initiative_carries_no_lifetime(self, client, db, env):
        """Nothing lies outside the year, so there is nothing to say."""
        init = await _init(db, "This year only", costBudget=25_000)
        await create_budget_line(db, initiative_id=init.id, fiscal_year=THIS_YEAR, amount=25_000)
        data = await _treemap(client, env["admin"], type="Initiative", cost_field="costBudget")
        assert _costs(data) == {"This year only": 25_000}
        assert "lifetime_cost" not in data["items"][0]

    @pytest.mark.parametrize("stored", [None, 0, 10_000])
    async def test_the_lifetime_is_the_lines_not_a_stale_attribute(self, client, db, env, stored):
        """Lines written without the PPM cost sync (demo seeder, workspace
        applier, an import) leave ``costBudget`` missing or stale."""
        attrs = {} if stored is None else {"costBudget": stored}
        init = await _init(db, "Imported", **attrs)
        await create_budget_line(db, initiative_id=init.id, fiscal_year=THIS_YEAR, amount=25_000)
        await create_budget_line(
            db, initiative_id=init.id, fiscal_year=THIS_YEAR + 1, amount=30_000
        )
        data = await _treemap(client, env["admin"], type="Initiative", cost_field="costBudget")
        assert _costs(data) == {"Imported": 25_000}
        assert data["items"][0]["lifetime_cost"] == 55_000

    async def test_lines_only_in_another_year_leave_the_initiative_out(self, client, db, env):
        init = await _init(db, "Next year only", costBudget=40_000)
        await create_budget_line(
            db, initiative_id=init.id, fiscal_year=THIS_YEAR + 1, amount=40_000
        )
        data = await _treemap(client, env["admin"], type="Initiative", cost_field="costBudget")
        assert data["items"] == []
        assert data["total"] == 0

    async def test_no_lines_keeps_the_typed_figure_and_no_lifetime(self, client, db, env):
        await _init(db, "Hand-entered", costBudget=7_000)
        data = await _treemap(client, env["admin"], type="Initiative", cost_field="costBudget")
        assert _costs(data) == {"Hand-entered": 7_000}
        assert "lifetime_cost" not in data["items"][0]

    async def test_budget_lines_do_not_slice_the_actual_cost(self, client, db, env):
        """Budget and actuals are independent: lines for one, a typed value for the other."""
        init = await _two_year_init(db)
        init.attributes = {**init.attributes, "costActual": 9_000}
        await db.flush()
        data = await _treemap(client, env["admin"], type="Initiative", cost_field="costActual")
        assert _costs(data) == {"Programme": 9_000}
        assert "lifetime_cost" not in data["items"][0]

    async def test_actuals_by_cost_line_date_with_an_october_fiscal_start(self, client, db, env):
        await _set_fiscal_year_start(db, 10)
        fy = current_fiscal_year(10)
        init = await _init(db, "Programme", costActual=1_111)
        # FY `fy` runs from 1 October of fy-1 through 30 September of fy.
        for day, actual in (
            (date(fy - 1, 9, 30), 1),  # last day of the previous year
            (date(fy - 1, 10, 1), 10),  # first day of this year
            (date(fy, 9, 30), 100),  # last day of this year
            (date(fy, 10, 1), 1_000),  # first day of next year
        ):
            await create_cost_line(db, initiative_id=init.id, actual=actual, date=day)
        await create_cost_line(db, initiative_id=init.id, actual=10_000, date=None)

        data = await _treemap(client, env["admin"], type="Initiative", cost_field="costActual")
        assert _costs(data) == {"Programme": 110}
        # Every line, the undated one included — not the stored 1 111.
        assert data["items"][0]["lifetime_cost"] == 11_111
        assert data["fiscal_year"] == fy

    async def test_only_undated_cost_lines_count_in_no_year(self, client, db, env):
        init = await _init(db, "Undated", costActual=500)
        await create_cost_line(db, initiative_id=init.id, actual=500, date=None)
        data = await _treemap(client, env["admin"], type="Initiative", cost_field="costActual")
        assert data["items"] == []


class TestAggregate:
    @pytest.fixture
    async def shared(self, db, env):
        a, b = await _cap(db, "Cap A"), await _cap(db, "Cap B")
        init = await _two_year_init(db)
        await _link(db, init, a)
        await _link(db, init, b)
        return {"a": a, "b": b, "init": init}

    async def test_full_puts_the_years_figure_on_each_capability(self, client, env, shared):
        data = await _treemap(client, env["admin"], type="BusinessCapability", aggregate=AGG)
        assert _costs(data) == {"Cap A": 25_000, "Cap B": 25_000}
        assert data["total"] == 25_000
        assert data["source_costs"] == {str(shared["init"].id): 25_000}

    async def test_split_shares_the_years_figure(self, client, env, shared):
        data = await _treemap(
            client,
            env["admin"],
            type="BusinessCapability",
            aggregate=AGG,
            attribution="split",
        )
        assert _costs(data) == {"Cap A": 12_500, "Cap B": 12_500}
        assert data["total"] == 25_000

    @pytest.mark.parametrize(
        "attribution, expected, lifetime",
        [("full", 25_000, 50_000), ("split", 12_500, 25_000)],
    )
    async def test_drill_into_a_capability(
        self, client, env, shared, attribution, expected, lifetime
    ):
        """Split shares the all-years figure by the same count as the year's,
        so the note compares this tile's share with this tile's share."""
        data = await _treemap(
            client,
            env["admin"],
            type="Initiative",
            cost_field="costBudget",
            parent_card_id=str(shared["a"].id),
            attribution=attribution,
        )
        assert _costs(data) == {"Programme": expected}
        assert data["items"][0]["lifetime_cost"] == lifetime
        assert data["total"] == expected


class TestCostReport:
    async def test_cost_report_sums_the_years_slice_of_each_field(self, client, db, env):
        init = await _two_year_init(db)
        init.attributes = {**init.attributes, "costActual": 3_000}
        await db.flush()
        await _init(db, "Typed", costBudget=4_000)
        single = await _init(db, "Single year", costBudget=8_000)
        await create_budget_line(db, initiative_id=single.id, fiscal_year=THIS_YEAR, amount=8_000)
        resp = await client.get(
            "/api/v1/reports/cost",
            params={"type": "Initiative"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        by = {i["name"]: i for i in data["items"]}
        # Budget sliced to 25 000, the typed actual kept: 28 000 this year.
        assert by["Programme"]["cost"] == 28_000
        assert by["Programme"]["lifetime_cost"] == 53_000
        assert by["Typed"]["cost"] == 4_000
        assert "lifetime_cost" not in by["Typed"]
        assert by["Single year"]["cost"] == 8_000
        assert "lifetime_cost" not in by["Single year"]
        assert data["total"] == 40_000


class TestAccess:
    async def test_cost_report_without_costs_view_is_403(self, client, db, env):
        await create_role(db, key="viewer", label="Viewer", permissions={"inventory.view": True})
        viewer = await create_user(db, email="viewer@test.com", role="viewer")
        await _two_year_init(db)
        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={"type": "Initiative", "cost_field": "costBudget"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_a_hidden_initiative_is_not_summed(self, client, db, env):
        await create_role(db, key="analyst", label="Analyst", permissions={"costs.view": True})
        analyst = await create_user(db, email="analyst@test.com", role="analyst")
        await create_stakeholder_role_def(
            db, card_type_key="Initiative", key="owner", permissions={"card.view": True}
        )
        seen = await _two_year_init(db, "Seen")
        hidden = await _two_year_init(db, "Hidden")
        db.add(Stakeholder(card_id=seen.id, user_id=analyst.id, role="owner"))
        ct = (await db.execute(select(CardType).where(CardType.key == "Initiative"))).scalar_one()
        ct.role_permissions = {"analyst": {"inventory.view": False}}
        await db.flush()
        PermissionService.invalidate_type_permission_cache()

        data = await _treemap(client, analyst, type="Initiative", cost_field="costBudget")
        assert _costs(data) == {"Seen": 25_000}
        assert data["total"] == 25_000
        assert str(hidden.id) not in str(data)

    async def test_an_invalid_cost_field_is_400(self, client, env):
        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={"type": "Initiative", "cost_field": "cost Budget"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400
