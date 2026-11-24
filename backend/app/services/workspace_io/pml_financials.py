"""Validate imported PML financial records and their retained identities."""

from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType
from app.models.ppm_cost_line import PpmBudgetLine, PpmCostLine
from app.schemas.ppm import PpmBudgetLineCreate, PpmCostLineCreate, PpmInvoiceCreate
from app.schemas.ppm_fields import PmlSectionConfig
from app.services.ppm_fields import PmlFieldError, validate_field_values

KINDS = {"PpmBudgetLines": "budget", "PpmCostLines": "cost_item", "PpmInvoices": "invoice"}


async def validate_financial_row(
    db: AsyncSession,
    sheet: str,
    values: dict[str, Any],
    current: Any,
    config: PmlSectionConfig,
    cost_config: PmlSectionConfig,
    *,
    historical_child: bool,
    field_values_carried: bool,
    historical_cards: set[str],
    rejected_ids: set[str],
) -> str | None:
    initiative = await db.get(Card, values.get("initiative_id"))
    if initiative is None or initiative.type != "Initiative":
        return "Initiative unavailable"

    parent_column: str | None
    parent_model: Any
    parent_column, parent_model = {
        "PpmCostLines": ("budget_line_id", PpmBudgetLine),
        "PpmInvoices": ("cost_item_id", PpmCostLine),
    }.get(sheet, (None, None))
    budget: Any = None
    if parent_column:
        parent_id = values.get(parent_column)
        if parent_id and str(parent_id) in rejected_ids:
            return "Parent financial row was rejected"
        if parent_id:
            parent: Any = await db.get(parent_model, parent_id)
            if parent is None or parent.initiative_id != initiative.id:
                return "Parent financial row unavailable for this Initiative"
            if sheet == "PpmCostLines":
                budget = parent
        elif sheet == "PpmInvoices":
            return "Cost Item is required"

    raw_values = values.get("field_values") or {}
    if not isinstance(raw_values, dict):
        return "Invalid field values"
    existing_values = dict(current.field_values or {}) if current else {}
    try:
        fields = {field.key: field for field in config.fields}
        editable = {
            key: value
            for key, value in raw_values.items()
            if key in fields and fields[key].active and fields[key].kind != "calculated"
        }
        if any(key not in fields or fields[key].kind == "calculated" for key in raw_values):
            return "Unknown or calculated financial field"
        # Existing exports may predate fields that later became required. Validate
        # every carried value, while preserving absence only on an exported row.
        validation_config = config
        if field_values_carried:
            validation_config = config.model_copy(
                update={
                    "fields": [
                        field.model_copy(update={"required": False})
                        if field.key not in raw_values
                        else field
                        for field in config.fields
                    ]
                }
            )
        normalized_values = validate_field_values(
            validation_config,
            editable,
            raw_values if current is None else existing_values,
            creating=not field_values_carried and current is None,
        )
        if field_values_carried:
            values["field_values"] = {
                key: normalized_values[key] if fields[key].active else raw_values[key]
                for key in raw_values
            }
        else:
            values["field_values"] = normalized_values
        model: Any = {
            "PpmBudgetLines": PpmBudgetLineCreate,
            "PpmCostLines": PpmCostLineCreate,
            "PpmInvoices": PpmInvoiceCreate,
        }[sheet]
        payload = {key: value for key, value in values.items() if key in model.model_fields}
        if sheet == "PpmCostLines" and payload.get("budget_line_id") is None:
            import uuid

            payload["budget_line_id"] = uuid.UUID(int=0)
        parsed = model.model_validate(payload)
        for key in payload:
            if key != "field_values" and (key != "budget_line_id" or values.get(key) is not None):
                values[key] = getattr(parsed, key)
    except (PmlFieldError, ValidationError, ValueError, InvalidOperation):
        return "Invalid financial values"

    for field in config.fields:
        value = raw_values.get(field.key)
        if field.kind != "card_reference" or not value:
            continue
        card = await db.get(Card, UUID(str(value)))
        if card is None:
            if str(value) in historical_cards and field.card_type == "Provider":
                continue
            return "Referenced financial card is unavailable"
        if card.type != field.card_type:
            return "Referenced financial card has an incompatible type"
        if card.status != "ACTIVE" and str(value) not in historical_cards:
            return "Referenced financial card is unavailable"

    child_id = values.get("provider_child_id")
    if child_id and historical_child:
        child = await db.get(Card, child_id)
        if child is not None and child.type != "Provider":
            return "Historical Provider has an incompatible type"
        if child is None and str(child_id) not in historical_cards:
            return "Historical Provider is unavailable"
    if sheet == "PpmCostLines" and child_id and not historical_child:
        if budget is None or cost_config.provider_source is None:
            return "Provider child requires a configured budget"
        key = cost_config.provider_source.budget_field_key
        parent_id = (budget.field_values or {}).get(key)
        child = await db.get(Card, child_id)
        parent = await db.get(Card, UUID(str(parent_id))) if parent_id else None
        provider_type = await db.scalar(select(CardType).where(CardType.key == "Provider"))
        if (
            child is None
            or child.type != "Provider"
            or child.status != "ACTIVE"
            or parent is None
            or parent.type != "Provider"
            or parent.status != "ACTIVE"
            or str(child.parent_id) != str(parent.id)
            or provider_type is None
            or not provider_type.has_hierarchy
            or not cost_config.provider_source.allow_child_selection
        ):
            return "Provider child is not eligible for this budget"

    if current is not None:
        for key, value in values.items():
            if key in {"created_at", "updated_at"}:
                continue
            stored = getattr(current, key, None)
            if key == "amount" and sheet == "PpmInvoices":
                try:
                    if Decimal(str(stored)) == Decimal(str(value)):
                        continue
                except InvalidOperation:
                    pass
            if stored != value:
                return "Existing financial identity has different values"
    return None
