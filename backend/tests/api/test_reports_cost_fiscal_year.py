"""Integration tests: the cost reports are scoped to one fiscal year.

An annual cost counts in full in every fiscal year from the one a card goes
``active`` in through the one its ``endOfLife`` falls in — no pro-rating — and
the current fiscal year is the default. Dates are built relative to today so
the tests do not rot as the calendar moves on.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.models.app_settings import AppSettings
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
THIS_YEAR = datetime.now(timezone.utc).date().year


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


class TestCostTreemapFiscalYear:
    async def test_retired_before_this_year_is_excluded_by_default(self, client, db, env):
        """The reported bug: an End of Life in the past still added its cost."""
        await _app(
            db, "Retired", 1000, {"active": _d(THIS_YEAR - 5), "endOfLife": _d(THIS_YEAR - 1)}
        )
        await _app(db, "Running", 200, {"active": _d(THIS_YEAR - 5)})
        await _app(db, "No lifecycle", 30)

        data = await _treemap(client, env)
        assert _names(data) == ["No lifecycle", "Running"]
        assert data["total"] == 230
        assert data["fiscal_year"] == THIS_YEAR

    async def test_retiring_this_year_counts_in_full(self, client, db, env):
        """No pro-rating: the year of End of Life carries the whole annual cost."""
        await _app(
            db, "Leaving", 1200, {"active": _d(THIS_YEAR - 3), "endOfLife": _d(THIS_YEAR, 1, 2)}
        )
        data = await _treemap(client, env)
        assert data["total"] == 1200

        data = await _treemap(client, env, fiscal_year=THIS_YEAR + 1)
        assert data["items"] == []
        assert data["total"] == 0

    async def test_going_live_later_counts_only_from_that_year(self, client, db, env):
        await _app(
            db, "Upcoming", 500, {"phaseIn": _d(THIS_YEAR), "active": _d(THIS_YEAR + 2, 12, 31)}
        )

        assert (await _treemap(client, env))["items"] == []
        assert (await _treemap(client, env, fiscal_year=THIS_YEAR + 1))["items"] == []
        data = await _treemap(client, env, fiscal_year=THIS_YEAR + 2)
        assert _names(data) == ["Upcoming"]
        assert data["total"] == 500

    async def test_planned_without_an_active_date_is_excluded(self, client, db, env):
        await _app(db, "Idea", 700, {"plan": _d(THIS_YEAR - 1)})
        assert (await _treemap(client, env))["items"] == []

    async def test_a_past_year_can_be_requested(self, client, db, env):
        await _app(
            db, "Retired", 1000, {"active": _d(THIS_YEAR - 5), "endOfLife": _d(THIS_YEAR - 1)}
        )
        data = await _treemap(client, env, fiscal_year=THIS_YEAR - 1)
        assert _names(data) == ["Retired"]
        assert data["fiscal_year"] == THIS_YEAR - 1
        assert data["current_fiscal_year"] == THIS_YEAR

    async def test_response_describes_the_fiscal_years(self, client, db, env):
        await _app(db, "A", 10, {"active": _d(THIS_YEAR - 4), "endOfLife": _d(THIS_YEAR + 3)})
        data = await _treemap(client, env, fiscal_year=THIS_YEAR + 1)
        assert data["fiscal_year"] == THIS_YEAR + 1
        assert data["current_fiscal_year"] == THIS_YEAR
        assert data["fiscal_year_start"] == 1
        # Padded by one year each side, and unaffected by the year requested.
        assert data["fiscal_year_range"] == {"min": THIS_YEAR - 5, "max": THIS_YEAR + 4}

    async def test_range_without_lifecycle_data_is_the_current_year_padded(self, client, db, env):
        await _app(db, "A", 10)
        data = await _treemap(client, env)
        assert data["fiscal_year_range"] == {"min": THIS_YEAR - 1, "max": THIS_YEAR + 1}

    async def test_fiscal_year_start_month_is_honoured(self, client, db, env):
        await _set_fiscal_year_start(db, 10)
        # 1 October opens the fiscal year named after the NEXT calendar year.
        await _app(db, "October go-live", 100, {"active": _d(THIS_YEAR, 10, 1)})
        await _app(db, "September EOL", 50, {"endOfLife": _d(THIS_YEAR, 9, 30)})

        data = await _treemap(client, env, fiscal_year=THIS_YEAR)
        assert _names(data) == ["September EOL"]
        assert data["fiscal_year_start"] == 10

        data = await _treemap(client, env, fiscal_year=THIS_YEAR + 1)
        assert _names(data) == ["October go-live"]

    async def test_invalid_fiscal_year_is_rejected(self, client, db, env):
        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={"type": "Application", "fiscal_year": 42},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 422


class TestAggregateFiscalYear:
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

        data = await _treemap(
            client, env, aggregate=["ITComponent:costTotalAnnual"], fiscal_year=THIS_YEAR - 2
        )
        assert data["total"] == 1200

    async def test_retired_primary_card_drops_out(self, client, db, env):
        app = await _app(db, "Old App", 0, {"endOfLife": _d(THIS_YEAR - 1)})
        itc = await _app(db, "ITC", 300, card_type="ITComponent")
        await create_relation(db, type_key="relAppToITC", source_id=app.id, target_id=itc.id)

        data = await _treemap(client, env, aggregate=["ITComponent:costTotalAnnual"])
        assert data["items"] == []

    async def test_related_lifecycles_widen_the_range(self, client, db, env):
        app = await _app(db, "App", 0)
        itc = await _app(db, "ITC", 300, {"endOfLife": _d(THIS_YEAR + 6)}, card_type="ITComponent")
        await create_relation(db, type_key="relAppToITC", source_id=app.id, target_id=itc.id)

        data = await _treemap(client, env, aggregate=["ITComponent:costTotalAnnual"])
        assert data["fiscal_year_range"] == {"min": THIS_YEAR - 1, "max": THIS_YEAR + 7}

    async def test_drill_down_applies_the_fiscal_year(self, client, db, env):
        provider = await create_card(db, card_type="Provider", name="Vendor")
        live = await _app(db, "Live ITC", 300, card_type="ITComponent")
        gone = await _app(
            db, "Gone ITC", 900, {"endOfLife": _d(THIS_YEAR - 1)}, card_type="ITComponent"
        )
        for itc in (live, gone):
            await create_relation(
                db, type_key="relProviderToITC", source_id=provider.id, target_id=itc.id
            )

        params = {"type": "ITComponent", "parent_card_id": str(provider.id)}
        data = await _treemap(client, env, **params)
        assert _names(data) == ["Live ITC"]

        data = await _treemap(client, env, **params, fiscal_year=THIS_YEAR - 1)
        assert _names(data) == ["Gone ITC", "Live ITC"]


class TestCostEndpointFiscalYear:
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

        resp = await client.get(
            "/api/v1/reports/cost",
            params={"type": "Application", "fiscal_year": THIS_YEAR - 1},
            headers=auth_headers(env["admin"]),
        )
        assert resp.json()["total"] == 1200
