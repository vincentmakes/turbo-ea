"""Integration tests: cost-driven reports respect costs.view."""

from __future__ import annotations

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def report_env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
    await create_card_type(
        db,
        key="Application",
        fields_schema=[
            {
                "section": "g",
                "fields": [
                    {"key": "costTotalAnnual", "type": "cost", "weight": 1},
                    {"key": "functionalFit", "type": "single_select", "weight": 0},
                    {"key": "technicalFit", "type": "single_select", "weight": 0},
                    {"key": "businessCriticality", "type": "single_select", "weight": 0},
                ],
            }
        ],
    )
    # Holds costs.view and nothing else: the shape an admin creates when they
    # want someone to see money but not the EA reports suite.
    await create_role(db, key="costs_only", permissions={"costs.view": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    costs_only = await create_user(db, email="costs@test.com", role="costs_only")
    await create_card(db, card_type="Application", name="A", attributes={"costTotalAnnual": 100})
    await create_card(db, card_type="Application", name="B", attributes={"costTotalAnnual": 200})
    return {
        "admin": admin,
        "member": member,
        "viewer": viewer,
        "costs_only": costs_only,
    }


class TestCostReportEndpoint:
    async def test_member_can_see_cost_report(self, client, db, report_env):
        r = await client.get(
            "/api/v1/reports/cost?type=Application",
            headers=auth_headers(report_env["member"]),
        )
        assert r.status_code == 200
        assert r.json()["total"] == 300

    async def test_viewer_blocked_on_cost_report(self, client, db, report_env):
        r = await client.get(
            "/api/v1/reports/cost?type=Application",
            headers=auth_headers(report_env["viewer"]),
        )
        assert r.status_code == 403


class TestCostTreemapEndpoint:
    async def test_member_can_see_cost_treemap(self, client, db, report_env):
        r = await client.get(
            "/api/v1/reports/cost-treemap?type=Application&cost_field=costTotalAnnual",
            headers=auth_headers(report_env["member"]),
        )
        assert r.status_code == 200

    async def test_viewer_blocked_on_cost_treemap(self, client, db, report_env):
        r = await client.get(
            "/api/v1/reports/cost-treemap?type=Application&cost_field=costTotalAnnual",
            headers=auth_headers(report_env["viewer"]),
        )
        assert r.status_code == 403


class TestPortfolioCostAxisGate:
    async def test_viewer_blocked_when_size_field_is_cost(self, client, db, report_env):
        r = await client.get(
            "/api/v1/reports/portfolio?type=Application"
            "&size_field=costTotalAnnual"
            "&x_axis=functionalFit&y_axis=technicalFit&color_field=businessCriticality",
            headers=auth_headers(report_env["viewer"]),
        )
        assert r.status_code == 403

    async def test_member_can_use_cost_size_field(self, client, db, report_env):
        r = await client.get(
            "/api/v1/reports/portfolio?type=Application"
            "&size_field=costTotalAnnual"
            "&x_axis=functionalFit&y_axis=technicalFit&color_field=businessCriticality",
            headers=auth_headers(report_env["member"]),
        )
        assert r.status_code == 200


class TestCostReportNeedsOnlyCostsView:
    """`costs.view` is the whole gate for a report that is nothing but costs.

    These endpoints also required `reports.ea_dashboard`, which meant a role
    granted cost visibility saw the menu entry, opened the page and got a 403 —
    stricter than what `costs.view` ("View cost fields on cards and cost
    reports") promises the admin who ticked it.
    """

    async def test_costs_view_alone_opens_the_cost_report(self, client, db, report_env):
        r = await client.get(
            "/api/v1/reports/cost?type=Application",
            headers=auth_headers(report_env["costs_only"]),
        )
        assert r.status_code == 200
        assert r.json()["total"] == 300

    async def test_costs_view_alone_opens_the_treemap(self, client, db, report_env):
        # The treemap is the endpoint the Cost report page actually calls.
        r = await client.get(
            "/api/v1/reports/cost-treemap?type=Application&cost_field=costTotalAnnual",
            headers=auth_headers(report_env["costs_only"]),
        )
        assert r.status_code == 200

    async def test_still_closed_without_costs_view(self, client, db, report_env):
        # The loosening is confined to costs.view — it does not open the report
        # to a role that lacks it.
        for path in (
            "/api/v1/reports/cost?type=Application",
            "/api/v1/reports/cost-treemap?type=Application&cost_field=costTotalAnnual",
        ):
            r = await client.get(path, headers=auth_headers(report_env["viewer"]))
            assert r.status_code == 403, path
