"""A PPM edit re-runs the Initiative's calculations (#1111).

Until 2.142.0 only budget and cost lines did; a calculated ``progress`` field
over ``ppm.completion`` went stale the moment a task was marked done, a work
package edited, a risk raised or a status report filed. Each mutation now
refreshes the card the way the cost sync always has — and, because the card
row changed on a user's behalf, records a ``card.updated`` event so History
and the Modified column agree (#995).
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
    create_task,
    create_user,
    create_wbs,
)

BASE = "/api/v1/ppm"

SCHEMA = [
    {
        "section": "Delivery",
        "fields": [
            {"key": "progress", "label": "Progress", "type": "percentage", "weight": 1},
            {"key": "health", "label": "Health", "type": "text", "weight": 1},
        ],
    }
]


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_card_type(db, key="Initiative", label="Initiative", fields_schema=SCHEMA)
    admin = await create_user(db, email="admin@test.com", role="admin")
    card = await create_card(db, card_type="Initiative", name="Rollout", user_id=admin.id)
    db.add(
        Calculation(
            name="Progress",
            formula="ppm.completion",
            target_type_key="Initiative",
            target_field_key="progress",
            is_active=True,
        )
    )
    await db.commit()
    # Plain values only: every request below commits through the shared
    # session and expires the ORM objects, and reading an expired attribute
    # from a test is sync IO (MissingGreenlet).
    return {"card_id": card.id, "init_id": str(card.id), "headers": auth_headers(admin)}


async def _progress(db, card_id) -> float | None:
    db.expire_all()
    card = (await db.execute(select(Card).where(Card.id == card_id))).scalar_one()
    return (card.attributes or {}).get("progress")


async def _rollup_events(db, card_id) -> list[Event]:
    rows = (await db.execute(select(Event).where(Event.card_id == card_id))).scalars().all()
    return [e for e in rows if (e.data or {}).get("source") == "ppm_rollup"]


class TestWorkPackages:
    async def test_create_and_patch_refresh_the_calculated_field(self, client, db, env):
        init_id = env["init_id"]
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json={"title": "Phase 1", "completion": 40},
            headers=env["headers"],
        )
        assert resp.status_code == 200
        assert await _progress(db, env["card_id"]) == 40.0

        await client.patch(
            f"{BASE}/wbs/{resp.json()['id']}",
            json={"completion": 90},
            headers=env["headers"],
        )
        assert await _progress(db, env["card_id"]) == 90.0

        events = await _rollup_events(db, env["card_id"])
        assert len(events) == 2
        assert events[-1].data["changes"]["attributes"]["new"]["progress"] == 90.0
        assert events[-1].data["changes"]["attributes"]["old"]["progress"] == 40.0

    async def test_delete_recomputes_without_the_package(self, client, db, env):
        init_id = env["init_id"]
        wbs = await create_wbs(db, initiative_id=env["card_id"], title="Phase 1", completion=80)
        await create_wbs(db, initiative_id=env["card_id"], title="Phase 2", completion=20)
        wbs_id = str(wbs.id)
        await db.commit()

        resp = await client.delete(f"{BASE}/wbs/{wbs_id}", headers=env["headers"])
        assert resp.status_code == 204
        assert await _progress(db, env["card_id"]) == 20.0

        overview = await client.get(
            f"{BASE}/initiatives/{init_id}/completion", headers=env["headers"]
        )
        assert overview.json()["completion"] == 20.0


class TestTasks:
    async def test_marking_a_task_done_moves_progress(self, client, db, env):
        wbs = await create_wbs(db, initiative_id=env["card_id"], title="Phase 1")
        task = await create_task(db, initiative_id=env["card_id"], wbs_id=wbs.id)
        task_id = str(task.id)
        await db.commit()

        resp = await client.patch(
            f"{BASE}/tasks/{task_id}", json={"status": "done"}, headers=env["headers"]
        )
        assert resp.status_code == 200
        # One task, done: the package rolls up to 100 and so does the root mean.
        assert await _progress(db, env["card_id"]) == 100.0
        assert len(await _rollup_events(db, env["card_id"])) == 1

    async def test_untouched_value_writes_no_event(self, client, db, env, card_update_sql):
        """A task edit that leaves every calculated value where it was must not
        rewrite the Initiative card — no event, and no ``updated_at`` bump."""
        wbs = await create_wbs(db, initiative_id=env["card_id"], title="Phase 1")
        task = await create_task(db, initiative_id=env["card_id"], wbs_id=wbs.id)
        task_id = str(task.id)
        await db.commit()
        # First edit lands progress = 100; the second (a rename) changes nothing.
        await client.patch(
            f"{BASE}/tasks/{task_id}", json={"status": "done"}, headers=env["headers"]
        )
        assert await _progress(db, env["card_id"]) == 100.0

        card_update_sql.clear()
        resp = await client.patch(
            f"{BASE}/tasks/{task_id}", json={"title": "Renamed"}, headers=env["headers"]
        )
        assert resp.status_code == 200
        assert await _progress(db, env["card_id"]) == 100.0
        assert len(await _rollup_events(db, env["card_id"])) == 1
        assert not card_update_sql.bumped(), "a no-op recalculation must not re-date the card"


class TestReportsAndRisks:
    async def test_status_report_feeds_a_health_formula(self, client, db, env):
        db.add(
            Calculation(
                name="Health",
                formula='COALESCE(ppm.scheduleHealth, "unreported")',
                target_type_key="Initiative",
                target_field_key="health",
                is_active=True,
            )
        )
        await db.commit()
        init_id = env["init_id"]

        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/reports",
            json={
                "report_date": "2026-03-01",
                "schedule_health": "atRisk",
                "cost_health": "onTrack",
                "scope_health": "onTrack",
            },
            headers=env["headers"],
        )
        assert resp.status_code == 200
        db.expire_all()
        card = (await db.execute(select(Card).where(Card.id == env["card_id"]))).scalar_one()
        assert card.attributes["health"] == "atRisk"

        await client.delete(f"{BASE}/reports/{resp.json()['id']}", headers=env["headers"])
        db.expire_all()
        card = (await db.execute(select(Card).where(Card.id == env["card_id"]))).scalar_one()
        assert card.attributes["health"] == "unreported"

    async def test_risk_edits_refresh(self, client, db, env):
        db.add(
            Calculation(
                name="Open risks",
                formula="ppm.risksOpen",
                target_type_key="Initiative",
                target_field_key="health",
                is_active=True,
            )
        )
        await db.commit()
        init_id = env["init_id"]
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/risks",
            json={"title": "Vendor delay", "probability": 3, "impact": 4},
            headers=env["headers"],
        )
        assert resp.status_code == 200
        db.expire_all()
        card = (await db.execute(select(Card).where(Card.id == env["card_id"]))).scalar_one()
        assert card.attributes["health"] == 1

        await client.patch(
            f"{BASE}/risks/{resp.json()['id']}", json={"status": "closed"}, headers=env["headers"]
        )
        db.expire_all()
        card = (await db.execute(select(Card).where(Card.id == env["card_id"]))).scalar_one()
        assert card.attributes["health"] == 0
