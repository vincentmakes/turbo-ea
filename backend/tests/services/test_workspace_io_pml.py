"""Workspace PML financial identity, parent and amount regressions."""

import uuid
from decimal import Decimal

from app.models.ppm_cost_line import PpmBudgetLine, PpmCostLine
from app.models.ppm_invoice import PpmInvoice
from app.services.card_resolver import CardResolver
from app.services.workspace_io.applier import SectionResult
from app.services.workspace_io.bundle import WorkspaceBundle
from app.services.workspace_io.entities import EntitySection, apply_entity_section
from app.services.workspace_io.remap import CARDS, RemapContext
from tests.conftest import create_card


async def _apply(db, section, row, source_card, target_card, context=None):
    ctx = context or RemapContext()
    ctx.ids.record(CARDS, source_card, target_card.id)
    result = SectionResult(sheet=section.sheet)
    bundle = WorkspaceBundle(manifest={}, sheets={section.sheet: [row]})
    resolver = CardResolver({}, {}, {})
    await apply_entity_section(db, section, bundle, result, resolver, {}, ctx)
    return result, ctx


async def test_repeat_budget_with_conflicting_values_reports_conflict(db):
    initiative = await create_card(db, card_type="Initiative", name="Initiative")
    budget = PpmBudgetLine(
        id=uuid.uuid4(),
        initiative_id=initiative.id,
        fiscal_year=2026,
        category="opex",
        amount=100,
        field_values={},
    )
    db.add(budget)
    await db.flush()
    source = uuid.uuid4()
    section = EntitySection("PpmBudgetLines", PpmBudgetLine, card_fk_columns=("initiative_id",))
    row = {
        "id": str(budget.id),
        "initiative_id__id": str(source),
        "fiscal_year": 2026,
        "category": "opex",
        "description": None,
        "amount": 200,
        "field_values": {},
    }
    result, _ = await _apply(db, section, row, source, initiative)
    assert result.conflict == 1
    assert budget.amount == 100


async def test_invoice_rejects_foreign_or_missing_cost_parent(db):
    initiative = await create_card(db, card_type="Initiative", name="Initiative")
    foreign = await create_card(db, card_type="Initiative", name="Foreign")
    budget = PpmBudgetLine(
        id=uuid.uuid4(),
        initiative_id=foreign.id,
        fiscal_year=2026,
        category="opex",
        amount=100,
        field_values={},
    )
    db.add(budget)
    cost = PpmCostLine(
        id=uuid.uuid4(),
        initiative_id=foreign.id,
        budget_line_id=budget.id,
        description="Foreign",
        category="opex",
        actual=0,
        planned=0,
        field_values={},
    )
    db.add(cost)
    await db.flush()
    source = uuid.uuid4()
    section = EntitySection("PpmInvoices", PpmInvoice, card_fk_columns=("initiative_id",))
    for parent in (cost.id, uuid.uuid4()):
        row = {
            "id": str(uuid.uuid4()),
            "initiative_id__id": str(source),
            "cost_item_id": str(parent),
            "invoice_date": "2026-11-23",
            "invoice_id": "00042",
            "amount": "30.11",
            "field_values": {},
        }
        result, _ = await _apply(db, section, row, source, initiative)
        assert result.conflict == 1


async def test_invoice_only_import_preserves_decimal_and_repeat_identity(db):
    initiative = await create_card(db, card_type="Initiative", name="Initiative")
    budget = PpmBudgetLine(
        id=uuid.uuid4(),
        initiative_id=initiative.id,
        fiscal_year=2026,
        category="opex",
        amount=100,
        field_values={},
    )
    cost = PpmCostLine(
        id=uuid.uuid4(),
        initiative_id=initiative.id,
        budget_line_id=budget.id,
        description="Cost",
        category="opex",
        actual=0,
        planned=0,
        field_values={},
    )
    db.add_all([budget, cost])
    await db.flush()
    source = uuid.uuid4()
    identifier = uuid.uuid4()
    section = EntitySection("PpmInvoices", PpmInvoice, card_fk_columns=("initiative_id",))
    row = {
        "id": str(identifier),
        "initiative_id__id": str(source),
        "cost_item_id": str(cost.id),
        "invoice_date": "2026-11-23",
        "invoice_id": "00042",
        "amount": "30.11",
        "field_values": {},
    }
    result, _ = await _apply(db, section, row, source, initiative)
    assert result.created == 1
    saved = await db.get(PpmInvoice, identifier)
    assert saved.amount == Decimal("30.11") and saved.invoice_id == "00042"
    repeated, _ = await _apply(db, section, row, source, initiative)
    assert repeated.skipped == 1 and repeated.conflict == 0


async def test_cost_provider_historical_reparenting_and_unassigned_legacy(db):
    from app.services.workspace_io.remap import rewrite_pml_row

    initiative = await create_card(db, card_type="Initiative", name="Initiative")
    parent = await create_card(db, card_type="Provider", name="Original")
    another = await create_card(db, card_type="Provider", name="New parent")
    child = await create_card(db, card_type="Provider", name="Moved", parent_id=another.id)
    budget = PpmBudgetLine(
        id=uuid.uuid4(),
        initiative_id=initiative.id,
        fiscal_year=2026,
        category="opex",
        amount=100,
        field_values={"origin": str(parent.id)},
    )
    db.add(budget)
    await db.flush()
    ctx = RemapContext()
    ctx.pml_configs = {
        "cost_item": {
            "provider_source": {"budget_field_key": "origin", "allow_child_selection": True}
        },
    }
    ctx.ids.record(CARDS, parent.id, parent.id)
    ctx.ids.record(CARDS, child.id, child.id)
    source = uuid.uuid4()
    section = EntitySection(
        "PpmCostLines", PpmCostLine, card_fk_columns=("initiative_id",), rewrite=rewrite_pml_row
    )
    row = {
        "id": str(uuid.uuid4()),
        "initiative_id__id": str(source),
        "budget_line_id": str(budget.id),
        "provider_child_id": str(child.id),
        "description": "Cost",
        "category": "opex",
        "planned": 0,
        "actual": 0,
        "field_values": {},
    }
    result, _ = await _apply(db, section, row, source, initiative, ctx)
    assert result.conflict == 1
    row["id"] = str(uuid.uuid4())
    row["provider_child_historical"] = True
    result, _ = await _apply(db, section, row, source, initiative, ctx)
    assert result.created == 1
    historical = await db.get(PpmCostLine, uuid.UUID(row["id"]))
    assert historical.provider_child_id == child.id
    row["id"] = str(uuid.uuid4())
    row["provider_child_id"] = None
    row["budget_line_id"] = None
    row.pop("provider_child_historical")
    result, _ = await _apply(db, section, row, source, initiative, ctx)
    assert result.created == 1
    legacy = await db.get(PpmCostLine, uuid.UUID(row["id"]))
    assert legacy.budget_line_id is None


async def test_deleted_provider_identities_remain_distinct_and_stable(db):
    import json

    from app.services.workspace_io.remap import rewrite_pml_row

    initiative = await create_card(db, card_type="Initiative", name="Initiative")
    ctx = RemapContext()
    ctx.pml_configs = {
        "budget": {
            "fields": [
                {
                    "key": "origin",
                    "label": "Origin",
                    "kind": "card_reference",
                    "card_type": "Provider",
                }
            ]
        },
    }
    source = uuid.uuid4()
    section = EntitySection(
        "PpmBudgetLines", PpmBudgetLine, card_fk_columns=("initiative_id",), rewrite=rewrite_pml_row
    )
    rows = []
    deleted = [str(uuid.uuid4()), str(uuid.uuid4())]
    for provider in deleted:
        row = {
            "id": str(uuid.uuid4()),
            "initiative_id__id": str(source),
            "fiscal_year": 2026,
            "category": "opex",
            "description": None,
            "amount": 100,
            "field_values": {"origin": provider},
            "pml_historical_card_ids": json.dumps([provider]),
        }
        result, _ = await _apply(db, section, row, source, initiative, ctx)
        assert result.created == 1, result.errors
        rows.append(row)
    first = await db.get(PpmBudgetLine, uuid.UUID(rows[0]["id"]))
    second = await db.get(PpmBudgetLine, uuid.UUID(rows[1]["id"]))
    assert first.field_values["origin"] != second.field_values["origin"]
    assert first.field_values["origin"] not in deleted
    repeated, _ = await _apply(db, section, rows[0], source, initiative, ctx)
    assert repeated.skipped == 1 and repeated.conflict == 0


async def test_rejected_budget_blocks_dependent_cost_even_if_destination_exists(db):
    initiative = await create_card(db, card_type="Initiative", name="Initiative")
    budget = PpmBudgetLine(
        id=uuid.uuid4(),
        initiative_id=initiative.id,
        fiscal_year=2026,
        category="opex",
        amount=100,
        field_values={},
    )
    db.add(budget)
    await db.flush()
    source = uuid.uuid4()
    ctx = RemapContext()
    ctx.pml_rejected_ids.add(str(budget.id))
    section = EntitySection("PpmCostLines", PpmCostLine, card_fk_columns=("initiative_id",))
    row = {
        "id": str(uuid.uuid4()),
        "initiative_id__id": str(source),
        "budget_line_id": str(budget.id),
        "provider_child_id": None,
        "description": "Cost",
        "category": "opex",
        "planned": 0,
        "actual": 0,
        "field_values": {},
    }
    result, _ = await _apply(db, section, row, source, initiative, ctx)
    assert result.conflict == 1
    assert str(row["id"]) in ctx.pml_rejected_ids


async def test_legacy_cost_without_budget_accepts_invoice_only_import(db):
    initiative = await create_card(db, card_type="Initiative", name="Legacy initiative")
    cost = PpmCostLine(
        id=uuid.uuid4(),
        initiative_id=initiative.id,
        budget_line_id=None,
        description="Legacy cost",
        category="opex",
        actual=0,
        planned=0,
        field_values={},
    )
    db.add(cost)
    await db.flush()
    source = uuid.uuid4()
    invoice_id = uuid.uuid4()
    section = EntitySection("PpmInvoices", PpmInvoice, card_fk_columns=("initiative_id",))
    row = {
        "id": str(invoice_id),
        "initiative_id__id": str(source),
        "cost_item_id": str(cost.id),
        "invoice_date": "2026-11-23",
        "invoice_id": "00042",
        "amount": "30.11",
        "field_values": {},
    }
    result, _ = await _apply(db, section, row, source, initiative)
    assert result.created == 1, result.errors
    saved = await db.get(PpmInvoice, invoice_id)
    assert saved.cost_item_id == cost.id
    assert saved.amount == Decimal("30.11")
    assert cost.budget_line_id is None


async def test_import_cost_only_preserves_existing_invoice(db):
    from datetime import date

    initiative = await create_card(db, card_type="Initiative", name="Initiative")
    budget = PpmBudgetLine(
        id=uuid.uuid4(),
        initiative_id=initiative.id,
        fiscal_year=2026,
        category="opex",
        amount=100,
        field_values={},
    )
    cost = PpmCostLine(
        id=uuid.uuid4(),
        initiative_id=initiative.id,
        budget_line_id=budget.id,
        description="Cost",
        category="opex",
        actual=0,
        planned=0,
        field_values={},
    )
    invoice = PpmInvoice(
        id=uuid.uuid4(),
        initiative_id=initiative.id,
        cost_item_id=cost.id,
        invoice_id="00042",
        invoice_date=date(2026, 11, 23),
        amount=Decimal("30.11"),
        field_values={},
    )
    db.add_all([budget, cost, invoice])
    await db.flush()
    source = uuid.uuid4()
    section = EntitySection("PpmCostLines", PpmCostLine, card_fk_columns=("initiative_id",))
    row = {
        "id": str(cost.id),
        "initiative_id__id": str(source),
        "budget_line_id": str(budget.id),
        "provider_child_id": None,
        "description": "Cost",
        "category": "opex",
        "planned": 0,
        "actual": 0,
        "date": None,
        "field_values": {},
    }
    result, _ = await _apply(db, section, row, source, initiative)
    assert result.skipped == 1 and result.conflict == 0, result.errors
    assert invoice.cost_item_id == cost.id and invoice.amount == Decimal("30.11")


async def test_import_normalizes_hand_edited_budget_and_custom_numeric_fields(db):
    initiative = await create_card(db, card_type="Initiative", name="Initiative")
    ctx = RemapContext()
    ctx.pml_configs = {
        "budget": {"fields": [{"key": "units", "label": "Units", "kind": "number"}]},
    }
    source = uuid.uuid4()
    identifier = uuid.uuid4()
    section = EntitySection("PpmBudgetLines", PpmBudgetLine, card_fk_columns=("initiative_id",))
    row = {
        "id": str(identifier),
        "initiative_id__id": str(source),
        "fiscal_year": "2026",
        "category": "opex",
        "description": "Annual",
        "amount": "12.50",
        "field_values": {"units": "0007.500"},
    }
    result, _ = await _apply(db, section, row, source, initiative, ctx)
    assert result.created == 1, result.errors
    saved = await db.get(PpmBudgetLine, identifier)
    assert saved.fiscal_year == 2026
    assert saved.amount == 12.5
    assert saved.field_values == {"units": "7.500"}
    repeated, _ = await _apply(db, section, row, source, initiative, ctx)
    assert repeated.skipped == 1 and repeated.conflict == 0, repeated.errors


async def test_invalid_field_values_list_is_reported_without_aborting_import(db):
    initiative = await create_card(db, card_type="Initiative", name="Initiative")
    source = uuid.uuid4()
    ctx = RemapContext()
    ctx.pml_configs = {
        "budget": {
            "fields": [
                {
                    "key": "origin",
                    "label": "Origin",
                    "kind": "card_reference",
                    "card_type": "Provider",
                }
            ]
        },
    }
    section = EntitySection("PpmBudgetLines", PpmBudgetLine, card_fk_columns=("initiative_id",))
    row = {
        "id": str(uuid.uuid4()),
        "initiative_id__id": str(source),
        "fiscal_year": 2026,
        "category": "opex",
        "amount": 100,
        "field_values": ["bad"],
    }
    result, _ = await _apply(db, section, row, source, initiative, ctx)
    assert result.conflict == 1
    assert "field values" in result.errors[0].lower()


async def test_repeat_budget_missing_target_field_conflicts_and_blocks_dependent(db):
    initiative = await create_card(db, card_type="Initiative", name="Initiative")
    budget = PpmBudgetLine(
        id=uuid.uuid4(),
        initiative_id=initiative.id,
        fiscal_year=2026,
        category="opex",
        amount=100,
        field_values={"note": "target-only"},
    )
    db.add(budget)
    await db.flush()
    source = uuid.uuid4()
    ctx = RemapContext()
    ctx.pml_configs = {"budget": {"fields": [{"key": "note", "label": "Note", "kind": "text"}]}}
    budget_section = EntitySection(
        "PpmBudgetLines", PpmBudgetLine, card_fk_columns=("initiative_id",)
    )
    budget_row = {
        "id": str(budget.id),
        "initiative_id__id": str(source),
        "fiscal_year": 2026,
        "category": "opex",
        "description": None,
        "amount": 100,
        "field_values": {},
    }
    result, _ = await _apply(db, budget_section, budget_row, source, initiative, ctx)
    assert result.conflict == 1
    assert budget.field_values == {"note": "target-only"}
    assert str(budget.id) in ctx.pml_rejected_ids
    cost_section = EntitySection("PpmCostLines", PpmCostLine, card_fk_columns=("initiative_id",))
    cost_row = {
        "id": str(uuid.uuid4()),
        "initiative_id__id": str(source),
        "budget_line_id": str(budget.id),
        "provider_child_id": None,
        "description": "Blocked",
        "category": "opex",
        "planned": 0,
        "actual": 0,
        "field_values": {},
    }
    child, _ = await _apply(db, cost_section, cost_row, source, initiative, ctx)
    assert child.conflict == 1 and child.created == 0


async def test_legacy_budget_without_field_column_preserves_existing_and_applies_defaults(db):
    initiative = await create_card(db, card_type="Initiative", name="Initiative")
    budget = PpmBudgetLine(
        id=uuid.uuid4(),
        initiative_id=initiative.id,
        fiscal_year=2026,
        category="opex",
        amount=100,
        field_values={"note": "target-only"},
    )
    db.add(budget)
    await db.flush()
    source = uuid.uuid4()
    ctx = RemapContext()
    ctx.pml_configs = {
        "budget": {"fields": [{"key": "note", "label": "Note", "kind": "text", "default": "new"}]}
    }
    section = EntitySection("PpmBudgetLines", PpmBudgetLine, card_fk_columns=("initiative_id",))
    row = {
        "id": str(budget.id),
        "initiative_id__id": str(source),
        "fiscal_year": 2026,
        "category": "opex",
        "description": None,
        "amount": 100,
    }
    repeated, _ = await _apply(db, section, row, source, initiative, ctx)
    assert repeated.skipped == 1 and repeated.conflict == 0
    assert budget.field_values == {"note": "target-only"}
    new_id = uuid.uuid4()
    row["id"] = str(new_id)
    created, _ = await _apply(db, section, row, source, initiative, ctx)
    assert created.created == 1, created.errors
    saved = await db.get(PpmBudgetLine, new_id)
    assert saved.field_values == {"note": "new"}


async def test_repeat_budget_with_changed_inactive_field_conflicts(db):
    initiative = await create_card(db, card_type="Initiative", name="Initiative")
    budget = PpmBudgetLine(
        id=uuid.uuid4(),
        initiative_id=initiative.id,
        fiscal_year=2026,
        category="opex",
        amount=100,
        field_values={"note": "target"},
    )
    db.add(budget)
    await db.flush()
    source = uuid.uuid4()
    ctx = RemapContext()
    ctx.pml_configs = {
        "budget": {"fields": [{"key": "note", "label": "Note", "kind": "text", "active": False}]}
    }
    section = EntitySection("PpmBudgetLines", PpmBudgetLine, card_fk_columns=("initiative_id",))
    row = {
        "id": str(budget.id),
        "initiative_id__id": str(source),
        "fiscal_year": 2026,
        "category": "opex",
        "description": None,
        "amount": 100,
        "field_values": {"note": "incoming"},
    }
    result, _ = await _apply(db, section, row, source, initiative, ctx)
    assert result.conflict == 1
    assert budget.field_values == {"note": "target"}


async def test_historical_row_can_lack_field_required_after_its_creation(db):
    initiative = await create_card(db, card_type="Initiative", name="Initiative")
    source = uuid.uuid4()
    ctx = RemapContext()
    ctx.pml_configs = {
        "budget": {
            "fields": [{"key": "newField", "label": "New", "kind": "text", "required": True}]
        }
    }
    section = EntitySection("PpmBudgetLines", PpmBudgetLine, card_fk_columns=("initiative_id",))
    row = {
        "id": str(uuid.uuid4()),
        "initiative_id__id": str(source),
        "fiscal_year": 2026,
        "category": "opex",
        "amount": 100,
        "field_values": {},
    }
    result, _ = await _apply(db, section, row, source, initiative, ctx)
    assert result.created == 1, result.errors
    saved = await db.get(PpmBudgetLine, uuid.UUID(row["id"]))
    assert saved.field_values == {}


async def test_archived_invoice_reference_round_trips_with_historical_marker(db):
    import json
    from datetime import date

    from app.services.workspace_io.entities import export_entity_section
    from app.services.workspace_io.remap import rewrite_pml_row

    initiative = await create_card(db, card_type="Initiative", name="Initiative")
    organization = await create_card(db, card_type="Organization", name="Archived organization")
    organization.status = "ARCHIVED"
    cost = PpmCostLine(
        id=uuid.uuid4(),
        initiative_id=initiative.id,
        description="Legacy cost",
        category="opex",
        actual=0,
        planned=0,
        field_values={},
    )
    db.add(cost)
    await db.flush()
    invoice = PpmInvoice(
        initiative_id=initiative.id,
        cost_item_id=cost.id,
        invoice_date=date(2026, 11, 23),
        invoice_id="REF",
        amount=Decimal("30"),
        field_values={"client": str(organization.id)},
    )
    db.add(invoice)
    await db.flush()
    from app.models.app_settings import AppSettings

    settings = await db.get(AppSettings, "default")
    if settings is None:
        settings = AppSettings(id="default", general_settings={}, email_settings={})
        db.add(settings)
    settings.general_settings = {
        "pml.financial_fields.invoice": {
            "fields": [
                {
                    "key": "client",
                    "label": "Client",
                    "kind": "card_reference",
                    "card_type": "Organization",
                }
            ]
        }
    }
    await db.flush()
    section = EntitySection(
        "PpmInvoices", PpmInvoice, card_fk_columns=("initiative_id",), rewrite=rewrite_pml_row
    )
    _, rows = await export_entity_section(
        db, section, {initiative.id: initiative, organization.id: organization}, {}, {}
    )
    assert json.loads(rows[0]["pml_historical_card_ids"]) == [str(organization.id)]
    await db.delete(invoice)
    await db.flush()
    target_organization = await create_card(
        db, card_type="Organization", name="Destination archived organization"
    )
    target_organization.status = "ARCHIVED"
    await db.flush()
    assert target_organization.id != organization.id
    ctx = RemapContext()
    ctx.pml_configs = {"invoice": settings.general_settings["pml.financial_fields.invoice"]}
    ctx.ids.record(CARDS, organization.id, target_organization.id)
    result, _ = await _apply(db, section, rows[0], initiative.id, initiative, ctx)
    assert result.created == 1, result.errors
    restored = await db.get(PpmInvoice, uuid.UUID(rows[0]["id"]))
    assert restored.field_values["client"] == str(target_organization.id)
