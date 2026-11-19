"""No feed of stored events hands a card's costs to a reader who may not see
them on the card.

A ``card.updated`` event stores the whole old and new attributes — the History
tab renders nothing else — so every surface that returns event payloads
repeats the values ``GET /cards/{id}`` redacts: a card's History, the
dashboard's Recent Activity, the admin summary, My Workspace, and a mutation
batch read by its own author. The stored rows stay whole (rollback restores
from them); the values are removed per reader on the way out
(``app.services.event_cost_scrub``).
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.models.stakeholder import Stakeholder
from app.models.user_favorite import UserFavorite
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

BASE = {
    "reports.ea_dashboard": True,
    "inventory.view": True,
    "inventory.edit": True,
    "admin.users": True,
}
BEFORE = {"costTotalAnnual": 100, "tier": "gold"}
AFTER = {"costTotalAnnual": 250, "tier": "platinum"}
STORED = {"attributes": {"old": BEFORE, "new": AFTER}}
CLEAN = {"attributes": {"old": {"tier": "gold"}, "new": {"tier": "platinum"}}}

# Who reads, and whether they may see the card's costs.
SEES_COSTS = {"admin": True, "finance": True, "owner": True, "reader": False, "observer": False}


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="plain", label="Plain", permissions=BASE)
    await create_role(db, key="finance", label="Finance", permissions={**BASE, "costs.view": True})
    await create_card_type(
        db,
        key="Application",
        label="Application",
        fields_schema=[
            {
                "section": "General",
                "fields": [
                    {"key": "costTotalAnnual", "type": "cost", "weight": 0},
                    {"key": "tier", "type": "text", "weight": 0},
                ],
            }
        ],
    )
    await create_stakeholder_role_def(
        db,
        key="responsible",
        label="Responsible",
        permissions={"card.view": True, "card.view_costs": True},
    )
    await create_stakeholder_role_def(
        db, key="observer", label="Observer", permissions={"card.view": True}
    )
    users = {
        "admin": await create_user(db, email="admin@test.com", role="admin"),
        "finance": await create_user(db, email="finance@test.com", role="finance"),
        "owner": await create_user(db, email="owner@test.com", role="plain"),
        "reader": await create_user(db, email="reader@test.com", role="plain"),
        "observer": await create_user(db, email="observer@test.com", role="plain"),
    }
    card = await create_card(db, card_type="Application", name="Billing", attributes=dict(AFTER))
    db.add(Stakeholder(card_id=card.id, user_id=users["owner"].id, role="responsible"))
    db.add(Stakeholder(card_id=card.id, user_id=users["observer"].id, role="observer"))
    for user in users.values():
        db.add(UserFavorite(user_id=user.id, card_id=card.id))
    db.add(
        Event(
            card_id=card.id,
            event_type="card.updated",
            data={"id": str(card.id), "changes": STORED},
        )
    )
    await db.flush()
    return {"users": users, "card": card}


async def _changes(client, user, url, key=None) -> dict:
    resp = await client.get(url, headers=auth_headers(user))
    assert resp.status_code == 200, resp.text
    rows = resp.json()[key] if key else resp.json()
    [row] = [r for r in rows if r["event_type"] == "card.updated"]
    return row["data"]["changes"]


FEEDS = [
    ("/api/v1/reports/dashboard", "recent_events"),
    ("/api/v1/reports/admin-dashboard", "recent_activity"),
    ("/api/v1/events/my-cards", None),
    ("card-history", None),
]


@pytest.mark.parametrize("who", list(SEES_COSTS))
@pytest.mark.parametrize(("url", "key"), FEEDS)
async def test_a_feed_shows_cost_values_only_to_a_reader_who_may_see_them(
    client, env, url, key, who
):
    if url == "card-history":
        url = f"/api/v1/cards/{env['card'].id}/history"
    got = await _changes(client, env["users"][who], url, key)
    assert got == (STORED if SEES_COSTS[who] else CLEAN)


async def test_the_stored_event_keeps_its_values(client, db, env):
    await _changes(client, env["users"]["reader"], f"/api/v1/cards/{env['card'].id}/history")
    stored = (
        await db.execute(select(Event.data).where(Event.event_type == "card.updated"))
    ).scalar_one()
    assert stored["changes"] == STORED


async def test_a_card_less_rollback_event_shows_no_cost_values_either(client, db, env):
    # A rollback publishes its operations without a card on the row, so the
    # feed's card filters let it through; the old values are in `fields`.
    op = {
        "op": "restore_card_fields",
        "card_id": str(env["card"].id),
        "fields": {"attributes": dict(BEFORE)},
        "outcome": "ok",
    }
    db.add(Event(card_id=None, event_type="rollback.restore_card_fields", data=op))
    await db.flush()

    async def fields(who):
        resp = await client.get(
            "/api/v1/reports/dashboard", headers=auth_headers(env["users"][who])
        )
        assert resp.status_code == 200, resp.text
        [row] = [
            r
            for r in resp.json()["recent_events"]
            if r["event_type"] == "rollback.restore_card_fields"
        ]
        return row["data"]["fields"]

    assert await fields("reader") == {"attributes": {"tier": "gold"}}
    assert await fields("finance") == {"attributes": BEFORE}


# ── a mutation batch, read by its own author ────────────────────────────────


async def _edit_in_a_batch(client, user, card) -> str:
    """One PATCH of a non-cost field made under a mutation batch the user
    opened; returns the batch id."""
    opened = await client.post(
        "/api/v1/mutation-batches?row_count=1",
        json={"tool_name": "update_card", "dry_run": False},
        headers=auth_headers(user),
    )
    assert opened.status_code == 201, opened.text
    batch_id = opened.json()["id"]
    resp = await client.patch(
        f"/api/v1/cards/{card.id}",
        json={"attributes": {"tier": "silver"}},
        headers={**auth_headers(user), "X-Turbo-EA-Batch": batch_id},
    )
    assert resp.status_code == 200, resp.text
    return batch_id


async def test_an_editor_cannot_read_the_cost_back_from_their_own_batch(client, db, env):
    # The edit replaces the whole attributes dict, so the route merges the
    # cost the editor may not see back in — and the event records both sides.
    reader = env["users"]["reader"]
    batch_id = await _edit_in_a_batch(client, reader, env["card"])

    resp = await client.get(
        f"/api/v1/mutation-batches/{batch_id}/events", headers=auth_headers(reader)
    )
    assert resp.status_code == 200, resp.text
    [event] = resp.json()["events"]
    assert event["data"]["changes"]["attributes"] == {
        "old": {"tier": "platinum"},
        "new": {"tier": "silver"},
    }
    # The batch is still shown with its author, on both of its endpoints.
    assert resp.json()["batch"]["actor_display_name"] == reader.display_name
    meta = await client.get(f"/api/v1/mutation-batches/{batch_id}", headers=auth_headers(reader))
    assert meta.status_code == 200, meta.text
    assert meta.json()["actor_display_name"] == reader.display_name
    assert meta.json()["actor_user_id"] == str(reader.id)

    # An auditor who sees costs reads the same batch whole.
    as_admin = await client.get(
        f"/api/v1/mutation-batches/{batch_id}/events", headers=auth_headers(env["users"]["admin"])
    )
    [event] = as_admin.json()["events"]
    assert event["data"]["changes"]["attributes"] == {
        "old": {"costTotalAnnual": 250, "tier": "platinum"},
        "new": {"costTotalAnnual": 250, "tier": "silver"},
    }


async def test_rolling_a_batch_back_restores_the_cost_without_showing_it(client, db, env):
    reader, card = env["users"]["reader"], env["card"]
    batch_id = await _edit_in_a_batch(client, reader, card)

    preview = await client.post(
        f"/api/v1/mutation-batches/{batch_id}/rollback",
        json={"dry_run": True},
        headers=auth_headers(reader),
    )
    assert preview.status_code == 200, preview.text
    [op] = preview.json()["operations"]
    assert op["op"] == "restore_card_fields"
    assert op["fields"] == {"attributes": {"tier": "platinum"}}

    done = await client.post(
        f"/api/v1/mutation-batches/{batch_id}/rollback",
        json={"dry_run": False},
        headers=auth_headers(reader),
    )
    assert done.status_code == 200, done.text
    [result] = done.json()["results"]
    assert result["status"] == "ok"
    assert result["fields"] == {"attributes": {"tier": "platinum"}}

    # What was restored is the stored value, cost included...
    restored = (
        await db.execute(
            select(Card.attributes)
            .where(Card.id == card.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert restored == {"costTotalAnnual": 250, "tier": "platinum"}

    # ...and the rollback's own batch lists it for its author without the cost.
    rollback_id = done.json()["rollback_batch_id"]
    stored_summary = (
        await db.execute(select(MutationBatch.summary).where(MutationBatch.id == rollback_id))
    ).scalar_one()
    assert stored_summary["results"][0]["fields"] == {
        "attributes": {"costTotalAnnual": 250, "tier": "platinum"}
    }
    for url in (
        f"/api/v1/mutation-batches/{rollback_id}",
        f"/api/v1/mutation-batches/{rollback_id}/events",
    ):
        resp = await client.get(url, headers=auth_headers(reader))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        summary = (body.get("batch") or body)["summary"]
        assert summary["results"][0]["fields"] == {"attributes": {"tier": "platinum"}}
        assert summary["reverses_batch_id"] == batch_id

    as_admin = await client.get(
        f"/api/v1/mutation-batches/{rollback_id}", headers=auth_headers(env["users"]["admin"])
    )
    assert as_admin.json()["summary"]["results"][0]["fields"] == {
        "attributes": {"costTotalAnnual": 250, "tier": "platinum"}
    }

    # The audit list reads the same way: whole for someone who sees costs,
    # without them for an auditor who does not.
    await create_role(
        db, key="auditor", label="Auditor", permissions={**BASE, "admin.events": True}
    )
    auditor = await create_user(db, email="auditor@test.com", role="auditor")

    async def listed(user):
        resp = await client.get("/api/v1/mutation-batches", headers=auth_headers(user))
        assert resp.status_code == 200, resp.text
        [row] = [b for b in resp.json()["items"] if b["id"] == rollback_id]
        return row["summary"]["results"][0]["fields"]

    assert await listed(auditor) == {"attributes": {"tier": "platinum"}}
    assert await listed(env["users"]["admin"]) == {
        "attributes": {"costTotalAnnual": 250, "tier": "platinum"}
    }


async def test_a_rollback_preview_carries_the_batch_it_would_reverse(client, db, env):
    reader = env["users"]["reader"]
    batch_id = await _edit_in_a_batch(client, reader, env["card"])
    preview = await client.post(
        f"/api/v1/mutation-batches/{batch_id}/rollback",
        json={"dry_run": True},
        headers=auth_headers(reader),
    )
    body = preview.json()
    assert body["dry_run"] is True
    assert body["batch"]["id"] == batch_id
    assert body["batch"]["tool_name"] == "update_card"
    # the preview's batch names no author, as before
    assert body["batch"]["actor_display_name"] is None
    assert body["batch"]["actor_user_id"] == str(reader.id)
    assert body["event_count"] == 1
    assert body["unsupported_events"] == []
