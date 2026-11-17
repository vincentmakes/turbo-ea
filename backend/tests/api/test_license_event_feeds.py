"""Cost and license values reach only their own readers on every event feed.

Two readers per feed: one with only cost access (``costs.view``), one with only license
access (``licenses.view``). Three events on one card: a cost event, a license event and a
legacy ``card.updated`` diff of ``licensedUsers`` + ``costTotalAnnual``.
"""

from __future__ import annotations

import pytest

from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.models.user_favorite import UserFavorite
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

GATES = {
    "inventory.view": True,
    "admin.events": True,
    "reports.ea_dashboard": True,
    "admin.users": True,
}


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="costonly", permissions={**GATES, "costs.view": True})
    await create_role(db, key="licenseonly", permissions={**GATES, "licenses.view": True})
    await create_card_type(db, key="Application")
    admin = await create_user(db, email="a@lic-feed.com", role="admin")
    cost = await create_user(db, email="c@lic-feed.com", role="costonly")
    lic = await create_user(db, email="l@lic-feed.com", role="licenseonly")
    card = await create_card(db, name="ERP", user_id=admin.id)
    batch_ids = {}
    for who in (cost, lic):
        b = MutationBatch(tool_name="t", actor_user_id=who.id)
        db.add(b)
        await db.flush()
        batch_ids[who.id] = b.id
    for who in (cost, lic):
        db.add(UserFavorite(user_id=who.id, card_id=card.id))
    for et, data in (
        ("card.costs_updated", {"changes": {"costTotalAnnual": {"old": 1, "new": 2}}}),
        (
            "card.licenses_updated",
            {"changes": {"license_types": {"old": [], "new": ["users:admin"]}}},
        ),
        (
            "card.updated",
            {
                "changes": {
                    "attributes": {
                        "old": {"licensedUsers": 1, "costTotalAnnual": 1},
                        "new": {"licensedUsers": 2, "costTotalAnnual": 2},
                    }
                }
            },
        ),
    ):
        for bid in batch_ids.values():
            db.add(
                Event(
                    card_id=card.id, event_type=et, data=dict(data), batch_id=bid, user_id=admin.id
                )
            )
    await db.flush()
    return {"admin": admin, "cost": cost, "lic": lic, "card": card, "batches": batch_ids}


def _keys(blob) -> set[str]:
    """Every key name appearing anywhere in the JSON blob."""
    out: set[str] = set()

    def walk(v):
        if isinstance(v, dict):
            for k, x in v.items():
                out.add(k)
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk(blob)
    return out


COST = {"costTotalAnnual"}
LICENSE = {"licensedUsers", "license_types"}


def _assert_split(blob, who: str):
    keys = _keys(blob)
    if who == "cost":
        assert COST <= keys and not (LICENSE & keys)
    else:
        assert LICENSE <= keys and not (COST & keys)


async def _history(client, env, who):
    r = await client.get(f"/api/v1/cards/{env['card'].id}/history", headers=auth_headers(env[who]))
    assert r.status_code == 200
    return r.json()


async def _my_cards(client, env, who):
    r = await client.get("/api/v1/events/my-cards", headers=auth_headers(env[who]))
    assert r.status_code == 200
    return r.json()


async def _admin_events(client, env, who):
    r = await client.get(
        "/api/v1/events", params={"card_id": str(env["card"].id)}, headers=auth_headers(env[who])
    )
    assert r.status_code == 200
    return r.json()


async def _batch(client, env, who):
    bid = env["batches"][env[who].id]
    r = await client.get(f"/api/v1/mutation-batches/{bid}/events", headers=auth_headers(env[who]))
    assert r.status_code == 200
    return r.json()


async def _dashboard(client, env, who):
    r = await client.get("/api/v1/reports/dashboard", headers=auth_headers(env[who]))
    assert r.status_code == 200
    return r.json()["recent_events"]


async def _admin_dashboard(client, env, who):
    r = await client.get("/api/v1/reports/admin-dashboard", headers=auth_headers(env[who]))
    assert r.status_code == 200
    return r.json()["recent_activity"]


async def test_card_history_feed_only_cost_access(client, env):
    _assert_split(await _history(client, env, "cost"), "cost")


async def test_card_history_feed_only_license_access(client, env):
    _assert_split(await _history(client, env, "lic"), "lic")


async def test_my_cards_feed_only_cost_access(client, env):
    _assert_split(await _my_cards(client, env, "cost"), "cost")


async def test_my_cards_feed_only_license_access(client, env):
    _assert_split(await _my_cards(client, env, "lic"), "lic")


async def test_admin_events_feed_only_cost_access(client, env):
    _assert_split(await _admin_events(client, env, "cost"), "cost")


async def test_admin_events_feed_only_license_access(client, env):
    _assert_split(await _admin_events(client, env, "lic"), "lic")


async def test_mutation_batch_events_only_cost_access(client, env):
    _assert_split(await _batch(client, env, "cost"), "cost")


async def test_mutation_batch_events_only_license_access(client, env):
    _assert_split(await _batch(client, env, "lic"), "lic")


async def test_dashboard_recent_activity_only_cost_access(client, env):
    _assert_split(await _dashboard(client, env, "cost"), "cost")


async def test_dashboard_recent_activity_only_license_access(client, env):
    _assert_split(await _dashboard(client, env, "lic"), "lic")


async def test_admin_dashboard_feed_only_cost_access(client, env):
    _assert_split(await _admin_dashboard(client, env, "cost"), "cost")


async def test_admin_dashboard_feed_only_license_access(client, env):
    _assert_split(await _admin_dashboard(client, env, "lic"), "lic")


async def test_history_gets_a_license_summary(client, env):
    rows = await _history(client, env, "lic")
    summary = [r["data"]["summary"] for r in rows if r["event_type"] == "card.licenses_updated"]
    assert summary and summary[0].startswith("Licensing of ERP changed")


async def test_sse_drop_set_only_cost_access(db, env):
    from app.services.cost_event_redaction import reader_drop_keys

    keys = await reader_drop_keys(db, env["cost"])
    assert "licensedUsers" in keys and "license_types" in keys
    assert "costTotalAnnual" not in keys and "cost_items" not in keys


async def test_sse_drop_set_only_license_access(db, env):
    from app.services.cost_event_redaction import reader_drop_keys

    keys = await reader_drop_keys(db, env["lic"])
    assert "costTotalAnnual" in keys and "cost_items" in keys
    assert "licensedUsers" not in keys and "license_types" not in keys
    assert await reader_drop_keys(db, env["admin"]) == frozenset()
