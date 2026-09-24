"""Integration tests: the cost reports show the current fiscal year only.

A card's annual cost counts in full when the current fiscal year falls between
the one it goes ``active`` in and the one its ``endOfLife`` falls in, both
included — no pro-rating, and no way to ask for another year. Dates are built
relative to the current fiscal year so the tests do not rot as the calendar
moves on.
"""

from __future__ import annotations

import pytest

from app.models.app_settings import AppSettings
from app.services.fiscal_year import current_fiscal_year
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)

COST_FIELDS = [
    {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}
]

# With the default January start the fiscal year is the calendar year.
THIS_YEAR = current_fiscal_year(1)


def _d(year: int, month: int = 6, day: int = 15) -> str:
    return f"{year:04d}-{month:02d}-{day:02d}"


async def _set_fiscal_year_start(db, month: int) -> None:
    await db.merge(AppSettings(id="default", general_settings={"fiscalYearStart": month}))
    await db.flush()


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    await create_card_type(db, key="Application", fields_schema=COST_FIELDS)
    await create_card_type(db, key="ITComponent", fields_schema=COST_FIELDS)
    await create_card_type(db, key="Provider", fields_schema=[])
    await create_relation_type(
        db,
        key="relAppToITC",
        source_type_key="Application",
        target_type_key="ITComponent",
    )
    await create_relation_type(
        db,
        key="relProviderToITC",
        source_type_key="Provider",
        target_type_key="ITComponent",
    )
    return {"admin": admin}


async def _app(db, name, cost, lifecycle=None, card_type="Application"):
    return await create_card(
        db,
        card_type=card_type,
        name=name,
        attributes={"costTotalAnnual": cost},
        lifecycle=lifecycle or {},
    )


async def _treemap(client, env, **params):
    resp = await client.get(
        "/api/v1/reports/cost-treemap",
        params={"type": "Application", **params},
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _names(data) -> list[str]:
    return sorted(i["name"] for i in data["items"])


class TestCostTreemapCurrentFiscalYear:
    async def test_retired_in_an_earlier_year_is_excluded(self, client, db, env):
        """The reported bug: an End of Life in the past still added its cost."""
        await _app(
            db,
            "Retired",
            1000,
            {"active": _d(THIS_YEAR - 5), "endOfLife": _d(THIS_YEAR - 1, 12, 31)},
        )
        await _app(db, "Running", 200, {"active": _d(THIS_YEAR - 5)})
        await _app(db, "No lifecycle", 30)

        data = await _treemap(client, env)
        assert _names(data) == ["No lifecycle", "Running"]
        assert data["total"] == 230
        assert data["fiscal_year"] == THIS_YEAR
        assert data["fiscal_year_start"] == 1

    async def test_retiring_this_year_counts_in_full(self, client, db, env):
        """No pro-rating: the year of End of Life carries the whole annual cost."""
        await _app(
            db, "Leaving", 1200, {"active": _d(THIS_YEAR - 3), "endOfLife": _d(THIS_YEAR, 1, 1)}
        )
        data = await _treemap(client, env)
        assert _names(data) == ["Leaving"]
        assert data["total"] == 1200

    async def test_going_live_this_year_counts_in_full(self, client, db, env):
        await _app(db, "Late arrival", 500, {"active": _d(THIS_YEAR, 12, 31)})
        data = await _treemap(client, env)
        assert data["total"] == 500

    async def test_going_live_next_year_is_excluded(self, client, db, env):
        await _app(
            db, "Upcoming", 500, {"phaseIn": _d(THIS_YEAR), "active": _d(THIS_YEAR + 1, 1, 1)}
        )
        assert (await _treemap(client, env))["items"] == []

    async def test_planned_without_an_active_date_is_excluded(self, client, db, env):
        await _app(db, "Idea", 700, {"plan": _d(THIS_YEAR - 1)})
        assert (await _treemap(client, env))["items"] == []

    async def test_fiscal_year_start_month_moves_the_boundary(self, client, db, env):
        await _set_fiscal_year_start(db, 10)
        fy = current_fiscal_year(10)
        # FY `fy` runs from 1 October of fy-1 through 30 September of fy.
        await _app(db, "Retired last FY", 10, {"endOfLife": _d(fy - 1, 9, 30)})
        await _app(db, "Retiring on day one", 20, {"endOfLife": _d(fy - 1, 10, 1)})
        await _app(db, "Live on the last day", 40, {"active": _d(fy, 9, 30)})
        await _app(db, "Live next FY", 80, {"active": _d(fy, 10, 1)})

        data = await _treemap(client, env)
        assert _names(data) == ["Live on the last day", "Retiring on day one"]
        assert data["fiscal_year"] == fy
        assert data["fiscal_year_start"] == 10

    async def test_no_other_year_can_be_requested(self, client, db, env):
        """A card holds one annual figure, so no year parameter is offered."""
        await _app(db, "Retired", 1000, {"endOfLife": _d(THIS_YEAR - 1)})
        data = await _treemap(client, env, fiscal_year=THIS_YEAR - 1)
        assert data["items"] == []
        assert data["fiscal_year"] == THIS_YEAR


class TestAggregateCurrentFiscalYear:
    async def test_retired_related_cards_stop_adding_to_the_total(self, client, db, env):
        app = await _app(db, "App", 0, {"active": _d(THIS_YEAR - 5)})
        live = await _app(
            db, "Live ITC", 300, {"active": _d(THIS_YEAR - 5)}, card_type="ITComponent"
        )
        gone = await _app(
            db,
            "Gone ITC",
            900,
            {"active": _d(THIS_YEAR - 5), "endOfLife": _d(THIS_YEAR - 2)},
            card_type="ITComponent",
        )
        await create_relation(db, type_key="relAppToITC", source_id=app.id, target_id=live.id)
        await create_relation(db, type_key="relAppToITC", source_id=app.id, target_id=gone.id)

        data = await _treemap(client, env, aggregate=["ITComponent:costTotalAnnual"])
        assert data["items"][0]["cost"] == 300
        assert data["total"] == 300

    async def test_retired_primary_card_drops_out(self, client, db, env):
        app = await _app(db, "Old App", 0, {"endOfLife": _d(THIS_YEAR - 1)})
        itc = await _app(db, "ITC", 300, card_type="ITComponent")
        await create_relation(db, type_key="relAppToITC", source_id=app.id, target_id=itc.id)

        data = await _treemap(client, env, aggregate=["ITComponent:costTotalAnnual"])
        assert data["items"] == []

    async def test_drill_down_applies_the_rule(self, client, db, env):
        provider = await create_card(db, card_type="Provider", name="Vendor")
        live = await _app(db, "Live ITC", 300, card_type="ITComponent")
        gone = await _app(
            db, "Gone ITC", 900, {"endOfLife": _d(THIS_YEAR - 1)}, card_type="ITComponent"
        )
        for itc in (live, gone):
            await create_relation(
                db, type_key="relProviderToITC", source_id=provider.id, target_id=itc.id
            )

        data = await _treemap(client, env, type="ITComponent", parent_card_id=str(provider.id))
        assert _names(data) == ["Live ITC"]


class TestCostEndpointCurrentFiscalYear:
    async def test_cost_report_applies_the_same_rule(self, client, db, env):
        await _app(db, "Retired", 1000, {"endOfLife": _d(THIS_YEAR - 1)})
        await _app(db, "Running", 200)

        resp = await client.get(
            "/api/v1/reports/cost",
            params={"type": "Application"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert [i["name"] for i in data["items"]] == ["Running"]
        assert data["total"] == 200
        assert data["fiscal_year"] == THIS_YEAR
        assert data["fiscal_year_start"] == 1
