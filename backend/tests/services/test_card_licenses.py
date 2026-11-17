from __future__ import annotations

import json

import pytest
from sqlalchemy import select

from app.models.app_settings import AppSettings
from app.models.card_license import CardLicense
from app.models.event import Event
from app.services import card_licenses as svc
from app.services import license_metrics, license_types
from app.services.fiscal_year import current_fiscal_year
from tests.conftest import create_card, create_card_type, create_license_type, create_user

SM = 1
CUR = current_fiscal_year(SM)


def cell(licensed, actual=None):
    return {"licensed": licensed, "actual": actual}


async def _setup(db, archived=(), model=("users", "installations")):
    for metric in ("users", "installations"):
        for key in ("admin", "prod", "old"):
            await create_license_type(db, key, key.upper(), metric_key=metric)
            if key in archived:
                await license_types.update_item(db, metric, key, archived=True)
    await create_card_type(db, key="Application")
    return await create_card(db, attributes={"licensingModel": list(model)})


async def _row(db, card, year, items):
    db.add(CardLicense(card_id=card.id, fiscal_year=year, items=items))
    await db.flush()


async def test_carry_forward_is_licensed_only(db):
    card = await _setup(db)
    await _row(db, card, CUR - 1, {"users": {"admin": cell(10, 9)}})
    yl = await svc.get_year(db, card, CUR, SM)
    users = yl.metrics[0]
    assert (users.types[0].licensed, users.types[0].actual) == (10, None)
    assert yl.confirmed is False and yl.fallback_from == CUR - 1
    assert yl.status == "no_actual_data"


async def test_confirm_materialises_licensed_only(db):
    card = await _setup(db)
    await _row(db, card, CUR - 1, {"users": {"admin": cell(10, 9)}})
    await svc.confirm_year(db, card.id, CUR)
    row = (
        await db.execute(
            select(CardLicense).where(
                CardLicense.card_id == card.id, CardLicense.fiscal_year == CUR
            )
        )
    ).scalar_one()
    assert row.items == {"users": {"admin": cell(10, None)}}
    assert (await svc.get_year(db, card, CUR, SM)).confirmed is True


async def test_merge_unset_keeps_and_none_clears(db):
    card = await _setup(db)
    await svc.merge_cell(db, card.id, CUR, "users", "admin", licensed=10, actual=7)
    await svc.merge_cell(db, card.id, CUR, "users", "admin", actual=svc.UNSET, licensed=svc.UNSET)
    await svc.merge_cell(db, card.id, CUR, "users", "admin", licensed=svc.UNSET, actual=8)
    items = (await svc._resolve(db, card.id, CUR, SM))[0]
    assert items["users"]["admin"] == cell(10, 8)
    await svc.merge_cell(db, card.id, CUR, "users", "admin", actual=None)
    assert (await svc._resolve(db, card.id, CUR, SM))[0]["users"]["admin"] == cell(10, None)
    await svc.merge_cell(db, card.id, CUR, "users", "prod", actual=3)  # new cell, licensed 0
    assert (await svc._resolve(db, card.id, CUR, SM))[0]["users"]["prod"] == cell(0, 3)


async def test_forecast_rejects_actual(db):
    card = await _setup(db)
    with pytest.raises(svc.LicenseError) as e:
        await svc.merge_cell(db, card.id, CUR + 1, "users", "admin", licensed=1, actual=2)
    assert e.value.code == "forecast_actual"
    await svc.merge_cell(db, card.id, CUR + 1, "users", "admin", licensed=1, actual=None)


async def test_archived_type_editable_when_present_refused_when_new(db):
    card = await _setup(db, archived=("old",))
    await _row(db, card, CUR, {"users": {"old": cell(5, 1)}})
    await svc.merge_cell(db, card.id, CUR, "users", "old", actual=4)  # the cell exists
    assert (await svc._resolve(db, card.id, CUR, SM))[0]["users"]["old"]["actual"] == 4
    with pytest.raises(svc.LicenseError) as e:  # a new cell (other metric) on it
        await svc.merge_cell(db, card.id, CUR, "installations", "old", licensed=1)
    assert e.value.code == "archived_type"


async def test_archived_type_in_carried_forward_current_year(db):
    card = await _setup(db, archived=("old",))
    await _row(db, card, CUR - 1, {"users": {"old": cell(5, 1)}})
    await svc.merge_cell(db, card.id, CUR, "users", "old", actual=2)
    assert (await svc._resolve(db, card.id, CUR, SM))[0]["users"]["old"] == cell(5, 2)


@pytest.mark.parametrize(
    "kw,code",
    [
        ({"key": "nope", "licensed": 1}, "unknown_type"),
        ({"metric": "seats", "licensed": 1}, "invalid_metric"),
        ({"licensed": True}, "invalid_count"),
        ({"licensed": -1}, "invalid_count"),
        ({"licensed": 1.5}, "invalid_count"),
        ({"licensed": 1_000_000_001}, "invalid_count"),
        ({"licensed": 1, "actual": True}, "invalid_count"),
        ({"licensed": 1, "fy": CUR + 2}, "year_out_of_range"),
        ({"licensed": 1, "fy": CUR - 6}, "year_out_of_range"),
    ],
)
async def test_unknown_type_bad_metric_and_bool_count_refused(db, kw, code):
    card = await _setup(db)
    kw = dict(kw)
    with pytest.raises(svc.LicenseError) as e:
        await svc.merge_cell(
            db, card.id, kw.pop("fy", CUR), kw.pop("metric", "users"), kw.pop("key", "admin"), **kw
        )
    assert e.value.code == code


async def test_copy_to_forecast_copies_licensed_only(db):
    card = await _setup(db, archived=("old",))
    await _row(db, card, CUR, {"users": {"admin": cell(10, 9), "old": cell(4, 4)}})
    await svc.copy_to_forecast(db, card.id, CUR, "users", "admin")
    await svc.copy_to_forecast(db, card.id, CUR, "users", "old")  # archived but present
    items = (await svc._resolve(db, card.id, CUR + 1, SM))[0]
    assert items["users"] == {"admin": cell(10, None), "old": cell(4, None)}
    with pytest.raises(svc.LicenseError):
        await svc.copy_to_forecast(db, card.id, CUR + 1, "users", "admin")
    with pytest.raises(svc.LicenseError) as e:
        await svc.copy_to_forecast(db, card.id, CUR, "users", "prod")
    assert e.value.code == "unknown_type"


async def test_delete_absent_cell_is_noop_without_event(db):
    card = await _setup(db)
    user = await create_user(db, email="d@lic.com")
    await _row(db, card, CUR, {"users": {"admin": cell(1, 1)}})
    assert await svc.delete_cell(db, card.id, CUR, "users", "prod") is False
    assert await svc.apply_write(
        db, card, user.id, CUR, lambda: svc.delete_cell(db, card.id, CUR, "users", "prod")
    )
    evs = (await db.execute(select(Event).where(Event.card_id == card.id))).scalars().all()
    assert evs == []
    assert await svc.delete_cell(db, card.id, CUR, "users", "admin") is True
    assert (await svc._resolve(db, card.id, CUR, SM))[0] == {}


async def test_metrics_come_from_the_cells_in_catalogue_order(db):
    card = await _setup(db)
    await license_metrics.update_item(db, "installations", sort_order=0)
    await license_metrics.update_item(db, "users", sort_order=1)
    await svc.merge_cell(db, card.id, CUR, "users", "admin", licensed=2, actual=1)
    await svc.merge_cell(db, card.id, CUR, "installations", "admin", licensed=5, actual=5)
    yl = await svc.get_year(db, card, CUR, SM)
    assert [m.metric for m in yl.metrics] == ["installations", "users"]
    assert yl.pair_keys == ["installations:admin", "users:admin"]


async def test_year_with_only_unactualised_cell_shows_one_metric_no_actual_data(db):
    card = await _setup(db)
    await _row(db, card, CUR, {"users": {"admin": cell(5, None)}})
    yl = await svc.get_year(db, card, CUR, SM)
    assert [m.metric for m in yl.metrics] == ["users"] and yl.status == "no_actual_data"


async def test_year_without_cells_has_no_metric(db):
    card = await _setup(db)
    yl = await svc.get_year(db, card, CUR, SM)
    assert yl.metrics == [] and yl.status == "no_actual_data" and yl.pair_keys == []


async def test_unknown_metric_in_stored_cells_is_shown_by_its_key(db):
    card = await _setup(db)
    await _row(db, card, CUR, {"zzz": {"a": cell(1, 5)}, "users": {"admin": cell(5, 1)}})
    yl = await svc.get_year(db, card, CUR, SM)
    assert [m.metric for m in yl.metrics] == ["users", "zzz"]
    assert yl.status == "over"


async def test_same_type_key_under_two_metrics_is_two_cells(db):
    card = await _setup(db)
    await svc.merge_cell(db, card.id, CUR, "users", "admin", licensed=1)
    await svc.merge_cell(db, card.id, CUR, "installations", "admin", licensed=2)
    items = (await svc._resolve(db, card.id, CUR, SM))[0]
    assert (items["users"]["admin"]["licensed"], items["installations"]["admin"]["licensed"]) == (
        1,
        2,
    )


async def test_type_of_another_metric_is_unknown_in_this_one(db):
    card = await _setup(db)
    await create_license_type(db, "seat", "Seat", metric_key="installations")
    with pytest.raises(svc.LicenseError) as e:
        await svc.merge_cell(db, card.id, CUR, "users", "seat", licensed=1)
    assert e.value.code == "unknown_type"


async def test_archived_metric_refuses_a_new_cell_but_keeps_an_existing_one(db):
    card = await _setup(db)
    await _row(db, card, CUR, {"users": {"admin": cell(5, 1)}})
    await license_metrics.update_item(db, "users", archived=True)
    await svc.merge_cell(db, card.id, CUR, "users", "admin", actual=3)
    with pytest.raises(svc.LicenseError) as e:
        await svc.merge_cell(db, card.id, CUR, "users", "prod", licensed=1)
    assert e.value.code == "archived_metric"


async def test_carried_current_year_pairs_follow_the_carried_cells(db):
    card = await _setup(db)
    await _row(db, card, CUR - 1, {"users": {"admin": cell(10, 9)}})
    yl = await svc.get_year(db, card, CUR, SM)
    assert yl.pair_keys == ["users:admin"] and yl.metrics[0].types[0].actual is None


async def test_window_follows_fiscal_year_start(db):
    card = await _setup(db)
    db.add(AppSettings(id="default", general_settings={"fiscalYearStart": 4}))
    await db.flush()
    cur = current_fiscal_year(4)
    window = await svc.get_window(db, card, 4)
    assert [y.fiscal_year for y in window] == list(range(cur - 4, cur + 2))
    assert [y.is_current for y in window].count(True) == 1
    assert window[-1].is_forecast and window[-1].status is None
    await svc.merge_cell(db, card.id, cur + 1, "users", "admin", licensed=1)  # April's forecast


async def test_event_carries_type_keys_only(db):
    card = await _setup(db)
    user = await create_user(db, email="e@lic.com")
    await svc.apply_write(
        db,
        card,
        user.id,
        CUR,
        lambda: svc.merge_cell(db, card.id, CUR, "users", "admin", licensed=12345, actual=678),
    )
    ev = (await db.execute(select(Event).where(Event.card_id == card.id))).scalar_one()
    assert ev.event_type == svc.LICENSE_EVENT
    assert ev.data["changes"] == {"license_types": {"old": [], "new": ["users:admin"]}}
    assert ev.data["fiscal_year"] == CUR
    # The event's own random id could contain any short digit run: look at the rest.
    blob = json.dumps({k: v for k, v in ev.data.items() if k != "id"})
    assert "12345" not in blob and "678" not in blob and "licensed" not in blob


@pytest.mark.parametrize("fy", [CUR - 6, CUR + 2])
async def test_delete_outside_the_write_window_is_refused(db, fy):
    card = await _setup(db)
    await _row(db, card, fy, {"users": {"admin": cell(1, 1)}})
    with pytest.raises(svc.LicenseError) as e:
        await svc.delete_cell(db, card.id, fy, "users", "admin")
    assert e.value.code == "year_out_of_range"
    # the row is untouched
    assert (await svc._resolve(db, card.id, fy, SM))[0] == {"users": {"admin": cell(1, 1)}}
