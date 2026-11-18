"""The licensing demo seeder: once by marker, every status present, Forecast licensed only."""

from __future__ import annotations

from sqlalchemy import delete, select

from app.models.card import Card
from app.models.card_license import CardLicense
from app.models.card_type import CardType
from app.models.license_metric import LicenseMetric
from app.models.license_type import LicenseType
from app.services import card_licenses, seed
from app.services.fiscal_year import current_fiscal_year, get_fiscal_year_start
from app.services.license_catalogue import load_catalogue
from app.services.seed_demo_licensing import SEEDER_KEY, seed_licensing_demo_data
from app.services.seed_markers import demo_seed_completed
from tests.conftest import create_card, create_card_type

APPS = ("SAP S/4HANA", "SAP Ariba", "SAP SuccessFactors", "Siemens Teamcenter")
ITCS = ("PostgreSQL 16", "Datadog")


async def _demo_cards(db):
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="ITComponent", label="IT Component")
    for name in APPS:
        await create_card(db, card_type="Application", name=name, attributes={})
    for name in ITCS:
        await create_card(db, card_type="ITComponent", name=name, attributes={})


async def test_fresh_seed_has_the_default_metrics_and_no_model_field(db):
    await seed.seed_metamodel(db)
    metrics = (await db.execute(select(LicenseMetric.key))).scalars().all()
    assert set(metrics) == {"users", "installations"}
    for key in ("Application", "ITComponent"):
        schema = (
            await db.execute(select(CardType.fields_schema).where(CardType.key == key))
        ).scalar_one()
        assert "licensingModel" not in [f["key"] for s in schema for f in s["fields"]]


async def test_seeds_once_by_marker(db):
    await _demo_cards(db)
    first = await seed_licensing_demo_data(db)
    assert not first.get("skipped")
    assert await demo_seed_completed(db, SEEDER_KEY)
    attrs = (await db.execute(select(Card.attributes))).scalars().all()
    assert not any("licensingModel" in a for a in attrs)

    rows = (await db.execute(select(CardLicense))).scalars().all()
    second = await seed_licensing_demo_data(db)
    assert second["skipped"] is True
    assert len((await db.execute(select(CardLicense))).scalars().all()) == len(rows)


async def test_types_sit_under_their_metric_and_every_cell_resolves(db):
    await _demo_cards(db)
    await seed_licensing_demo_data(db)
    pairs = set((await db.execute(select(LicenseType.metric_key, LicenseType.key))).all())
    assert pairs == {
        ("users", "business"),
        ("users", "admin"),
        ("installations", "prod"),
        ("installations", "no_prod"),
    }
    catalogue = await load_catalogue(db)
    rows = (await db.execute(select(CardLicense))).scalars().all()
    for row in rows:
        for metric, types in row.items.items():
            for key in types:
                assert catalogue.type(metric, key) is not None, (metric, key)


async def test_a_card_pairs_differ_by_year(db):
    await _demo_cards(db)
    await seed_licensing_demo_data(db)
    rows = (await db.execute(select(CardLicense))).scalars().all()
    by_card: dict = {}
    for row in rows:
        pairs = frozenset((m, k) for m, types in row.items.items() for k in types)
        by_card.setdefault(row.card_id, set()).add(pairs)
    assert any(len(years) > 1 for years in by_card.values())


async def test_marker_holds_after_data_deleted(db):
    await _demo_cards(db)
    await seed_licensing_demo_data(db)
    await db.execute(delete(CardLicense))
    await db.execute(delete(LicenseType))
    await db.flush()
    again = await seed_licensing_demo_data(db)
    assert again["skipped"] is True
    assert (await db.execute(select(CardLicense))).scalars().all() == []
    assert (await db.execute(select(LicenseType))).scalars().all() == []


async def test_every_status_is_present_in_current_year(db):
    await _demo_cards(db)
    await seed_licensing_demo_data(db)
    start = await get_fiscal_year_start(db)
    fy = current_fiscal_year(start)
    seen = set()
    for card in (await db.execute(select(Card))).scalars():
        if card.type not in card_licenses.LICENSE_TYPES:
            continue
        year = await card_licenses.get_year(db, card, fy, start)
        for result in year.metrics:
            seen.add(result.status)
    assert seen == {"over", "approaching", "no_actual_data", "compliant"}


async def test_forecast_rows_have_no_actual(db):
    await _demo_cards(db)
    await seed_licensing_demo_data(db)
    start = await get_fiscal_year_start(db)
    fy = current_fiscal_year(start)
    rows = (await db.execute(select(CardLicense))).scalars().all()
    assert {r.fiscal_year for r in rows} == {fy - 2, fy - 1, fy, fy + 1}
    forecast = [r for r in rows if r.fiscal_year == fy + 1]
    assert forecast
    for row in forecast:
        for types in row.items.values():
            assert all(cell["actual"] is None for cell in types.values())


async def test_skips_without_demo_cards(db):
    result = await seed_licensing_demo_data(db)
    assert result["skipped"] is True
    assert (await db.execute(select(LicenseType))).scalars().all() == []
    assert not await demo_seed_completed(db, SEEDER_KEY)


async def test_card_with_existing_license_row_is_left_alone(db):
    await create_card_type(db, key="Application", label="Application")
    erp = await create_card(db, card_type="Application", name="SAP S/4HANA", attributes={})
    await create_card(db, card_type="Application", name="SAP Ariba", attributes={})
    year = current_fiscal_year(await get_fiscal_year_start(db))
    db.add(CardLicense(card_id=erp.id, fiscal_year=year, items={"users": {"x": {"licensed": 1}}}))
    await db.flush()
    result = await seed_licensing_demo_data(db)  # no uq_card_licenses_card_year crash
    assert result["skipped"] is False
    mine = (
        (await db.execute(select(CardLicense).where(CardLicense.card_id == erp.id))).scalars().all()
    )
    assert [(r.fiscal_year, r.items) for r in mine] == [(year, {"users": {"x": {"licensed": 1}}})]
    await db.refresh(erp)
    assert "licensingModel" not in erp.attributes
