"""Migration of built-in Initiative actual dates."""

import importlib.util
from pathlib import Path

import pytest

from app.models.app_settings import AppSettings
from app.models.calculation import Calculation
from app.models.web_portal import WebPortal
from tests.conftest import create_card, create_card_type


def migration_201():
    path = Path(__file__).resolve().parents[2] / "alembic/versions/201_initiative_actual_dates.py"
    spec = importlib.util.spec_from_file_location("initiative_actual_dates_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def test_migration_installs_dates_and_preserves_legacy_customization(db):
    initiative = await create_card_type(
        db,
        key="Initiative",
        built_in=True,
        fields_schema=[
            {
                "section": "Schedule",
                "fields": [
                    {"key": "startDate", "type": "date", "label": "Planned"},
                    {"key": "ActualEnd", "type": "date", "label": "Consegna effettiva"},
                ],
            }
        ],
        subtypes=[{"key": "program", "hidden_fields": ["ActualEnd"]}],
    )
    initiative.section_config = {"custom:0": {"hidden_fields": ["ActualEnd"], "label": "ActualEnd"}}
    await create_card_type(db, key="Application")
    record = await create_card(
        db,
        card_type="Initiative",
        name="Legacy",
        attributes={"actualStart": "2026-04-01", "ActualEnd": "2026-05-01"},
    )
    other = await create_card(
        db, card_type="Application", name="Other", attributes={"ActualEnd": "leave alone"}
    )
    db.add(
        AppSettings(
            id="default",
            general_settings={
                "other": "preserved",
                "pml.timeline": {"actual_start_key": "ActualEnd", "actual_end_key": "ActualEnd"},
            },
        )
    )
    calc = Calculation(
        name="Use actual end",
        target_type_key="Initiative",
        target_field_key="summary",
        formula="data.ActualEnd",
    )
    db.add(calc)
    portal = WebPortal(
        name="Initiatives",
        slug="initiatives",
        card_type="Initiative",
        display_fields=["ActualEnd"],
        card_config={"toggles": {"field:ActualEnd": {"card": False, "detail": True}}},
        filters={"attributes": {"ActualEnd": ["ActualEnd"]}, "search": "ActualEnd"},
    )
    db.add(portal)
    await db.flush()
    migration = migration_201()
    conn = await db.connection()
    await conn.run_sync(migration._upgrade_data)
    await db.refresh(initiative)
    await db.refresh(record)
    await db.refresh(other)
    await db.refresh(calc)
    await db.refresh(portal)
    settings = await db.get(AppSettings, "default", populate_existing=True)
    fields = [field for section in initiative.fields_schema for field in section["fields"]]
    assert any(field["key"] == "actualStart" and field["type"] == "date" for field in fields)
    end = next(field for field in fields if field["key"] == "actualEnd")
    assert end["label"] == "Consegna effettiva"
    assert any(field["key"] == "ActualEnd" for field in fields)
    assert record.attributes == {"actualStart": "2026-04-01", "ActualEnd": "2026-05-01"}
    assert other.attributes["ActualEnd"] == "leave alone"
    assert initiative.subtypes[0]["hidden_fields"] == ["ActualEnd", "actualEnd"]
    assert initiative.section_config["custom:0"]["hidden_fields"] == ["ActualEnd", "actualEnd"]
    assert settings.general_settings["other"] == "preserved"
    assert settings.general_settings["pml.timeline"]["actual_end_key"] == "ActualEnd"
    assert settings.general_settings["pml.timeline"]["actual_start_key"] == "ActualEnd"
    assert calc.formula == "data.ActualEnd"
    assert portal.display_fields == ["ActualEnd"]
    assert portal.card_config["toggles"]["field:ActualEnd"] == {"card": False, "detail": True}
    assert portal.card_config["toggles"]["field:actualEnd"] == {"card": False, "detail": False}
    assert portal.filters == {"attributes": {"ActualEnd": ["ActualEnd"]}, "search": "ActualEnd"}
    assert initiative.section_config["custom:0"]["label"] == "ActualEnd"


async def test_migration_preserves_conflicting_existing_values(db):
    await create_card_type(
        db,
        key="Initiative",
        built_in=True,
        fields_schema=[
            {
                "section": "Schedule",
                "fields": [{"key": "ActualEnd", "type": "date", "label": "Legacy"}],
            }
        ],
    )
    card = await create_card(
        db,
        card_type="Initiative",
        name="Both",
        attributes={"ActualEnd": "2026-04-01", "actualEnd": "2026-05-01"},
    )
    await db.flush()
    migration = migration_201()
    conn = await db.connection()
    await conn.run_sync(migration._upgrade_data)
    await db.refresh(card)
    assert card.attributes["actualEnd"] == "2026-05-01"
    assert card.attributes["ActualEnd"] == "2026-04-01"


async def test_migration_keeps_custom_mapping_and_existing_field_labels(db):
    initiative = await create_card_type(
        db,
        key="Initiative",
        built_in=True,
        fields_schema=[
            {
                "section": "Schedule",
                "fields": [
                    {"key": "actualStart", "type": "date", "label": "My start"},
                    {"key": "actualEnd", "type": "date", "label": "My end"},
                    {"key": "deliveryDate", "type": "date", "label": "Delivery"},
                ],
            }
        ],
    )
    db.add(
        AppSettings(
            id="default",
            general_settings={
                "pml.timeline": {
                    "actual_start_key": "actualStart",
                    "actual_end_key": "deliveryDate",
                }
            },
        )
    )
    await db.flush()
    migration = migration_201()
    conn = await db.connection()
    await conn.run_sync(migration._upgrade_data)
    await db.refresh(initiative)
    settings = await db.get(AppSettings, "default", populate_existing=True)
    fields = initiative.fields_schema[0]["fields"]
    assert fields[0]["label"] == "My start" and fields[0]["built_in"] is True
    assert fields[1]["label"] == "My end" and fields[1]["built_in"] is True
    assert settings.general_settings["pml.timeline"]["actual_end_key"] == "deliveryDate"


async def test_migration_rejects_incompatible_occupied_canonical_key(db):
    await create_card_type(
        db,
        key="Initiative",
        built_in=True,
        fields_schema=[
            {
                "section": "Custom",
                "fields": [{"key": "actualEnd", "type": "text", "label": "Important data"}],
            }
        ],
    )
    await db.flush()
    migration = migration_201()
    conn = await db.connection()
    with pytest.raises(RuntimeError, match="actualEnd.*not a date"):
        await conn.run_sync(migration._upgrade_data)


async def test_migration_uses_one_existing_timeline_when_planned_fields_are_missing(db):
    initiative = await create_card_type(
        db,
        key="Initiative",
        built_in=True,
        fields_schema=[{"section": "Timeline", "fields": []}],
    )
    migration = migration_201()
    conn = await db.connection()
    await conn.run_sync(migration._upgrade_data)
    await db.refresh(initiative)

    assert len(initiative.fields_schema) == 1
    [timeline] = initiative.fields_schema
    assert timeline["section"] == "Timeline"
    assert [field["key"] for field in timeline["fields"]] == ["actualStart", "actualEnd"]


async def test_migration_renames_only_initiative_servicenow_field_mapping(db):
    from app.models.servicenow import SnowConnection, SnowFieldMapping, SnowMapping

    await create_card_type(db, key="Initiative", built_in=True)
    connection = SnowConnection(
        name="SN", instance_url="https://example.invalid", auth_type="basic", credentials={}
    )
    db.add(connection)
    await db.flush()
    initiative = SnowMapping(
        connection_id=connection.id, card_type_key="Initiative", snow_table="project"
    )
    application = SnowMapping(
        connection_id=connection.id, card_type_key="Application", snow_table="application"
    )
    db.add_all([initiative, application])
    await db.flush()
    target = SnowFieldMapping(
        mapping_id=initiative.id, turbo_field="attributes.ActualEnd", snow_field="end"
    )
    other = SnowFieldMapping(
        mapping_id=application.id, turbo_field="attributes.ActualEnd", snow_field="end"
    )
    unrelated = SnowFieldMapping(
        mapping_id=initiative.id, turbo_field="attributes.ActualEndNotes", snow_field="notes"
    )
    db.add_all([target, other, unrelated])
    await db.flush()
    migration = migration_201()
    conn = await db.connection()
    await conn.run_sync(migration._upgrade_data)
    await db.refresh(target)
    await db.refresh(other)
    await db.refresh(unrelated)
    assert target.turbo_field == "attributes.actualEnd"
    assert other.turbo_field == "attributes.ActualEnd"
    assert unrelated.turbo_field == "attributes.ActualEndNotes"


def test_migration_formula_rewrites_only_real_field_accesses():
    migration = migration_201()
    formula = "IF(data.note == 'data.ActualEnd', data.ActualEnd, data['ActualEnd'])"
    assert migration._rename_formula(formula) == (
        "IF(data.note == 'data.ActualEnd', data.actualEnd, data['actualEnd'])"
    )
    broken = "data.ActualEnd + ("
    assert migration._rename_formula(broken) == broken


def test_migration_portal_intersects_colliding_visibility_toggles():
    migration = migration_201()
    row = {
        "display_fields": [],
        "filters": {},
        "card_config": {
            "toggles": {
                "field:ActualEnd": {"card": False, "detail": True},
                "field:actualEnd": {"card": True, "detail": True},
            }
        },
    }
    _, config, _ = migration._portal_values(row)
    assert config["toggles"]["field:actualEnd"] == {"card": False, "detail": True}


def test_migration_formula_uses_per_line_parsing_and_preserves_literals():
    migration = migration_201()
    formula = (
        "d = 1\n  IF(data.note == 'data.ActualEnd', data['Actual' 'End'], data['\\x41ctualEnd'])"
    )
    expected = "d = 1\n  IF(data.note == 'data.ActualEnd', data['actualEnd'], data['actualEnd'])"
    assert migration._rename_formula(formula) == expected


async def test_migration_portal_conflicting_dates_do_not_publish_different_value(db):
    initiative = await create_card_type(
        db,
        key="Initiative",
        built_in=True,
        fields_schema=[
            {
                "section": "Timeline",
                "fields": [
                    {"key": "ActualEnd", "type": "date", "label": "Legacy"},
                    {"key": "actualEnd", "type": "date", "label": "Actual"},
                ],
            }
        ],
    )
    card = await create_card(
        db,
        card_type="Initiative",
        name="Collision",
        attributes={"ActualEnd": "2026-04-01", "actualEnd": "2026-05-01"},
    )
    portal = WebPortal(
        name="Published",
        slug="published",
        card_type="Initiative",
        is_published=True,
        display_fields=["ActualEnd"],
        card_config={"toggles": {"field:ActualEnd": {"card": True, "detail": True}}},
    )
    db.add(portal)
    await db.flush()
    conn = await db.connection()
    await conn.run_sync(migration_201()._upgrade_data)
    await db.refresh(card)
    await db.refresh(initiative)
    await db.refresh(portal)
    assert portal.display_fields == ["ActualEnd"]
    assert "field:actualEnd" not in portal.card_config["toggles"]
    fields = [field["key"] for section in initiative.fields_schema for field in section["fields"]]
    assert "ActualEnd" in fields
    assert card.attributes["ActualEnd"] == "2026-04-01"


async def test_migration_does_not_publish_private_legacy_date_as_canonical(db):
    await create_card_type(
        db,
        key="Initiative",
        built_in=True,
        fields_schema=[
            {
                "section": "Timeline",
                "fields": [
                    {"key": "ActualEnd", "type": "date", "label": "Legacy"},
                    {"key": "actualEnd", "type": "date", "label": "Actual"},
                ],
            }
        ],
    )
    card = await create_card(
        db,
        card_type="Initiative",
        name="Only legacy",
        attributes={"ActualEnd": "2026-04-01"},
    )
    portal = WebPortal(
        name="Published",
        slug="published-canonical",
        card_type="Initiative",
        is_published=True,
        display_fields=["actualEnd"],
        card_config={
            "toggles": {
                "field:ActualEnd": {"card": False, "detail": False},
                "field:actualEnd": {"card": True, "detail": True},
            }
        },
    )
    db.add(portal)
    await db.flush()
    conn = await db.connection()
    await conn.run_sync(migration_201()._upgrade_data)
    await db.refresh(card)
    assert card.attributes["ActualEnd"] == "2026-04-01"
    assert "actualEnd" not in card.attributes
