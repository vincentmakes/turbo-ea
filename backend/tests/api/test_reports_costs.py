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


class TestPortfolioAndLifecycleRedactCosts:
    """`/reports/app-portfolio` and `/reports/roadmap` hand the client every
    attribute of every card (and of their relations) for client-side grouping.
    Their own permissions say nothing about money, so the cost fields follow
    the card rule: `costs.view`, or a stakeholder role that shows them."""

    @pytest.fixture
    async def env(self, db):
        from app.models.stakeholder import Stakeholder
        from tests.conftest import (
            create_relation,
            create_relation_type,
            create_stakeholder_role_def,
        )

        reports = {"reports.portfolio": True, "reports.ea_dashboard": True, "inventory.view": True}
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="analyst", permissions=reports)
        await create_role(db, key="finance", permissions={**reports, "costs.view": True})
        await create_card_type(
            db,
            key="Application",
            fields_schema=[
                {
                    "section": "g",
                    "fields": [
                        {"key": "costTotalAnnual", "type": "cost", "weight": 0},
                        {"key": "tier", "type": "text", "weight": 0},
                    ],
                }
            ],
        )
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="relAppToItc",
            label="uses",
            source_type_key="Application",
            target_type_key="ITComponent",
            attributes_schema=[
                {"key": "costShare", "label": "Share", "type": "cost"},
                {"key": "note", "label": "Note", "type": "text"},
            ],
        )
        await create_stakeholder_role_def(
            db, key="responsible", permissions={"card.view": True, "card.view_costs": True}
        )
        users = {
            "analyst": await create_user(db, email="analyst@test.com", role="analyst"),
            "owner": await create_user(db, email="owner@test.com", role="analyst"),
            "finance": await create_user(db, email="finance@test.com", role="finance"),
        }
        life = {"active": "2024-01-01"}
        a = await create_card(
            db,
            card_type="Application",
            name="A",
            attributes={"costTotalAnnual": 100, "tier": "gold"},
            lifecycle=life,
        )
        b = await create_card(
            db,
            card_type="Application",
            name="B",
            attributes={"costTotalAnnual": 200, "tier": "silver"},
            lifecycle=life,
        )
        server = await create_card(db, card_type="ITComponent", name="Server", lifecycle=life)
        for app in (a, b):
            await create_relation(
                db,
                type_key="relAppToItc",
                source_id=app.id,
                target_id=server.id,
                attributes={"costShare": 5, "note": "n"},
            )
        db.add(Stakeholder(card_id=a.id, user_id=users["owner"].id, role="responsible"))
        await db.flush()
        return {"users": users, "a": a, "b": b, "server": server}

    FULL = {"costTotalAnnual": 100, "tier": "gold"}, {"costTotalAnnual": 200, "tier": "silver"}
    BARE = {"tier": "gold"}, {"tier": "silver"}
    REL_FULL, REL_BARE = {"costShare": 5, "note": "n"}, {"note": "n"}

    async def _apps(self, client, user, url):
        resp = await client.get(url, headers=auth_headers(user))
        assert resp.status_code == 200, resp.text
        items = {i["name"]: i for i in resp.json()["items"]}
        assert set(items) == {"A", "B"}
        return items

    @pytest.mark.parametrize(
        "url",
        [
            "/api/v1/reports/app-portfolio?type=Application",
            "/api/v1/reports/roadmap?type=Application",
        ],
    )
    async def test_each_reader_gets_the_costs_they_may_see(self, client, env, url):
        expected = {
            "analyst": (self.BARE, (self.REL_BARE, self.REL_BARE)),
            "finance": (self.FULL, (self.REL_FULL, self.REL_FULL)),
            # the owner of A: A's own costs and the relation that starts at A
            "owner": ((self.FULL[0], self.BARE[1]), (self.REL_FULL, self.REL_BARE)),
        }
        for who, (cards, relations) in expected.items():
            items = await self._apps(client, env["users"][who], url)
            assert (items["A"]["attributes"], items["B"]["attributes"]) == cards, who
            got = tuple(items[n]["relations"][0]["attributes"] for n in ("A", "B"))
            assert got == relations, who

    async def test_a_relation_listed_on_its_target_follows_its_source(self, client, env):
        # The IT Component has no cost field of its own; its two incoming
        # relations belong to A and to B.
        async def shares(who):
            resp = await client.get(
                "/api/v1/reports/app-portfolio?type=ITComponent",
                headers=auth_headers(env["users"][who]),
            )
            assert resp.status_code == 200, resp.text
            [item] = resp.json()["items"]
            return {r["related_name"]: r["attributes"] for r in item["relations"]}

        assert await shares("analyst") == {"A": self.REL_BARE, "B": self.REL_BARE}
        assert await shares("owner") == {"A": self.REL_FULL, "B": self.REL_BARE}
        assert await shares("finance") == {"A": self.REL_FULL, "B": self.REL_FULL}

    async def test_the_lifecycle_report_across_all_types(self, client, env):
        async def attributes(who):
            resp = await client.get(
                "/api/v1/reports/roadmap", headers=auth_headers(env["users"][who])
            )
            assert resp.status_code == 200, resp.text
            return {i["name"]: i["attributes"] for i in resp.json()["items"]}

        assert await attributes("analyst") == {"A": self.BARE[0], "B": self.BARE[1], "Server": {}}
        assert await attributes("owner") == {"A": self.FULL[0], "B": self.BARE[1], "Server": {}}
        assert await attributes("finance") == {"A": self.FULL[0], "B": self.FULL[1], "Server": {}}
