"""The licensing report rows: which cards count in which year, and what they show."""

from __future__ import annotations

import pytest
from sqlalchemy import update

from app.models.card_license import CardLicense
from app.models.card_logo import CardLogo
from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.services.card_read_scope import CardReadScope
from app.services.cost_grouping import GroupBy
from app.services.fiscal_year import current_fiscal_year
from app.services.license_report import build_report, counts_in_year
from app.services.permission_service import PermissionService
from tests.conftest import (
    create_card,
    create_card_type,
    create_license_metric,
    create_license_type,
    create_role,
    create_stakeholder_role_def,
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
                    {"key": "tier", "type": "single_select"},
                    {"key": "tags", "type": "multiple_select"},
                ],
            }
        ],
    )
    await create_license_metric(db, "users", "Users", sort_order=1)
    await create_license_metric(db, "installations", "Installations", sort_order=2)
    await create_license_type(db, "admin", "Admin")
    await create_license_type(db, "dev", "Dev")
    await create_license_type(db, "seat", "Seat", metric_key="installations")
    return CardReadScope.load, user


async def _card(db, name, lifecycle=None, status="ACTIVE", **kw):
    return await create_card(
        db, card_type="Application", name=name, status=status, lifecycle=lifecycle or {}, **kw
    )


async def _row(db, card, year, **metrics):
    """``metrics``: ``users={"admin": (licensed, actual)}``."""
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


async def _report(db, env, fy=CUR, **kw):
    load, user = env
    params = {
        "card_types": ["Application"],
        "metric": None,
        "license_type": None,
        "group_by": None,
        "card_id": None,
        **kw,
    }
    return await build_report(db, await load(db, user), user=user, fy=fy, **params)


def _names(report):
    return sorted(r["name"] for r in report["rows"])


def _by_name(report):
    return {r["name"]: r for r in report["rows"]}


async def test_report_omits_licenses_denied_on_a_readable_card(db, env):
    await create_role(db, key="licensed", permissions={"licenses.view": True})
    user = await create_user(db, email="licensed-report@test.com", role="licensed")
    await create_stakeholder_role_def(
        db, key="reader", permissions={"card.view": True, "card.view_licenses": False}
    )
    card = await _card(db, "Readable")
    db.add(Stakeholder(card_id=card.id, user_id=user.id, role="reader"))
    await db.execute(
        update(CardType)
        .where(CardType.key == "Application")
        .values(role_permissions={"licensed": {"inventory.view": False}})
    )
    await db.flush()
    PermissionService.invalidate_type_permission_cache()
    report = await _report(db, (CardReadScope.load, user))
    assert _names(report) == []


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


async def test_all_metrics_lists_a_card_with_no_pair_as_no_actual_data(db, env):
    await _card(db, "Bare")
    row = (await _report(db, env))["rows"][0]
    assert (row["status"], row["by_metric"]) == ("no_actual_data", [])
    assert (row["worst_pct"], row["worst_no_licence"]) == (None, False)


async def test_a_metric_lists_only_cards_with_a_pair_of_that_metric(db, env):
    users = await _card(db, "Users")
    installs = await _card(db, "Installs")
    await _card(db, "Bare")
    await _row(db, users, CUR, users={"admin": (10, 4)})
    await _row(db, installs, CUR, installations={"seat": (5, 5)})
    assert _names(await _report(db, env, metric="installations")) == ["Installs"]
    assert _names(await _report(db, env, metric="users")) == ["Users"]
    assert _names(await _report(db, env)) == ["Bare", "Installs", "Users"]


async def test_a_license_type_keeps_only_cards_with_that_pair(db, env):
    a = await _card(db, "A")
    b = await _card(db, "B")
    await _row(db, a, CUR, users={"admin": (10, 4)})
    await _row(db, b, CUR, users={"dev": (10, 4)})
    report = await _report(db, env, license_type="users:admin")
    assert _names(report) == ["A"]
    assert [t["key"] for t in report["rows"][0]["by_metric"][0]["types"]] == ["admin"]


async def test_the_selection_narrows_what_the_row_shows_and_its_status(db, env):
    c = await _card(db, "Mix")
    await _row(db, c, CUR, users={"admin": (10, 12), "dev": (10, 1)})
    row = (await _report(db, env, license_type="users:dev"))["rows"][0]
    assert row["status"] == "compliant"
    assert [t["key"] for t in row["by_metric"][0]["types"]] == ["dev"]


async def test_row_status_is_the_worst_across_metrics(db, env):
    c = await _card(db, "Mix")
    await _row(db, c, CUR, users={"admin": (10, 4)}, installations={"seat": (5, 9)})
    row = (await _report(db, env))["rows"][0]
    assert row["status"] == "over"
    assert [(m["metric"], m["status"]) for m in row["by_metric"]] == [
        ("users", "compliant"),
        ("installations", "over"),
    ]
    assert (row["worst_pct"], row["worst_no_licence"]) == (180.0, False)


async def test_totals_are_per_metric_never_across_metrics(db, env):
    c = await _card(db, "Mix")
    await _row(db, c, CUR, users={"admin": (10, 12), "dev": (0, 2)}, installations={"seat": (7, 3)})
    row = (await _report(db, env))["rows"][0]
    totals = {m["metric"]: (m["licensed_total"], m["actual_total"]) for m in row["by_metric"]}
    assert totals == {"users": (10, 14), "installations": (7, 3)}
    assert row["worst_no_licence"] is True and "licensed_total" not in row


async def test_a_cell_under_an_unknown_metric_still_has_a_status(db, env):
    c = await _card(db, "Odd")
    await _row(db, c, CUR, ghost={"x": (10, 11)})
    row = (await _report(db, env))["rows"][0]
    assert row["status"] == "over" and row["by_metric"][0]["metric"] == "ghost"


async def test_past_year_lists_cards_with_a_row_only(db, env):
    with_row = await _card(db, "WithRow")
    await _card(db, "NoRow")
    await _row(db, with_row, CUR - 2, users={"admin": (10, 4)})
    report = await _report(db, env, fy=CUR - 2)
    assert _names(report) == ["WithRow"]
    assert report["rows"][0]["by_metric"][0]["types"] == [
        {
            "key": "admin",
            "licensed": 10,
            "actual": 4,
            "pct": 40.0,
            "no_licence": False,
            "status": "compliant",
        }
    ]


async def test_current_year_carry_forward_reads_licensed_only(db, env):
    c = await _card(db, "Carry")
    await _row(db, c, CUR - 1, users={"admin": (10, 9)})
    row = (await _report(db, env))["rows"][0]
    cell = row["by_metric"][0]["types"][0]
    assert (cell["licensed"], cell["actual"]) == (10, None)
    assert row["status"] == "no_actual_data"


async def test_a_row_says_whether_its_year_is_confirmed_or_carried_forward(db, env):
    own = await _card(db, "Own")
    carried = await _card(db, "Carried")
    await _row(db, own, CUR, users={"admin": (10, 4)})
    await _row(db, carried, CUR - 1, users={"admin": (10, 9)})
    rows = _by_name(await _report(db, env))
    assert (rows["Own"]["confirmed"], rows["Carried"]["confirmed"]) == (True, False)
    past = _by_name(await _report(db, env, fy=CUR - 1))
    assert past["Carried"]["confirmed"] is True


async def test_retired_card_only_in_its_recorded_years(db, env):
    c = await _card(db, "Gone", lifecycle={"endOfLife": f"{CUR - 1}-12-31"})
    await _row(db, c, CUR - 1, users={"admin": (5, 1)})
    await _row(db, c, CUR, users={"admin": (5, 1)})  # a row in the following year still hides
    assert _names(await _report(db, env, fy=CUR)) == []
    assert _names(await _report(db, env, fy=CUR - 1)) == ["Gone"]
    assert _names(await _report(db, env, fy=CUR - 2)) == []


async def test_group_by_field_assigns_raw_values(db, env):
    await _card(db, "A", attributes={"tier": "gold"})
    await _card(db, "B")
    report = await _report(db, env, group_by=GroupBy("field", "tier"))
    assert {r["name"]: r["group"] for r in report["rows"]} == {"A": "gold", "B": "__other__"}


async def test_group_by_multi_valued_field_is_refused(db, env):
    with pytest.raises(ValueError):
        await _report(db, env, group_by=GroupBy("field", "tags"))


async def test_the_row_carries_alias_and_attributes(db, env):
    await _card(db, "Aliased", alias="Ali", attributes={"tier": "gold"})
    row = (await _report(db, env))["rows"][0]
    assert (row["alias"], row["attributes"]["tier"]) == ("Ali", "gold")


async def test_the_response_has_no_trend_and_no_catalogue(db, env):
    report = await _report(db, env)
    assert "trend" not in report and "license_types" not in report and "metric" not in report
    assert report["years"] == list(range(CUR - 4, CUR + 2))


async def test_metrics_and_types_in_year_ignore_the_selection(db, env):
    c = await _card(db, "A")
    await _row(db, c, CUR, users={"admin": (1, 1)}, installations={"seat": (1, 1)})
    report = await _report(db, env, metric="users")
    assert report["metrics_in_year"] == ["users", "installations"]
    assert report["types_in_year"] == ["installations:seat", "users:admin"]


async def test_an_archived_metric_is_listed_only_with_data_in_the_year(db, env):
    old = await create_license_metric(db, "old", "Old", archived=True)
    await create_license_type(db, "x", "X", metric_key=old.key)
    c = await _card(db, "A")
    assert "old" not in (await _report(db, env))["metrics_in_year"]
    await _row(db, c, CUR, old={"x": (1, 1)})
    assert "old" in (await _report(db, env))["metrics_in_year"]


async def test_a_metric_and_a_pair_of_another_metric_are_refused(db, env):
    with pytest.raises(ValueError, match="installations:seat"):
        await _report(db, env, metric="users", license_type="installations:seat")
    assert (await _report(db, env, metric="installations", license_type="installations:seat"))[
        "rows"
    ] == []


async def test_a_row_carries_logo_updated_at_only_when_the_card_has_a_logo(db, env):
    await db.execute(
        update(CardType).where(CardType.key == "Application").values(allow_card_logo=True)
    )
    logo = await _card(db, "Logo")
    await _card(db, "Plain")
    db.add(CardLogo(card_id=logo.id, mime_type="image/png", size=1, data=b"x"))
    await db.flush()
    rows = _by_name(await _report(db, env))
    assert rows["Logo"]["logo_updated_at"] is not None
    assert "logo_updated_at" not in rows["Plain"]


async def test_unknown_metrics_follow_the_catalogue_ones_sorted(db, env):
    c = await _card(db, "Mixed")
    await _row(
        db,
        c,
        CUR,
        zeta={"x": (1, 1)},
        installations={"seat": (1, 1)},
        alpha={"x": (1, 1)},
        users={"admin": (1, 1)},
    )
    row = (await _report(db, env))["rows"][0]
    assert [m["metric"] for m in row["by_metric"]] == ["users", "installations", "alpha", "zeta"]


async def test_a_selection_and_a_grouping_combine(db, env):
    gold = await _card(db, "Gold", attributes={"tier": "gold"})
    other = await _card(db, "Other")
    seats = await _card(db, "Seats", attributes={"tier": "gold"})
    await _row(db, gold, CUR, users={"admin": (1, 1)})
    await _row(db, other, CUR, users={"dev": (1, 1)})
    await _row(db, seats, CUR, installations={"seat": (1, 1)})
    report = await _report(db, env, metric="users", group_by=GroupBy("field", "tier"))
    assert {r["name"]: r["group"] for r in report["rows"]} == {"Gold": "gold", "Other": "__other__"}


@pytest.mark.parametrize(
    "kw",
    [{"metric": "seats"}, {"license_type": "admin"}, {"license_type": "users:nope"}],
)
async def test_an_unknown_selection_is_refused(db, env, kw):
    with pytest.raises(ValueError):
        await _report(db, env, **kw)
