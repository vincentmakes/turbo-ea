from __future__ import annotations

from datetime import date

import pytest

from app.models.card_cost import CardCost
from app.services import card_costs as svc
from app.services import cost_item_types as cat
from app.services.fiscal_year import current_fiscal_year
from tests.conftest import create_card, create_card_type

SM = 1
CUR = current_fiscal_year(SM)


async def _setup(db, archived=()):
    for key in ("lic", "ams", "old"):
        await cat.create_item(db, key, key.upper(), None)
    for key in archived:
        await cat.update_item(db, key, archived=True)
    await create_card_type(
        db,
        key="Application",
        fields_schema=[
            {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}
        ],
    )
    return await create_card(db)


async def _row(db, card, year, items):
    db.add(CardCost(card_id=card.id, fiscal_year=year, items=items))
    await db.flush()


def _it(amount, renewal=None):
    return {"amount": amount, "renewal_date": renewal}


async def test_tco_counts_archived(db):
    card = await _setup(db, archived=("old",))
    await _row(db, card, CUR, {"lic": _it(10), "old": _it(5)})
    yc = await svc.get_year_row(db, card.id, CUR, SM)
    assert yc.tco == 15
    assert {line.key: line.archived for line in yc.items} == {"lic": False, "old": True}
    assert yc.confirmed and yc.is_current and not yc.is_forecast


async def test_empty_row_does_not_fall_back_but_missing_row_does(db):
    card = await _setup(db)
    await _row(db, card, CUR - 1, {"lic": _it(10)})
    missing = await svc.get_year_row(db, card.id, CUR, SM)
    assert (missing.tco, missing.confirmed, missing.fallback_from) == (10, False, CUR - 1)
    await _row(db, card, CUR, {})
    empty = await svc.get_year_row(db, card.id, CUR, SM)
    assert (empty.tco, empty.confirmed, empty.fallback_from, empty.items) == (0, True, None, [])


async def test_forecast_and_past_without_row_stay_empty(db):
    card = await _setup(db)
    await _row(db, card, CUR, {"lic": _it(10)})
    await _row(db, card, CUR - 3, {"lic": _it(1)})
    fc = await svc.get_year_row(db, card.id, CUR + 1, SM)
    assert fc.is_forecast and fc.tco == 0 and fc.fallback_from is None
    past = await svc.get_year_row(db, card.id, CUR - 2, SM)
    assert past.tco == 0 and past.fallback_from is None


async def test_no_earlier_row_is_empty(db):
    card = await _setup(db)
    yc = await svc.get_year_row(db, card.id, CUR, SM)
    assert yc.tco == 0 and yc.items == [] and yc.fallback_from is None and not yc.confirmed


async def test_fallback_renewal_shifted_by_skipped_years(db):
    card = await _setup(db)
    await _row(db, card, CUR - 1, {"lic": _it(10, "2026-12-31")})
    yc = await svc.get_year_row(db, card.id, CUR, SM)
    assert yc.items[0].renewal_date == date(2027, 12, 31)
    await db.delete(await db.get(CardCost, (await _id(db, card, CUR - 1))))
    await db.flush()
    await _row(db, card, CUR - 2, {"lic": _it(10, "2026-12-31")})
    yc = await svc.get_year_row(db, card.id, CUR, SM)
    assert yc.items[0].renewal_date == date(2028, 12, 31) and yc.fallback_from == CUR - 2


async def _id(db, card, year):
    from sqlalchemy import select

    return (
        await db.execute(
            select(CardCost.id).where(CardCost.card_id == card.id, CardCost.fiscal_year == year)
        )
    ).scalar_one()


async def test_window_six_years(db):
    card = await _setup(db)
    w = await svc.get_window(db, card.id, SM)
    assert [y.fiscal_year for y in w] == list(range(CUR - 4, CUR + 2))


async def test_upsert_in_fallback_materialises_set_then_applies(db):
    card = await _setup(db)
    await _row(db, card, CUR - 1, {"lic": _it(10), "ams": _it(4)})
    assert await svc.upsert_item(db, card.id, CUR, "lic", 12, None) is None
    yc = await svc.get_year_row(db, card.id, CUR, SM)
    assert yc.confirmed and yc.fallback_from is None
    assert {line.key: line.amount for line in yc.items} == {"lic": 12, "ams": 4}
    assert yc.tco == 16


async def test_confirm_year_stores_unchanged(db):
    card = await _setup(db)
    await _row(db, card, CUR - 1, {"lic": _it(10)})
    assert await svc.confirm_year(db, card.id, CUR) is None
    again = await svc.get_year_row(db, card.id, CUR, SM)
    assert again.confirmed and again.tco == 10


async def test_archived_new_item_refused_existing_editable(db):
    card = await _setup(db, archived=("old",))
    with pytest.raises(svc.CostError) as e:
        await svc.upsert_item(db, card.id, CUR, "old", 5, None)
    assert e.value.code == "archived_item"
    await _row(db, card, CUR, {"old": _it(5)})
    await svc.upsert_item(db, card.id, CUR, "old", 7, None)
    assert (await svc.get_year_row(db, card.id, CUR, SM)).tco == 7


async def test_archived_item_removed_since_snapshot_cannot_be_reintroduced(db, monkeypatch):
    card = await _setup(db, archived=("old",))
    await _row(db, card, CUR, {"lic": _it(10)})
    resolve = svc._resolve

    async def stale_snapshot(db, card_id, fiscal_year, start_month):
        return {"old": _it(5), "lic": _it(10)}, True, None

    monkeypatch.setattr(svc, "_resolve", stale_snapshot)
    with pytest.raises(svc.CostError) as exc:
        await svc.upsert_item(db, card.id, CUR, "old", 7, None)
    assert exc.value.code == "archived_item"
    assert str(exc.value) == "Cost item 'old' is archived"
    monkeypatch.setattr(svc, "_resolve", resolve)
    unchanged = await svc.get_year_row(db, card.id, CUR, SM)
    assert {item.key: item.amount for item in unchanged.items} == {"lic": 10}
    await svc.upsert_item(db, card.id, CUR, "lic", 12, None)
    assert (await svc.get_year_row(db, card.id, CUR, SM)).tco == 12


async def test_unknown_item_and_negative_amount(db):
    card = await _setup(db)
    with pytest.raises(svc.CostError) as e:
        await svc.upsert_item(db, card.id, CUR, "zzz", 5, None)
    assert e.value.code == "unknown_item"
    with pytest.raises(svc.CostError) as e:
        await svc.upsert_item(db, card.id, CUR, "lic", -1, None)
    assert e.value.code == "invalid_amount"


async def test_put_window(db):
    card = await _setup(db)
    for year in (CUR - 6, CUR + 2):
        with pytest.raises(svc.CostError) as e:
            await svc.upsert_item(db, card.id, year, "lic", 1, None)
        assert e.value.code == "year_out_of_range"
    await svc.upsert_item(db, card.id, CUR - 5, "lic", 1, None)
    await svc.upsert_item(db, card.id, CUR + 1, "lic", 1, date(2030, 1, 1))


async def test_get_year_row_outside_window(db):
    card = await _setup(db)
    await _row(db, card, CUR - 5, {"lic": _it(3)})
    assert (await svc.get_year_row(db, card.id, CUR - 5, SM)).tco == 3
    assert (await svc.get_year_row(db, card.id, CUR - 9, SM)).tco == 0


async def test_delete_item(db):
    card = await _setup(db)
    await _row(db, card, CUR, {"lic": _it(3), "ams": _it(2)})
    await svc.delete_item(db, card.id, CUR, "lic")
    assert (await svc.get_year_row(db, card.id, CUR, SM)).tco == 2


async def test_copy_to_forecast_overwrites_and_shifts(db):
    card = await _setup(db, archived=("old",))
    await _row(db, card, CUR, {"lic": _it(10, "2026-06-30"), "old": _it(5)})
    await _row(db, card, CUR + 1, {"lic": _it(99)})
    assert await svc.copy_to_forecast(db, card.id, CUR, "lic") is None
    yc = await svc.get_year_row(db, card.id, CUR + 1, SM)
    assert yc.is_forecast and yc.items[0].amount == 10
    assert yc.items[0].renewal_date == date(2027, 6, 30)
    await svc.copy_to_forecast(db, card.id, CUR, "old")
    assert (await svc.get_year_row(db, card.id, CUR + 1, SM)).tco == 15


async def test_copy_to_forecast_feb29(db):
    card = await _setup(db)
    await _row(db, card, CUR, {"lic": _it(1, "2028-02-29")})
    await svc.copy_to_forecast(db, card.id, CUR, "lic")
    yc = await svc.get_year_row(db, card.id, CUR + 1, SM)
    assert yc.items[0].renewal_date == date(2029, 2, 28)


async def test_copy_to_forecast_missing_source(db):
    card = await _setup(db)
    with pytest.raises(svc.CostError) as e:
        await svc.copy_to_forecast(db, card.id, CUR, "lic")
    assert e.value.code == "unknown_item"


async def test_recompute_derived_uses_fallback_tco(db):
    card = await _setup(db)
    card.attributes = {"x": 1, "costTotalAnnual": 999}
    await _row(db, card, CUR - 1, {"lic": _it(10), "ams": _it(4)})
    await svc.recompute_derived(db, card)
    assert card.attributes == {"x": 1, "costTotalAnnual": 14}


async def test_delete_item_outside_put_window(db):
    card = await _setup(db)
    await _row(db, card, CUR - 8, {"lic": _it(3), "ams": _it(2)})
    await svc.delete_item(db, card.id, CUR - 8, "lic")
    assert (await svc.get_year_row(db, card.id, CUR - 8, SM)).tco == 2


async def test_editable_is_get_or_create_and_keeps_existing_items(db):
    from sqlalchemy import func, select

    card = await _setup(db)
    await _row(db, card, CUR - 1, {"lic": _it(10)})
    first = await svc._editable(db, card.id, CUR, SM)
    assert first.items["lic"]["amount"] == 10
    first.items = {**first.items, "ams": _it(4)}
    await db.flush()
    second = await svc._editable(db, card.id, CUR, SM)
    assert second.id == first.id and set(second.items) == {"lic", "ams"}
    n = await db.scalar(
        select(func.count())
        .select_from(CardCost)
        .where(CardCost.card_id == card.id, CardCost.fiscal_year == CUR)
    )
    assert n == 1


async def _row_count(db, card):
    from sqlalchemy import func, select

    return await db.scalar(
        select(func.count()).select_from(CardCost).where(CardCost.card_id == card.id)
    )


async def test_delete_of_a_key_the_year_lacks_is_a_noop(db):
    card = await _setup(db)
    await _row(db, card, CUR - 8, {"lic": _it(3)})
    assert await svc.delete_item(db, card.id, CUR - 8, "ams") is False
    assert await svc.delete_item(db, card.id, 1990, "lic") is False  # no row in a locked year
    assert await _row_count(db, card) == 1


async def test_delete_of_a_fallback_key_still_materialises_the_year(db):
    card = await _setup(db)
    await _row(db, card, CUR - 1, {"lic": _it(10), "ams": _it(4)})
    assert await svc.delete_item(db, card.id, CUR, "lic") is True
    yc = await svc.get_year_row(db, card.id, CUR, SM)
    assert yc.confirmed and [i.key for i in yc.items] == ["ams"]


def test_display_window_is_one_year_shorter_than_the_put_window():
    assert svc.WINDOW_PAST == 4 and svc.FISCAL_YEAR_LOOKBACK == 5
    svc._check_window(CUR - svc.FISCAL_YEAR_LOOKBACK, SM)
    with pytest.raises(svc.CostError):
        svc._check_window(CUR - svc.FISCAL_YEAR_LOOKBACK - 1, SM)


def test_shift_survives_a_stored_year_out_of_range():
    assert svc._shift("9999-12-31", 1) == "9999-12-31"
    assert svc._shift("0001-01-01", -1) == "0001-01-01"
    assert svc._shift("2028-02-29", 1) == "2029-02-28"


async def test_current_year_reads_a_legacy_out_of_range_renewal_date(db):
    card = await _setup(db)
    await _row(db, card, CUR - 1, {"lic": _it(10, "9999-12-31")})
    yc = await svc.get_year_row(db, card.id, CUR, SM)
    assert yc.items[0].renewal_date == date(9999, 12, 31)


# ── mutation hardening: messages, locks, bounds and event payload ─────────────────────────────


def test_cost_error_str_is_the_message_or_else_the_code():
    assert str(svc.CostError("some_code")) == "some_code"
    assert str(svc.CostError("some_code", "readable")) == "readable"
    assert svc.CostError("some_code", "readable").code == "some_code"


def _spy_rows(monkeypatch):
    """Record ``(card_id, fiscal_year, lock)`` for every ``_row`` call."""
    calls: list[tuple] = []
    real = svc._row

    async def spy(db, card_id, fy, lock=False):
        calls.append((card_id, fy, lock))
        return await real(db, card_id, fy, lock=lock)

    monkeypatch.setattr(svc, "_row", spy)
    return calls


def _spy_statements(db, monkeypatch):
    seen: list = []
    real = db.execute

    async def spy(stmt, *a, **kw):
        seen.append(stmt)
        return await real(stmt, *a, **kw)

    monkeypatch.setattr(db, "execute", spy)
    return seen


def _sql(stmt) -> str:
    from sqlalchemy.dialects import postgresql

    return str(stmt.compile(dialect=postgresql.dialect()))


async def test_row_only_locks_when_asked_and_then_refreshes_the_identity_map(db, monkeypatch):
    card = await _setup(db)
    await _row(db, card, CUR, {"lic": _it(1)})
    seen = _spy_statements(db, monkeypatch)
    await svc._row(db, card.id, CUR)
    assert "FOR UPDATE" not in _sql(seen[-1])
    assert "populate_existing" not in seen[-1].get_execution_options()
    await svc._row(db, card.id, CUR, lock=True)
    assert "FOR UPDATE" in _sql(seen[-1])
    assert seen[-1].get_execution_options()["populate_existing"] is True


async def test_locked_row_is_re_read_from_the_database(db):
    from sqlalchemy import update

    card = await _setup(db)
    await _row(db, card, CUR, {"lic": _it(1)})
    cached = await svc._row(db, card.id, CUR)
    await db.execute(
        update(CardCost)
        .where(CardCost.card_id == card.id)
        .values(items={"lic": _it(2)})
        .execution_options(synchronize_session=False)
    )
    assert (await svc._row(db, card.id, CUR, lock=True)) is cached
    assert cached.items["lic"]["amount"] == 2


async def test_fallback_row_is_the_latest_strictly_earlier_year(db):
    card = await _setup(db)
    for year in (CUR - 3, CUR - 1, CUR - 2, CUR, CUR + 1):  # not in year order on purpose
        await _row(db, card, year, {"lic": _it(year - CUR + 100)})
    got = await svc._fallback_row(db, card.id, CUR)
    assert got is not None and got.fiscal_year == CUR - 1
    assert (await svc._fallback_row(db, card.id, CUR - 3)) is None  # nothing earlier


async def test_lines_default_to_not_archived_for_an_unknown_key():
    lines = svc._lines({"zz": _it(2, "2030-01-02")}, {})
    assert [(i.key, i.amount, i.archived, i.renewal_date) for i in lines] == [
        ("zz", 2.0, False, date(2030, 1, 2))
    ]


async def test_fallback_is_only_looked_up_for_a_current_year_without_a_row(db, monkeypatch):
    card = await _setup(db)
    await _row(db, card, CUR, {"lic": _it(1)})
    await _row(db, card, CUR - 1, {"lic": _it(5)})
    asked: list[int] = []

    async def spy(db_, card_id, fy):
        asked.append(fy)
        return None

    monkeypatch.setattr(svc, "_fallback_row", spy)
    await svc._resolve(db, card.id, CUR, SM)  # has a row
    await svc._resolve(db, card.id, CUR - 2, SM)  # no row, but not the current year
    await svc._resolve(db, card.id, CUR + 1, SM)
    assert asked == []
    await db.delete(await db.get(CardCost, await _id(db, card, CUR)))
    await db.flush()
    await svc._resolve(db, card.id, CUR, SM)
    assert asked == [CUR]


async def test_window_reads_the_rows_of_this_card(db):
    card = await _setup(db)
    await _row(db, card, CUR - 2, {"lic": _it(7)})
    await _row(db, card, CUR + 1, {"ams": _it(3)})
    other = await create_card(db, name="Other")
    await _row(db, other, CUR - 2, {"lic": _it(1000)})
    w = await svc.get_window(db, card.id, SM)
    assert {y.fiscal_year: y.tco for y in w}[CUR - 2] == 7
    assert {y.fiscal_year: y.tco for y in w}[CUR + 1] == 3


def test_check_window_message_names_the_year():
    with pytest.raises(svc.CostError) as e:
        svc._check_window(CUR + 2, SM)
    assert e.value.code == "year_out_of_range"
    assert str(e.value) == f"Fiscal year {CUR + 2} is outside the editable window"


async def test_editable_locks_the_row_it_reads_and_reselects_after_creating(db, monkeypatch):
    card = await _setup(db)
    await _row(db, card, CUR, {"lic": _it(1)})
    calls = _spy_rows(monkeypatch)
    await svc._editable(db, card.id, CUR, SM)
    assert calls == [(card.id, CUR, True)]
    calls.clear()
    seen = _spy_statements(db, monkeypatch)
    await svc._editable(db, card.id, CUR + 1, SM)  # no row: the first and the last read lock it
    assert calls[0] == (card.id, CUR + 1, True) and calls[-1] == (card.id, CUR + 1, True)
    assert len([s for s in seen if "INSERT" in _sql(s)]) == 1
    assert await _row_count(db, card) == 2


@pytest.mark.parametrize("bad", [True, False, "5", None, float("inf"), float("nan"), -0.01, -1])
async def test_upsert_rejects_a_non_finite_negative_or_non_numeric_amount(db, bad):
    card = await _setup(db)
    with pytest.raises(svc.CostError) as e:
        await svc.upsert_item(db, card.id, CUR, "lic", bad, None)
    assert e.value.code == "invalid_amount"
    assert str(e.value) == "Amount must be a non-negative number"
    assert await _row_count(db, card) == 0


@pytest.mark.parametrize("ok", [0, 0.5, 1, 12.25])
async def test_upsert_accepts_zero_and_small_amounts(db, ok):
    card = await _setup(db)
    await svc.upsert_item(db, card.id, CUR, "lic", ok, None)
    assert (await svc.get_year_row(db, card.id, CUR, SM)).items[0].amount == ok


async def test_upsert_error_messages_name_the_item(db):
    card = await _setup(db, archived=("old",))
    with pytest.raises(svc.CostError) as e:
        await svc.upsert_item(db, card.id, CUR, "zzz", 1, None)
    assert str(e.value) == "Unknown cost item 'zzz'"
    with pytest.raises(svc.CostError) as e:
        await svc.upsert_item(db, card.id, CUR, "old", 1, None)
    assert str(e.value) == "Cost item 'old' is archived"


async def test_upsert_stores_the_renewal_date_as_iso_or_none(db):
    card = await _setup(db)
    await svc.upsert_item(db, card.id, CUR, "lic", 5, date(2030, 4, 5))
    await svc.upsert_item(db, card.id, CUR, "ams", 6, None)
    row = await svc._row(db, card.id, CUR)
    assert row.items == {
        "lic": {"amount": 5, "renewal_date": "2030-04-05"},
        "ams": {"amount": 6, "renewal_date": None},
    }


async def test_copy_to_forecast_refuses_the_forecast_year_itself_and_later(db):
    card = await _setup(db)
    await _row(db, card, CUR + 1, {"lic": _it(1)})
    for source in (CUR + 1, CUR + 2):
        with pytest.raises(svc.CostError) as e:
            await svc.copy_to_forecast(db, card.id, source, "lic")
        assert e.value.code == "year_out_of_range"
        assert str(e.value) == "Source year must be before the Forecast year"


async def test_copy_to_forecast_missing_source_message(db):
    card = await _setup(db)
    with pytest.raises(svc.CostError) as e:
        await svc.copy_to_forecast(db, card.id, CUR - 1, "lic")
    assert e.value.code == "unknown_item"
    assert str(e.value) == f"'lic' has no amount in FY{CUR - 1}"


async def test_declaring_types_tolerates_a_non_dict_section(db):
    await create_card_type(
        db,
        key="Application",
        fields_schema=[
            "junk",
            {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost"}]},
        ],
    )
    await create_card_type(db, key="ITComponent", fields_schema=["junk", {"fields": None}])
    assert await svc._declaring_types(db) == {"Application"}


async def test_recompute_derived_leaves_a_type_that_does_not_declare_the_field(db):
    await cat.create_item(db, "lic", "LIC", None)
    await create_card_type(db, key="ITComponent", fields_schema=[])
    card = await create_card(db, card_type="ITComponent", attributes={"x": 1})
    await _row(db, card, CUR, {"lic": _it(10)})
    await svc.recompute_derived(db, card)
    assert card.attributes == {"x": 1}


async def test_stale_totals_lists_only_the_cards_whose_stored_value_differs(db):
    card = await _setup(db)
    ok = await create_card(db, name="ok", attributes={"x": 1, "costTotalAnnual": 14})
    bare = await create_card(db, name="bare", attributes={"x": 1})
    empty = await create_card(db, name="empty", attributes={})
    other = await create_card(db, card_type="Process", name="P", attributes={})
    for c in (card, ok):
        await _row(db, c, CUR, {"lic": _it(10), "ams": _it(4)})
    stale = await svc.stale_totals(db)
    assert stale == {card.id: 14.0}
    assert bare.id not in stale and empty.id not in stale and other.id not in stale


async def test_write_totals_counts_changes_and_merges_into_fresh_attributes(db):
    from sqlalchemy import update

    from app.models.card import Card

    await _setup(db)
    a = await create_card(db, name="a", attributes={"x": 1})
    b = await create_card(db, name="b", attributes={})
    same = await create_card(db, name="same", attributes={"x": 1})
    await db.execute(
        update(Card)
        .where(Card.id == a.id)
        .values(attributes={"x": 1, "y": 2})
        .execution_options(synchronize_session=False)
    )
    n = await svc.write_totals(db, {a.id: 5.0, b.id: 6.0, same.id: None})
    assert n == 2
    assert a.attributes == {"x": 1, "y": 2, "costTotalAnnual": 5.0}  # fresh row, not the cache
    assert b.attributes == {"costTotalAnnual": 6.0}
    assert same.attributes == {"x": 1}
    assert await svc.write_totals(db, {}) == 0


async def test_apply_write_noop_returns_the_old_year_and_publishes_nothing(db, monkeypatch):
    card = await _setup(db)
    await _row(db, card, CUR, {"lic": _it(10)})
    published: list = []

    async def fake_publish(*a, **kw):
        published.append((a, kw))

    monkeypatch.setattr(svc.event_bus, "publish", fake_publish)

    async def noop():
        return False

    out = await svc.apply_write(db, card, card.id, CUR, noop)
    assert [i.key for i in out.items] == ["lic"] and out.tco == 10
    assert published == []


async def test_apply_write_refreshes_card_before_publishing_old_total(db, monkeypatch):
    from sqlalchemy import update

    from app.models.card import Card

    card = await _setup(db)
    await _row(db, card, CUR, {"lic": _it(10)})
    await db.execute(
        update(Card)
        .where(Card.id == card.id)
        .values(attributes={"costTotalAnnual": 10, "other": "retained"})
        .execution_options(synchronize_session=False)
    )
    published = []

    async def capture(event_type, data, **kwargs):
        published.append(data)

    monkeypatch.setattr(svc.event_bus, "publish", capture)

    async def op():
        await svc.upsert_item(db, card.id, CUR, "lic", 12, None)

    await svc.apply_write(db, card, card.id, CUR, op)
    assert published[0]["changes"]["costTotalAnnual"] == {"old": 10, "new": 12}
    assert card.attributes["other"] == "retained"


async def test_apply_write_publishes_keys_only_with_card_and_user(db, monkeypatch):
    card = await _setup(db)
    await _row(db, card, CUR, {"lic": _it(10)})
    uid = card.id  # any uuid: the event bus is stubbed
    published: list = []

    async def fake_publish(event_type, data, **kw):
        published.append((event_type, data, kw))

    monkeypatch.setattr(svc.event_bus, "publish", fake_publish)

    async def op():
        await svc.upsert_item(db, card.id, CUR, "ams", 4, None)

    out = await svc.apply_write(db, card, uid, CUR, op)
    assert out.tco == 14
    ((event_type, data, kw),) = published
    assert event_type == "card.costs_updated"
    data["changes"]["cost_items"]["new"].sort()  # JSONB key order is not insertion order
    assert data == {
        "id": str(card.id),
        "source": "card_costs",
        "changes": {
            "costTotalAnnual": {"old": None, "new": 14.0},
            "cost_items": {"old": ["lic"], "new": ["ams", "lic"]},
        },
    }
    assert kw["card_id"] == card.id and kw["user_id"] == uid and kw["db"] is db
