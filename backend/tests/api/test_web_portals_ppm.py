"""Integration tests for the account-less PPM portfolio portal.

The load-bearing assertions here are the negative ones: no email addresses and no
identifiers beyond the initiative's own may reach an anonymous visitor, whatever
the portal's display toggles say.
"""

from __future__ import annotations

import json
import re
from datetime import date

import pytest
from sqlalchemy import select

from app.models.app_settings import AppSettings
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

PUBLIC = "/api/v1/web-portals/public/board/ppm/portfolio"

# Any 8-4 hex prefix — catches a raw UUID wherever it appears in the payload.
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-", re.IGNORECASE)


async def _set_ppm_enabled(db, enabled: bool = True):
    row = (
        await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    ).scalar_one_or_none()
    if row is None:
        db.add(AppSettings(id="default", general_settings={"ppmEnabled": enabled}))
    else:
        row.general_settings = {**(row.general_settings or {}), "ppmEnabled": enabled}
    await db.flush()


async def _add_report(db, initiative, reporter, **kwargs):
    from app.models.ppm_status_report import PpmStatusReport

    report = PpmStatusReport(
        initiative_id=initiative.id,
        reporter_id=reporter.id if reporter else None,
        report_date=kwargs.get("report_date", date(2026, 2, 1)),
        schedule_health=kwargs.get("schedule_health", "atRisk"),
        cost_health=kwargs.get("cost_health", "onTrack"),
        scope_health=kwargs.get("scope_health", "onTrack"),
        summary=kwargs.get("summary", "Internal summary naming a customer"),
        accomplishments=kwargs.get("accomplishments", "Shipped phase one"),
        next_steps=kwargs.get("next_steps", "Begin phase two"),
    )
    db.add(report)
    await db.flush()
    return report


async def _add_stakeholder(db, card, user, role="itProjectManager"):
    from app.models.stakeholder import Stakeholder

    sh = Stakeholder(card_id=card.id, user_id=user.id, role=role)
    db.add(sh)
    await db.flush()
    return sh


async def _add_budget_and_cost(db, initiative, *, planned=1000.0, actual=250.0):
    from app.models.ppm_cost_line import PpmBudgetLine, PpmCostLine

    db.add(
        PpmBudgetLine(
            initiative_id=initiative.id, category="capex", amount=planned, fiscal_year=2026
        )
    )
    db.add(
        PpmCostLine(
            initiative_id=initiative.id,
            category="capex",
            description="Licences",
            planned=planned,
            actual=actual,
        )
    )
    await db.flush()


@pytest.fixture
async def ppm_portal_env(db, client):
    """An admin, a published portfolio portal, and one initiative with full data."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_card_type(db, key="Initiative", label="Initiative")
    await _set_ppm_enabled(db, True)
    admin = await create_user(db, email="admin@test.com", role="admin")

    # A user with a blank display name. `users.display_name` is NOT NULL, so an
    # empty string is the real shape this happens in — and it is exactly what
    # makes the internal `display_name or email` fallback fire. The public
    # payload must never fall back to the address.
    nameless = await create_user(db, email="nameless.pm@company.com", role="admin", display_name="")

    initiative = await create_card(
        db,
        card_type="Initiative",
        name="ERP Replacement",
        subtype="Project",
        attributes={
            "startDate": "2026-01-01",
            "endDate": "2026-12-31",
            "initiativeStatus": "In Progress",
            # Cost-typed card attributes — always stripped on a public portal.
            "costBudget": 999999,
            "costActual": 424242,
        },
    )
    await _add_stakeholder(db, initiative, nameless)
    await _add_report(db, initiative, nameless)
    await _add_budget_and_cost(db, initiative)

    resp = await client.post(
        "/api/v1/web-portals",
        json={
            "name": "Portfolio",
            "slug": "board",
            "card_type": "Initiative",
            "view": "ppm_portfolio",
            "is_published": True,
        },
        headers=auth_headers(admin),
    )
    assert resp.status_code == 201, resp.text
    return {"admin": admin, "portal_id": resp.json()["id"], "initiative": initiative}


async def _set_toggles(client, admin, portal_id, **toggles):
    resp = await client.patch(
        f"/api/v1/web-portals/{portal_id}",
        json={"card_config": {"ppm": toggles}},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200, resp.text


class TestPortalTypeAdmin:
    async def test_default_view_is_cards(self, client, db, ppm_portal_env):
        resp = await client.post(
            "/api/v1/web-portals",
            json={"name": "Cat", "slug": "cat", "card_type": "Initiative"},
            headers=auth_headers(ppm_portal_env["admin"]),
        )
        assert resp.status_code == 201
        assert resp.json()["view"] == "cards"

    async def test_invalid_view_rejected(self, client, db, ppm_portal_env):
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Bad",
                "slug": "bad",
                "card_type": "Initiative",
                "view": "not-a-view",
            },
            headers=auth_headers(ppm_portal_env["admin"]),
        )
        assert resp.status_code == 400

    async def test_portfolio_view_pins_card_type(self, client, db, ppm_portal_env):
        await create_card_type(db, key="Application", label="Application")
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Pinned",
                "slug": "pinned",
                "card_type": "Application",
                "view": "ppm_portfolio",
            },
            headers=auth_headers(ppm_portal_env["admin"]),
        )
        assert resp.status_code == 201
        assert resp.json()["card_type"] == "Initiative"

    async def test_portfolio_view_requires_ppm_enabled(self, client, db, ppm_portal_env):
        await _set_ppm_enabled(db, False)
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Off",
                "slug": "off",
                "card_type": "Initiative",
                "view": "ppm_portfolio",
            },
            headers=auth_headers(ppm_portal_env["admin"]),
        )
        assert resp.status_code == 400

    async def test_patch_cannot_repoint_a_portfolio_portal(self, client, db, ppm_portal_env):
        await create_card_type(db, key="Application", label="Application")
        resp = await client.patch(
            f"/api/v1/web-portals/{ppm_portal_env['portal_id']}",
            json={"card_type": "Application"},
            headers=auth_headers(ppm_portal_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["card_type"] == "Initiative"


class TestPublicPortfolioPayload:
    async def test_serves_the_board_cookieless(self, client, db, ppm_portal_env):
        resp = await client.get(PUBLIC)
        assert resp.status_code == 200
        body = resp.json()
        assert body["dashboard"]["total_initiatives"] == 1
        assert [i["name"] for i in body["items"]] == ["ERP Replacement"]
        assert body["items"][0]["latest_report"]["schedule_health"] == "atRisk"

    async def test_never_leaks_an_email_with_people_on(self, client, db, ppm_portal_env):
        """The internal shapes fall back to a user's email when they have no
        display name. That fallback must never survive into a public payload."""
        await _set_toggles(
            client, ppm_portal_env["admin"], ppm_portal_env["portal_id"], show_people=True
        )
        body = (await client.get(PUBLIC)).json()
        raw = json.dumps(body)
        assert "@" not in raw
        assert "nameless.pm" not in raw
        # The unnamed user is omitted entirely rather than identified by address.
        assert body["items"][0]["stakeholders"] == []
        assert body["items"][0]["latest_report"]["reporter"] is None

    async def test_never_leaks_an_email_with_people_off(self, client, db, ppm_portal_env):
        body = (await client.get(PUBLIC)).json()
        assert "@" not in json.dumps(body)

    async def test_named_person_shown_only_when_people_enabled(self, client, db, ppm_portal_env):
        named = await create_user(
            db, email="pm@company.com", role="admin", display_name="Dana Fischer"
        )
        await _add_stakeholder(db, ppm_portal_env["initiative"], named, role="responsible")

        off = (await client.get(PUBLIC)).json()
        assert off["items"][0]["stakeholders"] == []

        await _set_toggles(
            client, ppm_portal_env["admin"], ppm_portal_env["portal_id"], show_people=True
        )
        on = (await client.get(PUBLIC)).json()
        assert [p["display_name"] for p in on["items"][0]["stakeholders"]] == ["Dana Fischer"]
        assert "@" not in json.dumps(on)

    async def test_only_board_roles_are_published(self, client, db, ppm_portal_env):
        other = await create_user(db, email="obs@company.com", role="admin", display_name="Obs")
        await _add_stakeholder(db, ppm_portal_env["initiative"], other, role="observer")
        await _set_toggles(
            client, ppm_portal_env["admin"], ppm_portal_env["portal_id"], show_people=True
        )
        body = (await client.get(PUBLIC)).json()
        assert "Obs" not in json.dumps(body)

    async def test_no_identifiers_beyond_the_initiative_id(self, client, db, ppm_portal_env):
        """The row id is a real card UUID (rows link to /ppm/{id} behind the
        login wall); nothing else in the payload may carry one."""
        await _set_toggles(
            client, ppm_portal_env["admin"], ppm_portal_env["portal_id"], show_people=True
        )
        # A child row, so `parent_id` carries a value rather than passing as null.
        await create_card(
            db,
            card_type="Initiative",
            name="ERP Phase 1",
            subtype="Project",
            parent_id=ppm_portal_env["initiative"].id,
        )
        body = (await client.get(PUBLIC)).json()

        item_ids = [i.pop("id") for i in body["items"]]
        assert str(ppm_portal_env["initiative"].id) in item_ids
        # A parent may only ever repeat the id of another row on this board.
        parents = [i.pop("parent_id") for i in body["items"]]
        assert [p for p in parents if p is not None] == [str(ppm_portal_env["initiative"].id)]
        assert set(parents) - {None} <= set(item_ids)
        assert not UUID_RE.search(json.dumps(body)), "a non-initiative identifier leaked"

    async def test_group_id_is_an_opaque_token(self, client, db, ppm_portal_env):
        from app.models.relation import Relation
        from app.models.relation_type import RelationType

        await create_card_type(db, key="Organization", label="Organization")
        db.add(
            RelationType(
                key="relOrgToInitiative",
                label="drives",
                reverse_label="driven by",
                source_type_key="Organization",
                target_type_key="Initiative",
            )
        )
        await db.flush()
        org = await create_card(db, card_type="Organization", name="Finance")
        db.add(
            Relation(
                type="relOrgToInitiative",
                source_id=org.id,
                target_id=ppm_portal_env["initiative"].id,
            )
        )
        await db.flush()

        body = (await client.get(f"{PUBLIC}?group_by=Organization")).json()
        item = body["items"][0]
        assert item["group_name"] == "Finance"
        assert item["group_id"] == "g0"
        assert str(org.id) not in json.dumps(body)


class TestPublicPortfolioSubtypeGroup:
    """``group_by=subtype:<key>`` on the public board: one anchor per opaque token."""

    @staticmethod
    async def _programs(db, under):
        program = await create_card(
            db, card_type="Initiative", name="Transformation", subtype="Program"
        )
        await create_card(
            db, card_type="Initiative", name="Phase 1", subtype="Project", parent_id=program.id
        )
        await create_card(
            db, card_type="Initiative", name="Phase 2", subtype="Project", parent_id=program.id
        )
        other = await create_card(db, card_type="Initiative", name="Upgrade", subtype="Program")
        await create_card(
            db, card_type="Initiative", name="Patch", subtype="Epic", parent_id=other.id
        )
        # A child of the fixture's standalone project: it has no program above.
        await create_card(
            db, card_type="Initiative", name="Loose", subtype="Epic", parent_id=under.id
        )
        return program, other

    async def test_one_anchor_per_token_shared_by_its_rows(self, client, db, ppm_portal_env):
        program, other = await self._programs(db, ppm_portal_env["initiative"])
        resp = await client.get(PUBLIC, params={"group_by": "subtype:Program"})
        assert resp.status_code == 200
        items = {i["name"]: i for i in resp.json()["items"]}

        anchors = {i["group_id"]: n for n, i in items.items() if i["group_anchor"]}
        assert sorted(anchors.values()) == ["Transformation", "Upgrade"]
        assert all(re.fullmatch(r"g\d+", token) for token in anchors)
        by_anchor = {n: items[n]["group_id"] for n in ("Transformation", "Upgrade")}
        for name in ("Phase 1", "Phase 2"):
            assert items[name]["group_id"] == by_anchor["Transformation"]
            assert items[name]["group_name"] == "Transformation"
            assert items[name]["group_anchor"] is False
        assert items["Patch"]["group_id"] == by_anchor["Upgrade"]
        for name in ("ERP Replacement", "Loose"):
            assert items[name]["group_id"] is None
            assert items[name]["group_anchor"] is False
        assert str(program.id) in {i["id"] for i in items.values()}
        assert resp.text.count(str(other.id)) == 2  # its own id and its child's parent_id

    async def test_no_identifiers_beyond_the_initiative_id(self, client, db, ppm_portal_env):
        await self._programs(db, ppm_portal_env["initiative"])
        body = (await client.get(PUBLIC, params={"group_by": "subtype:Program"})).json()
        item_ids = [i.pop("id") for i in body["items"]]
        parents = [i.pop("parent_id") for i in body["items"]]
        assert set(parents) - {None} <= set(item_ids)
        assert not UUID_RE.search(json.dumps(body)), "a non-initiative identifier leaked"

    async def test_a_portal_that_filters_programs_out_is_all_ungrouped(
        self, client, db, ppm_portal_env
    ):
        await self._programs(db, ppm_portal_env["initiative"])
        resp = await client.patch(
            f"/api/v1/web-portals/{ppm_portal_env['portal_id']}",
            json={"filters": {"subtypes": ["Project", "Epic"]}},
            headers=auth_headers(ppm_portal_env["admin"]),
        )
        assert resp.status_code == 200

        resp = await client.get(PUBLIC, params={"group_by": "subtype:Program"})
        items = resp.json()["items"]
        assert {i["name"] for i in items} == {
            "ERP Replacement",
            "Phase 1",
            "Phase 2",
            "Patch",
            "Loose",
        }
        assert all(i["group_id"] is None and not i["group_anchor"] for i in items)
        assert "Transformation" not in resp.text


class TestPublicPortfolioCosts:
    async def test_costs_shown_by_default(self, client, db, ppm_portal_env):
        body = (await client.get(PUBLIC)).json()
        assert body["items"][0]["capex_planned"] == 1000.0
        assert body["items"][0]["capex_actual"] == 250.0
        assert body["dashboard"]["total_budget"] == 1000.0

    async def test_costs_withheld_when_disabled(self, client, db, ppm_portal_env):
        await _set_toggles(
            client, ppm_portal_env["admin"], ppm_portal_env["portal_id"], show_costs=False
        )
        body = (await client.get(PUBLIC)).json()
        item = body["items"][0]
        assert item["capex_planned"] is None
        assert item["capex_actual"] is None
        assert item["opex_planned"] is None
        assert item["opex_actual"] is None
        assert body["dashboard"]["total_budget"] is None

    async def test_cost_typed_card_attributes_never_published(self, client, db, ppm_portal_env):
        """`costBudget` / `costActual` are `type: "cost"` metamodel fields, which
        public portals strip unconditionally — `show_costs` must not reach them."""
        await _set_toggles(
            client, ppm_portal_env["admin"], ppm_portal_env["portal_id"], show_costs=True
        )
        raw = json.dumps((await client.get(PUBLIC)).json())
        assert "999999" not in raw
        assert "424242" not in raw
        assert "cost_budget" not in raw
        assert "cost_actual" not in raw


class TestPublicPortfolioNarrative:
    async def test_narrative_shown_by_default(self, client, db, ppm_portal_env):
        report = (await client.get(PUBLIC)).json()["items"][0]["latest_report"]
        assert report["summary"] == "Internal summary naming a customer"
        assert report["accomplishments"] == "Shipped phase one"
        assert report["next_steps"] == "Begin phase two"

    async def test_narrative_withheld_when_disabled(self, client, db, ppm_portal_env):
        await _set_toggles(
            client,
            ppm_portal_env["admin"],
            ppm_portal_env["portal_id"],
            show_report_narrative=False,
        )
        body = (await client.get(PUBLIC)).json()
        report = body["items"][0]["latest_report"]
        assert report["summary"] is None
        assert report["accomplishments"] is None
        assert report["next_steps"] is None
        # The health dots and the date survive, so the hover overview still works.
        assert report["schedule_health"] == "atRisk"
        assert report["report_date"] == "2026-02-01"
        assert "naming a customer" not in json.dumps(body)


class TestPublicPortfolioScope:
    async def test_portal_subtype_filter_narrows_the_board(self, client, db, ppm_portal_env):
        await create_card(db, card_type="Initiative", name="Cloud Migration", subtype="Program")
        assert len((await client.get(PUBLIC)).json()["items"]) == 2

        resp = await client.patch(
            f"/api/v1/web-portals/{ppm_portal_env['portal_id']}",
            json={"filters": {"subtypes": ["Program"]}},
            headers=auth_headers(ppm_portal_env["admin"]),
        )
        assert resp.status_code == 200

        body = (await client.get(PUBLIC)).json()
        assert [i["name"] for i in body["items"]] == ["Cloud Migration"]
        assert body["dashboard"]["total_initiatives"] == 1

    async def test_parent_on_the_board_is_published(self, client, db, ppm_portal_env):
        parent = ppm_portal_env["initiative"]
        await create_card(
            db, card_type="Initiative", name="ERP Phase 1", subtype="Project", parent_id=parent.id
        )
        items = {i["name"]: i for i in (await client.get(PUBLIC)).json()["items"]}
        assert items["ERP Phase 1"]["parent_id"] == str(parent.id)
        assert items["ERP Replacement"]["parent_id"] is None

    async def test_parent_outside_the_portal_filter_is_null(self, client, db, ppm_portal_env):
        program = await create_card(
            db, card_type="Initiative", name="Transformation", subtype="Program"
        )
        await create_card(
            db, card_type="Initiative", name="ERP Phase 1", subtype="Project", parent_id=program.id
        )
        resp = await client.patch(
            f"/api/v1/web-portals/{ppm_portal_env['portal_id']}",
            json={"filters": {"subtypes": ["Project"]}},
            headers=auth_headers(ppm_portal_env["admin"]),
        )
        assert resp.status_code == 200

        resp = await client.get(PUBLIC)
        items = {i["name"]: i for i in resp.json()["items"]}
        assert set(items) == {"ERP Replacement", "ERP Phase 1"}
        assert items["ERP Phase 1"]["parent_id"] is None
        assert str(program.id) not in resp.text

    async def test_malformed_tag_filter_does_not_500(self, client, db, ppm_portal_env):
        resp = await client.patch(
            f"/api/v1/web-portals/{ppm_portal_env['portal_id']}",
            json={"filters": {"tag_ids": ["not-a-uuid"]}},
            headers=auth_headers(ppm_portal_env["admin"]),
        )
        assert resp.status_code == 200
        assert (await client.get(PUBLIC)).status_code == 200

    async def test_archived_initiatives_excluded(self, client, db, ppm_portal_env):
        await create_card(
            db, card_type="Initiative", name="Cancelled", subtype="Project", status="ARCHIVED"
        )
        body = (await client.get(PUBLIC)).json()
        assert [i["name"] for i in body["items"]] == ["ERP Replacement"]


class TestPublicPortfolioRollup:
    """A parent without lines or dates of its own publishes what is beneath it."""

    @staticmethod
    async def _program(db):
        program = await create_card(
            db, card_type="Initiative", name="Transformation", subtype="Program"
        )
        phase = await create_card(
            db,
            card_type="Initiative",
            name="ERP Phase 1",
            subtype="Project",
            parent_id=program.id,
            attributes={"startDate": "2026-02-01", "endDate": "2026-08-31"},
        )
        pilot = await create_card(
            db,
            card_type="Initiative",
            name="Pilot",
            subtype="Epic",
            parent_id=program.id,
            attributes={"startDate": "2025-06-01", "endDate": "2027-03-31"},
        )
        await _add_budget_and_cost(db, phase, planned=400.0, actual=100.0)
        await _add_budget_and_cost(db, pilot, planned=30.0, actual=3.0)
        return program

    async def test_costs_and_dates_published_with_costs_on(self, client, db, ppm_portal_env):
        await self._program(db)
        items = {i["name"]: i for i in (await client.get(PUBLIC)).json()["items"]}
        assert items["Transformation"]["rollup"] == {
            "descendant_count": 2,
            "capex_planned": 430.0,
            "capex_actual": 103.0,
            "opex_planned": 0.0,
            "opex_actual": 0.0,
            "start_date": "2025-06-01",
            "end_date": "2027-03-31",
        }
        assert items["Transformation"]["capex_planned"] == 0
        assert items["ERP Phase 1"]["rollup"] is None

    async def test_costs_withheld_dates_kept_with_costs_off(self, client, db, ppm_portal_env):
        await self._program(db)
        await _set_toggles(
            client, ppm_portal_env["admin"], ppm_portal_env["portal_id"], show_costs=False
        )
        items = {i["name"]: i for i in (await client.get(PUBLIC)).json()["items"]}
        assert items["Transformation"]["rollup"] == {
            "descendant_count": 2,
            "capex_planned": None,
            "capex_actual": None,
            "opex_planned": None,
            "opex_actual": None,
            "start_date": "2025-06-01",
            "end_date": "2027-03-31",
        }

    async def test_child_outside_the_portal_filter_adds_nothing(self, client, db, ppm_portal_env):
        await self._program(db)
        resp = await client.patch(
            f"/api/v1/web-portals/{ppm_portal_env['portal_id']}",
            json={"filters": {"subtypes": ["Program", "Project"]}},
            headers=auth_headers(ppm_portal_env["admin"]),
        )
        assert resp.status_code == 200
        items = {i["name"]: i for i in (await client.get(PUBLIC)).json()["items"]}
        assert "Pilot" not in items
        rollup = items["Transformation"]["rollup"]
        assert rollup["descendant_count"] == 1
        assert rollup["capex_planned"] == 400.0
        assert rollup["capex_actual"] == 100.0
        assert (rollup["start_date"], rollup["end_date"]) == ("2026-02-01", "2026-08-31")


class TestPublicPortfolioGuards:
    async def test_unpublished_portal_404s(self, client, db, ppm_portal_env):
        resp = await client.patch(
            f"/api/v1/web-portals/{ppm_portal_env['portal_id']}",
            json={"is_published": False},
            headers=auth_headers(ppm_portal_env["admin"]),
        )
        assert resp.status_code == 200
        assert (await client.get(PUBLIC)).status_code == 404

    async def test_disabling_ppm_takes_the_portal_dark(self, client, db, ppm_portal_env):
        """No need to unpublish: switching the module off is enough."""
        assert (await client.get(PUBLIC)).status_code == 200
        await _set_ppm_enabled(db, False)
        assert (await client.get(PUBLIC)).status_code == 404

    async def test_unknown_slug_404s(self, client, db, ppm_portal_env):
        resp = await client.get("/api/v1/web-portals/public/nope/ppm/portfolio")
        assert resp.status_code == 404


class TestGroupOptions:
    async def test_group_options_carry_the_metamodel_entity(self, client, db, ppm_portal_env):
        from app.models.relation_type import RelationType

        await create_card_type(
            db,
            key="Organization",
            label="Business Unit",
            icon="corporate_fare",
            color="#2889ff",
            translations={"de": {"label": "Geschäftsbereich"}},
        )
        db.add(
            RelationType(
                key="relOrgToInitiative",
                label="drives",
                reverse_label="driven by",
                source_type_key="Organization",
                target_type_key="Initiative",
            )
        )
        await db.flush()

        opts = (await client.get(PUBLIC)).json()["group_options"]
        org = next(o for o in opts if o["type_key"] == "Organization")
        # The human label, not the internal key — the client resolves the locale.
        assert org["label"] == "Business Unit"
        assert org["translations"] == {"de": {"label": "Geschäftsbereich"}}
        assert org["icon"] == "corporate_fare"


class TestQueryCount:
    async def test_payload_does_not_scale_queries_with_initiatives(
        self, client, db, ppm_portal_env, test_engine
    ):
        """The board's per-row reporter and stakeholder loads are batched.

        Both used to run inside the item loop, which put an unauthenticated
        endpoint one page-load away from N queries per initiative.
        """
        pm = await create_user(db, email="pm2@company.com", role="admin", display_name="PM Two")
        for n in range(20):
            card = await create_card(
                db, card_type="Initiative", name=f"Initiative {n}", subtype="Project"
            )
            await _add_stakeholder(db, card, pm)
            await _add_report(db, card, pm)

        resp, count = await _counted_get(client, test_engine, PUBLIC)
        assert resp.status_code == 200
        assert len(resp.json()["items"]) == 21
        # Comfortably above the handful the builder issues, far below 21×2.
        assert count < 25, f"query count {count} scales with initiatives"

    async def test_subtype_grouping_adds_no_query(self, client, db, ppm_portal_env, test_engine):
        """Grouping by a subtype is decided over the rows already loaded."""
        pm = await create_user(db, email="pm2@company.com", role="admin", display_name="PM Two")
        programs = []
        for n in range(5):
            programs.append(
                await create_card(
                    db, card_type="Initiative", name=f"Program {n}", subtype="Program"
                )
            )
        for n in range(20):
            card = await create_card(
                db,
                card_type="Initiative",
                name=f"Initiative {n}",
                subtype="Project",
                parent_id=programs[n % 5].id,
            )
            await _add_stakeholder(db, card, pm)
            await _add_report(db, card, pm)

        plain, plain_count = await _counted_get(client, test_engine, PUBLIC)
        grouped, grouped_count = await _counted_get(
            client, test_engine, f"{PUBLIC}?group_by=subtype:Program"
        )
        assert plain.status_code == grouped.status_code == 200
        assert len(grouped.json()["items"]) == 26
        assert sum(1 for i in grouped.json()["items"] if i["group_anchor"]) == 5
        assert grouped_count == plain_count
        assert grouped_count < 25, f"query count {grouped_count} scales with initiatives"


async def _counted_get(client, test_engine, url):
    """GET ``url`` and count the SQL statements it issued."""
    from sqlalchemy import event

    counter = {"n": 0}

    def _count(conn, cursor, statement, params, context, executemany):
        counter["n"] += 1

    event.listen(test_engine.sync_engine, "before_cursor_execute", _count)
    try:
        resp = await client.get(url)
    finally:
        event.remove(test_engine.sync_engine, "before_cursor_execute", _count)
    return resp, counter["n"]


class TestCardPortalUnaffected:
    async def test_cards_portal_still_serves_its_grid(self, client, db, ppm_portal_env):
        await create_card_type(db, key="Application", label="Application")
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Catalog",
                "slug": "catalog",
                "card_type": "Application",
                "is_published": True,
            },
            headers=auth_headers(ppm_portal_env["admin"]),
        )
        assert resp.status_code == 201
        assert resp.json()["view"] == "cards"

        meta = await client.get("/api/v1/web-portals/public/catalog")
        assert meta.status_code == 200
        assert meta.json()["view"] == "cards"
        assert (await client.get("/api/v1/web-portals/public/catalog/cards")).status_code == 200
