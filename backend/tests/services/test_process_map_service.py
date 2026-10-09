"""Tests for ``process_map_service.total_app_cost``.

Cost fields carry no numeric check on write, so a linked Application can hold a
string (an Excel import, an integration, an older client). The Process House
sums those costs, and one such value used to turn ``GET
/reports/bpm/process-map`` into a 500.
"""

from __future__ import annotations

import pytest

from app.services.process_map_service import total_app_cost
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)


def _app(**attributes) -> dict:
    return {"attributes": attributes}


class TestTotalAppCost:
    def test_sums_numbers_under_either_key(self):
        apps = [_app(costTotalAnnual=100), _app(totalAnnualCost=50.5), _app()]
        assert total_app_cost(apps) == 150.5

    def test_prefers_cost_total_annual(self):
        assert total_app_cost([_app(costTotalAnnual=10, totalAnnualCost=99)]) == 10

    def test_coerces_numeric_strings(self):
        apps = [_app(costTotalAnnual="1200"), _app(totalAnnualCost=" 300.5 ")]
        assert total_app_cost(apps) == 1500.5

    def test_skips_values_that_are_not_numbers(self):
        apps = [
            _app(costTotalAnnual="n/a"),
            _app(costTotalAnnual=["100"]),
            _app(costTotalAnnual={"amount": 100}),
            _app(costTotalAnnual=True),
            _app(costTotalAnnual=None),
            _app(costTotalAnnual=7),
        ]
        assert total_app_cost(apps) == 7

    def test_skips_non_finite_values(self):
        # float() reads these, but they are not JSON and not a cost.
        apps = [
            _app(costTotalAnnual="nan"),
            _app(costTotalAnnual="inf"),
            _app(costTotalAnnual=float("-inf")),
            _app(costTotalAnnual=float("nan")),
            _app(costTotalAnnual=3),
        ]
        assert total_app_cost(apps) == 3

    def test_keeps_integer_costs_integral(self):
        total = total_app_cost([_app(costTotalAnnual=100), _app(totalAnnualCost=50)])
        assert total == 150
        assert isinstance(total, int)

    def test_falls_back_to_the_other_key_when_the_first_is_not_a_number(self):
        assert total_app_cost([_app(costTotalAnnual="tbd", totalAnnualCost=40)]) == 40

    def test_zero_for_no_apps(self):
        assert total_app_cost([]) == 0


@pytest.fixture
async def process_map_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="pm-admin@example.com", role="admin")
    await create_card_type(db, key="BusinessProcess", label="Business Process")
    await create_card_type(
        db,
        key="Application",
        label="Application",
        fields_schema=[
            {
                "section": "Cost",
                "fields": [{"key": "costTotalAnnual", "label": "Annual Cost", "type": "cost"}],
            }
        ],
    )
    await create_relation_type(
        db,
        key="relProcessToApp",
        label="is supported by",
        source_type_key="BusinessProcess",
        target_type_key="Application",
    )
    process = await create_card(db, card_type="BusinessProcess", name="Order to Cash")
    for name, cost in [("Text Cost App", "not a number"), ("String Cost App", "250"), ("Num", 100)]:
        app = await create_card(db, name=name, attributes={"costTotalAnnual": cost})
        await create_relation(
            db, type_key="relProcessToApp", source_id=process.id, target_id=app.id
        )
    return {"admin": admin, "process": process}


class TestProcessMapEndpoint:
    async def test_a_string_cost_does_not_break_the_map(self, client, process_map_env):
        resp = await client.get(
            "/api/v1/reports/bpm/process-map",
            headers=auth_headers(process_map_env["admin"]),
        )
        assert resp.status_code == 200
        (item,) = resp.json()["items"]
        assert item["name"] == "Order to Cash"
        assert item["app_count"] == 3
        assert item["total_cost"] == 350
