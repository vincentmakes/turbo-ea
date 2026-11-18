"""Workspace transfer of the license catalogue: metrics, types per metric, and bundles
written before metrics existed (no ``LicenseMetrics`` sheet, types without ``metric_key``)."""

from __future__ import annotations

import pytest
from sqlalchemy import delete, select

from app.models.card import Card
from app.models.card_license import CardLicense
from app.models.card_type import CardType
from app.models.license_metric import LicenseMetric
from app.models.license_type import LicenseType
from app.services.licensing_migration import MODEL_KEY, licensing_section
from app.services.workspace_io import (
    FORMAT_VERSION,
    apply_bundle,
    apply_selected,
    build_bundle,
    parse_bundle,
)
from app.services.workspace_io.license_compat import derive_catalogue, items_of, keep_known_cells
from tests.conftest import (
    create_card,
    create_card_type,
    create_license_metric,
    create_license_type,
    create_user,
)

METRICS = "LicenseMetrics"
TYPES = "LicenseTypes"
CELL = {"licensed": 5, "actual": 2}


def _section(result, sheet):
    return next(s for s in result.sections if s.sheet == sheet)


async def _metrics(db) -> dict[str, LicenseMetric]:
    return {m.key: m for m in (await db.execute(select(LicenseMetric))).scalars()}


async def _types(db) -> dict[tuple[str, str], LicenseType]:
    return {(t.metric_key, t.key): t for t in (await db.execute(select(LicenseType))).scalars()}


def _make_old(bundle, type_rows: list[dict] | None = None):
    """Turn a parsed bundle into one written before license metrics existed."""
    del bundle.sheets[METRICS]
    if type_rows is None:
        seen: dict[str, dict] = {}
        for row in bundle.sheets[TYPES]:
            row = {k: v for k, v in row.items() if k != "metric_key"}
            seen.setdefault(row["key"], row)
        type_rows = list(seen.values())
    bundle.sheets[TYPES] = type_rows
    return bundle


async def _wipe_catalogue(db):
    await db.execute(delete(CardLicense))
    await db.execute(delete(LicenseType))
    await db.execute(delete(LicenseMetric))
    await db.flush()


# --- pure helpers ---------------------------------------------------------------


def test_derive_puts_a_type_under_each_metric_its_data_uses_and_an_unused_one_under_both():
    types = [
        {"key": "admin", "label": "Admin", "archived": True},
        {"key": "dev", "label": "Dev"},
        {"key": "prod", "label": "Prod"},
    ]
    cards = [
        {"items": '{"users": {"admin": {"licensed": 1}}, "installations": {"prod": {}}}'},
        {"items": {"installations": {"admin": {"licensed": 2}}}},
    ]
    metrics, derived = derive_catalogue([], types, cards)

    assert [m["key"] for m in metrics] == ["users", "installations"]
    assert [m["label"] for m in metrics] == ["Users", "Installations"]
    pairs = sorted((t["metric_key"], t["key"]) for t in derived)
    assert pairs == [
        ("installations", "admin"),
        ("installations", "dev"),
        ("installations", "prod"),
        ("users", "admin"),
        ("users", "dev"),
    ]
    # A duplicated type keeps its own values (label, archived) under each metric.
    admins = [t for t in derived if t["key"] == "admin"]
    assert all(t["label"] == "Admin" and t["archived"] is True for t in admins)


def test_derive_keeps_the_bundles_own_metrics_and_adds_only_the_missing_defaults():
    metrics, _ = derive_catalogue([{"key": "users", "label": "Seats"}], [], [])
    assert [(m["key"], m["label"]) for m in metrics] == [
        ("users", "Seats"),
        ("installations", "Installations"),
    ]


def test_derive_keeps_a_type_under_the_bundles_own_metric_holding_its_cells():
    metrics, derived = derive_catalogue(
        [{"key": "cores", "label": "Cores"}],
        [{"key": "std", "label": "Std"}, {"key": "lost", "label": "Lost"}],
        [{"items": {"cores": {"std": {"licensed": 4}}, "seats": {"lost": {"licensed": 1}}}}],
    )
    assert [m["key"] for m in metrics] == ["cores", "users", "installations"]
    assert sorted((t["metric_key"], t["key"]) for t in derived) == [
        ("cores", "std"),
        ("installations", "lost"),
        ("users", "lost"),
    ]


def test_derive_keeps_a_type_row_that_already_names_its_metric_and_ignores_bad_json():
    _, derived = derive_catalogue(
        [], [{"metric_key": "users", "key": "admin"}], [{"items": "{not json"}]
    )
    assert [(t["metric_key"], t["key"]) for t in derived] == [("users", "admin")]


def test_keep_known_cells_drops_unknown_pairs_and_names_them():
    items = {
        "users": {"admin": CELL, "ghost": CELL},
        "seats": {"admin": CELL},
    }
    kept, dropped = keep_known_cells(items, {("users", "admin")})
    assert kept == {"users": {"admin": CELL}}
    assert dropped == ["seats:admin", "users:ghost"]


def test_keep_known_cells_leaves_a_fully_known_blob_alone():
    items = {"users": {"admin": CELL}}
    assert keep_known_cells(items, {("users", "admin")}) == (items, [])


# --- new-format bundles ------------------------------------------------------------


async def _seed_two_metrics(db, email):
    user = await create_user(db, email=email, role="admin")
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="Billing", user_id=user.id)
    await create_license_metric(db, "users", "Users", sort_order=0)
    await create_license_metric(db, "seats", "Seats", sort_order=1, translations={"it": "Posti"})
    await create_license_type(db, "admin", "Admin", metric_key="users", sort_order=3)
    await create_license_type(db, "named", "Named", metric_key="seats", archived=True)
    items = {"users": {"admin": CELL}, "seats": {"named": CELL}}
    db.add(CardLicense(card_id=card.id, fiscal_year=2026, items=items))
    await db.flush()
    return user, items


async def test_round_trip_reproduces_metrics_types_and_card_licenses(db):
    user, items = await _seed_two_metrics(db, "lc-rt@test.com")
    raw = await build_bundle(db)
    await _wipe_catalogue(db)
    await db.execute(delete(Card))
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()

    metrics = await _metrics(db)
    assert set(metrics) == {"users", "seats"}
    assert (metrics["seats"].label, metrics["seats"].sort_order) == ("Seats", 1)
    assert metrics["seats"].translations == {"it": "Posti"}
    types = await _types(db)
    assert set(types) == {("users", "admin"), ("seats", "named")}
    assert types[("users", "admin")].sort_order == 3
    assert types[("seats", "named")].archived is True
    row = (await db.execute(select(CardLicense))).scalar_one()
    assert row.items == items


async def test_a_reimport_skips_every_metric_and_type(db):
    user, _ = await _seed_two_metrics(db, "lc-again@test.com")
    raw = await build_bundle(db)

    result = await apply_bundle(db, parse_bundle(raw), user)
    for sheet in (METRICS, TYPES):
        sr = _section(result, sheet)
        assert (sr.created, sr.updated, sr.skipped, sr.failed) == (0, 0, 2, 0), sr


async def test_a_new_bundle_overwrites_a_matched_rows_label_and_archive_flag(db):
    user, _ = await _seed_two_metrics(db, "lc-merge@test.com")
    raw = await build_bundle(db)
    types = await _types(db)
    types[("users", "admin")].archived = True
    types[("users", "admin")].label = "Local"
    (await _metrics(db))["seats"].archived = True
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert _section(result, TYPES).updated == 1
    assert _section(result, METRICS).updated == 1
    types = await _types(db)
    assert (types[("users", "admin")].label, types[("users", "admin")].archived) == (
        "Admin",
        False,
    )
    assert (await _metrics(db))["seats"].archived is False


async def test_a_bundle_from_an_empty_catalogue_is_not_treated_as_old(db):
    user = await create_user(db, email="lc-empty@test.com", role="admin")
    raw = await build_bundle(db)
    bundle = parse_bundle(raw)
    assert METRICS in bundle.sheets and bundle.rows(METRICS) == []

    result = await apply_bundle(db, bundle, user)
    assert _section(result, METRICS).created == 0
    assert await _metrics(db) == {}


async def test_the_same_key_under_another_metric_is_a_different_row(db):
    user, _ = await _seed_two_metrics(db, "lc-other@test.com")
    raw = await build_bundle(db)
    await db.execute(delete(LicenseType).where(LicenseType.metric_key == "seats"))
    await create_license_type(db, "named", "Mine", metric_key="users", sort_order=9)

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert _section(result, TYPES).created == 1
    types = await _types(db)
    assert types[("seats", "named")].label == "Named"
    assert (types[("users", "named")].label, types[("users", "named")].sort_order) == ("Mine", 9)


async def test_a_type_of_a_metric_nobody_has_is_reported_and_skipped(db):
    user, _ = await _seed_two_metrics(db, "lc-orphan@test.com")
    bundle = parse_bundle(await build_bundle(db))
    bundle.sheets[TYPES].append({"metric_key": "cores", "key": "std", "label": "Std"})
    await _wipe_catalogue(db)

    result = await apply_bundle(db, bundle, user)
    sr = _section(result, TYPES)
    assert sr.created == 2
    assert sr.skip_reasons.get("unknown_metric") == 1
    assert any("cores:std" in e for e in sr.errors), sr.errors
    assert ("cores", "std") not in await _types(db)


async def test_a_cell_whose_metric_or_type_exists_nowhere_is_dropped_and_reported(db):
    user, items = await _seed_two_metrics(db, "lc-cell@test.com")
    bundle = parse_bundle(await build_bundle(db))
    (row,) = bundle.sheets["CardLicenses"]
    row["items"] = {**items, "users": {**items["users"], "ghost": CELL}, "cores": {"x": CELL}}
    await db.execute(delete(CardLicense))
    await db.flush()

    result = await apply_bundle(db, bundle, user)
    sr = _section(result, "CardLicenses")
    assert sr.failed == 0, sr
    assert any("cores:x" in e for e in sr.errors) and any("users:ghost" in e for e in sr.errors)
    assert (await db.execute(select(CardLicense))).scalar_one().items == items


async def test_types_selected_without_their_metric_sheet_create_no_orphan_metric_key(db):
    user, items = await _seed_two_metrics(db, "lc-sel-types@test.com")
    bundle = parse_bundle(await build_bundle(db))
    await db.execute(delete(CardLicense))
    await db.execute(delete(LicenseType))
    await db.execute(delete(LicenseMetric).where(LicenseMetric.key == "seats"))
    await db.flush()

    result = await apply_selected(db, bundle, user, sheets={TYPES, "CardLicenses"}, dry_run=False)
    assert set(await _types(db)) == {("users", "admin")}
    assert _section(result, TYPES).skip_reasons.get("unknown_metric") == 1
    # The cells stay, as with CardLicenses alone: the bundle knows the pair.
    assert (await db.execute(select(CardLicense))).scalar_one().items == items


async def test_license_sheets_apply_in_dependency_order(db):
    user, _ = await _seed_two_metrics(db, "lc-order@test.com")
    result = await apply_bundle(db, parse_bundle(await build_bundle(db)), user)
    sheets = [s.sheet for s in result.sections]
    assert sheets.index(METRICS) < sheets.index(TYPES) < sheets.index("CardLicenses")


# --- bundles written before license metrics ------------------------------------------


async def _seed_old_world(db, email):
    """A source whose ``admin`` type has data under both metrics and ``dev`` none."""
    user = await create_user(db, email=email, role="admin")
    await create_card_type(
        db, key="Application", label="Application", fields_schema=[licensing_section()]
    )
    card = await create_card(
        db,
        card_type="Application",
        name="Billing",
        user_id=user.id,
        attributes={MODEL_KEY: ["users"]},
    )
    await create_license_type(db, "admin", "Admin", metric_key="users", sort_order=0)
    await create_license_type(db, "admin", "Admin", metric_key="installations", sort_order=0)
    await create_license_type(db, "dev", "Dev", metric_key="users", sort_order=1)
    items = {"users": {"admin": CELL}, "installations": {"admin": CELL}}
    db.add(CardLicense(card_id=card.id, fiscal_year=2026, items=items))
    await db.flush()
    return user, card, items


async def test_format_version_is_unchanged_and_an_old_bundle_imports(db):
    assert FORMAT_VERSION == "1"
    user, card, items = await _seed_old_world(db, "lc-old@test.com")
    bundle = _make_old(parse_bundle(await build_bundle(db)))
    await _wipe_catalogue(db)

    result = await apply_bundle(db, bundle, user)
    assert result.total_failed == 0, result.as_dict()
    assert set(await _metrics(db)) == {"users", "installations"}
    assert _section(result, METRICS).created == 2
    assert set(await _types(db)) == {
        ("users", "admin"),
        ("installations", "admin"),
        ("users", "dev"),
        ("installations", "dev"),
    }
    row = (await db.execute(select(CardLicense).where(CardLicense.card_id == card.id))).scalar_one()
    assert row.items == items


async def test_an_old_bundle_never_unarchives_or_reorders_a_target_row(db):
    user, _, _ = await _seed_old_world(db, "lc-arch@test.com")
    bundle = _make_old(parse_bundle(await build_bundle(db)))
    types = await _types(db)
    types[("installations", "admin")].archived = True
    types[("installations", "admin")].sort_order = 7
    types[("installations", "admin")].label = "Local"
    metrics = await _metrics(db)
    metrics["users"].archived = True
    metrics["users"].label = "Seats"
    await db.flush()

    result = await apply_bundle(db, bundle, user)
    assert result.total_failed == 0, result.as_dict()
    target = (await _types(db))[("installations", "admin")]
    assert (target.archived, target.sort_order) == (True, 7)
    assert target.label == "Admin"  # the label still follows the bundle
    metric = (await _metrics(db))["users"]
    assert (metric.archived, metric.label) == (True, "Seats")


async def test_an_old_bundle_changes_no_row_the_target_already_has(db):
    user, _, _ = await _seed_old_world(db, "lc-old-again@test.com")
    bundle = _make_old(parse_bundle(await build_bundle(db)))

    result = await apply_bundle(db, bundle, user)
    metrics, types = _section(result, METRICS), _section(result, TYPES)
    assert (metrics.created, metrics.updated, metrics.skipped) == (0, 0, 2)
    assert metrics.skip_reasons == {"already_present": 2}
    # ``dev`` had no data, so it lands under both metrics: the target only had it under users.
    assert (types.created, types.updated, types.skipped) == (1, 0, 3)


async def test_an_old_bundle_loses_licensing_model_and_it_is_not_re_added(db):
    user, card, _ = await _seed_old_world(db, "lc-model@test.com")
    bundle = _make_old(parse_bundle(await build_bundle(db)))
    await db.execute(delete(CardLicense))
    await db.execute(delete(Card))
    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    ct.fields_schema = []
    await db.flush()

    result = await apply_bundle(db, bundle, user)
    assert result.total_failed == 0, result.as_dict()
    db.expire_all()
    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    assert ct.fields_schema == []
    imported = (await db.execute(select(Card).where(Card.name == "Billing"))).scalar_one()
    assert MODEL_KEY not in imported.attributes


async def test_an_old_bundle_with_card_licenses_only_creates_nothing_and_drops_unknown_cells(db):
    user, card, items = await _seed_old_world(db, "lc-only@test.com")
    bundle = _make_old(parse_bundle(await build_bundle(db)))
    (row,) = bundle.sheets["CardLicenses"]
    row["items"] = {**items, "seats": {"admin": CELL}, "users": {"admin": CELL, "ghost": CELL}}
    await _wipe_catalogue(db)

    result = await apply_selected(db, bundle, user, sheets={"CardLicenses"}, dry_run=False)
    assert result.total_failed == 0, result.as_dict()
    assert [s.sheet for s in result.sections] == ["CardLicenses"]
    assert await _metrics(db) == {}
    assert await _types(db) == {}
    stored = (
        await db.execute(select(CardLicense).where(CardLicense.card_id == card.id))
    ).scalar_one()
    assert stored.items == items
    errors = _section(result, "CardLicenses").errors
    assert any("seats:admin" in e for e in errors) and any("users:ghost" in e for e in errors)


# --- review hardening ------------------------------------------------------------------


async def test_a_new_bundle_with_an_empty_metric_key_cell_is_not_treated_as_old(db):
    user, _ = await _seed_two_metrics(db, "lc-emptycell@test.com")
    bundle = parse_bundle(await build_bundle(db))
    bundle.sheets[TYPES].append({"metric_key": None, "key": "loose", "label": "Loose"})

    result = await apply_bundle(db, bundle, user)
    sr = _section(result, TYPES)
    assert (sr.created, sr.failed) == (0, 1), sr
    # Treated as old, the row would be derived under both defaults, creating ``installations``.
    assert set(await _metrics(db)) == {"users", "seats"}
    assert not any(k == "loose" for _, k in await _types(db))


async def test_a_catalogue_row_without_key_is_counted_as_failed(db):
    user, _ = await _seed_two_metrics(db, "lc-nokey@test.com")
    bundle = parse_bundle(await build_bundle(db))
    bundle.sheets[METRICS].append({"key": None, "label": "Nameless"})
    bundle.sheets[TYPES].append({"metric_key": "users", "key": None, "label": "Nameless"})

    result = await apply_bundle(db, bundle, user)
    assert _section(result, METRICS).failed == 1
    assert _section(result, TYPES).failed == 1


async def test_a_new_row_with_empty_label_and_sort_order_takes_the_key_and_the_default(db):
    user, _ = await _seed_two_metrics(db, "lc-blank@test.com")
    bundle = parse_bundle(await build_bundle(db))
    bundle.sheets[METRICS].append({"key": "cores", "label": None, "sort_order": None})
    bundle.sheets[TYPES].append(
        {"metric_key": "cores", "key": "std", "label": None, "sort_order": None}
    )

    result = await apply_bundle(db, bundle, user)
    assert result.total_failed == 0, result.as_dict()
    metric = (await _metrics(db))["cores"]
    assert (metric.label, metric.sort_order) == ("cores", 0)
    typ = (await _types(db))[("cores", "std")]
    assert (typ.label, typ.sort_order) == ("std", 0)


async def test_dropped_cells_are_reported_one_line_each_in_name_order(db):
    user, items = await _seed_two_metrics(db, "lc-lines@test.com")
    bundle = parse_bundle(await build_bundle(db))
    (row,) = bundle.sheets["CardLicenses"]
    row["items"] = {**items, "users": {**items["users"], "ghost": CELL}, "cores": {"x": CELL}}
    await db.execute(delete(CardLicense))
    await db.flush()

    result = await apply_bundle(db, bundle, user)
    tail = "its metric or type is on neither this instance nor in the bundle, skipped"
    assert _section(result, "CardLicenses").errors == [
        f"license cell cores:x: {tail}",
        f"license cell users:ghost: {tail}",
    ]


async def test_a_card_licenses_row_whose_items_are_not_an_object_reaches_the_entity_pass(db):
    user, _ = await _seed_two_metrics(db, "lc-list@test.com")
    bundle = parse_bundle(await build_bundle(db))
    (row,) = bundle.sheets["CardLicenses"]
    row["items"] = "[1, 2]"

    result = await apply_bundle(db, bundle, user)
    assert bundle.sheets["CardLicenses"] == [row]
    assert _section(result, "CardLicenses").errors == []


def test_items_of_reads_an_object_and_nothing_else():
    assert items_of({"items": '{"users": {}}'}) == {"users": {}}
    assert items_of({"items": {"users": {}}}) == {"users": {}}
    assert items_of({"items": "{not json"}) == {}
    assert items_of({"items": "[1]"}) == {}
    assert items_of({}) == {}


@pytest.mark.parametrize("selected", [TYPES, METRICS])
async def test_an_old_bundle_with_one_catalogue_sheet_selected_writes_both(db, selected):
    user, _, _ = await _seed_old_world(db, f"lc-one-{selected.lower()}@test.com")
    bundle = _make_old(parse_bundle(await build_bundle(db)))
    await _wipe_catalogue(db)

    result = await apply_selected(db, bundle, user, sheets={selected}, dry_run=False)
    assert [s.sheet for s in result.sections] == [METRICS, TYPES]
    assert _section(result, METRICS).created == 2
    assert _section(result, TYPES).created == 4
    assert set(await _metrics(db)) == {"users", "installations"}


async def test_an_old_bundle_card_with_no_attributes_imports(db):
    user, _, _ = await _seed_old_world(db, "lc-noattrs@test.com")
    bundle = _make_old(parse_bundle(await build_bundle(db)))
    (card_row,) = [r for r in bundle.sheets["Cards"] if r.get("name") == "Billing"]
    card_row["attributes"] = None
    await db.execute(delete(CardLicense))
    await db.execute(delete(Card))
    await db.flush()

    result = await apply_bundle(db, bundle, user)
    assert _section(result, "Cards").failed == 0, result.as_dict()
    imported = (await db.execute(select(Card).where(Card.name == "Billing"))).scalar_one()
    assert MODEL_KEY not in (imported.attributes or {})
