"""Workspace restore keeps PML settings, schemas and dates consistent."""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import select

from app.models.app_settings import AppSettings
from app.models.card import Card
from app.services.workspace_io import applier, schema
from app.services.workspace_io.bundle import WorkspaceBundle
from tests.conftest import create_card, create_card_type, create_role, create_user


@pytest.fixture
async def pml_workspace(db):
    await create_role(db, key="admin", permissions={"*": True})
    user = await create_user(db, role="admin")
    fields = [
        {"key": "startDate", "type": "date"},
        {"key": "endDate", "type": "date"},
        {"key": "actualStart", "type": "date", "built_in": True},
        {"key": "actualEnd", "type": "date", "built_in": True},
        {"key": "customStart", "type": "date"},
        {"key": "customEnd", "type": "date"},
    ]
    initiative = await create_card_type(
        db,
        key="Initiative",
        label="Initiative",
        built_in=True,
        fields_schema=[{"section": "Timeline", "fields": fields}],
    )
    settings = AppSettings(
        id="default",
        general_settings={
            "pml.timeline": {"actual_start_key": "customStart", "actual_end_key": "customEnd"}
        },
        email_settings={},
    )
    db.add(settings)
    await db.flush()
    return user, initiative, settings


def workspace(sheets):
    return WorkspaceBundle(manifest={}, sheets=sheets, assets={})


def settings_row(general):
    return {"key": "general_settings", "value": json.dumps(general)}


def type_row(fields):
    return {
        "key": "Initiative",
        "fields_schema": json.dumps([{"section": "Timeline", "fields": fields}]),
    }


@pytest.mark.parametrize(
    "selected",
    [
        {schema.SHEET_CARD_TYPES},
        {schema.SHEET_CARD_TYPES, schema.SHEET_SETTINGS},
    ],
)
async def test_invalid_schema_mapping_pair_preserves_both_values(db, pml_workspace, selected):
    user, initiative, settings = pml_workspace
    before_schema = initiative.fields_schema
    before_mapping = settings.general_settings["pml.timeline"]
    fields = [field for field in before_schema[0]["fields"] if field["key"] != "customStart"]
    source = workspace(
        {
            schema.SHEET_CARD_TYPES: [type_row(fields)],
            schema.SHEET_SETTINGS: [
                settings_row(
                    {
                        "pml.timeline": {
                            "actual_start_key": "missingField",
                            "actual_end_key": "customEnd",
                        },
                        "theme": "dark",
                    }
                )
            ],
        }
    )
    result = await applier._run(db, source, user, dry_run=False, sheets=selected, commit=False)
    await db.refresh(initiative)
    await db.refresh(settings)
    assert initiative.fields_schema == before_schema
    assert settings.general_settings["pml.timeline"] == before_mapping
    assert result.total_conflict + result.total_failed > 0
    if schema.SHEET_SETTINGS in selected:
        assert settings.general_settings["theme"] == "dark"


async def test_settings_only_invalid_mapping_preserves_current_mapping(db, pml_workspace):
    user, _, settings = pml_workspace
    before = settings.general_settings["pml.timeline"]
    source = workspace(
        {
            schema.SHEET_SETTINGS: [
                settings_row(
                    {
                        "pml.timeline": {
                            "actual_start_key": "startDate",
                            "actual_end_key": "customEnd",
                        }
                    }
                )
            ]
        }
    )
    result = await applier._run(
        db, source, user, dry_run=False, sheets={schema.SHEET_SETTINGS}, commit=False
    )
    await db.refresh(settings)
    assert settings.general_settings["pml.timeline"] == before
    assert result.total_conflict + result.total_failed > 0


async def test_workspace_rejects_inverted_actual_dates(db, pml_workspace):
    user, _, _ = pml_workspace
    source = workspace(
        {
            schema.SHEET_CARDS: [
                {
                    "type": "Initiative",
                    "name": "Invalid dates",
                    "attributes": json.dumps(
                        {"customStart": "2027-04-01", "customEnd": "2027-03-01"}
                    ),
                }
            ]
        }
    )
    result = await applier._run(
        db, source, user, dry_run=False, sheets={schema.SHEET_CARDS}, commit=False
    )
    assert not await db.scalar(select(Card.id).where(Card.name == "Invalid dates"))
    assert result.total_conflict + result.total_failed > 0


async def test_settings_only_card_default_uses_destination_card_id(db, pml_workspace):
    user, _, settings = pml_workspace
    await create_card_type(db, key="Provider", label="Provider")
    provider = await create_card(db, card_type="Provider", name="Aruba")
    source_id = str(uuid.uuid4())
    key = "pml.financial_fields.budget"
    config = {
        "fields": [
            {
                "key": "provider",
                "label": "Provider",
                "kind": "card_reference",
                "card_type": "Provider",
                "default": source_id,
            }
        ]
    }
    source = workspace(
        {
            schema.SHEET_SETTINGS: [settings_row({key: config})],
            schema.SHEET_CARDS: [
                {schema.SOURCE_ID_COLUMN: source_id, "type": "Provider", "name": "Aruba"}
            ],
        }
    )
    result = await applier._run(
        db, source, user, dry_run=False, sheets={schema.SHEET_SETTINGS}, commit=False
    )
    await db.refresh(settings)
    assert result.total_failed == 0
    assert settings.general_settings[key]["fields"][0]["default"] == str(provider.id)


async def test_schema_and_new_mapping_apply_together(db, pml_workspace):
    user, initiative, settings = pml_workspace
    fields = [f for f in initiative.fields_schema[0]["fields"] if f["key"] != "customStart"]
    fields.append({"key": "newStart", "type": "date"})
    mapping = {"actual_start_key": "newStart", "actual_end_key": "customEnd"}
    source = workspace(
        {
            schema.SHEET_CARD_TYPES: [type_row(fields)],
            schema.SHEET_SETTINGS: [settings_row({"pml.timeline": mapping})],
        }
    )
    result = await applier._run(
        db,
        source,
        user,
        dry_run=False,
        sheets={schema.SHEET_CARD_TYPES, schema.SHEET_SETTINGS},
        commit=False,
    )
    await db.refresh(initiative)
    await db.refresh(settings)
    assert result.total_conflict == 0
    assert settings.general_settings["pml.timeline"] == mapping
    assert any(f["key"] == "newStart" for f in initiative.fields_schema[0]["fields"])


async def test_conflicting_mapping_blocks_dependent_card_not_other_type(db, pml_workspace):
    user, _, _ = pml_workspace
    await create_card_type(db, key="Application", label="Application")
    source = workspace(
        {
            schema.SHEET_SETTINGS: [
                settings_row(
                    {
                        "pml.timeline": {
                            "actual_start_key": "missingStart",
                            "actual_end_key": "customEnd",
                        }
                    }
                )
            ],
            schema.SHEET_CARDS: [
                {
                    "type": "Initiative",
                    "name": "Blocked",
                    "attributes": json.dumps({"missingStart": "2026-01-01"}),
                },
                {"type": "Application", "name": "Allowed", "attributes": "{}"},
            ],
        }
    )
    result = await applier._run(
        db,
        source,
        user,
        dry_run=False,
        sheets={schema.SHEET_SETTINGS, schema.SHEET_CARDS},
        commit=False,
    )
    assert result.total_conflict >= 2
    assert not await db.scalar(select(Card.id).where(Card.name == "Blocked"))
    assert await db.scalar(select(Card.id).where(Card.name == "Allowed"))


async def test_incompatible_financial_config_preserves_previous_and_reports(db, pml_workspace):
    user, _, settings = pml_workspace
    await create_card_type(db, key="Provider", label="Provider")
    key = "pml.financial_fields.invoice"
    previous = {"fields": [{"key": "note", "label": "Note", "kind": "text"}]}
    settings.general_settings = {**settings.general_settings, key: previous}
    await db.flush()
    invalid = {
        "fields": [
            {"key": "vendor", "label": "Vendor", "kind": "card_reference", "card_type": "Provider"}
        ]
    }
    source = workspace({schema.SHEET_SETTINGS: [settings_row({key: invalid})]})
    result = await applier._run(
        db, source, user, dry_run=False, sheets={schema.SHEET_SETTINGS}, commit=False
    )
    await db.refresh(settings)
    assert settings.general_settings[key] == previous
    assert result.total_conflict + result.total_failed > 0


async def test_readonly_timeline_field_cannot_replace_current_mapping(db, pml_workspace):
    user, initiative, settings = pml_workspace
    fields = [dict(field) for field in initiative.fields_schema[0]["fields"]]
    next(field for field in fields if field["key"] == "customStart")["readonly"] = True
    before = initiative.fields_schema
    source = workspace({schema.SHEET_CARD_TYPES: [type_row(fields)]})
    result = await applier._run(
        db, source, user, dry_run=False, sheets={schema.SHEET_CARD_TYPES}, commit=False
    )
    await db.refresh(initiative)
    assert initiative.fields_schema == before
    assert result.total_conflict + result.total_failed > 0


async def test_preview_does_not_persist_new_timeline_mapping(db, pml_workspace):
    user, _, settings = pml_workspace
    before = dict(settings.general_settings)
    source = workspace(
        {
            schema.SHEET_SETTINGS: [
                settings_row(
                    {
                        "pml.timeline": {
                            "actual_start_key": "actualStart",
                            "actual_end_key": "actualEnd",
                        }
                    }
                )
            ]
        }
    )
    result = await applier._run(
        db, source, user, dry_run=True, sheets={schema.SHEET_SETTINGS}, commit=False
    )
    await db.refresh(settings)
    assert result.total_conflict == 0
    assert settings.general_settings == before


async def test_rejected_initiative_type_does_not_apply_new_timeline_mapping(db, pml_workspace):
    user, initiative, settings = pml_workspace
    before_schema = initiative.fields_schema
    before_mapping = settings.general_settings["pml.timeline"]
    fields = [*before_schema[0]["fields"], {"key": "newStart", "type": "date"}]
    broken = {**type_row(fields), "lifecycle_stages": json.dumps([{}])}
    source = workspace(
        {
            schema.SHEET_CARD_TYPES: [broken, {"key": "Application", "label": "Other"}],
            schema.SHEET_SETTINGS: [
                settings_row(
                    {
                        "pml.timeline": {
                            "actual_start_key": "newStart",
                            "actual_end_key": "customEnd",
                        },
                        "theme": "dark",
                    }
                )
            ],
            schema.SHEET_CARDS: [
                {
                    "type": "Initiative",
                    "name": "Should not import",
                    "attributes": json.dumps({"newStart": "2027-01-01"}),
                }
            ],
        }
    )
    result = await applier._run(
        db,
        source,
        user,
        dry_run=False,
        sheets={schema.SHEET_CARD_TYPES, schema.SHEET_SETTINGS, schema.SHEET_CARDS},
        commit=False,
    )
    await db.refresh(initiative)
    await db.refresh(settings)
    assert initiative.fields_schema == before_schema
    assert settings.general_settings["pml.timeline"] == before_mapping
    assert settings.general_settings["theme"] == "dark"
    assert not await db.scalar(select(Card.id).where(Card.name == "Should not import"))
    assert result.total_failed + result.total_conflict > 0


async def test_budget_and_cost_provider_settings_change_as_one_pair(db, pml_workspace):
    user, _, settings = pml_workspace
    await create_card_type(db, key="Provider", label="Provider")
    budget_key = "pml.financial_fields.budget"
    cost_key = "pml.financial_fields.cost_item"

    def budget(field):
        return {
            "fields": [
                {"key": field, "label": "Vendor", "kind": "card_reference", "card_type": "Provider"}
            ]
        }

    def cost(field):
        return {"fields": [], "provider_source": {"budget_field_key": field}}

    settings.general_settings = {
        **settings.general_settings,
        budget_key: budget("oldVendor"),
        cost_key: cost("oldVendor"),
    }
    await db.flush()
    source = workspace(
        {
            schema.SHEET_SETTINGS: [
                settings_row({budget_key: budget("newVendor"), cost_key: cost("newVendor")})
            ]
        }
    )
    result = await applier._run(
        db, source, user, dry_run=False, sheets={schema.SHEET_SETTINGS}, commit=False
    )
    await db.refresh(settings)
    assert result.total_conflict == 0
    assert settings.general_settings[budget_key]["fields"][0]["key"] == "newVendor"
    assert settings.general_settings[cost_key]["provider_source"]["budget_field_key"] == "newVendor"


async def test_legacy_aruba_mapping_schema_and_card_dates_are_normalized(db, pml_workspace):
    user, initiative, settings = pml_workspace
    fields = [f for f in initiative.fields_schema[0]["fields"] if f["key"] != "actualEnd"]
    fields.append({"key": "ActualEnd", "label": "Actual End", "type": "date"})
    source = workspace(
        {
            schema.SHEET_CARD_TYPES: [type_row(fields)],
            schema.SHEET_SETTINGS: [
                settings_row(
                    {
                        "pml.timeline": {
                            "actual_start_key": "actualStart",
                            "actual_end_key": "ActualEnd",
                        }
                    }
                )
            ],
            schema.SHEET_CARDS: [
                {
                    "type": "Initiative",
                    "name": "Legacy Aruba",
                    "attributes": json.dumps(
                        {"actualStart": "2026-01-01", "ActualEnd": "2026-03-01"}
                    ),
                }
            ],
        }
    )
    result = await applier._run(
        db,
        source,
        user,
        dry_run=False,
        sheets={schema.SHEET_CARD_TYPES, schema.SHEET_SETTINGS, schema.SHEET_CARDS},
        commit=False,
    )
    await db.refresh(initiative)
    await db.refresh(settings)
    card = await db.scalar(select(Card).where(Card.name == "Legacy Aruba"))
    assert result.total_conflict == 0
    assert settings.general_settings["pml.timeline"]["actual_end_key"] == "actualEnd"
    assert card.attributes["actualEnd"] == "2026-03-01"
    assert "ActualEnd" not in card.attributes
    assert not any(f["key"] == "ActualEnd" for f in initiative.fields_schema[0]["fields"])


async def test_legacy_aruba_conflicting_values_keep_both_and_use_canonical(db, pml_workspace):
    user, _, settings = pml_workspace
    settings.general_settings = {
        "pml.timeline": {"actual_start_key": "actualStart", "actual_end_key": "actualEnd"}
    }
    await db.flush()
    source = workspace(
        {
            schema.SHEET_CARDS: [
                {
                    "type": "Initiative",
                    "name": "Collision",
                    "attributes": json.dumps(
                        {"ActualEnd": "2026-04-01", "actualEnd": "2026-05-01"}
                    ),
                }
            ]
        }
    )
    result = await applier._run(
        db, source, user, dry_run=False, sheets={schema.SHEET_CARDS}, commit=False
    )
    card = await db.scalar(select(Card).where(Card.name == "Collision"))
    assert result.total_conflict == 0
    assert card.attributes["actualEnd"] == "2026-05-01"
    assert card.attributes["ActualEnd"] == "2026-04-01"


async def test_invalid_provider_pair_preserves_both_previous_definitions(db, pml_workspace):
    user, _, settings = pml_workspace
    await create_card_type(db, key="Provider", label="Provider")
    budget_key = "pml.financial_fields.budget"
    cost_key = "pml.financial_fields.cost_item"
    old_budget = {
        "fields": [
            {
                "key": "oldVendor",
                "label": "Vendor",
                "kind": "card_reference",
                "card_type": "Provider",
            }
        ]
    }
    old_cost = {"fields": [], "provider_source": {"budget_field_key": "oldVendor"}}
    settings.general_settings = {
        **settings.general_settings,
        budget_key: old_budget,
        cost_key: old_cost,
    }
    await db.flush()
    new_budget = {
        "fields": [
            {
                "key": "newVendor",
                "label": "Vendor",
                "kind": "card_reference",
                "card_type": "Provider",
            }
        ]
    }
    new_cost = {"fields": [], "provider_source": {"budget_field_key": "missing"}}
    source = workspace(
        {schema.SHEET_SETTINGS: [settings_row({budget_key: new_budget, cost_key: new_cost})]}
    )
    result = await applier._run(
        db, source, user, dry_run=False, sheets={schema.SHEET_SETTINGS}, commit=False
    )
    await db.refresh(settings)
    assert settings.general_settings[budget_key] == old_budget
    assert settings.general_settings[cost_key] == old_cost
    assert result.total_conflict > 0


async def test_provider_constant_cannot_reference_an_initiative_on_restore(db, pml_workspace):
    user, _, settings = pml_workspace
    card = await create_card(db, card_type="Initiative", name="Wrong reference type")
    key = "pml.financial_fields.cost_item"
    previous = {"fields": []}
    settings.general_settings = {**settings.general_settings, key: previous}
    await db.flush()
    candidate = {
        "fields": [
            {
                "key": "classification",
                "label": "Classification",
                "kind": "calculated",
                "calculation": {
                    "result_type": "text",
                    "inputs": {},
                    "provider_constants": {"supplier": str(card.id)},
                    "expression": 'IF(supplier == supplier, "yes", "no")',
                },
            }
        ],
    }
    source = workspace({schema.SHEET_SETTINGS: [settings_row({key: candidate})]})

    result = await applier._run(
        db, source, user, dry_run=False, sheets={schema.SHEET_SETTINGS}, commit=False
    )

    await db.refresh(settings)
    assert result.total_conflict > 0
    assert settings.general_settings[key] == previous
    errors = [error for section in result.sections for error in section.errors]
    assert any("Unresolved Provider reference" in error for error in errors)


async def test_selected_settings_ignore_unselected_malformed_type_row(db, pml_workspace):
    user, _, settings = pml_workspace
    source = workspace(
        {
            schema.SHEET_CARD_TYPES: [{"key": "Initiative", "fields_schema": "{invalid json"}],
            schema.SHEET_SETTINGS: [settings_row({"theme": "dark"})],
        }
    )
    result = await applier._run(
        db, source, user, dry_run=False, sheets={schema.SHEET_SETTINGS}, commit=False
    )
    await db.refresh(settings)
    assert result.total_failed == 0
    assert settings.general_settings["theme"] == "dark"


def test_legacy_date_normalizes_calculation_and_portal_for_selected_restore():
    source = workspace(
        {
            schema.SHEET_CARD_TYPES: [type_row([{"key": "ActualEnd", "type": "date"}])],
            schema.SHEET_CARDS: [],
            schema.SHEET_CALCULATIONS: [
                {
                    "target_type_key": "Initiative",
                    "target_field_key": "ActualEnd",
                    "formula": 'data.ActualEnd + data["ActualEnd"]',
                },
                {
                    "target_type_key": "Application",
                    "target_field_key": "ActualEnd",
                    "formula": "data.ActualEnd",
                },
            ],
            "WebPortals": [
                {
                    "card_type": "Initiative",
                    "display_fields": ["name", "ActualEnd"],
                    "card_config": {
                        "toggles": {"field:ActualEnd": {"card": False, "detail": True}}
                    },
                    "filters": {"attributes": {"ActualEnd": "2026-01-01"}},
                },
            ],
        }
    )
    result = applier._normalize_legacy_initiative_dates(
        source, {schema.SHEET_CALCULATIONS, schema.SHEET_CARDS, "WebPortals"}
    )
    calculation = result.rows(schema.SHEET_CALCULATIONS)[0]
    assert calculation["target_field_key"] == "ActualEnd"
    assert calculation["formula"] == 'data.ActualEnd + data["ActualEnd"]'
    assert result.rows(schema.SHEET_CALCULATIONS)[1]["formula"] == "data.ActualEnd"
    portal = result.rows("WebPortals")[0]
    assert portal["display_fields"] == ["name", "ActualEnd"]
    assert portal["card_config"]["toggles"]["field:ActualEnd"] == {"card": False, "detail": True}
    assert portal["card_config"]["toggles"]["field:actualEnd"] == {"card": False, "detail": False}
    assert portal["filters"]["attributes"] == {"ActualEnd": "2026-01-01"}
    assert source.rows("WebPortals")[0]["display_fields"] == ["name", "ActualEnd"]


def test_legacy_portal_conflict_keeps_published_value_and_hides_canonical():
    source = workspace(
        {
            schema.SHEET_CARD_TYPES: [
                type_row(
                    [
                        {"key": "ActualEnd", "type": "date"},
                        {"key": "actualEnd", "type": "date"},
                    ]
                )
            ],
            schema.SHEET_CARDS: [
                {
                    "type": "Initiative",
                    "attributes": {"ActualEnd": "2026-04-01", "actualEnd": "2026-05-01"},
                }
            ],
            "WebPortals": [
                {
                    "card_type": "Initiative",
                    "display_fields": ["ActualEnd"],
                    "card_config": {"toggles": {"field:ActualEnd": {"card": True, "detail": True}}},
                    "filters": {},
                }
            ],
        }
    )
    normalized = applier._normalize_legacy_initiative_dates(source, None)
    portal = normalized.rows("WebPortals")[0]
    assert portal["display_fields"] == ["ActualEnd"]
    assert portal["card_config"]["toggles"]["field:ActualEnd"]["card"] is True
    assert "field:actualEnd" not in portal["card_config"]["toggles"]
    fields = normalized.rows(schema.SHEET_CARD_TYPES)[0]["fields_schema"][0]["fields"]
    assert {item["key"] for item in fields} == {"ActualEnd", "actualEnd"}
    assert normalized.rows(schema.SHEET_CARDS)[0]["attributes"]["ActualEnd"] == "2026-04-01"


@pytest.mark.parametrize("financial_only", [False, True])
async def test_workspace_settings_preserve_concurrent_unrelated_update(test_engine, financial_only):
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.services.workspace_io.remap import RemapContext

    key = "pml.financial_fields.invoice"
    async with AsyncSession(test_engine, expire_on_commit=False) as setup:
        settings = await setup.get(AppSettings, "default")
        original = dict(settings.general_settings or {}) if settings else None
        if settings is None:
            settings = AppSettings(id="default", general_settings={}, email_settings={})
            setup.add(settings)
        settings.general_settings = {**(original or {}), "other": "before"}
        await setup.commit()

    try:
        async with AsyncSession(test_engine, expire_on_commit=False) as importer:
            # The importer has already read a stale singleton before another
            # transaction commits its unrelated settings update.
            stale = await importer.get(AppSettings, "default")
            assert stale.general_settings["other"] == "before"
            async with AsyncSession(test_engine, expire_on_commit=False) as writer:
                current = await writer.get(AppSettings, "default")
                current.general_settings = {**current.general_settings, "other": "after"}
                await writer.commit()
            if financial_only:
                incoming = {key: {"fields": [{"key": "note", "label": "Note", "kind": "text"}]}}
                await applier._finalize_pml_settings(
                    importer, incoming, RemapContext(), applier.ApplyResult(dry_run=False)
                )
            else:
                incoming = workspace({schema.SHEET_SETTINGS: [settings_row({"theme": "dark"})]})
                await applier._apply_settings(
                    importer, incoming, applier.SectionResult(sheet=schema.SHEET_SETTINGS), False
                )
            await importer.commit()

        async with AsyncSession(test_engine) as verify:
            saved = await verify.get(AppSettings, "default")
            assert saved.general_settings["other"] == "after"
            if financial_only:
                assert saved.general_settings[key]["fields"][0]["key"] == "note"
            else:
                assert saved.general_settings["theme"] == "dark"
    finally:
        async with AsyncSession(test_engine) as cleanup:
            settings = await cleanup.get(AppSettings, "default")
            if original is None:
                await cleanup.delete(settings)
            else:
                settings.general_settings = original
            await cleanup.commit()


def test_selected_portal_only_does_not_promote_from_empty_source_inventory():
    source = workspace(
        {
            schema.SHEET_CARD_TYPES: [type_row([{"key": "ActualEnd", "type": "date"}])],
            schema.SHEET_CARDS: [],
            "WebPortals": [
                {
                    "card_type": "Initiative",
                    "display_fields": ["ActualEnd"],
                    "card_config": {"toggles": {"field:ActualEnd": {"card": True, "detail": True}}},
                }
            ],
        }
    )
    result = applier._normalize_legacy_initiative_dates(source, {"WebPortals"})
    portal = result.rows("WebPortals")[0]
    assert portal["display_fields"] == ["ActualEnd"]
    assert portal["card_config"]["toggles"]["field:actualEnd"] == {"card": False, "detail": False}


def test_legacy_private_date_is_not_copied_to_public_canonical_field():
    source = workspace(
        {
            schema.SHEET_CARD_TYPES: [
                type_row(
                    [
                        {"key": "ActualEnd", "type": "date"},
                        {"key": "actualEnd", "type": "date"},
                    ]
                )
            ],
            schema.SHEET_CARDS: [
                {
                    "type": "Initiative",
                    "attributes": {"ActualEnd": "2026-04-01"},
                }
            ],
            "WebPortals": [
                {
                    "card_type": "Initiative",
                    "display_fields": ["actualEnd"],
                    "card_config": {
                        "toggles": {
                            "field:ActualEnd": {"card": False, "detail": False},
                            "field:actualEnd": {"card": True, "detail": True},
                        }
                    },
                }
            ],
        }
    )
    result = applier._normalize_legacy_initiative_dates(source, None)
    attributes = result.rows(schema.SHEET_CARDS)[0]["attributes"]
    assert attributes["ActualEnd"] == "2026-04-01"
    assert "actualEnd" not in attributes


async def test_cards_only_restore_keeps_legacy_private_for_existing_portal(db, pml_workspace):
    from app.models.web_portal import WebPortal

    user, _, _ = pml_workspace
    db.add(
        WebPortal(
            name="Published",
            slug="existing-canonical",
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
    )
    await db.flush()
    source = workspace(
        {
            schema.SHEET_CARDS: [
                {
                    "type": "Initiative",
                    "name": "Imported private",
                    "attributes": {"ActualEnd": "2026-04-01"},
                }
            ]
        }
    )
    result = await applier._run(
        db, source, user, dry_run=False, sheets={schema.SHEET_CARDS}, commit=False
    )
    assert result.total_conflict == 0
    card = await db.scalar(select(Card).where(Card.name == "Imported private"))
    assert card.attributes["ActualEnd"] == "2026-04-01"
    assert "actualEnd" not in card.attributes


@pytest.mark.parametrize(
    "toggles",
    [
        {},
        {
            "field:ActualEnd": {"card": True, "detail": False},
            "field:actualEnd": {"card": False, "detail": True},
        },
    ],
)
def test_portal_surfaces_preserve_private_legacy_values(toggles):
    source = workspace(
        {
            schema.SHEET_CARD_TYPES: [
                type_row(
                    [
                        {"key": "ActualEnd", "type": "date"},
                        {"key": "actualEnd", "type": "date"},
                    ]
                )
            ],
            schema.SHEET_SETTINGS: [
                settings_row(
                    {
                        "pml.timeline": {
                            "actual_start_key": "actualStart",
                            "actual_end_key": "ActualEnd",
                        }
                    }
                )
            ],
            schema.SHEET_CARDS: [
                {
                    "type": "Initiative",
                    "attributes": {"ActualEnd": "2026-04-01"},
                }
            ],
            "WebPortals": [
                {
                    "card_type": "Initiative",
                    "display_fields": ["actualEnd"],
                    "card_config": {"toggles": toggles},
                }
            ],
        }
    )
    result = applier._normalize_legacy_initiative_dates(source, None)
    attributes = result.rows(schema.SHEET_CARDS)[0]["attributes"]
    assert attributes == {"ActualEnd": "2026-04-01"}
    portal = result.rows("WebPortals")[0]
    assert portal["card_config"]["toggles"] == toggles
    general = result.rows(schema.SHEET_SETTINGS)[0]["value"]
    assert general["pml.timeline"]["actual_end_key"] == "ActualEnd"


async def test_combined_portal_restore_does_not_publish_retained_destination_date(
    client, db, pml_workspace
):
    import uuid

    user, initiative, _ = pml_workspace
    retained = await create_card(
        db,
        card_type="Initiative",
        name="Retained",
        attributes={"ActualEnd": "2026-04-01", "actualEnd": "2026-05-01"},
    )
    portal_id = uuid.uuid4()
    source = workspace(
        {
            schema.SHEET_CARD_TYPES: [type_row([{"key": "ActualEnd", "type": "date"}])],
            schema.SHEET_CARDS: [],
            "WebPortals": [
                {
                    "id": str(portal_id),
                    "name": "Imported",
                    "slug": "imported-safe-date",
                    "card_type": "Initiative",
                    "is_published": True,
                    "display_fields": ["ActualEnd"],
                    "card_config": {"toggles": {"field:ActualEnd": {"card": True, "detail": True}}},
                    "filters": {},
                }
            ],
        }
    )
    result = await applier._run(
        db,
        source,
        user,
        dry_run=False,
        sheets={schema.SHEET_CARDS, "WebPortals"},
        commit=False,
    )
    assert result.total_conflict == 0
    response = await client.get("/api/v1/web-portals/public/imported-safe-date/cards")
    assert response.status_code == 200
    body = response.json()
    records = body if isinstance(body, list) else body["items"]
    shown = next(row for row in records if row["id"] == str(retained.id))
    assert shown["attributes"].get("actualEnd") is None
