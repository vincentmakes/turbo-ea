"""The licensing report rows and trend: which cards count in which year, and what they show."""

from __future__ import annotations

import pytest

from app.models.card_license import CardLicense
from app.services.card_read_scope import CardReadScope
from app.services.fiscal_year import current_fiscal_year
from app.services.license_report import build_report, counts_in_year
from tests.conftest import (
    create_card,
    create_card_type,
    create_license_type,
    create_role,
    create_user,
)

CUR = current_fiscal_year(1)
FORECAST = CUR + 1


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    user = await create_user(db, email="a@lic-report.com", role="admin")
    await create_card_type(
        db,
        key="Application",
        fields_schema=[
            {
                "section": "S",
                "fields": [
                    {"key": "licensingModel", "type": "multiple_select"},
                    {"key": "tier", "type": "single_select"},
                    {"key": "tags", "type": "multiple_select"},
                ],
            }
        ],
    )
    await create_license_type(db, "admin", "Admin")
    await create_license_type(db, "dev", "Dev")
    return CardReadScope.load, user


async def _card(db, name, model=("users",), lifecycle=None, status="ACTIVE", **attrs):
    return await create_card(
        db,
        card_type="Application",
        name=name,
        status=status,
        lifecycle=lifecycle or {},
        attributes={"licensingModel": list(model), **attrs},
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


async def _report(db, env, fy=CUR, group_by=None, **kw):
    load, user = env
    return await build_report(
        db,
        await load(db, user),
        type_key="Application",
        metric="users",
        fy=fy,
        group_by=group_by,
        card_id=kw.pop("card_id", None),
        **kw,
    )


def _names(report):
    return sorted(r["name"] for r in report["rows"])


def test_counts_in_year_rules():
    live = {"endOfLife": f"{CUR - 1}-12-31"}
    card = type("C", (), {"lifecycle": live})()
    assert counts_in_year(card, True, CUR, CUR, 1) is False  # retired before the current year
    assert counts_in_year(card, True, CUR - 1, CUR, 1) is True  # past years: a stored row
    assert counts_in_year(card, False, CUR - 1, CUR, 1) is False
    assert counts_in_year(card, True, FORECAST, CUR, 1) is True


async def test_current_year_applies_lifecycle_gate_and_archived_excluded(db, env):
    await _card(db, "Live")
    await _card(db, "Retired", lifecycle={"endOfLife": f"{CUR - 1}-12-31"})
    await _card(db, "Planned", lifecycle={"plan": f"{CUR + 3}-01-01"})
    await _card(db, "Archived", status="ARCHIVED")
    assert _names(await _report(db, env)) == ["Live"]


async def test_past_year_lists_cards_with_a_row_only(db, env):
    with_row = await _card(db, "WithRow")
    await _card(db, "NoRow")
    await _row(db, with_row, CUR - 2, admin=(10, 4))
    report = await _report(db, env, fy=CUR - 2)
    assert _names(report) == ["WithRow"]
    assert report["rows"][0]["by_type"]["admin"] == {
        "licensed": 10,
        "actual": 4,
        "pct": 40.0,
        "no_licence": False,
        "status": "compliant",
    }


async def test_cards_without_metric_in_model_are_left_out(db, env):
    await _card(db, "Users", model=("users",))
    await _card(db, "Installs", model=("installations",))
    await _card(db, "NoModel", model=())
    assert _names(await _report(db, env)) == ["Users"]


async def test_current_year_carry_forward_reads_licensed_only(db, env):
    c = await _card(db, "Carry")
    await _row(db, c, CUR - 1, admin=(10, 9))
    row = (await _report(db, env))["rows"][0]
    assert row["by_type"]["admin"]["licensed"] == 10
    assert row["by_type"]["admin"]["actual"] is None
    assert row["status"] == "no_actual_data"


async def test_trend_has_six_years_and_forecast_licensed_only(db, env):
    c = await _card(db, "T")
    await _row(db, c, CUR - 1, admin=(10, 9))
    await _row(db, c, CUR, admin=(12, 6), dev=(3, 3))
    await _row(db, c, FORECAST, admin=(15, 7))  # a stray actual must not leak
    report = await _report(db, env)
    assert report["years"] == list(range(CUR - 4, CUR + 2))
    assert [t["fiscal_year"] for t in report["trend"]] == report["years"]
    by_year = {t["fiscal_year"]: t["cards"] for t in report["trend"]}
    cid = str(c.id)
    assert by_year[CUR - 1][cid]["admin"] == {"licensed": 10, "actual": 9}
    assert by_year[CUR][cid]["dev"] == {"licensed": 3, "actual": 3}
    assert by_year[FORECAST][cid]["admin"] == {"licensed": 15, "actual": None}
    assert by_year[CUR - 4] == {}


async def test_group_by_field_assigns_raw_values(db, env):
    await _card(db, "A", tier="gold")
    await _card(db, "B")
    from app.services.cost_grouping import GroupBy

    report = await _report(db, env, group_by=GroupBy("field", "tier"))
    assert {r["name"]: r["group"] for r in report["rows"]} == {"A": "gold", "B": "__other__"}


async def test_group_by_multi_valued_field_is_refused(db, env):
    from app.services.cost_grouping import GroupBy

    with pytest.raises(ValueError):
        await _report(db, env, group_by=GroupBy("field", "tags"))


async def test_retired_card_only_in_its_recorded_years(db, env):
    c = await _card(db, "Gone", lifecycle={"endOfLife": f"{CUR - 1}-12-31"})
    await _row(db, c, CUR - 3, admin=(5, 5))
    await _row(db, c, CUR - 1, admin=(5, 1))
    await _row(db, c, CUR, admin=(5, 1))  # a row in the retirement-following year still hides
    assert _names(await _report(db, env, fy=CUR)) == []
    assert _names(await _report(db, env, fy=CUR - 1)) == ["Gone"]
    assert _names(await _report(db, env, fy=CUR - 2)) == []
    report = await _report(db, env)
    by_year = {t["fiscal_year"]: t["cards"] for t in report["trend"]}
    assert str(c.id) in by_year[CUR - 3] and str(c.id) in by_year[CUR - 1]
    assert by_year[CUR] == {}


async def test_totals_status_and_worst_percentage(db, env):
    c = await _card(db, "Mix")
    await _row(db, c, CUR, admin=(10, 12), dev=(0, 2))
    row = (await _report(db, env))["rows"][0]
    assert (row["status"], row["worst_pct"], row["worst_no_licence"]) == ("over", 120.0, True)
    assert (row["licensed_total"], row["actual_total"]) == (10, 14)
