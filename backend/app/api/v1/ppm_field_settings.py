"""Administration of PML financial field definitions."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import cast, func, literal, select, update
from sqlalchemy.dialects.postgresql import JSONB, insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.app_settings import AppSettings
from app.models.card import Card
from app.models.card_type import CardType
from app.models.ppm_cost_line import PpmBudgetLine, PpmCostLine
from app.models.ppm_invoice import PpmInvoice
from app.models.relation_type import RelationType
from app.models.user import User
from app.schemas.ppm_fields import (
    PmlFieldDefinition,
    PmlProviderSource,
    PmlRowKind,
    PmlSectionConfig,
)
from app.services.card_read_scope import CardReadScope
from app.services.permission_service import PermissionService
from app.services.ppm_fields import (
    PROVIDER_INPUTS,
    STANDARD_INPUTS,
    PmlFieldError,
    evaluate_row_fields,
    validate_section_config,
)

router = APIRouter(prefix="/pml/financial-fields", tags=["settings"])
_PREFIX = "pml.financial_fields."
_SECTIONS: tuple[PmlRowKind, ...] = ("budget", "cost_item", "invoice")


class ProtectedFieldMarker(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$", max_length=100)
    keep_existing: Literal[True]


class FieldSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fields: list[PmlFieldDefinition | ProtectedFieldMarker] = Field(
        default_factory=list, max_length=100
    )
    visible_columns: list[str] = Field(default_factory=list, max_length=150)
    provider_source: PmlProviderSource | None = None


class PreviewRequest(BaseModel):
    configuration: PmlSectionConfig
    field_key: str
    sample_values: dict[str, Any]


async def lock_field_settings(db: AsyncSession) -> None:
    """Keep field definitions stable until a financial write is committed."""
    await db.execute(
        insert(AppSettings)
        .values(id="default", general_settings={}, email_settings={})
        .on_conflict_do_nothing(index_elements=["id"])
    )
    await db.execute(
        select(AppSettings.id).where(AppSettings.id == "default").with_for_update(read=True)
    )


async def load_section(db: AsyncSession, section: PmlRowKind) -> PmlSectionConfig:
    raw = await db.scalar(
        select(AppSettings.general_settings[_PREFIX + section]).where(AppSettings.id == "default")
    )
    return PmlSectionConfig.model_validate(raw or {})


def _reference_pairs(config: PmlSectionConfig, field) -> set[tuple[uuid.UUID, str]]:
    refs: set[tuple[uuid.UUID, str]] = set()

    def add(value, card_type):
        if value is None or card_type is None:
            return
        try:
            refs.add((uuid.UUID(str(value)), card_type))
        except (TypeError, ValueError) as exc:
            raise HTTPException(422, detail={field.key: "Invalid card reference"}) from exc

    if field.kind == "card_reference":
        add(field.default, field.card_type)
    calculation = field.calculation
    if calculation is None:
        return refs
    for value in calculation.provider_constants.values():
        add(value, "Provider")
    card_types = {
        item.key: item.card_type for item in config.fields if item.kind == "card_reference"
    }
    card_types.update(dict.fromkeys(PROVIDER_INPUTS, "Provider"))
    card_aliases = {
        key: card_types[source]
        for key, source in calculation.inputs.items()
        if source in card_types
    }

    def visit(condition):
        if not isinstance(condition, dict):
            return
        alias = condition.get("input")
        if alias in card_aliases:
            add(condition.get("value"), card_aliases[alias])
        for child in condition.get("conditions", []):
            visit(child)
        visit(condition.get("condition"))

    for rule in calculation.rules or []:
        visit(rule.get("when"))
    return refs


def _reference_ids(config: PmlSectionConfig, field) -> set[uuid.UUID]:
    return {identifier for identifier, _card_type in _reference_pairs(config, field)}


async def _protected_fields(db: AsyncSession, user: User, config: PmlSectionConfig) -> set[str]:
    references = {field.key: _reference_ids(config, field) for field in config.fields}
    ids = set().union(*references.values()) if references else set()
    if not ids:
        return set()
    scope = await CardReadScope.load(db, user, include_subtype_denials=True)
    visible = set(
        (
            await db.scalars(
                select(Card.id).where(Card.id.in_(ids), *scope.where(Card, mode="module"))
            )
        ).all()
    )
    return {key for key, referenced in references.items() if referenced - visible}


def _display_config(config: PmlSectionConfig, protected: set[str]) -> dict[str, Any]:
    output = config.model_dump(mode="json")
    output["fields"] = [
        (
            {"key": field.key, "label": field.label, "kind": field.kind, "protected": True}
            if field.key in protected
            else field.model_dump(mode="json")
        )
        for field in config.fields
    ]
    return output


async def _validate(
    db: AsyncSession,
    section: PmlRowKind,
    config: PmlSectionConfig,
    previous: PmlSectionConfig | None = None,
    *,
    prospective: dict[str, PmlSectionConfig] | None = None,
) -> None:
    try:
        validate_section_config(section, config, previous)
    except PmlFieldError as exc:
        raise HTTPException(422, detail=exc.errors) from exc
    if section in {"budget", "cost_item"}:
        budget = config if section == "budget" else (prospective or {}).get("budget")
        cost = config if section == "cost_item" else (prospective or {}).get("cost_item")
        if budget is None:
            budget = await load_section(db, "budget")
        if cost is None:
            cost = await load_section(db, "cost_item")
        provider = cost.provider_source
        if provider is not None and not any(
            field.key == provider.budget_field_key
            and field.active
            and field.kind == "card_reference"
            and field.card_type == "Provider"
            for field in budget.fields
        ):
            raise HTTPException(
                422, detail={"provider_source": "An active budget Provider field is required"}
            )
    previous_fields = {field.key: field for field in previous.fields} if previous else {}
    model: Any = {"budget": PpmBudgetLine, "cost_item": PpmCostLine, "invoice": PpmInvoice}[section]
    current_fields = {field.key: field for field in config.fields}
    for key, old in previous_fields.items():
        current = current_fields.get(key)
        removed_options = {option.id for option in old.options} - (
            {option.id for option in current.options} if current else set()
        )
        column = model.field_values[key].astext
        if current is None:
            populated = await db.scalar(select(model.id).where(column.is_not(None)).limit(1))
            if populated is not None:
                raise HTTPException(422, detail={key: "A populated field cannot be removed"})
        elif removed_options:
            populated = await db.scalar(
                select(model.id).where(column.in_(removed_options)).limit(1)
            )
            if populated is not None:
                raise HTTPException(422, detail={key: "An option in use cannot be removed"})
    for field in config.fields:
        previous_field = previous_fields.get(field.key)
        if previous_field and (
            previous_field.kind != field.kind
            or (
                previous_field.kind == "card_reference"
                and previous_field.card_type != field.card_type
            )
        ):
            populated = await db.scalar(
                select(model.id).where(model.field_values[field.key].astext.is_not(None)).limit(1)
            )
            if populated is not None:
                raise HTTPException(422, detail={field.key: "A populated field cannot change type"})
        if field.kind != "card_reference":
            continue
        if not field.card_type:
            raise HTTPException(422, detail={field.key: "A card type is required"})
        if section == "invoice" and field.card_type == "Provider":
            raise HTTPException(422, detail={field.key: "Provider is unavailable on invoices"})
        if not await db.scalar(select(CardType.id).where(CardType.key == field.card_type)):
            raise HTTPException(422, detail={field.key: "Unknown card type"})
        if field.relation_type:
            relation = await db.scalar(
                select(RelationType).where(RelationType.key == field.relation_type)
            )
            if relation is None or {relation.source_type_key, relation.target_type_key} != {
                field.card_type,
                "Initiative",
            }:
                raise HTTPException(422, detail={field.key: "Incompatible relation type"})


async def _validate_references(
    db: AsyncSession,
    user: User,
    config: PmlSectionConfig,
    previous: PmlSectionConfig | None = None,
) -> None:
    old_fields = {field.key: field for field in previous.fields} if previous else {}
    scope = await CardReadScope.load(db, user, include_subtype_denials=True)
    for field in config.fields:
        references = _reference_pairs(config, field)
        old = old_fields.get(field.key)
        old_references = _reference_pairs(previous, old) if previous and old else set()
        for identifier, card_type in references - old_references:
            visible = await db.scalar(
                select(Card.id).where(
                    Card.id == identifier,
                    Card.type == card_type,
                    Card.status == "ACTIVE",
                    *scope.where(Card, mode="module"),
                )
            )
            if visible is None:
                raise HTTPException(422, detail={field.key: "Referenced card is unavailable"})


@router.get("")
async def get_field_settings(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> dict[str, Any]:
    await PermissionService.require_permission(db, user, "admin.settings")
    output: dict[str, Any] = {}
    for section in _SECTIONS:
        config = await load_section(db, section)
        output[section] = _display_config(config, await _protected_fields(db, user, config))
    return output


@router.put("/{section}")
async def put_field_settings(
    section: PmlRowKind,
    body: FieldSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    await PermissionService.require_permission(db, user, "admin.settings")
    await db.execute(
        insert(AppSettings)
        .values(id="default", general_settings={}, email_settings={})
        .on_conflict_do_nothing(index_elements=["id"])
    )
    # Budget and Cost Item configurations depend on each other.
    await db.execute(select(AppSettings.id).where(AppSettings.id == "default").with_for_update())
    previous = await load_section(db, section)
    protected = await _protected_fields(db, user, previous)
    previous_fields = {field.key: field for field in previous.fields}
    incoming = []
    retained = set()
    payload = body.model_dump(mode="json")
    for item in payload["fields"]:
        if isinstance(item, dict) and item.get("keep_existing") is True:
            key = item.get("key")
            if set(item) != {"key", "keep_existing"} or key not in protected:
                raise HTTPException(422, "Invalid protected field marker")
            incoming.append(previous_fields[key].model_dump(mode="json"))
            retained.add(key)
        else:
            if isinstance(item, dict) and item.get("key") in protected:
                raise HTTPException(403, "A protected field cannot be changed")
            incoming.append(item)
    if protected != retained:
        raise HTTPException(403, "A protected field cannot be removed")
    try:
        config = PmlSectionConfig.model_validate({**payload, "fields": incoming})
    except ValidationError as exc:
        raise HTTPException(
            422, detail=exc.errors(include_context=False, include_input=False)
        ) from exc
    await _validate(db, section, config, previous)
    await _validate_references(db, user, config, previous)
    newly_protected = await _protected_fields(db, user, config)
    if newly_protected != protected:
        raise HTTPException(403, "A protected field cannot change visibility")
    patch = {_PREFIX + section: config.model_dump(mode="json")}
    await db.execute(
        update(AppSettings)
        .where(AppSettings.id == "default")
        .values(
            general_settings=func.coalesce(
                AppSettings.general_settings, cast(literal({}, JSONB), JSONB)
            ).op("||")(literal(patch, JSONB))
        )
    )
    await db.commit()
    return _display_config(config, newly_protected)


@router.post("/{section}/preview")
async def preview_field(
    section: PmlRowKind,
    body: PreviewRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    await PermissionService.require_permission(db, user, "admin.settings")
    await _validate(db, section, body.configuration)
    if await _protected_fields(db, user, body.configuration):
        raise HTTPException(403, "A referenced card is unavailable")
    await _validate_references(db, user, body.configuration)
    card_fields = {
        field.key: field.card_type
        for field in body.configuration.fields
        if field.kind == "card_reference"
    }
    if section == "cost_item":
        card_fields.update(dict.fromkeys(PROVIDER_INPUTS, "Provider"))
    scope = await CardReadScope.load(db, user, include_subtype_denials=True)
    for key, value in body.sample_values.items():
        if key not in card_fields or value is None:
            continue
        try:
            identifier = uuid.UUID(str(value))
        except (ValueError, TypeError) as exc:
            raise HTTPException(422, detail={key: "Invalid card reference"}) from exc
        visible = await db.scalar(
            select(Card.id).where(
                Card.id == identifier,
                Card.type == card_fields[key],
                Card.status == "ACTIVE",
                *scope.where(Card, mode="module"),
            )
        )
        if visible is None:
            raise HTTPException(422, detail={key: "Referenced card is unavailable"})
    field = next((item for item in body.configuration.fields if item.key == body.field_key), None)
    if field is None or not field.active or field.kind != "calculated":
        raise HTTPException(422, detail={body.field_key: "An active calculated field is required"})
    allowed_inputs = STANDARD_INPUTS[section] | {
        item.key for item in body.configuration.fields if item.active and item.kind != "calculated"
    }
    unknown = set(body.sample_values) - allowed_inputs
    if unknown:
        raise HTTPException(422, detail={key: "Unknown preview input" for key in unknown})
    values, errors = evaluate_row_fields(body.configuration, body.sample_values, body.sample_values)
    return {"value": values.get(body.field_key), "errors": errors}
