"""The filter pipeline behind ``GET /risks`` and ``GET /risks/metrics``:
category, level (the residual assessment wins), owner, source, overdue,
card type, ``sort_by=level``, paging — and the metrics following the same
filters so the tiles always match the grid.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest

from app.core.permissions import MEMBER_PERMISSIONS
from app.services.risk_service import link_cards
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_risk,
    create_role,
    create_user,
)

RISKS = "/api/v1/risks"
TOMORROW = date.today() + timedelta(days=1)
YESTERDAY = date.today() - timedelta(days=1)


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    owner = await create_user(db, email="owner@test.com", role="member")
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="ITComponent", label="IT Component")
    app = await create_card(db, card_type="Application", name="App", user_id=admin.id)
    itc = await create_card(db, card_type="ITComponent", name="Comp", user_id=admin.id)

    sec = await create_risk(
        db,
        title="Security hole",
        category="security",
        initial_probability="very_high",
        initial_impact="critical",
        owner_id=owner.id,
        target_resolution_date=YESTERDAY,
        source_type="manual",
    )
    ops = await create_risk(
        db,
        title="Ops drift",
        category="operational",
        initial_probability="high",
        initial_impact="high",
        residual_probability="low",
        residual_impact="low",
        target_resolution_date=YESTERDAY,
        status="mitigated",
        source_type="compliance",
        source_ref="gdpr",
    )
    comp = await create_risk(
        db,
        title="Compliance gap",
        category="compliance",
        initial_probability="medium",
        initial_impact="medium",
        target_resolution_date=TOMORROW,
        status="analysed",
        source_type="extension",
        source_ref="acme:1",
    )
    await link_cards(db, sec.id, [app.id])
    await link_cards(db, ops.id, [itc.id])
    await link_cards(db, comp.id, [app.id, itc.id])
    return {"admin": admin, "owner": owner, "sec": sec, "ops": ops, "comp": comp}


async def _titles(client, user, query: str) -> list[str]:
    resp = await client.get(f"{RISKS}?{query}", headers=auth_headers(user))
    assert resp.status_code == 200, resp.text
    return [r["title"] for r in resp.json()["items"]]


class TestFilters:
    async def test_category(self, client, db, env):
        assert await _titles(client, env["admin"], "category=security") == ["Security hole"]
        assert set(
            await _titles(client, env["admin"], "category=security&category=compliance")
        ) == {
            "Security hole",
            "Compliance gap",
        }

    async def test_level_uses_the_residual_assessment_when_set(self, client, db, env):
        # Ops drift is initially high but residually low.
        assert await _titles(client, env["admin"], "level=low") == ["Ops drift"]
        assert await _titles(client, env["admin"], "level=high") == []
        assert await _titles(client, env["admin"], "level=critical") == ["Security hole"]

    async def test_owner(self, client, db, env):
        assert await _titles(client, env["admin"], f"owner_id={env['owner'].id}") == [
            "Security hole"
        ]
        resp = await client.get(f"{RISKS}?owner_id=nobody", headers=auth_headers(env["admin"]))
        assert resp.status_code == 400 and resp.json()["detail"] == "Invalid owner_id"

    async def test_source_type(self, client, db, env):
        assert await _titles(client, env["admin"], "source_type=extension") == ["Compliance gap"]
        assert set(
            await _titles(client, env["admin"], "source_type=compliance&source_type=manual")
        ) == {"Security hole", "Ops drift"}

    async def test_overdue_ignores_resolved_risks(self, client, db, env):
        # Ops drift is past due but mitigated; Compliance gap is due tomorrow.
        assert await _titles(client, env["admin"], "overdue=true") == ["Security hole"]

    async def test_card_type(self, client, db, env):
        assert set(await _titles(client, env["admin"], "card_type=ITComponent")) == {
            "Ops drift",
            "Compliance gap",
        }
        assert await _titles(client, env["admin"], "card_type=Nope") == []

    async def test_unknown_filter_values_match_nothing(self, client, db, env):
        assert await _titles(client, env["admin"], "status=closed") == []


class TestSortingAndPaging:
    async def test_sort_by_level(self, client, db, env):
        asc = await _titles(client, env["admin"], "sort_by=level&sort_dir=asc")
        assert asc == ["Security hole", "Compliance gap", "Ops drift"]
        desc = await _titles(client, env["admin"], "sort_by=level&sort_dir=desc")
        assert desc == list(reversed(asc))

    async def test_sort_by_reference(self, client, db, env):
        asc = await _titles(client, env["admin"], "sort_by=reference&sort_dir=asc")
        assert asc == ["Security hole", "Ops drift", "Compliance gap"]

    async def test_paging(self, client, db, env):
        resp = await client.get(
            f"{RISKS}?sort_by=reference&sort_dir=asc&page=2&page_size=2",
            headers=auth_headers(env["admin"]),
        )
        body = resp.json()
        assert body["total"] == 3 and body["page"] == 2 and body["page_size"] == 2
        assert [r["title"] for r in body["items"]] == ["Compliance gap"]


class TestMetrics:
    async def test_metrics_follow_the_filters(self, client, db, env):
        resp = await client.get(f"{RISKS}/metrics", headers=auth_headers(env["admin"]))
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 3 and body["overdue"] == 1
        assert body["by_category"] == {"security": 1, "operational": 1, "compliance": 1}

        filtered = (
            await client.get(
                f"{RISKS}/metrics?category=security&overdue=true",
                headers=auth_headers(env["admin"]),
            )
        ).json()
        assert filtered["total"] == 1
        assert filtered["by_level"] == {"critical": 1, "high": 0, "medium": 0, "low": 0}

    async def test_metrics_reject_a_malformed_owner(self, client, db, env):
        resp = await client.get(
            f"{RISKS}/metrics?owner_id={uuid.uuid4()}x", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 400
