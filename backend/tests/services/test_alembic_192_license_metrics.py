"""Migration 192 (license metrics): the data steps, driven on the test database.

``create_all`` builds the new schema, so the DDL part of 192 (the column, the constraint
swap) is not exercised here; the steps are functions over a ``Session`` that take a plan
instead of reading the old table, and run through ``AsyncSession.run_sync``.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select, update

from app.models.app_settings import AppSettings
from app.models.calculation import Calculation
from app.models.card import Card
from app.models.card_license import CardLicense
from app.models.card_type import CardType
from app.models.license_metric import LicenseMetric
from app.models.license_type import LicenseType
from app.services import license_metrics_migration as lmm
from app.services.licensing_migration import derive_type_metrics
from tests.conftest import create_card, create_card_type, create_license_type

TEMPLATES = {
    "admin": {"label": "Admin", "sort_order": 0, "archived": False, "translations": {}},
    "dev": {"label": "Dev", "sort_order": 1, "archived": True, "translations": {"it": "Svil."}},
}


async def _types(db):
    rows = (await db.execute(select(LicenseType))).scalars().all()
    return sorted((r.metric_key, r.key) for r in rows)


async def _apply(db, types, used):
    plan = derive_type_metrics(types, used)
    await db.run_sync(lambda s: lmm.apply_type_plan(s, plan, TEMPLATES))
    db.expire_all()
    return plan


async def test_creates_default_metrics(db):
    await db.run_sync(lmm.seed_default_metrics)
    await db.run_sync(lmm.seed_default_metrics)  # a second run adds nothing
    rows = (await db.execute(select(LicenseMetric).order_by(LicenseMetric.sort_order))).scalars()
    assert [(m.key, m.label) for m in rows] == [
        ("users", "Users"),
        ("installations", "Installations"),
    ]


async def test_type_used_under_one_metric_stays_there(db):
    await db.run_sync(lmm.seed_default_metrics)
    await _apply(db, [("admin", False)], {"admin": {"installations"}})
    assert await _types(db) == [("installations", "admin")]


async def test_type_used_under_both_is_duplicated_with_same_label_and_archived(db):
    await db.run_sync(lmm.seed_default_metrics)
    plan = await _apply(db, [("dev", True)], {"dev": {"users", "installations"}})
    rows = (await db.execute(select(LicenseType))).scalars().all()
    assert len(rows) == 2
    assert {(r.label, r.archived, r.sort_order, r.translations["it"]) for r in rows} == {
        ("Dev", True, 1, "Svil.")
    }
    # Running the same plan again adds nothing.
    await db.run_sync(lambda s: lmm.apply_type_plan(s, plan, TEMPLATES))
    assert len((await db.execute(select(LicenseType))).scalars().all()) == 2


async def test_type_without_data_goes_under_both(db):
    await db.run_sync(lmm.seed_default_metrics)
    await _apply(db, [("admin", False)], {})
    assert await _types(db) == [("installations", "admin"), ("users", "admin")]


async def test_cells_in_card_licenses_are_untouched(db):
    await db.run_sync(lmm.seed_default_metrics)
    card = await create_card(db, name="A")
    items = {
        "users": {"admin": {"licensed": 5, "actual": 3}},
        "installations": {"dev": {"licensed": 1, "actual": None}},
    }
    db.add(CardLicense(card_id=card.id, fiscal_year=2026, items=items))
    await db.flush()
    used = await db.run_sync(lmm.used_metrics)
    assert used == {"admin": {"users"}, "dev": {"installations"}}
    await _apply(db, [("admin", False), ("dev", True)], used)
    await db.run_sync(lmm.clear_model_values)
    assert (await db.execute(select(CardLicense.items))).scalar_one() == items


async def test_licensing_model_removed_from_schema_and_attribute_values_without_moving_updated_at(
    db,
):
    field = {"key": "licensingModel", "type": "multiple_select"}
    await create_card_type(
        db,
        key="Application",
        fields_schema=[
            {"section": "Info", "fields": [{"key": "x", "type": "text"}]},
            {"section": "Licensing", "fields": [field]},
        ],
    )
    await create_card_type(
        db,
        key="Mine",
        fields_schema=[
            {"section": "Licensing", "fields": [{"key": "licensingModel", "type": "text"}]}
        ],
    )
    app = await create_card(db, name="App", attributes={"licensingModel": ["users"], "k": 1})
    mine = await create_card(
        db, card_type="Mine", name="Mine", attributes={"licensingModel": "free text"}
    )
    app_id, mine_id = app.id, mine.id  # read before expire_all
    old = datetime(2020, 1, 1, tzinfo=timezone.utc)  # func.now() is constant in a test
    await db.execute(update(Card).values(updated_at=old))
    await db.flush()
    db.expire_all()

    await db.run_sync(lmm.strip_model_field)
    cleared = await db.run_sync(lmm.clear_model_values)
    db.expire_all()

    assert cleared == 1
    schema = (
        await db.execute(select(CardType.fields_schema).where(CardType.key == "Application"))
    ).scalar_one()
    assert schema == [{"section": "Info", "fields": [{"key": "x", "type": "text"}]}]
    custom = (
        await db.execute(select(CardType.fields_schema).where(CardType.key == "Mine"))
    ).scalar_one()
    assert custom[0]["fields"] == [{"key": "licensingModel", "type": "text"}]
    for cid, attrs in ((app_id, {"k": 1}), (mine_id, {"licensingModel": "free text"})):
        row = (await db.execute(select(Card).where(Card.id == cid))).scalar_one()
        assert row.attributes == attrs and row.updated_at == old


async def test_clear_model_values_keeps_a_value_a_field_of_that_key_still_owns(db):
    ext_field = {"key": "licensingModel", "type": "multiple_select", "ext": "licensing"}
    await create_card_type(
        db,
        key="Application",
        fields_schema=[{"section": "Licensing", "ext": "licensing", "fields": [ext_field]}],
    )
    await create_card_type(
        db,
        key="ITComponent",
        fields_schema=[
            {
                "section": "Licensing",
                "fields": [{"key": "licensingModel", "type": "multiple_select"}],
            }
        ],
    )
    app = await create_card(db, name="App", attributes={"licensingModel": ["seat"]})
    itc = await create_card(
        db, card_type="ITComponent", name="Itc", attributes={"licensingModel": ["users"]}
    )
    app_id, itc_id = app.id, itc.id
    await db.run_sync(lmm.strip_model_field)
    cleared = await db.run_sync(lmm.clear_model_values)
    db.expire_all()
    attrs = dict(
        (await db.execute(select(Card.id, Card.attributes).where(Card.id.in_([app_id, itc_id]))))
        .tuples()
        .all()
    )
    assert cleared == 1
    assert attrs == {app_id: {"licensingModel": ["seat"]}, itc_id: {}}


async def test_report_lists_are_capped_and_the_card_total_is_not(db):
    many = [f"t{i:03d}" for i in range(lmm.REPORT_CAP + 1)]
    templates = {k: {"label": k.upper()} for k in many}
    plan = [(k, m) for k in many for m in ("users", "installations")]
    used = {k: {"users", "installations"} for k in many}
    cards = [{"card_id": str(i), "metrics": ["users"]} for i in range(lmm.REPORT_CAP + 1)]
    db.add_all(
        Calculation(
            name=f"c{i}",
            target_type_key="Application",
            target_field_key="x",
            formula="x = data.licensingModel",
        )
        for i in range(lmm.REPORT_CAP + 1)
    )
    await db.flush()
    report = await db.run_sync(lambda s: lmm.collect_report(s, plan, used, templates, cards))
    assert lmm.REPORT_CAP == 200
    assert [len(report[k]) for k in ("duplicated_types", "calculations", "cards")] == [200] * 3
    assert report["duplicated_types"][-1]["key"] == many[-2]
    assert report["total_cards"] == lmm.REPORT_CAP + 1


async def test_report_lists_duplicated_types_citing_calculations_and_cards_whose_ignored_metric_data_now_shows(  # noqa: E501
    db,
):
    db.add(AppSettings(id="default", general_settings={"keep": 1}))
    await db.run_sync(lmm.seed_default_metrics)
    tracked = await create_card(db, name="Tracked", attributes={"licensingModel": ["users"]})
    ignored = await create_card(db, name="Ignored", attributes={"licensingModel": ["users"]})
    db.add(
        CardLicense(
            card_id=tracked.id, fiscal_year=2026, items={"users": {"admin": {"licensed": 1}}}
        )
    )
    db.add(
        CardLicense(
            card_id=ignored.id,
            fiscal_year=2026,
            items={
                "users": {"admin": {"licensed": 1}},
                "installations": {"admin": {"licensed": 2}},
            },
        )
    )
    db.add(
        Calculation(
            name="calc",
            target_type_key="Application",
            target_field_key="x",
            formula="present = data.licensingModel",
        )
    )
    await db.flush()
    used = await db.run_sync(lmm.used_metrics)
    plan = derive_type_metrics([("admin", False), ("dev", True)], used)
    cards = await db.run_sync(lmm.ignored_metric_cards)  # read before the attributes are cleared

    def run(s):
        report = lmm.collect_report(s, plan, used, TEMPLATES, cards)
        lmm.write_report(s, report)
        return report

    report = await db.run_sync(run)
    assert report["duplicated_types"] == [
        {"key": "admin", "label": "Admin", "metrics": ["users", "installations"]}
    ]
    assert report["attached_to_both"] == [{"key": "dev", "label": "Dev"}]
    assert [c["name"] for c in report["calculations"]] == ["calc"]
    assert report["cards"] == [{"card_id": str(ignored.id), "metrics": ["installations"]}]
    assert report["total_cards"] == 1
    db.expire_all()
    settings = (await db.execute(select(AppSettings))).scalar_one().general_settings
    assert settings["keep"] == 1
    assert settings["license_metrics_migration_report"] == report


async def test_downgrade_refuses_when_a_type_is_duplicated(db):
    await db.run_sync(lmm.seed_default_metrics)
    assert await db.run_sync(lmm.can_downgrade) is True
    await create_license_type(db, key="admin", metric_key="users")
    assert await db.run_sync(lmm.can_downgrade) is True
    await create_license_type(db, key="admin", metric_key="installations")
    assert await db.run_sync(lmm.can_downgrade) is False
