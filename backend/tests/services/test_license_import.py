"""The licensing Excel import: parsing, planning (the dry run) and applying."""

from __future__ import annotations

import io
import zipfile

import openpyxl
import pytest
from sqlalchemy import select

from app.models.app_settings import AppSettings
from app.models.card_license import CardLicense
from app.models.event import Event
from app.services import license_metrics, license_types
from app.services.card_licenses import UNSET, LicenseError, merge_cell
from app.services.fiscal_year import current_fiscal_year
from app.services.license_import import (
    HEADERS,
    ImportFileError,
    ImportRow,
    apply_import,
    parse_workbook,
    plan_import,
)
from tests.conftest import (
    create_card,
    create_card_type,
    create_license_metric,
    create_license_type,
    create_role,
    create_user,
)

CUR = current_fiscal_year(1)
FORECAST = CUR + 1
HDR = ["Component", "Metric", "License type", "Year", "Licensed", "Actual"]


def xlsx(rows, headers=HDR) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(headers)
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def row(i, comp="ERP", metric="users", typ="admin", year=CUR, licensed=10, actual=4):
    return ImportRow(i, comp, metric, typ, year, licensed, actual)


# --- parsing -----------------------------------------------------------------


def test_parse_accepts_uk_spelling_text_numbers_and_trailing_blanks():
    data = xlsx(
        [
            ["ERP", "Users", "Admin", "2026", "12", 12.0, "x"],
            [None, None, None, None, None, None, None],
            ["CRM", "installations", "Dev", 2025, None, "", None],
            [None] * 7,
            [None] * 7,
        ],
        headers=["component", "METRIC", "Licence Type", "year", "licensed", "ACTUAL", "Notes"],
    )
    rows = parse_workbook(data)
    assert [(r.row, r.component, r.metric, r.license_type) for r in rows] == [
        (2, "ERP", "Users", "Admin"),
        (4, "CRM", "installations", "Dev"),
    ]
    assert (rows[0].year, rows[0].licensed, rows[0].actual) == ("2026", "12", 12.0)
    assert rows[1].licensed is None


def test_headers_constant_lists_the_six_columns():
    assert HEADERS == ("component", "metric", "license type", "year", "licensed", "actual")


def test_parse_rejects_wrong_headers_and_non_xlsx_bytes():
    with pytest.raises(ImportFileError):
        parse_workbook(xlsx([["a"]], headers=["Component", "Metric"]))
    with pytest.raises(ImportFileError):
        parse_workbook(b"this is not a workbook")
    with pytest.raises(ImportFileError):
        parse_workbook(xlsx([]))  # header only: nothing to import


def _zip_with(members: dict[str, int]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, size in members.items():
            zf.writestr(name, b"\0" * size)
    return buf.getvalue()


def test_parse_refuses_a_zip_bomb():
    # one member over the 50 MB limit; the archive itself is a few dozen KB
    with pytest.raises(ImportFileError, match="limit"):
        parse_workbook(_zip_with({"xl/worksheets/sheet1.xml": 60 * 1024 * 1024}))
    # members under the limit that sum over the 100 MB total
    with pytest.raises(ImportFileError, match="refused"):
        parse_workbook(_zip_with({f"xl/{i}.xml": 40 * 1024 * 1024 for i in range(3)}))


# --- planning ----------------------------------------------------------------


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    user = await create_user(db, email="a@lic-imp.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_license_type(db, "admin", "Admin")
    await create_license_type(db, "dev", "Dev")
    await create_license_type(db, "dev", "Dev", metric_key="installations")
    await create_license_type(db, "old", "Old")
    await license_types.update_item(db, "users", "old", archived=True)
    await create_license_type(db, "amb_a", "Shared")
    await create_license_type(db, "amb_b", "Shared")
    erp = await create_card(
        db,
        card_type="Application",
        name="ERP",
        attributes={"licensingModel": ["users"]},
    )
    return {"user": user, "erp": erp}


async def test_plan_matches_case_insensitive_and_does_not_read_licensing_model(db, env):
    plan = await plan_import(
        db,
        env["user"],
        [
            row(2, comp="  erp ", metric="User", typ="ADMIN", year="2026", licensed="10"),
            row(3, metric="Installations", typ="Dev", licensed=5, actual=None),
        ],
    )
    assert plan.skipped == []
    assert plan.matched == 2
    assert not hasattr(plan, "flagged")  # an untracked metric no longer flags anything
    assert sorted(plan.cells[(env["erp"].id, CUR)]) == [
        ("installations", "dev", 5, UNSET),
        ("users", "admin", 10, 4),
    ]


async def test_a_metric_resolves_by_label_and_a_custom_metric_works(db, env):
    await create_license_metric(db, key="cores", label="CPU Cores")
    await create_license_type(db, "std", "Standard", metric_key="cores")
    plan = await plan_import(
        db,
        env["user"],
        [
            row(2, metric="cpu cores", typ="Standard", actual=None),
            row(3, metric="Users", typ="admin", year=CUR - 1),
            row(4, metric="cores", typ="std", year=CUR - 2, actual=None),
        ],
    )
    assert plan.skipped == []
    assert plan.cells[(env["erp"].id, CUR)] == [("cores", "std", 10, UNSET)]


async def test_legacy_alias_only_reaches_a_metric_keyed_users_or_installations(db, env):
    await create_license_metric(db, key="seats", label="Seats")
    await create_license_type(db, "admin", "Admin", metric_key="seats")
    plan = await plan_import(db, env["user"], [row(2, metric="user"), row(3, metric="seat")])
    assert [(s.row, s.reason) for s in plan.skipped] == [(3, "invalid_metric")]
    assert list(plan.cells[(env["erp"].id, CUR)]) == [("users", "admin", 10, 4)]


async def test_a_type_of_another_metric_is_skipped_type_not_in_metric(db, env):
    await create_license_type(db, "prod", "Prod", metric_key="installations")
    plan = await plan_import(
        db,
        env["user"],
        [row(2, metric="Users", typ="prod"), row(3, metric="Users", typ="Prod", year=CUR - 1)],
    )
    assert [(s.row, s.reason, s.detail) for s in plan.skipped] == [
        (2, "type_not_in_metric", "prod"),
        (3, "type_not_in_metric", "Prod"),
    ]


async def test_the_same_type_key_under_two_metrics_writes_the_right_cell(db, env):
    plan = await plan_import(
        db,
        env["user"],
        [row(2, metric="installations", typ="dev", licensed=7, actual=None)],
    )
    assert await apply_import(db, env["user"].id, plan) == 1
    stored = (await db.execute(select(CardLicense))).scalar_one()
    assert stored.items == {"installations": {"dev": {"licensed": 7, "actual": None}}}


async def test_an_archived_metric_cannot_create_a_cell_but_updates_an_existing_one(db, env):
    await create_license_metric(db, key="legacy", label="Legacy")
    await create_license_type(db, "x", "X", metric_key="legacy")
    db.add(
        CardLicense(
            card_id=env["erp"].id,
            fiscal_year=CUR - 2,
            items={"legacy": {"x": {"licensed": 2, "actual": 1}}},
        )
    )
    await license_metrics.update_item(db, "legacy", archived=True)
    await db.flush()
    plan = await plan_import(
        db,
        env["user"],
        [
            row(2, metric="Legacy", typ="x", year=CUR - 1),
            row(3, metric="legacy", typ="x", year=CUR - 2),
        ],
    )
    assert [(s.row, s.reason, s.detail, s.metric) for s in plan.skipped] == [
        (2, "archived_license_metric", "legacy", "legacy")
    ]
    assert list(plan.cells) == [(env["erp"].id, CUR - 2)]
    assert await apply_import(db, env["user"].id, plan) == 1


async def test_both_values_empty_is_nothing_to_write_even_for_an_archived_metric(db, env):
    plan = await plan_import(db, env["user"], [row(2, licensed=None, actual="")])
    assert [s.reason for s in plan.skipped] == ["nothing_to_write"]


async def test_plan_skips_every_reason(db, env):
    await create_card(db, card_type="Application", name="Twin")
    await create_card(db, card_type="ITComponent", name="twin")
    rows = [
        row(2, comp="Nobody"),  # card_not_found
        row(3, comp="Twin"),  # ambiguous_card
        row(4, typ="nope"),  # unknown_license_type
        row(5, typ="shared"),  # ambiguous_license_type
        row(6, typ="old", year=CUR - 1),  # archived_license_type
        row(7, metric="seats"),  # invalid_metric
        row(8, year=CUR + 2),  # invalid_year
        row(9, licensed="12.5"),  # invalid_number
        row(10, year=FORECAST, licensed=3, actual=1),  # forecast_actual
        row(11, typ="dev", year=CUR - 2),  # duplicate_cell
        row(12, typ="dev", year=CUR - 2, licensed=1),  # duplicate_cell
        row(13, typ="dev", year=CUR - 3, licensed=None, actual=""),  # nothing_to_write
        row(14, typ="dev", year=CUR - 4),  # accepted
    ]
    plan = await plan_import(db, env["user"], rows)
    by_row = {s.row: s.reason for s in plan.skipped}
    assert by_row == {
        2: "card_not_found",
        3: "ambiguous_card",
        4: "unknown_license_type",
        5: "ambiguous_license_type",
        6: "archived_license_type",
        7: "invalid_metric",
        8: "invalid_year",
        9: "invalid_number",
        10: "forecast_actual",
        11: "duplicate_cell",
        12: "duplicate_cell",
        13: "nothing_to_write",
    }
    assert plan.matched == 1 and list(plan.cells) == [(env["erp"].id, CUR - 4)]


# The file says "Users" (a label): a resolved metric is named by its key "users", an
# unresolved one by the file's own text.
@pytest.mark.parametrize(
    "reason,kwargs,metric",
    [
        ("card_not_found", {"comp": "Nobody"}, "Users"),
        ("ambiguous_card", {"comp": "Twin"}, "Users"),
        ("invalid_metric", {"metric": "Seats"}, "Seats"),
        ("unknown_license_type", {"typ": "nope"}, "users"),
        ("ambiguous_license_type", {"typ": "shared"}, "users"),
        ("type_not_in_metric", {"typ": "seat"}, "users"),
        ("archived_license_type", {"typ": "old", "year": CUR - 1}, "users"),
        ("invalid_year", {"year": CUR + 2}, "users"),
        ("invalid_number", {"licensed": "12.5"}, "users"),
        ("forecast_actual", {"year": FORECAST, "licensed": 3, "actual": 1}, "users"),
        ("nothing_to_write", {"licensed": None, "actual": ""}, "users"),
    ],
    ids=lambda v: v if isinstance(v, str) else "",
)
async def test_every_skip_names_the_metric(db, env, reason, kwargs, metric):
    await create_card(db, card_type="Application", name="Twin")
    await create_card(db, card_type="ITComponent", name="twin")
    await create_license_type(db, "seat", "Seat", metric_key="installations")
    plan = await plan_import(db, env["user"], [row(2, **{"metric": "Users", **kwargs})])
    assert [(s.reason, s.metric) for s in plan.skipped] == [(reason, metric)]


async def test_a_duplicate_cell_names_the_metric(db, env):
    plan = await plan_import(db, env["user"], [row(2, metric="Users"), row(3)])
    assert [(s.reason, s.metric) for s in plan.skipped] == [("duplicate_cell", "users")] * 2


async def test_an_archived_type_names_the_metric_it_is_archived_under(db, env):
    await create_license_type(db, "standard", "Standard")
    await license_types.update_item(db, "users", "standard", archived=True)
    await create_license_type(db, "standard", "Standard", metric_key="installations")
    plan = await plan_import(
        db,
        env["user"],
        [
            row(2, metric="Users", typ="standard"),
            row(3, metric="Installations", typ="standard", actual=None),
        ],
    )
    assert [(s.row, s.reason, s.detail, s.metric) for s in plan.skipped] == [
        (2, "archived_license_type", "standard", "users")
    ]
    assert plan.cells[(env["erp"].id, CUR)] == [("installations", "standard", 10, UNSET)]


@pytest.mark.parametrize(
    "bad", ["12.5", -1, "-3", True, "abc", 1_000_000_001, float("nan")], ids=repr
)
async def test_plan_rejects_fractional_negative_and_junk_numbers(db, env, bad):
    plan = await plan_import(db, env["user"], [row(2, licensed=bad)])
    assert [s.reason for s in plan.skipped] == ["invalid_number"]


async def test_plan_accepts_text_and_float_whole_numbers(db, env):
    plan = await plan_import(db, env["user"], [row(2, licensed="12", actual=7.0, year="2026.0")])
    assert plan.skipped == []
    assert plan.cells[(env["erp"].id, CUR)] == [("users", "admin", 12, 7)]


async def test_duplicate_cells_are_all_skipped(db, env):
    plan = await plan_import(db, env["user"], [row(2), row(3, comp="erp", licensed=1), row(4)])
    assert [s.reason for s in plan.skipped] == ["duplicate_cell"] * 3
    assert plan.matched == 0 and plan.cells == {}


async def test_an_archived_type_with_an_existing_cell_is_accepted(db, env):
    db.add(
        CardLicense(
            card_id=env["erp"].id,
            fiscal_year=CUR - 1,
            items={"users": {"old": {"licensed": 2, "actual": 1}}},
        )
    )
    await db.flush()
    plan = await plan_import(db, env["user"], [row(2, typ="old", year=CUR - 1, actual=2)])
    assert plan.skipped == [] and plan.matched == 1


async def test_empty_cell_leaves_stored_value(db, env):
    db.add(
        CardLicense(
            card_id=env["erp"].id,
            fiscal_year=CUR,
            items={"users": {"admin": {"licensed": 3, "actual": 5}}},
        )
    )
    await db.flush()
    plan = await plan_import(db, env["user"], [row(2, licensed=10, actual=None)])
    await apply_import(db, env["user"].id, plan)
    stored = (await db.execute(select(CardLicense))).scalar_one()
    await db.refresh(stored)
    assert stored.items == {"users": {"admin": {"licensed": 10, "actual": 5}}}


@pytest.mark.parametrize(
    "reason,kwargs,args",
    [
        ("invalid_year", {"year": CUR + 2}, dict(fiscal_year=CUR + 2, key="admin")),
        ("invalid_metric", {"metric": "seats"}, dict(metric="seats", key="admin")),
        ("unknown_license_type", {"typ": "nope"}, dict(key="nope")),
        ("invalid_number", {"licensed": -1}, dict(key="admin", licensed=-1)),
        (
            "forecast_actual",
            {"year": FORECAST, "licensed": 3, "actual": 1},
            dict(fiscal_year=FORECAST, key="admin", licensed=3, actual=1),
        ),
        ("archived_license_type", {"typ": "old", "year": CUR - 1}, dict(key="old")),
    ],
)
async def test_dry_run_and_apply_agree(db, env, reason, kwargs, args):
    """Every row the plan skips for a cell rule is also refused by the one write rule."""
    plan = await plan_import(db, env["user"], [row(2, **kwargs)])
    assert [s.reason for s in plan.skipped] == [reason]
    call = {"fiscal_year": CUR, "metric": "users", **args}
    with pytest.raises(LicenseError):
        await merge_cell(db, env["erp"].id, call.pop("fiscal_year"), call.pop("metric"), **call)


async def test_accepted_rows_are_accepted_by_merge_cell(db, env):
    plan = await plan_import(
        db, env["user"], [row(2), row(3, typ="dev", year=FORECAST, actual=None)]
    )
    assert plan.skipped == []
    assert await apply_import(db, env["user"].id, plan) == 2


async def test_apply_one_event_per_card_year(db, env):
    plan = await plan_import(
        db,
        env["user"],
        [row(2), row(3, typ="dev"), row(4, year=CUR - 1), row(5, typ="dev", year=CUR - 1)],
    )
    assert await apply_import(db, env["user"].id, plan) == 4
    events = [
        e
        for e in (await db.execute(select(Event))).scalars()
        if e.card_id == env["erp"].id and e.event_type == "card.licenses_updated"
    ]
    assert sorted(e.data["fiscal_year"] for e in events) == [CUR - 1, CUR]
    assert all("10" not in str(e.data["changes"]) for e in events)  # keys only, never counts


async def test_import_year_uses_fiscal_year_start(db, env):
    db.add(AppSettings(id="default", general_settings={"fiscalYearStart": 4}))
    await db.flush()
    cur4 = current_fiscal_year(4)
    assert cur4 != CUR
    plan = await plan_import(
        db,
        env["user"],
        [
            row(2, year=cur4, actual=None),
            row(3, typ="dev", year=cur4 + 1, actual=None),  # the Forecast year of April
            row(4, typ="dev", year=cur4 + 2),
        ],
    )
    assert [s.row for s in plan.skipped] == [4]
    assert plan.skipped[0].reason == "invalid_year"
    assert sorted(y for _, y in plan.cells) == [cur4, cur4 + 1]


async def test_hidden_card_is_not_found(db, env):
    from sqlalchemy import update

    from app.models.card_type import CardType

    await create_role(db, key="editor", permissions={"inventory.view": True, "licenses.edit": True})
    editor = await create_user(db, email="e@lic-imp.com", role="editor")
    await db.execute(
        update(CardType)
        .where(CardType.key == "Application")
        .values(role_permissions={"editor": {"inventory.view": False}})
    )
    await db.flush()
    plan = await plan_import(db, editor, [row(2)])
    assert [s.reason for s in plan.skipped] == ["card_not_found"]


def test_parse_refuses_more_rows_than_the_cap():
    from app.services import license_import

    assert license_import.MAX_ROWS == 10_000
    data = xlsx([["ERP", "users", "admin", CUR, 1, 1]] * 3)
    original = license_import.MAX_ROWS
    license_import.MAX_ROWS = 2
    try:
        with pytest.raises(ImportFileError, match="more than 2 rows"):
            parse_workbook(data)
    finally:
        license_import.MAX_ROWS = original


async def test_apply_failure_midway_leaves_nothing_after_rollback(db, env):
    """The route answers 409 and rolls back: no card_licenses row and no event survive."""
    plan = await plan_import(db, env["user"], [row(2), row(3, typ="dev", year=CUR - 1)])
    assert plan.skipped == []
    await license_types.update_item(
        db, "users", "dev", archived=True
    )  # the catalogue changes after the plan
    await db.flush()
    with pytest.raises(LicenseError):
        await apply_import(db, env["user"].id, plan)
    await db.rollback()
    assert (await db.execute(select(CardLicense))).scalars().all() == []
    events = (await db.execute(select(Event))).scalars().all()
    assert [e for e in events if e.event_type == "card.licenses_updated"] == []
