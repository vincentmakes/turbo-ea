"""A PPM change on an Initiative re-runs its ancestors' calculations (#1254).

The portfolio deliberately rolls nothing up; a calculated field is the way to
total PPM figures on a parent — the same formula on every level, each level
reading what its children hold. That only stays fresh if a PPM edit on a child
re-runs every Initiative above it, nearest parent first, in the same request.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.calculation import Calculation
from app.models.card import Card
from app.models.event import Event
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)

BASE = "/api/v1/ppm"

SCHEMA = [
    {
        "section": "Roll-up",
        "fields": [
            {"key": "rolledUpBudget", "label": "Rolled-up budget", "type": "cost", "weight": 0},
            {"key": "taskTotal", "label": "Tasks below", "type": "number", "weight": 0},
        ],
    }
]


@pytest.fixture
async def chain(db):
    """Program → Project → Workstream, plus an unrelated Initiative and a viewer."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions={"ppm.view": True})
    await create_card_type(
        db, key="Initiative", label="Initiative", fields_schema=SCHEMA, has_hierarchy=True
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    root = await create_card(db, card_type="Initiative", name="Program")
    mid = await create_card(db, card_type="Initiative", name="Project", parent_id=root.id)
    leaf = await create_card(db, card_type="Initiative", name="Workstream", parent_id=mid.id)
    other = await create_card(db, card_type="Initiative", name="Elsewhere")
    db.add_all(
        [
            Calculation(
                name="Rolled-up budget",
                formula='ppm.totalBudget + SUM(PLUCK(children, "attributes.rolledUpBudget"))',
                target_type_key="Initiative",
                target_field_key="rolledUpBudget",
                is_active=True,
            ),
            Calculation(
                name="Tasks below",
                formula='ppm.taskCount + SUM(PLUCK(children, "attributes.taskTotal"))',
                target_type_key="Initiative",
                target_field_key="taskTotal",
                is_active=True,
                execution_order=1,
            ),
        ]
    )
    await db.commit()
    return {
        "root": root.id,
        "mid": mid.id,
        "leaf": leaf.id,
        "other": other.id,
        "admin": auth_headers(admin),
        "viewer": auth_headers(viewer),
    }


async def _attrs(db, card_id) -> dict:
    db.expire_all()
    card = (await db.execute(select(Card).where(Card.id == card_id))).scalar_one()
    return dict(card.attributes or {})


async def _rollups(db, card_id) -> list[Event]:
    rows = (
        (
            await db.execute(
                select(Event).where(Event.card_id == card_id, Event.event_type == "card.updated")
            )
        )
        .scalars()
        .all()
    )
    return [e for e in rows if (e.data or {}).get("source") in ("ppm_rollup", "ppm_cost_rollup")]


async def _add_budget(client, card_id, headers, amount=100.0):
    return await client.post(
        f"{BASE}/initiatives/{card_id}/budgets",
        json={"fiscal_year": 2026, "category": "capex", "amount": amount},
        headers=headers,
    )


class TestCostSync:
    async def test_budget_on_the_leaf_reaches_every_ancestor(self, client, db, chain):
        resp = await _add_budget(client, chain["leaf"], chain["admin"], 100.0)
        assert resp.status_code == 200

        assert (await _attrs(db, chain["leaf"]))["rolledUpBudget"] == 100.0
        assert (await _attrs(db, chain["mid"]))["rolledUpBudget"] == 100.0
        assert (await _attrs(db, chain["root"]))["rolledUpBudget"] == 100.0
        # An Initiative outside the chain is not touched.
        assert "rolledUpBudget" not in await _attrs(db, chain["other"])

    async def test_each_level_adds_its_own_budget(self, client, db, chain):
        await _add_budget(client, chain["mid"], chain["admin"], 40.0)
        await _add_budget(client, chain["leaf"], chain["admin"], 100.0)

        assert (await _attrs(db, chain["leaf"]))["rolledUpBudget"] == 100.0
        assert (await _attrs(db, chain["mid"]))["rolledUpBudget"] == 140.0
        assert (await _attrs(db, chain["root"]))["rolledUpBudget"] == 140.0

    async def test_each_moved_ancestor_records_one_history_entry(self, client, db, chain):
        await _add_budget(client, chain["leaf"], chain["admin"], 100.0)

        for key in ("mid", "root"):
            events = await _rollups(db, chain[key])
            assert len(events) == 1, key
            assert events[0].data["source"] == "ppm_rollup"
            change = events[0].data["changes"]["attributes"]
            assert change["new"]["rolledUpBudget"] == 100.0
            assert "rolledUpBudget" not in change["old"]
        assert len(await _rollups(db, chain["leaf"])) == 1
        assert await _rollups(db, chain["other"]) == []

    async def test_a_denied_write_refreshes_nothing(self, client, db, chain):
        resp = await _add_budget(client, chain["leaf"], chain["viewer"], 100.0)
        assert resp.status_code == 403
        assert "rolledUpBudget" not in await _attrs(db, chain["root"])
        assert await _rollups(db, chain["root"]) == []

    async def test_a_rejected_write_refreshes_nothing(self, client, db, chain):
        resp = await client.post(
            f"{BASE}/initiatives/{chain['leaf']}/budgets",
            json={"fiscal_year": 2026, "category": "not-a-category", "amount": 100.0},
            headers=chain["admin"],
        )
        assert resp.status_code == 422
        assert await _rollups(db, chain["root"]) == []


class TestDerivedRefresh:
    async def test_a_task_on_the_leaf_reaches_every_ancestor(self, client, db, chain):
        resp = await client.post(
            f"{BASE}/initiatives/{chain['leaf']}/tasks",
            json={"title": "Design review"},
            headers=chain["admin"],
        )
        assert resp.status_code == 200

        assert (await _attrs(db, chain["leaf"]))["taskTotal"] == 1
        assert (await _attrs(db, chain["mid"]))["taskTotal"] == 1
        assert (await _attrs(db, chain["root"]))["taskTotal"] == 1

    async def test_an_ancestor_that_did_not_move_records_nothing(self, client, db, chain):
        resp = await client.post(
            f"{BASE}/initiatives/{chain['leaf']}/tasks",
            json={"title": "Design review"},
            headers=chain["admin"],
        )
        task_id = resp.json()["id"]
        before = {k: len(await _rollups(db, chain[k])) for k in ("mid", "root")}
        assert before == {"mid": 1, "root": 1}

        # A rename moves no figure anywhere in the chain.
        resp = await client.patch(
            f"{BASE}/tasks/{task_id}", json={"title": "Renamed"}, headers=chain["admin"]
        )
        assert resp.status_code == 200
        after = {k: len(await _rollups(db, chain[k])) for k in ("mid", "root")}
        assert after == before
        assert (await _attrs(db, chain["root"]))["taskTotal"] == 1
