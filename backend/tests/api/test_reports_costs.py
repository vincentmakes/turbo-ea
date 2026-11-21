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
from tests.cost_item_helpers import add_costs


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
    for name, cost in (("A", 100), ("B", 200)):
        card = await create_card(
            db, card_type="Application", name=name, attributes={"costTotalAnnual": cost}
        )
        await add_costs(db, card, other=cost)
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

    @pytest.mark.parametrize(
        "url",
        [
            "/api/v1/reports/app-portfolio?type=Application",
            "/api/v1/reports/roadmap?type=Application",
        ],
    )
    async def test_a_hidden_relation_type_still_has_its_costs_removed(self, client, db, env, url):
        # A hidden relation type drops out of the payload's `relation_types`,
        # but its rows are still listed on the cards.
        from sqlalchemy import select

        from app.models.relation_type import RelationType

        rt = (
            await db.execute(select(RelationType).where(RelationType.key == "relAppToItc"))
        ).scalar_one()
        rt.is_hidden = True
        await db.flush()

        items = await self._apps(client, env["users"]["analyst"], url)
        assert items["A"]["relations"][0]["attributes"] == self.REL_BARE
        items = await self._apps(client, env["users"]["finance"], url)
        assert items["A"]["relations"][0]["attributes"] == self.REL_FULL

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


class TestReportsUnderAViewDeny:
    """A View deny on a card type takes `costs.view` away for that type. The
    Landscape and Capability reports read their cost flag for the type they
    show, so a card of a denied type the reader still opens through a
    stakeholder role comes without its costs — and without them summed."""

    @pytest.fixture
    async def env(self, db):
        from sqlalchemy import select

        from app.models.card_type import CardType
        from app.models.stakeholder import Stakeholder
        from app.services.permission_service import PermissionService
        from tests.conftest import (
            create_relation,
            create_relation_type,
            create_stakeholder_role_def,
        )

        PermissionService.invalidate_type_permission_cache()
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(
            db,
            key="finance",
            permissions={
                "reports.ea_dashboard": True,
                "reports.portfolio": True,
                "inventory.view": True,
                "costs.view": True,
            },
        )
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
        await create_card_type(db, key="BusinessCapability", label="Business Capability")
        await create_relation_type(
            db,
            key="relAppToBC",
            label="supports",
            source_type_key="Application",
            target_type_key="BusinessCapability",
        )
        await create_stakeholder_role_def(db, key="watcher", permissions={"card.view": True})
        finance = await create_user(db, email="finance@test.com", role="finance")
        app = await create_card(
            db,
            card_type="Application",
            name="Billing",
            attributes={"costTotalAnnual": 100, "tier": "gold"},
        )
        cap = await create_card(db, card_type="BusinessCapability", name="Finance")
        await create_relation(db, type_key="relAppToBC", source_id=app.id, target_id=cap.id)
        db.add(Stakeholder(card_id=app.id, user_id=finance.id, role="watcher"))
        await db.flush()

        async def deny() -> None:
            ct = (
                await db.execute(select(CardType).where(CardType.key == "Application"))
            ).scalar_one()
            ct.role_permissions = {"finance": {"inventory.view": False}}
            await db.flush()
            PermissionService.invalidate_type_permission_cache()

        yield {"finance": finance, "deny": deny, "app": app, "cap": cap}
        PermissionService.invalidate_type_permission_cache()

    async def _landscape(self, client, user):
        resp = await client.get(
            "/api/v1/reports/landscape?type=Application&group_by=BusinessCapability",
            headers=auth_headers(user),
        )
        assert resp.status_code == 200, resp.text
        [group] = resp.json()["groups"]
        [item] = group["items"]
        return item["attributes"]

    async def _heatmap(self, client, user):
        resp = await client.get(
            "/api/v1/reports/capability-heatmap?metric=app_count", headers=auth_headers(user)
        )
        assert resp.status_code == 200, resp.text
        [item] = resp.json()["items"]
        [app] = item["apps"]
        return item["total_cost"], app["attributes"]

    async def test_without_a_deny_the_reports_carry_the_costs(self, client, env):
        full = {"costTotalAnnual": 100, "tier": "gold"}
        assert await self._landscape(client, env["finance"]) == full
        assert await self._heatmap(client, env["finance"]) == (100.0, full)

    async def test_a_view_deny_on_the_type_takes_the_costs_out_of_both(self, client, env):
        await env["deny"]()
        assert await self._landscape(client, env["finance"]) == {"tier": "gold"}
        assert await self._heatmap(client, env["finance"]) == (0.0, {"tier": "gold"})

    async def test_portfolio_hides_cost_axis_for_a_denied_card(self, client, env):
        await env["deny"]()
        response = await client.get(
            "/api/v1/reports/portfolio",
            params={
                "type": "Application",
                "x_axis": "tier",
                "y_axis": "tier",
                "size_field": "costTotalAnnual",
                "color_field": "tier",
            },
            headers=auth_headers(env["finance"]),
        )
        assert response.status_code == 200, response.text
        [item] = response.json()["items"]
        assert item["name"] == "Billing"
        assert item["x"] == "gold"
        assert item["size"] is None

    async def test_subtype_deny_hides_application_costs_in_both_reports(self, client, db, env):
        from sqlalchemy import select

        from app.models.card_type import CardType
        from app.services.permission_service import PermissionService

        ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
        env["app"].subtype = "restricted"
        ct.role_permissions = {
            "finance": {"inventory.view": {"value": False, "subtypes": ["restricted"]}}
        }
        await db.flush()
        PermissionService.invalidate_type_permission_cache()
        assert await self._landscape(client, env["finance"]) == {"tier": "gold"}
        assert await self._heatmap(client, env["finance"]) == (0.0, {"tier": "gold"})

    async def test_capability_cost_attributes_follow_card_permission(self, client, db, env):
        from sqlalchemy import select

        from app.models.card_type import CardType
        from app.models.stakeholder import Stakeholder
        from app.services.permission_service import PermissionService
        from tests.conftest import create_stakeholder_role_def

        ct = (
            await db.execute(select(CardType).where(CardType.key == "BusinessCapability"))
        ).scalar_one()
        ct.fields_schema = [
            {
                "section": "g",
                "fields": [
                    {"key": "costEstimate", "type": "cost"},
                    {"key": "tier", "type": "text"},
                ],
            }
        ]
        ct.role_permissions = {"finance": {"inventory.view": False}}
        await create_stakeholder_role_def(
            db, card_type_key="BusinessCapability", key="watcher", permissions={"card.view": True}
        )
        db.add(Stakeholder(card_id=env["cap"].id, user_id=env["finance"].id, role="watcher"))
        env["cap"].attributes = {"costEstimate": 40, "tier": "gold"}
        await db.flush()
        PermissionService.invalidate_type_permission_cache()
        response = await client.get(
            "/api/v1/reports/capability-heatmap?metric=app_count",
            headers=auth_headers(env["finance"]),
        )
        assert response.status_code == 200, response.text
        [item] = response.json()["items"]
        assert item["attributes"] == {"tier": "gold"}

    async def test_subtype_deny_keeps_authorized_cost_in_heatmap(self, client, db, env):
        from sqlalchemy import select

        from app.models.card_type import CardType
        from app.services.permission_service import PermissionService
        from tests.conftest import create_relation

        ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
        env["app"].subtype = "restricted"
        ct.role_permissions = {
            "finance": {"inventory.view": {"value": False, "subtypes": ["restricted"]}}
        }
        allowed = await create_card(
            db, card_type="Application", name="Allowed", attributes={"costTotalAnnual": 70}
        )
        await create_relation(
            db, type_key="relAppToBC", source_id=allowed.id, target_id=env["cap"].id
        )
        await db.flush()
        PermissionService.invalidate_type_permission_cache()
        response = await client.get(
            "/api/v1/reports/capability-heatmap?metric=total_cost",
            headers=auth_headers(env["finance"]),
        )
        assert response.status_code == 200, response.text
        [item] = response.json()["items"]
        assert item["total_cost"] == 70
        apps = {app["name"]: app for app in item["apps"]}
        assert apps["Allowed"]["attributes"]["costTotalAnnual"] == 70
        assert "costTotalAnnual" not in apps["Billing"]["attributes"]
