"""costs.edit gate, can_edit flag, and cost redaction in card history."""

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.stakeholder import Stakeholder
from app.services import cost_item_types
from app.services.event_bus import event_bus
from app.services.fiscal_year import current_fiscal_year
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

CUR = current_fiscal_year(1)


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_role(
        db, key="inv", label="Inv", permissions={"inventory.view": True, "inventory.edit": True}
    )
    users = {
        "admin": await create_user(db, email="a@cp.com", role="admin"),
        "resp": await create_user(db, email="r@cp.com", role="viewer"),
        "obs": await create_user(db, email="o@cp.com", role="viewer"),
        "inv": await create_user(db, email="i@cp.com", role="inv"),
    }
    await create_card_type(
        db,
        key="Application",
        fields_schema=[
            {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}
        ],
    )
    await cost_item_types.create_item(db, "lic", "Licences")
    for key, edit in (("responsible", True), ("observer", False)):
        await create_stakeholder_role_def(
            db,
            key=key,
            label=key,
            permissions={"card.view": True, "card.edit": edit, "card.view_costs": edit},
        )
    card = await create_card(db, card_type="Application", name="ERP", user_id=users["admin"].id)
    db.add(Stakeholder(card_id=card.id, user_id=users["resp"].id, role="responsible"))
    db.add(Stakeholder(card_id=card.id, user_id=users["obs"].id, role="observer"))
    await db.flush()
    return {**users, "card": card}


def url(env, tail=""):
    return f"/api/v1/cards/{env['card'].id}/costs{tail}"


async def put(client, env, who, amount=4321):
    return await client.put(
        url(env, f"/{CUR}/items/lic"), json={"amount": amount}, headers=auth_headers(env[who])
    )


async def test_put_edit_stakeholder_200_observer_and_inventory_edit_403(client, env):
    assert (await put(client, env, "resp")).status_code == 200
    assert (await put(client, env, "obs")).status_code == 403
    assert (await put(client, env, "inv")).status_code == 403
    assert (await put(client, env, "admin")).status_code == 200


async def test_get_can_edit_flag(client, env):
    for who, expected in (("admin", True), ("resp", True)):
        for tail in ("", f"/{CUR}"):
            r = await client.get(url(env, tail), headers=auth_headers(env[who]))
            assert r.status_code == 200
            assert r.json()["can_edit"] is expected
    assert (await client.get(url(env), headers=auth_headers(env["obs"]))).status_code == 403


async def test_history_redacts_for_non_cost_reader_and_labels_event(client, db, env):
    await put(client, env, "admin")
    # "inv" holds inventory.view but neither costs.view nor a stakeholder role.
    h = f"/api/v1/cards/{env['card'].id}/history"
    r = await client.get(h, headers=auth_headers(env["inv"]))
    assert r.status_code == 200
    evs = [e for e in r.json() if e["event_type"] == "card.costs_updated"]
    assert len(evs) == 1
    assert evs[0]["data"]["changes"] == {}
    assert "4321" not in r.text
    assert "cost_items" not in evs[0]["data"]["changes"]
    assert evs[0]["data"]["summary"] == "Costs of ERP changed"
    r = await client.get(h, headers=auth_headers(env["resp"]))
    ev = [e for e in r.json() if e["event_type"] == "card.costs_updated"][0]
    assert ev["data"]["changes"]["costTotalAnnual"]["new"] == 4321
    assert ev["data"]["summary"] == "Costs of ERP changed (items: Licences)"


async def test_history_redacts_attribute_diff(client, db, env):
    card = env["card"]
    await event_bus.publish(
        "card.updated",
        {
            "id": str(card.id),
            "changes": {
                "attributes": {
                    "old": {"costTotalAnnual": 11, "note": "a"},
                    "new": {"costTotalAnnual": 22, "note": "b"},
                }
            },
        },
        db=db,
        card_id=card.id,
        user_id=env["admin"].id,
    )
    h = f"/api/v1/cards/{card.id}/history"
    r = await client.get(h, headers=auth_headers(env["inv"]))
    assert r.json()[0]["data"]["changes"]["attributes"] == {
        "old": {"note": "a"},
        "new": {"note": "b"},
    }
    r = await client.get(h, headers=auth_headers(env["obs"]))
    assert "costTotalAnnual" not in r.json()[0]["data"]["changes"]["attributes"]["new"]
    r = await client.get(h, headers=auth_headers(env["resp"]))
    assert r.json()[0]["data"]["changes"]["attributes"]["new"]["costTotalAnnual"] == 22
    r = await client.get(h, headers=auth_headers(env["admin"]))
    assert r.json()[0]["data"]["changes"]["attributes"]["new"]["costTotalAnnual"] == 22


async def _member(db, env, email="m@cp.com"):
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    return await create_user(db, email=email, role="member")


async def test_default_member_cannot_edit_costs_without_stakeholder_role(client, db, env):
    env["member"] = await _member(db, env)
    assert (await put(client, env, "member")).status_code == 403
    r = await client.get(url(env), headers=auth_headers(env["member"]))
    assert r.status_code == 200 and r.json()["can_edit"] is False


async def test_default_member_who_is_responsible_edits(client, db, env):
    env["member"] = await _member(db, env)
    db.add(Stakeholder(card_id=env["card"].id, user_id=env["member"].id, role="responsible"))
    await db.flush()
    assert (await put(client, env, "member")).status_code == 200
    r = await client.get(url(env), headers=auth_headers(env["member"]))
    assert r.json()["can_edit"] is True


async def test_responsible_of_one_card_cannot_edit_another(client, db, env):
    other = await create_card(db, card_type="Application", name="CRM", user_id=env["admin"].id)
    r = await client.put(
        f"/api/v1/cards/{other.id}/costs/{CUR}/items/lic",
        json={"amount": 1},
        headers=auth_headers(env["resp"]),
    )
    assert r.status_code == 403


async def test_archived_stakeholder_role_grants_nothing(client, db, env):
    await create_stakeholder_role_def(
        db, key="old_owner", label="Old", permissions={"card.edit": True}, is_archived=True
    )
    user = await create_user(db, email="old@cp.com", role="viewer")
    db.add(Stakeholder(card_id=env["card"].id, user_id=user.id, role="old_owner"))
    await db.flush()
    env["old"] = user
    assert (await put(client, env, "old")).status_code == 403


async def test_hidden_card_write_is_404(client, db, env):
    from sqlalchemy import update

    from app.models.card_type import CardType

    await db.execute(
        update(CardType)
        .where(CardType.key == "Application")
        .values(role_permissions={"inv": {"inventory.view": False}})
    )
    await db.flush()
    assert (await put(client, env, "inv")).status_code == 404


async def _feed_env(db, env):
    """A cost event plus an attribute-diff event on the card, and a reader without cost access."""
    await create_role(
        db, key="feedreader", label="FR", permissions={**VIEWER_PERMISSIONS, "admin.events": True}
    )
    env["reader"] = await create_user(db, email="fr@cp.com", role="feedreader")
    card = env["card"]
    await event_bus.publish(
        "card.updated",
        {
            "id": str(card.id),
            "changes": {
                "attributes": {"old": {"costTotalAnnual": 11}, "new": {"costTotalAnnual": 22}}
            },
        },
        db=db,
        card_id=card.id,
        user_id=env["admin"].id,
    )
    await db.flush()
    return card


def _assert_no_amounts(evs, need_diff=True):
    """Every event is there, none carries a cost value; the attribute diff survives, emptied."""
    diffs = 0
    for e in evs:
        ch = e["data"].get("changes", {})
        assert "costTotalAnnual" not in ch and "cost_items" not in ch
        attrs = ch.get("attributes")
        if attrs is not None:
            diffs += 1
            assert all("costTotalAnnual" not in attrs[side] for side in ("old", "new"))
    assert diffs >= int(need_diff)


async def test_dashboard_recent_events_redacted(client, db, env):

    await put(client, env, "admin")
    await _feed_env(db, env)
    r = await client.get("/api/v1/reports/dashboard", headers=auth_headers(env["reader"]))
    assert r.status_code == 200
    evs = r.json()["recent_events"]
    assert {e["event_type"] for e in evs} >= {"card.costs_updated", "card.updated"}
    _assert_no_amounts(evs)
    r = await client.get("/api/v1/reports/dashboard", headers=auth_headers(env["admin"]))
    assert "4321" in str(r.json()["recent_events"])


async def test_my_cards_feed_redacted_unless_stakeholder(client, db, env):
    from app.models.user_favorite import UserFavorite

    await put(client, env, "admin")
    await _feed_env(db, env)
    db.add(UserFavorite(user_id=env["reader"].id, card_id=env["card"].id))
    await db.flush()
    r = await client.get("/api/v1/events/my-cards", headers=auth_headers(env["reader"]))
    assert r.status_code == 200 and len(r.json()) >= 2
    _assert_no_amounts(r.json())
    r = await client.get("/api/v1/events/my-cards", headers=auth_headers(env["resp"]))
    assert "4321" in r.text


async def test_admin_events_feed_redacted_without_cost_access(client, db, env):
    await put(client, env, "admin")
    card = await _feed_env(db, env)
    r = await client.get(f"/api/v1/events?card_id={card.id}", headers=auth_headers(env["reader"]))
    assert r.status_code == 200
    assert {e["event_type"] for e in r.json()} >= {"card.costs_updated", "card.updated"}
    _assert_no_amounts(r.json())
    r = await client.get(f"/api/v1/events?card_id={card.id}", headers=auth_headers(env["admin"]))
    assert "4321" in r.text


async def test_mutation_batch_events_redacted_without_cost_access(client, db, env):
    from sqlalchemy import select

    from app.models.event import Event

    await put(client, env, "admin")
    await _feed_env(db, env)
    batch_id = (
        await db.execute(
            select(Event.batch_id).where(
                Event.card_id == env["card"].id, Event.event_type == "card.costs_updated"
            )
        )
    ).scalar_one()
    assert batch_id is not None
    path = f"/api/v1/mutation-batches/{batch_id}/events"
    r = await client.get(path, headers=auth_headers(env["reader"]))
    assert r.status_code == 200 and r.json()["events"]
    _assert_no_amounts(r.json()["events"], need_diff=False)
    r = await client.get(path, headers=auth_headers(env["admin"]))
    assert "4321" in r.text


async def test_legacy_cost_history_read_needs_cost_view(client, db, env):
    await create_role(
        db, key="editor", label="E", permissions={"inventory.view": True, "inventory.edit": True}
    )
    editor = await create_user(db, email="ed@cp.com", role="editor")
    path = f"/api/v1/cards/{env['card'].id}/cost-history"
    assert (await client.get(path, headers=auth_headers(editor))).status_code == 403
    assert (await client.get(path, headers=auth_headers(env["admin"]))).status_code == 200


async def test_admin_dashboard_activity_redacted_without_cost_access(client, db, env):
    await put(client, env, "admin")
    await _feed_env(db, env)
    await create_role(db, key="usersadm", label="UA", permissions={"admin.users": True})
    ua = await create_user(db, email="ua@cp.com", role="usersadm")
    r = await client.get("/api/v1/reports/admin-dashboard", headers=auth_headers(ua))
    assert r.status_code == 200
    evs = [e for e in r.json()["recent_activity"] if e["card_id"] == str(env["card"].id)]
    assert {e["event_type"] for e in evs} >= {"card.costs_updated", "card.updated"}
    _assert_no_amounts(evs)
    r = await client.get("/api/v1/reports/admin-dashboard", headers=auth_headers(env["admin"]))
    assert "4321" in str(r.json()["recent_activity"])
