"""Integration tests for ``GET /ppm/initiatives/{id}/rollup`` (Overview tab line)."""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_budget_line,
    create_card,
    create_card_type,
    create_cost_line,
    create_role,
    create_stakeholder_role_def,
    create_user,
)


def _url(card) -> str:
    return f"/api/v1/ppm/initiatives/{card.id}/rollup"


async def _lines(db, card, *, capex=0.0, opex=0.0, capex_actual=0.0, opex_actual=0.0):
    await create_budget_line(db, initiative_id=card.id, category="capex", amount=capex)
    await create_budget_line(db, initiative_id=card.id, category="opex", amount=opex)
    await create_cost_line(db, initiative_id=card.id, category="capex", actual=capex_actual)
    await create_cost_line(db, initiative_id=card.id, category="opex", actual=opex_actual)


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="nobody", label="Nobody", permissions={"inventory.view": True})
    await create_card_type(db, key="Initiative", label="Initiative")
    await create_card_type(db, key="Application", label="Application")
    return {
        "admin": await create_user(db, email="admin@test.com", role="admin"),
        "member": await create_user(db, email="member@test.com", role="member"),
        "nobody": await create_user(db, email="nobody@test.com", role="nobody"),
    }


async def _deny_initiative_view_to_members(db):
    from app.models.card_type import CardType
    from app.services.permission_service import PermissionService

    ct = (await db.execute(select(CardType).where(CardType.key == "Initiative"))).scalar_one()
    ct.role_permissions = {"member": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()


class TestRollupEndpoint:
    async def test_requires_ppm_view(self, client, db, env):
        card = await create_card(db, card_type="Initiative", name="Root")
        resp = await client.get(_url(card), headers=auth_headers(env["nobody"]))
        assert resp.status_code == 403

    async def test_unknown_initiative_is_404(self, client, db, env):
        app = await create_card(db, card_type="Application", name="Not an initiative")
        resp = await client.get(_url(app), headers=auth_headers(env["admin"]))
        assert resp.status_code == 404

    async def test_hidden_initiative_is_404(self, client, db, env):
        card = await create_card(db, card_type="Initiative", name="Secret")
        await _deny_initiative_view_to_members(db)
        resp = await client.get(_url(card), headers=auth_headers(env["member"]))
        assert resp.status_code == 404

    async def test_sums_and_span_over_three_levels_without_the_root(self, client, db, env):
        root = await create_card(
            db,
            card_type="Initiative",
            name="Root",
            attributes={"startDate": "2000-01-01", "endDate": "2099-12-31"},
        )
        await _lines(db, root, capex=9999, opex=9999, capex_actual=9999, opex_actual=9999)
        mid = await create_card(
            db,
            card_type="Initiative",
            name="Mid",
            parent_id=root.id,
            attributes={"startDate": "2026-03-01", "endDate": "2026-12-31"},
        )
        leaf = await create_card(
            db,
            card_type="Initiative",
            name="Leaf",
            parent_id=mid.id,
            attributes={"startDate": "2026-01-15", "endDate": "2027-06-30"},
        )
        await _lines(db, mid, capex=100, opex=10, capex_actual=40, opex_actual=4)
        await _lines(db, leaf, capex=200, opex=20, capex_actual=60, opex_actual=6)

        resp = await client.get(_url(root), headers=auth_headers(env["admin"]))
        assert resp.status_code == 200
        assert resp.json() == {
            "descendant_count": 2,
            "capex_planned": 300,
            "capex_actual": 100,
            "opex_planned": 30,
            "opex_actual": 10,
            "total_planned": 330,
            "total_actual": 110,
            "start_date": "2026-01-15",
            "end_date": "2027-06-30",
            "has_budget_lines": True,
            "has_cost_lines": True,
            "by_year": [
                {
                    "year": 2025,
                    "capex_budget": 300,
                    "opex_budget": 30,
                    "capex_actual": 0,
                    "opex_actual": 0,
                },
                {
                    "year": None,
                    "capex_budget": 0,
                    "opex_budget": 0,
                    "capex_actual": 100,
                    "opex_actual": 10,
                },
            ],
        }

        mid_resp = (await client.get(_url(mid), headers=auth_headers(env["admin"]))).json()
        assert mid_resp["descendant_count"] == 1
        assert mid_resp["total_planned"] == 220
        assert mid_resp["start_date"] == "2026-01-15"

    async def test_archived_descendant_and_its_subtree_excluded(self, client, db, env):
        root = await create_card(db, card_type="Initiative", name="Root")
        live = await create_card(db, card_type="Initiative", name="Live", parent_id=root.id)
        gone = await create_card(
            db, card_type="Initiative", name="Gone", parent_id=root.id, status="ARCHIVED"
        )
        under_gone = await create_card(
            db,
            card_type="Initiative",
            name="Under gone",
            parent_id=gone.id,
            attributes={"startDate": "2020-01-01"},
        )
        await _lines(db, live, capex=10)
        await _lines(db, gone, capex=500)
        await _lines(db, under_gone, capex=700)

        body = (await client.get(_url(root), headers=auth_headers(env["admin"]))).json()
        assert body["descendant_count"] == 1
        assert body["capex_planned"] == 10
        assert body["start_date"] is None

    async def test_hidden_descendant_breaks_the_chain(self, client, db, env):
        member = env["member"]
        await create_stakeholder_role_def(
            db, card_type_key="Initiative", key="responsible", permissions={"card.view": True}
        )
        from app.models.stakeholder import Stakeholder

        root = await create_card(db, card_type="Initiative", name="Root")
        seen = await create_card(db, card_type="Initiative", name="Seen", parent_id=root.id)
        hidden = await create_card(db, card_type="Initiative", name="Hidden", parent_id=root.id)
        # Visible itself, but only reachable through the hidden one.
        below = await create_card(db, card_type="Initiative", name="Below", parent_id=hidden.id)
        await _lines(db, seen, capex=10, capex_actual=1)
        await _lines(db, hidden, capex=500)
        await _lines(db, below, capex=700)
        for card in (root, seen, below):
            db.add(Stakeholder(card_id=card.id, user_id=member.id, role="responsible"))
        await _deny_initiative_view_to_members(db)

        body = (await client.get(_url(root), headers=auth_headers(member))).json()
        assert body["descendant_count"] == 1
        assert body["capex_planned"] == 10
        assert body["capex_actual"] == 1
        assert body["total_planned"] == 10

        admin_body = (await client.get(_url(root), headers=auth_headers(env["admin"]))).json()
        assert admin_body["descendant_count"] == 3
        assert admin_body["capex_planned"] == 1210

    async def test_no_descendants(self, client, db, env):
        root = await create_card(
            db, card_type="Initiative", name="Root", attributes={"startDate": "2026-01-01"}
        )
        await _lines(db, root, capex=50)
        body = (await client.get(_url(root), headers=auth_headers(env["admin"]))).json()
        assert body == {
            "descendant_count": 0,
            "capex_planned": 0,
            "capex_actual": 0,
            "opex_planned": 0,
            "opex_actual": 0,
            "total_planned": 0,
            "total_actual": 0,
            "start_date": None,
            "end_date": None,
            "has_budget_lines": True,
            "has_cost_lines": True,
            "by_year": [],
        }

    async def test_non_initiative_child_ignored(self, client, db, env):
        root = await create_card(db, card_type="Initiative", name="Root")
        await create_card(
            db,
            card_type="Application",
            name="Odd child",
            parent_id=root.id,
            attributes={"startDate": "2020-01-01", "endDate": "2030-01-01"},
        )
        body = (await client.get(_url(root), headers=auth_headers(env["admin"]))).json()
        assert body["descendant_count"] == 0
        assert body["start_date"] is None


class TestRollupPerSide:
    async def test_presence_of_a_root_with_budget_lines_only(self, client, db, env):
        root = await create_card(db, card_type="Initiative", name="Root")
        await create_budget_line(db, initiative_id=root.id, category="capex", amount=0)
        child = await create_card(db, card_type="Initiative", name="Child", parent_id=root.id)
        await create_cost_line(db, initiative_id=child.id, category="opex", actual=3)
        body = (await client.get(_url(root), headers=auth_headers(env["admin"]))).json()
        assert body["has_budget_lines"] is True
        assert body["has_cost_lines"] is False
        # The child's own presence is not the root's.
        child_body = (await client.get(_url(child), headers=auth_headers(env["admin"]))).json()
        assert child_body["has_budget_lines"] is False
        assert child_body["has_cost_lines"] is True

    async def test_presence_of_a_root_with_cost_lines_only(self, client, db, env):
        root = await create_card(db, card_type="Initiative", name="Root")
        await create_cost_line(db, initiative_id=root.id, category="capex", actual=0)
        body = (await client.get(_url(root), headers=auth_headers(env["admin"]))).json()
        assert body["has_budget_lines"] is False
        assert body["has_cost_lines"] is True

    async def test_by_year_sums_three_levels_with_mixed_fiscal_years(self, client, db, env):
        root = await create_card(db, card_type="Initiative", name="Root")
        # The root's own lines never land in its by_year.
        await create_budget_line(
            db, initiative_id=root.id, fiscal_year=2026, category="capex", amount=9999
        )
        mid = await create_card(db, card_type="Initiative", name="Mid", parent_id=root.id)
        leaf = await create_card(db, card_type="Initiative", name="Leaf", parent_id=mid.id)
        await create_budget_line(
            db, initiative_id=mid.id, fiscal_year=2026, category="capex", amount=100
        )
        await create_budget_line(
            db, initiative_id=leaf.id, fiscal_year=2026, category="opex", amount=20
        )
        await create_budget_line(
            db, initiative_id=leaf.id, fiscal_year=2024, category="capex", amount=5
        )
        await create_cost_line(
            db, initiative_id=mid.id, category="capex", actual=40, date=date(2026, 3, 1)
        )
        await create_cost_line(
            db, initiative_id=leaf.id, category="opex", actual=6, date=date(2027, 2, 1)
        )
        await create_cost_line(db, initiative_id=leaf.id, category="opex", actual=8, date=None)

        body = (await client.get(_url(root), headers=auth_headers(env["admin"]))).json()
        assert body["by_year"] == [
            {
                "year": 2024,
                "capex_budget": 5,
                "opex_budget": 0,
                "capex_actual": 0,
                "opex_actual": 0,
            },
            {
                "year": 2026,
                "capex_budget": 100,
                "opex_budget": 20,
                "capex_actual": 40,
                "opex_actual": 0,
            },
            {
                "year": 2027,
                "capex_budget": 0,
                "opex_budget": 0,
                "capex_actual": 0,
                "opex_actual": 6,
            },
            {
                "year": None,
                "capex_budget": 0,
                "opex_budget": 0,
                "capex_actual": 0,
                "opex_actual": 8,
            },
        ]

    async def test_fiscal_year_start_moves_a_cost_line_into_the_next_year(self, client, db, env):
        from app.models.app_settings import AppSettings

        await db.merge(AppSettings(id="default", general_settings={"fiscalYearStart": 10}))
        await db.flush()
        root = await create_card(db, card_type="Initiative", name="Root")
        child = await create_card(db, card_type="Initiative", name="Child", parent_id=root.id)
        await create_cost_line(
            db, initiative_id=child.id, category="capex", actual=7, date=date(2025, 11, 1)
        )
        body = (await client.get(_url(root), headers=auth_headers(env["admin"]))).json()
        assert [(y["year"], y["capex_actual"]) for y in body["by_year"]] == [(2026, 7)]

    async def test_archived_and_hidden_descendants_stay_out_of_by_year(self, client, db, env):
        member = env["member"]
        await create_stakeholder_role_def(
            db, card_type_key="Initiative", key="responsible", permissions={"card.view": True}
        )
        from app.models.stakeholder import Stakeholder

        root = await create_card(db, card_type="Initiative", name="Root")
        seen = await create_card(db, card_type="Initiative", name="Seen", parent_id=root.id)
        hidden = await create_card(db, card_type="Initiative", name="Hidden", parent_id=root.id)
        gone = await create_card(
            db, card_type="Initiative", name="Gone", parent_id=root.id, status="ARCHIVED"
        )
        for card, amount in ((seen, 10), (hidden, 500), (gone, 700)):
            await create_budget_line(
                db, initiative_id=card.id, fiscal_year=2026, category="capex", amount=amount
            )
        for card in (root, seen):
            db.add(Stakeholder(card_id=card.id, user_id=member.id, role="responsible"))
        await _deny_initiative_view_to_members(db)

        body = (await client.get(_url(root), headers=auth_headers(member))).json()
        assert [(y["year"], y["capex_budget"]) for y in body["by_year"]] == [(2026, 10)]
        admin_body = (await client.get(_url(root), headers=auth_headers(env["admin"]))).json()
        assert [(y["year"], y["capex_budget"]) for y in admin_body["by_year"]] == [(2026, 510)]
