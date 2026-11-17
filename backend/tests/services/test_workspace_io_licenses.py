"""Workspace transfer carries the license-type catalogue and the per-card license rows."""

from __future__ import annotations

import uuid

from sqlalchemy import delete, select

from app.models.card_license import CardLicense
from app.models.license_metric import LicenseMetric
from app.models.license_type import LicenseType
from app.services.workspace_io import apply_bundle, apply_selected, build_bundle, parse_bundle
from app.services.workspace_io import remap as rm
from tests.conftest import create_card, create_card_type, create_license_type, create_user

ITEMS = {"users": {"admin": {"licensed": 10, "actual": 7}, "dev": {"licensed": 3, "actual": None}}}


async def _seed(db, email):
    user = await create_user(db, email=email, role="admin")
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="Billing", user_id=user.id)
    await create_license_type(db, "admin", "Admin", sort_order=0, translations={"it": "Amm."})
    await create_license_type(db, "dev", "Dev", sort_order=1, archived=True)
    db.add(CardLicense(card_id=card.id, fiscal_year=2026, items=ITEMS))
    await db.flush()
    return user, card


async def test_round_trip_carries_types_and_card_licenses(db):
    user, card = await _seed(db, "lic-ws@test.com")
    raw = await build_bundle(db)

    # Wipe the inventory so the card gets a NEW id on import.
    await db.execute(delete(CardLicense))
    await db.execute(delete(LicenseType))
    await db.execute(delete(LicenseMetric))
    await db.execute(delete(type(card)))
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()

    types = {t.key: t for t in (await db.execute(select(LicenseType))).scalars().all()}
    assert set(types) == {"admin", "dev"}
    assert {t.metric_key for t in types.values()} == {"users"}
    assert [m.key for m in (await db.execute(select(LicenseMetric))).scalars()] == ["users"]
    assert types["admin"].translations == {"it": "Amm."}
    assert types["dev"].archived is True
    new_card = (
        await db.execute(select(type(card)).where(type(card).name == "Billing"))
    ).scalar_one()
    row = (
        await db.execute(select(CardLicense).where(CardLicense.card_id == new_card.id))
    ).scalar_one()
    assert (row.fiscal_year, row.items) == (2026, ITEMS)


async def test_reimport_is_all_skip(db):
    user, _ = await _seed(db, "lic-ws2@test.com")
    raw = await build_bundle(db)
    again = await apply_bundle(db, parse_bundle(raw), user)
    assert again.total_failed == 0, again.as_dict()
    for sheet in ("LicenseMetrics", "LicenseTypes", "CardLicenses"):
        section = next(s for s in again.sections if s.sheet == sheet)
        assert section.created == 0


async def test_selected_sheet_card_licenses_applies(db):
    user, card = await _seed(db, "lic-ws3@test.com")
    card_id = card.id
    raw = await build_bundle(db)
    await db.execute(delete(CardLicense))
    await db.flush()

    result = await apply_selected(
        db, parse_bundle(raw), user, sheets={"CardLicenses"}, dry_run=False
    )
    assert result.total_failed == 0, result.as_dict()
    db.expire_all()
    row = (await db.execute(select(CardLicense).where(CardLicense.card_id == card_id))).scalar_one()
    assert row.items == ITEMS


def test_saved_report_picked_card_id_is_remapped():
    old, new = str(uuid.uuid4()), str(uuid.uuid4())
    ids = rm.IdMap()
    ids.record(rm.CARDS, old, new)
    out = rm.rewrite_saved_report_config({"pickedCardId": old}, ids, rm.RewriteTally())
    assert out == {"pickedCardId": new}


async def test_import_restores_a_licensing_model_field_the_bundle_lacks(db):
    """A bundle (or content pack) whose Application type has no ``licensingModel`` cannot
    strip it from the target: the importer puts it back in its ``Licensing`` section."""
    from app.models.card_type import CardType
    from app.services.licensing_migration import LICENSING_SECTION

    user = await create_user(db, email="lic-ws3@test.com", role="admin")
    await create_card_type(
        db,
        key="Application",
        label="Application",
        fields_schema=[{"section": "General", "fields": [{"key": "a", "type": "text"}]}],
    )
    raw = await build_bundle(db)

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()

    db.expire_all()
    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    sections = {s["section"]: [f["key"] for f in s["fields"]] for s in ct.fields_schema}
    assert sections[LICENSING_SECTION] == ["licensingModel"]
    assert sections["General"] == ["a"]


async def test_the_restore_is_counted_as_an_update_and_adds_missing_options(db):
    """The importer's licensingModel restore shows in the preview and the result, and a
    stored field that lacks a required option gets it back."""
    import copy

    from app.models.card_type import CardType
    from app.services.licensing_migration import LICENSING_MODEL_FIELD, LICENSING_SECTION
    from app.services.workspace_io import diff_bundle

    user = await create_user(db, email="lic-ws4@test.com", role="admin")
    deficient = copy.deepcopy(LICENSING_MODEL_FIELD)
    deficient["options"] = deficient["options"][:1]
    await create_card_type(
        db,
        key="Application",
        label="Application",
        fields_schema=[{"section": LICENSING_SECTION, "fields": [deficient]}],
    )
    raw = await build_bundle(db)

    preview = await diff_bundle(db, parse_bundle(raw), user)
    assert next(s for s in preview.sections if s.sheet == "CardTypes").updated == 1

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert next(s for s in result.sections if s.sheet == "CardTypes").updated == 1
    db.expire_all()
    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    options = [o["key"] for o in ct.fields_schema[0]["fields"][0]["options"]]
    assert options == ["users", "installations"]


def _cards_section(result):
    return next(s for s in result.sections if s.sheet == "CardTypes")


async def test_restore_on_a_type_the_bundle_also_changes_counts_once(db):
    """The bundle updates the row (label) and the restore adds the field: one update, not two."""
    from app.models.card_type import CardType
    from app.services.licensing_migration import LICENSING_SECTION

    user = await create_user(db, email="lic-ws5@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    raw = await build_bundle(db)
    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    ct.label = "Renamed locally"
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert _cards_section(result).updated == 1
    db.expire_all()
    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    assert ct.label == "Application"
    assert any(s["section"] == LICENSING_SECTION for s in ct.fields_schema)


async def test_restore_counts_each_type_the_bundle_does_not_carry(db):
    """Two licensing types missing from the bundle: each restore is its own update."""
    from app.models.card_type import CardType

    user = await create_user(db, email="lic-ws6@test.com", role="admin")
    raw = await build_bundle(db)  # no card types in it
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="ITComponent", label="IT Component")

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert _cards_section(result).updated == 2
    db.expire_all()
    for key in ("Application", "ITComponent"):
        ct = (await db.execute(select(CardType).where(CardType.key == key))).scalar_one()
        assert [f["key"] for s in ct.fields_schema for f in s["fields"]] == ["licensingModel"]
