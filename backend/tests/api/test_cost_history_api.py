import json

import pytest

from app.services.fiscal_year import current_fiscal_year
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

# With the default January start the fiscal year is the calendar year.
THIS_YEAR = current_fiscal_year(1)
YEAR = THIS_YEAR - 1

COST_FIELDS = [
    {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}
]


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="admin@cost-history.com", role="admin")
    await create_card_type(db, key="Provider", fields_schema=COST_FIELDS)
    return {"admin": admin}


async def test_lists_every_year_a_card_has(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Provider", name="ERP", user_id=admin.id)
    resp = await client.put(
        f"/api/v1/cards/{card.id}/cost-history",
        json={"fiscal_year": YEAR, "field_key": "costTotalAnnual", "value": 100},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200
    resp = await client.get(f"/api/v1/cards/{card.id}/cost-history", headers=auth_headers(admin))
    assert resp.status_code == 200
    assert resp.json()["rows"] == [
        {"fiscal_year": YEAR, "field_key": "costTotalAnnual", "value": 100}
    ]


async def test_upsert_overwrites_the_same_year_and_field(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Provider", name="ERP", user_id=admin.id)
    for value in (100, 200):
        resp = await client.put(
            f"/api/v1/cards/{card.id}/cost-history",
            json={"fiscal_year": YEAR, "field_key": "costTotalAnnual", "value": value},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
    resp = await client.get(f"/api/v1/cards/{card.id}/cost-history", headers=auth_headers(admin))
    assert resp.json()["rows"] == [
        {"fiscal_year": YEAR, "field_key": "costTotalAnnual", "value": 200}
    ]


async def test_delete_removes_the_row(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Provider", name="ERP", user_id=admin.id)
    await client.put(
        f"/api/v1/cards/{card.id}/cost-history",
        json={"fiscal_year": YEAR, "field_key": "costTotalAnnual", "value": 100},
        headers=auth_headers(admin),
    )
    resp = await client.delete(
        f"/api/v1/cards/{card.id}/cost-history/{YEAR}/costTotalAnnual", headers=auth_headers(admin)
    )
    assert resp.status_code == 204
    resp = await client.get(f"/api/v1/cards/{card.id}/cost-history", headers=auth_headers(admin))
    assert resp.json()["rows"] == []


async def test_rejects_a_field_key_the_card_type_does_not_have(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Provider", name="ERP", user_id=admin.id)
    resp = await client.put(
        f"/api/v1/cards/{card.id}/cost-history",
        json={"fiscal_year": YEAR, "field_key": "notACostField", "value": 100},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 400


async def _put(client, card, admin, **body):
    payload = {"fiscal_year": YEAR, "field_key": "costTotalAnnual", "value": 1, **body}
    return await client.put(
        f"/api/v1/cards/{card.id}/cost-history", json=payload, headers=auth_headers(admin)
    )


@pytest.mark.parametrize("year", [THIS_YEAR, THIS_YEAR - 5])
async def test_the_current_year_and_the_five_before_it_are_accepted(client, db, env, year):
    admin = env["admin"]
    card = await create_card(db, card_type="Provider", name="ERP", user_id=admin.id)
    assert (await _put(client, card, admin, fiscal_year=year)).status_code == 200


async def test_the_next_year_is_accepted(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Provider", name="ERP", user_id=admin.id)
    assert (await _put(client, card, admin, fiscal_year=THIS_YEAR + 1)).status_code == 200


async def test_two_years_ahead_is_rejected(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Provider", name="ERP", user_id=admin.id)
    resp = await _put(client, card, admin, fiscal_year=THIS_YEAR + 2)
    assert resp.status_code == 422
    assert str(THIS_YEAR + 1) in resp.json()["detail"]


@pytest.mark.parametrize("year", [THIS_YEAR - 6])
async def test_a_year_outside_the_five_year_window_is_rejected(client, db, env, year):
    admin = env["admin"]
    card = await create_card(db, card_type="Provider", name="ERP", user_id=admin.id)
    resp = await _put(client, card, admin, fiscal_year=year)
    assert resp.status_code == 422
    assert str(THIS_YEAR - 5) in resp.json()["detail"]
    rows = await client.get(f"/api/v1/cards/{card.id}/cost-history", headers=auth_headers(admin))
    assert rows.json()["rows"] == []


@pytest.mark.parametrize("year", [2147483648, 99999999999, 0, -5, 1899, 2201])
async def test_an_absurd_year_is_a_422_never_a_500(client, db, env, year):
    admin = env["admin"]
    card = await create_card(db, card_type="Provider", name="ERP", user_id=admin.id)
    assert (await _put(client, card, admin, fiscal_year=year)).status_code == 422
    resp = await client.delete(
        f"/api/v1/cards/{card.id}/cost-history/{year}/costTotalAnnual", headers=auth_headers(admin)
    )
    assert resp.status_code == 422


async def test_a_row_older_than_the_window_can_still_be_deleted(client, db, env):
    """Rows recorded before the window moved on must stay removable."""
    admin = env["admin"]
    card = await create_card(db, card_type="Provider", name="ERP", user_id=admin.id)
    resp = await client.delete(
        f"/api/v1/cards/{card.id}/cost-history/{THIS_YEAR - 9}/costTotalAnnual",
        headers=auth_headers(admin),
    )
    assert resp.status_code == 204


@pytest.mark.parametrize("raw_value", ["1e999", "-1e999", "NaN", "Infinity", "-1", "-0.01"])
async def test_a_value_that_is_negative_or_not_finite_is_rejected(client, db, env, raw_value):
    """json.dumps cannot spell these, so send the body as text, the way a hostile client would."""
    admin = env["admin"]
    card = await create_card(db, card_type="Provider", name="ERP", user_id=admin.id)
    body = '{"fiscal_year": %d, "field_key": "costTotalAnnual", "value": %s}' % (YEAR, raw_value)
    resp = await client.put(
        f"/api/v1/cards/{card.id}/cost-history",
        content=body,
        headers={**auth_headers(admin), "Content-Type": "application/json"},
    )
    assert resp.status_code == 422
    rows = await client.get(f"/api/v1/cards/{card.id}/cost-history", headers=auth_headers(admin))
    assert rows.json()["rows"] == []


async def test_a_cost_of_zero_is_accepted(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Provider", name="ERP", user_id=admin.id)
    assert (await _put(client, card, admin, value=0)).status_code == 200


async def _editor_without_costs(db, *, view=False):
    """A role that edits inventory but holds no cost permission (optionally only `costs.view`)."""
    perms = {"inventory.view": True, "inventory.edit": True}
    if view:
        perms["costs.view"] = True
    await create_role(db, key="inv-editor", permissions=perms)
    return await create_user(db, email="editor@cost-history.com", role="inv-editor")


@pytest.mark.parametrize("view", [False, True])
async def test_inventory_edit_alone_cannot_write_or_delete_a_cost(client, db, env, view):
    admin = env["admin"]
    editor = await _editor_without_costs(db, view=view)
    card = await create_card(db, card_type="Provider", name="ERP", user_id=admin.id)
    url = f"/api/v1/cards/{card.id}/cost-history"
    body = {"fiscal_year": YEAR, "field_key": "costTotalAnnual", "value": 100}
    assert (await client.put(url, json=body, headers=auth_headers(admin))).status_code == 200

    resp = await client.put(url, json={**body, "value": 0}, headers=auth_headers(editor))
    assert resp.status_code == 403
    resp = await client.delete(f"{url}/{YEAR}/costTotalAnnual", headers=auth_headers(editor))
    assert resp.status_code == 403

    rows = (await client.get(url, headers=auth_headers(admin))).json()["rows"]
    assert rows == [{"fiscal_year": YEAR, "field_key": "costTotalAnnual", "value": 100}]


async def test_a_card_edit_stakeholder_may_still_write_the_history(client, db, env):
    from app.models.stakeholder import Stakeholder
    from tests.conftest import create_stakeholder_role_def

    admin = env["admin"]
    editor = await _editor_without_costs(db)
    card = await create_card(db, card_type="Provider", name="ERP", user_id=admin.id)
    await create_stakeholder_role_def(
        db,
        card_type_key="Provider",
        key="owner",
        label="Owner",
        permissions={"card.edit": True, "card.view_costs": True},
    )
    db.add(Stakeholder(card_id=card.id, user_id=editor.id, role="owner"))
    await db.flush()
    resp = await client.put(
        f"/api/v1/cards/{card.id}/cost-history",
        json={"fiscal_year": YEAR, "field_key": "costTotalAnnual", "value": 5},
        headers=auth_headers(editor),
    )
    assert resp.status_code == 200


async def _cost_events(db, card):
    from sqlalchemy import select

    from app.models.event import Event

    rows = await db.execute(
        select(Event).where(Event.card_id == card.id, Event.event_type == "card.costs_updated")
    )
    return [e.data for e in rows.scalars().all()]


def _stable(change: dict) -> str:
    """A sort key that does not depend on the order the JSON column returns its keys in."""
    return json.dumps(change, sort_keys=True)


async def test_a_history_write_and_delete_publish_an_event_with_keys_only(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Provider", name="ERP", user_id=admin.id)
    url = f"/api/v1/cards/{card.id}/cost-history"
    for value in (123456, 654321):
        body = {"fiscal_year": YEAR, "field_key": "costTotalAnnual", "value": value}
        assert (await client.put(url, json=body, headers=auth_headers(admin))).status_code == 200
    resp = await client.delete(f"{url}/{YEAR}/costTotalAnnual", headers=auth_headers(admin))
    assert resp.status_code == 204

    events = await _cost_events(db, card)
    # The three events share one transaction timestamp, so their order is not defined.
    assert sorted((e["changes"]["cost_items"] for e in events), key=_stable) == sorted(
        [
            {"old": [], "new": ["costTotalAnnual"]},
            {"old": ["costTotalAnnual"], "new": ["costTotalAnnual"]},
            {"old": ["costTotalAnnual"], "new": []},
        ],
        key=_stable,
    )
    assert {e["source"] for e in events} == {"cost_history"}
    assert {e["fiscal_year"] for e in events} == {YEAR}
    dumped = str([{k: v for k, v in e.items() if k != "id"} for e in events])  # id is random
    assert "123456" not in dumped and "654321" not in dumped


async def test_deleting_a_year_that_has_no_row_publishes_nothing(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Provider", name="ERP", user_id=admin.id)
    resp = await client.delete(
        f"/api/v1/cards/{card.id}/cost-history/{YEAR}/costTotalAnnual", headers=auth_headers(admin)
    )
    assert resp.status_code == 204
    assert await _cost_events(db, card) == []


async def test_a_put_that_loses_the_race_to_a_concurrent_insert_still_succeeds(
    client, db, env, monkeypatch
):
    """The row appears between the existence check and the write: no unique-key 500."""
    from sqlalchemy import select

    from app.api.v1 import cost_history
    from app.models.card_cost_history import CardCostHistory

    admin = env["admin"]
    card = await create_card(db, card_type="Provider", name="Raced", user_id=admin.id)
    real_publish = cost_history._publish_history_change

    async def _publish_then_lose_the_race(db_, user, card_, fiscal_year, *, old, new):
        await real_publish(db_, user, card_, fiscal_year, old=old, new=new)
        db_.add(
            CardCostHistory(
                card_id=card_.id, fiscal_year=fiscal_year, field_key="costTotalAnnual", value=1
            )
        )
        await db_.flush()

    monkeypatch.setattr(cost_history, "_publish_history_change", _publish_then_lose_the_race)
    resp = await _put(client, card, admin, fiscal_year=YEAR, field_key="costTotalAnnual", value=7)
    assert resp.status_code == 200
    assert resp.json()["value"] == 7
    rows = (
        (await db.execute(select(CardCostHistory).where(CardCostHistory.card_id == card.id)))
        .scalars()
        .all()
    )
    assert [r.value for r in rows] == [7]
