"""GET /reports/licensing: gate, rows, statuses, trend, the Platform aggregate."""

from __future__ import annotations

import pytest
from sqlalchemy import select, update

from app.models.app_settings import AppSettings
from app.models.card_license import CardLicense
from app.models.card_type import CardType
from app.services.fiscal_year import current_fiscal_year
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_license_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)

CUR = current_fiscal_year(1)
FORECAST = CUR + 1
SCHEMA = [{"section": "S", "fields": [{"key": "licensingModel", "type": "multiple_select"}]}]
HIDE_ITC = {"member": {"inventory.view": False}}


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(
        db, key="member", label="M", permissions={"inventory.view": True, "licenses.view": True}
    )
    await create_role(db, key="viewer", label="V", permissions={"inventory.view": True})
    users = {
        "admin": await create_user(db, email="a@lic-rep.com", role="admin"),
        "member": await create_user(db, email="m@lic-rep.com", role="member"),
        "viewer": await create_user(db, email="v@lic-rep.com", role="viewer"),
    }
    for key in ("Application", "ITComponent"):
        await create_card_type(db, key=key, label=key, fields_schema=SCHEMA)
    await create_card_type(db, key="Platform", label="Platform")
    await create_relation_type(
        db, key="relPlatformToApp", source_type_key="Platform", target_type_key="Application"
    )
    await create_relation_type(
        db, key="relPlatformToITC", source_type_key="Platform", target_type_key="ITComponent"
    )
    await create_license_type(db, "admin", "Admin")
    await create_license_type(db, "dev", "Dev")
    return users


async def _card(db, name, card_type="Application", model=("users",), **kw):
    return await create_card(
        db, card_type=card_type, name=name, attributes={"licensingModel": list(model)}, **kw
    )


async def _row(db, card, year, **cells):
    db.add(
        CardLicense(
            card_id=card.id,
            fiscal_year=year,
            items={"users": {k: {"licensed": v[0], "actual": v[1]} for k, v in cells.items()}},
        )
    )
    await db.flush()


async def _hide_itc(db):
    await db.execute(
        update(CardType).where(CardType.key == "ITComponent").values(role_permissions=HIDE_ITC)
    )
    await db.flush()


async def _get(client, env, user="admin", **params):
    params = {"type": "Application", "metric": "users", **params}
    return await client.get(
        "/api/v1/reports/licensing", params=params, headers=auth_headers(env[user])
    )


async def test_requires_licenses_view(client, db, env):
    assert (await _get(client, env, "viewer")).status_code == 403
    assert (await _get(client, env, "member")).status_code == 200


async def test_rows_statuses_and_trend(client, db, env):
    over = await _card(db, "Over")
    near = await _card(db, "Near")
    nodata = await _card(db, "NoData")
    await _row(db, over, CUR, admin=(10, 12))
    await _row(db, near, CUR, admin=(10, 9))
    await _row(db, nodata, CUR, admin=(10, None))
    await _row(db, over, CUR - 1, admin=(10, 5))
    body = (await _get(client, env)).json()
    assert body["fiscal_year"] == body["current_fiscal_year"] == CUR
    assert body["metric"] == "users" and body["aggregate"] is None
    assert {r["name"]: r["status"] for r in body["rows"]} == {
        "Over": "over",
        "Near": "approaching",
        "NoData": "no_actual_data",
    }
    assert [t["fiscal_year"] for t in body["trend"]] == list(range(CUR - 4, CUR + 2))
    assert body["trend"][3]["cards"][str(over.id)]["admin"] == {"licensed": 10, "actual": 5}
    assert [t["key"] for t in body["license_types"]] == ["admin", "dev"]
    past = (await _get(client, env, fiscal_year=CUR - 1)).json()
    assert [r["name"] for r in past["rows"]] == ["Over"]


async def test_forecast_year_refused(client, db, env):
    resp = await _get(client, env, fiscal_year=FORECAST)
    assert resp.status_code == 400 and resp.json()["detail"] == "forecast_not_selectable"
    assert (await _get(client, env, fiscal_year=CUR - 5)).status_code == 400


async def test_bad_metric_and_type_refused(client, db, env):
    assert (await _get(client, env, metric="seats")).status_code == 400
    assert (await _get(client, env, type="Platform")).status_code == 400
    assert (await _get(client, env, group_by="field:nope")).status_code == 400


async def test_hidden_card_omitted_from_rows_and_trend(client, db, env):
    hidden = await _card(db, "Secret", card_type="ITComponent")
    await _row(db, hidden, CUR, admin=(1, 1))
    await _hide_itc(db)
    admin_body = (await _get(client, env, type="ITComponent")).json()
    assert [r["name"] for r in admin_body["rows"]] == ["Secret"]  # non-vacuity
    body = (await _get(client, env, "member", type="ITComponent")).json()
    assert body["rows"] == []
    assert all(t["cards"] == {} for t in body["trend"])
    assert "Secret" not in str(body) and str(hidden.id) not in str(body)


async def test_card_id_hidden_is_404(client, db, env):
    hidden = await _card(db, "Secret", card_type="ITComponent")
    await _hide_itc(db)
    assert (await _get(client, env, "member", card_id=str(hidden.id))).status_code == 404
    assert (await _get(client, env, card_id=str(hidden.id))).status_code == 200


async def test_card_id_of_another_type_refused(client, db, env):
    await create_card_type(db, key="Process", label="Process")
    proc = await create_card(db, card_type="Process", name="Proc")
    assert (await _get(client, env, card_id=str(proc.id))).status_code == 400
    assert (await _get(client, env, card_id="not-a-uuid")).status_code in (400, 404)


async def test_single_card_pick(client, db, env):
    a = await _card(db, "A")
    await _card(db, "B")
    await _row(db, a, CUR, admin=(10, 5))
    body = (await _get(client, env, card_id=str(a.id))).json()
    assert [r["name"] for r in body["rows"]] == ["A"] and body["aggregate"] is None
    assert body["rows"][0]["status"] == "compliant"


async def test_platform_aggregate_counts_once_and_applies_the_report_rules(client, db, env):
    plat = await create_card(db, card_type="Platform", name="Plat")
    both = await _card(db, "Both")
    await create_relation(db, type_key="relPlatformToApp", source_id=plat.id, target_id=both.id)
    await create_relation(db, type_key="relPlatformToITC", source_id=plat.id, target_id=both.id)
    itc = await _card(db, "Itc", card_type="ITComponent")
    await create_relation(db, type_key="relPlatformToITC", source_id=plat.id, target_id=itc.id)
    archived = await _card(db, "Arch", status="ARCHIVED")
    retired = await _card(db, "Retired", lifecycle={"endOfLife": f"{CUR - 1}-12-31"})
    other_metric = await _card(db, "Installs", model=("installations",))
    for c in (archived, retired, other_metric):
        await create_relation(db, type_key="relPlatformToApp", source_id=plat.id, target_id=c.id)
    for c in (both, itc, archived, retired, other_metric):
        await _row(db, c, CUR, admin=(10, 4))
    body = (await _get(client, env, card_id=str(plat.id))).json()
    assert body["aggregate"] == {"id": str(plat.id), "name": "Plat", "type": "Platform"}
    assert sorted(r["name"] for r in body["rows"]) == ["Both", "Itc"]
    assert body["trend"][4]["cards"].keys() == {str(both.id), str(itc.id)}


async def test_platform_aggregate_hides_unreadable_linked_cards(client, db, env):
    plat = await create_card(db, card_type="Platform", name="Plat")
    itc = await _card(db, "Secret", card_type="ITComponent")
    await create_relation(db, type_key="relPlatformToITC", source_id=plat.id, target_id=itc.id)
    await _hide_itc(db)
    assert len((await _get(client, env, card_id=str(plat.id))).json()["rows"]) == 1
    body = (await _get(client, env, "member", card_id=str(plat.id))).json()
    assert body["rows"] == [] and "Secret" not in str(body)


async def test_platform_aggregate_past_year_needs_a_stored_row(client, db, env):
    plat = await create_card(db, card_type="Platform", name="Plat")
    a = await _card(db, "Row")
    b = await _card(db, "NoRow")
    for c in (a, b):
        await create_relation(db, type_key="relPlatformToApp", source_id=plat.id, target_id=c.id)
    await _row(db, a, CUR - 2, admin=(3, 3))
    body = (await _get(client, env, card_id=str(plat.id), fiscal_year=CUR - 2)).json()
    assert [r["name"] for r in body["rows"]] == ["Row"]


async def test_platform_aggregate_has_no_status(client, db, env):
    plat = await create_card(db, card_type="Platform", name="Plat")
    a = await _card(db, "A")
    await create_relation(db, type_key="relPlatformToApp", source_id=plat.id, target_id=a.id)
    await _row(db, a, CUR, admin=(1, 5))
    row = (await _get(client, env, card_id=str(plat.id))).json()["rows"][0]
    assert row["status"] is None
    assert row["by_type"]["admin"]["status"] == "over"  # the per-type figures stay


async def test_fiscal_year_start_april_names_the_current_year(client, db, env):
    db.add(AppSettings(id="default", general_settings={"fiscalYearStart": 4}))
    await db.flush()
    cur4 = current_fiscal_year(4)
    a = await _card(db, "A")
    await _row(db, a, cur4, admin=(10, 5))
    body = (await _get(client, env)).json()
    assert body["current_fiscal_year"] == cur4 and body["fiscal_year"] == cur4
    assert body["fiscal_year_start"] == 4
    assert body["years"] == list(range(cur4 - 4, cur4 + 2))
    assert [r["name"] for r in body["rows"]] == ["A"]
    assert (await _get(client, env, fiscal_year=cur4 + 1)).status_code == 400


async def test_cost_attributes_are_stripped_without_costs_view(client, db, env):
    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    ct.fields_schema = SCHEMA + [{"section": "C", "fields": [{"key": "price", "type": "cost"}]}]
    await create_card(
        db,
        card_type="Application",
        name="A",
        attributes={"licensingModel": ["users"], "price": 99},
    )
    await db.flush()
    member = (await _get(client, env, "member")).json()["rows"][0]["attributes"]
    assert "price" not in member and member["licensingModel"] == ["users"]
    admin = (await _get(client, env)).json()["rows"][0]["attributes"]
    assert admin["price"] == 99
