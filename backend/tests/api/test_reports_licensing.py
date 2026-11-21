"""GET /reports/licensing: gate, rows across metrics, statuses, the Platform aggregate."""

from __future__ import annotations

from collections import Counter

import pytest
from sqlalchemy import select, update

from app.models.app_settings import AppSettings
from app.models.card_license import CardLicense
from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.services.fiscal_year import current_fiscal_year
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_license_metric,
    create_license_type,
    create_relation,
    create_relation_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

CUR = current_fiscal_year(1)
FORECAST = CUR + 1
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
        await create_card_type(
            db,
            key=key,
            label=key,
            fields_schema=[{"section": "S", "fields": [{"key": "tier", "type": "single_select"}]}],
        )
    await create_card_type(db, key="Platform", label="Platform")
    await create_relation_type(
        db, key="relPlatformToApp", source_type_key="Platform", target_type_key="Application"
    )
    await create_relation_type(
        db, key="relPlatformToITC", source_type_key="Platform", target_type_key="ITComponent"
    )
    await create_license_metric(db, "users", "Users", sort_order=1)
    await create_license_metric(db, "installations", "Installations", sort_order=2)
    await create_license_type(db, "admin", "Admin")
    await create_license_type(db, "dev", "Dev")
    await create_license_type(db, "seat", "Seat", metric_key="installations")
    return users


async def _card(db, name, card_type="Application", **kw):
    return await create_card(db, card_type=card_type, name=name, **kw)


async def _row(db, card, year, **metrics):
    db.add(
        CardLicense(
            card_id=card.id,
            fiscal_year=year,
            items={
                m: {k: {"licensed": v[0], "actual": v[1]} for k, v in cells.items()}
                for m, cells in metrics.items()
            },
        )
    )
    await db.flush()


async def _hide_itc(db):
    await db.execute(
        update(CardType).where(CardType.key == "ITComponent").values(role_permissions=HIDE_ITC)
    )
    await db.flush()


async def _get(client, env, user="admin", **params):
    params = {"card_types": "Application", **params}
    return await client.get(
        "/api/v1/reports/licensing", params=params, headers=auth_headers(env[user])
    )


async def test_requires_licenses_view(client, db, env):
    assert (await _get(client, env, "viewer")).status_code == 403
    assert (await _get(client, env, "member")).status_code == 200


async def test_report_hides_cost_attributes_per_card(client, db, env):
    await create_role(
        db,
        key="lic_cost_reader",
        permissions={"inventory.view": True, "licenses.view": True, "costs.view": True},
    )
    user = await create_user(db, email="lic-cost-reader@test.com", role="lic_cost_reader")
    await create_stakeholder_role_def(
        db,
        key="license_reader",
        permissions={"card.view": True, "card.view_licenses": True},
    )
    card = await _card(db, "Readable", attributes={"costPrice": 90, "tier": "gold"})
    db.add(Stakeholder(card_id=card.id, user_id=user.id, role="license_reader"))
    card_type = (
        await db.execute(select(CardType).where(CardType.key == "Application"))
    ).scalar_one()
    card_type.fields_schema = [
        {
            "section": "S",
            "fields": [
                {"key": "costPrice", "type": "cost"},
                {"key": "tier", "type": "single_select"},
            ],
        }
    ]
    card_type.role_permissions = {"lic_cost_reader": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()

    response = await _get(client, {"restricted": user}, "restricted", group_by="field:costPrice")
    assert response.status_code == 200, response.text
    row = response.json()["rows"][0]
    assert row["attributes"] == {"tier": "gold"}
    assert row["group"] == "__other__"


async def test_rows_statuses_and_tiles_match_the_rows(client, db, env):
    over = await _card(db, "Over")
    near = await _card(db, "Near")
    nodata = await _card(db, "NoData")
    await _card(db, "Bare")
    await _row(db, over, CUR, users={"admin": (10, 12)})
    await _row(db, near, CUR, users={"admin": (10, 9)})
    await _row(db, nodata, CUR, users={"admin": (10, None)})
    body = (await _get(client, env)).json()
    assert body["fiscal_year"] == body["current_fiscal_year"] == CUR and body["aggregate"] is None
    assert {r["name"]: r["status"] for r in body["rows"]} == {
        "Over": "over",
        "Near": "approaching",
        "NoData": "no_actual_data",
        "Bare": "no_actual_data",
    }
    assert Counter(r["status"] for r in body["rows"]) == {
        "over": 1,
        "approaching": 1,
        "no_actual_data": 2,
    }
    assert "trend" not in body and "license_types" not in body


async def test_metric_and_license_type_filters(client, db, env):
    a = await _card(db, "A")
    b = await _card(db, "B")
    await _row(db, a, CUR, users={"admin": (10, 4)})
    await _row(db, b, CUR, installations={"seat": (5, 5)})
    only_inst = (await _get(client, env, metric="installations")).json()
    assert [r["name"] for r in only_inst["rows"]] == ["B"]
    assert only_inst["metrics_in_year"] == ["users", "installations"]
    pair = (await _get(client, env, license_type="installations:seat")).json()
    assert [r["name"] for r in pair["rows"]] == ["B"]


async def test_two_card_types_in_one_report(client, db, env):
    await _card(db, "App")
    await _card(db, "Itc", card_type="ITComponent")
    body = (await _get(client, env, card_types="Application,ITComponent")).json()
    assert sorted((r["name"], r["type"]) for r in body["rows"]) == [
        ("App", "Application"),
        ("Itc", "ITComponent"),
    ]


async def test_past_year_lists_only_cards_with_a_row(client, db, env):
    a = await _card(db, "Row")
    await _card(db, "NoRow")
    await _row(db, a, CUR - 1, users={"admin": (10, 5)})
    past = (await _get(client, env, fiscal_year=CUR - 1)).json()
    assert [r["name"] for r in past["rows"]] == ["Row"]


async def test_rows_carry_confirmed_for_a_stored_year_and_not_for_a_carried_one(client, db, env):
    own = await _card(db, "Own")
    carried = await _card(db, "Carried")
    await _row(db, own, CUR, users={"admin": (10, 4)})
    await _row(db, carried, CUR - 1, users={"admin": (10, 9)})
    body = (await _get(client, env)).json()
    assert {r["name"]: r["confirmed"] for r in body["rows"]} == {"Own": True, "Carried": False}
    past = (await _get(client, env, fiscal_year=CUR - 1)).json()
    assert {r["name"]: r["confirmed"] for r in past["rows"]} == {"Carried": True}


async def test_card_types_default_to_both_license_types(client, db, env):
    await _card(db, "App")
    await _card(db, "Itc", card_type="ITComponent")
    resp = await client.get("/api/v1/reports/licensing", headers=auth_headers(env["admin"]))
    assert sorted(r["name"] for r in resp.json()["rows"]) == ["App", "Itc"]


async def test_card_types_are_not_checked_for_a_picked_card(client, db, env):
    plat = await create_card(db, card_type="Platform", name="Plat")
    a = await _card(db, "A")
    await create_relation(db, type_key="relPlatformToApp", source_id=plat.id, target_id=a.id)
    resp = await _get(client, env, card_id=str(plat.id), card_types="Platform")
    assert resp.status_code == 200 and [r["name"] for r in resp.json()["rows"]] == ["A"]
    assert (await _get(client, env, card_types="Platform")).status_code == 400


async def test_the_year_is_checked_before_the_card_types(client, db, env):
    resp = await _get(client, env, card_types="Bogus", fiscal_year=FORECAST)
    assert resp.status_code == 400 and resp.json()["detail"] == "forecast_not_selectable"


async def test_forecast_year_refused(client, db, env):
    resp = await _get(client, env, fiscal_year=FORECAST)
    assert resp.status_code == 400 and resp.json()["detail"] == "forecast_not_selectable"
    assert (await _get(client, env, fiscal_year=CUR - 5)).status_code == 400


@pytest.mark.parametrize(
    "params",
    [
        {"metric": "seats"},
        {"license_type": "admin"},
        {"license_type": "users:nope"},
        {"card_types": "Platform"},
        {"card_types": "Application,Application"},
        {"card_types": ""},
        {"group_by": "field:nope"},
    ],
)
async def test_bad_parameters_refused(client, db, env, params):
    assert (await _get(client, env, **params)).status_code == 400


async def test_hidden_card_omitted_from_rows(client, db, env):
    hidden = await _card(db, "Secret", card_type="ITComponent")
    await _row(db, hidden, CUR, users={"admin": (1, 1)})
    await _hide_itc(db)
    admin_body = (await _get(client, env, card_types="ITComponent")).json()
    assert [r["name"] for r in admin_body["rows"]] == ["Secret"]  # non-vacuity
    body = (await _get(client, env, "member", card_types="ITComponent")).json()
    assert body["rows"] == [] and body["metrics_in_year"] == [] and body["types_in_year"] == []
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
    await _row(db, a, CUR, users={"admin": (10, 5)})
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
    for c in (archived, retired):
        await create_relation(db, type_key="relPlatformToApp", source_id=plat.id, target_id=c.id)
    for c in (both, itc, archived, retired):
        await _row(db, c, CUR, users={"admin": (10, 4)})
    body = (await _get(client, env, card_id=str(plat.id))).json()
    assert body["aggregate"] == {"id": str(plat.id), "name": "Plat", "type": "Platform"}
    assert sorted(r["name"] for r in body["rows"]) == ["Both", "Itc"]


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
    await _row(db, a, CUR - 2, users={"admin": (3, 3)})
    body = (await _get(client, env, card_id=str(plat.id), fiscal_year=CUR - 2)).json()
    assert [r["name"] for r in body["rows"]] == ["Row"]


async def test_platform_aggregate_rows_have_no_status(client, db, env):
    plat = await create_card(db, card_type="Platform", name="Plat")
    a = await _card(db, "A")
    await create_relation(db, type_key="relPlatformToApp", source_id=plat.id, target_id=a.id)
    await _row(db, a, CUR, users={"admin": (1, 5)})
    row = (await _get(client, env, card_id=str(plat.id))).json()["rows"][0]
    assert row["status"] is None
    assert row["by_metric"][0]["types"][0]["status"] == "over"  # the per-type figures stay


async def test_fiscal_year_start_april_names_the_current_year(client, db, env):
    db.add(AppSettings(id="default", general_settings={"fiscalYearStart": 4}))
    await db.flush()
    cur4 = current_fiscal_year(4)
    a = await _card(db, "A")
    await _row(db, a, cur4, users={"admin": (10, 5)})
    body = (await _get(client, env)).json()
    assert body["current_fiscal_year"] == cur4 and body["fiscal_year"] == cur4
    assert body["fiscal_year_start"] == 4
    assert body["years"] == list(range(cur4 - 4, cur4 + 2))
    assert [r["name"] for r in body["rows"]] == ["A"]
    assert (await _get(client, env, fiscal_year=cur4 + 1)).status_code == 400


async def test_cost_attributes_are_stripped_without_costs_view(client, db, env):
    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    ct.fields_schema = [{"section": "C", "fields": [{"key": "price", "type": "cost"}]}]
    await create_card(db, card_type="Application", name="A", attributes={"price": 99})
    await db.flush()
    assert "price" not in (await _get(client, env, "member")).json()["rows"][0]["attributes"]
    assert (await _get(client, env)).json()["rows"][0]["attributes"]["price"] == 99
