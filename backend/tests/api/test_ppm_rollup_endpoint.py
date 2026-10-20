"""Integration tests for ``GET /ppm/initiatives/{id}/rollup`` (Overview tab line)."""

from __future__ import annotations

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
