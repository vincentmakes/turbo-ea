"""Validate and display configured Initiative actual dates."""

from __future__ import annotations

import copy
from datetime import date, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import cast, func, literal, select, update
from sqlalchemy.dialects.postgresql import JSONB, insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_settings import AppSettings
from app.models.calculation import Calculation
from app.models.card import Card
from app.models.card_type import CardType
from app.schemas.ppm_timeline import PmlTimelineMapping, PmlTimelineUpdate
from app.services.extensions.field_gate import locked_fields

TIMELINE_KEY = "pml.timeline"
DEFAULT_KEYS = {"start": "actualStart", "end": "actualEnd"}
PLANNED_KEYS = frozenset({"startDate", "endDate"})


class TimelineValidationError(ValueError):
    """An invalid mapping or Initiative date pair."""


async def load_timeline_mapping(db: AsyncSession) -> PmlTimelineMapping:
    value = await db.scalar(
        select(AppSettings.general_settings[TIMELINE_KEY]).where(AppSettings.id == "default")
    )
    if value is None or value == {}:
        value = {"actual_start_key": DEFAULT_KEYS["start"], "actual_end_key": DEFAULT_KEYS["end"]}
    return PmlTimelineMapping.model_validate(value)


async def save_timeline_mapping(db: AsyncSession, body: PmlTimelineUpdate) -> PmlTimelineMapping:
    if len(set(body.create_defaults)) != len(body.create_defaults):
        raise HTTPException(422, "Duplicate default selection")
    await db.execute(
        insert(AppSettings)
        .values(id="default", general_settings={}, email_settings={})
        .on_conflict_do_nothing(index_elements=["id"])
    )
    await db.execute(select(AppSettings.id).where(AppSettings.id == "default").with_for_update())
    initiative_type = await db.scalar(
        select(CardType).where(CardType.key == "Initiative").with_for_update()
    )
    if initiative_type is None:
        raise HTTPException(404, "Initiative type not found")

    locked = locked_fields("Initiative", initiative_type.fields_schema)
    schema: list[dict[str, Any]] = copy.deepcopy(initiative_type.fields_schema or [])
    keys = {
        field.get("key")
        for section in schema
        if isinstance(section, dict)
        for field in (section.get("fields") or [])
        if isinstance(field, dict)
    }
    mapped = {
        "actual_start_key": body.actual_start_key,
        "actual_end_key": body.actual_end_key,
    }
    if body.create_defaults:
        section = next(
            (
                item
                for item in schema
                if isinstance(item, dict) and item.get("section") == "Cost & Timeline"
            ),
            None,
        )
        if section is None:
            section = next(
                (
                    item
                    for item in schema
                    if isinstance(item, dict)
                    and any(
                        field.get("key") in {"startDate", "endDate"}
                        for field in (item.get("fields") or [])
                        if isinstance(field, dict)
                    )
                ),
                None,
            )
        if section is None:
            section = {"section": "Cost & Timeline", "fields": []}
            schema.append(section)
        for side in body.create_defaults:
            key = DEFAULT_KEYS[side]
            map_key = f"actual_{side}_key"
            if key in locked or mapped[map_key] is not None:
                raise HTTPException(409, f"Cannot create default field {key}")
            if key in keys:
                existing = [
                    field
                    for item in schema
                    if isinstance(item, dict)
                    for field in (item.get("fields") or [])
                    if isinstance(field, dict) and field.get("key") == key
                ]
                if len(existing) != 1 or existing[0].get("type") != "date":
                    raise HTTPException(409, f"Cannot create default field {key}")
                mapped[map_key] = key
                continue
            if section.get("fields") is None:
                section["fields"] = []
            section.setdefault("fields", []).append(
                {
                    "key": key,
                    "type": "date",
                    "label": "Actual Start" if side == "start" else "Actual End",
                    "weight": 0,
                    "built_in": True,
                }
            )
            keys.add(key)
            mapped[map_key] = key
    candidate = PmlTimelineMapping(**mapped)
    temporary_type = CardType(key="Initiative", label=initiative_type.label, fields_schema=schema)
    try:
        validate_timeline_mapping(candidate, temporary_type)
    except TimelineValidationError as exc:
        raise HTTPException(422, str(exc)) from exc
    selected = [key for key in (candidate.actual_start_key, candidate.actual_end_key) if key]
    if locked.keys() & set(selected):
        raise HTTPException(422, "A locked field cannot be a Timeline date")
    if selected:
        calculated = await db.scalar(
            select(Calculation.id)
            .where(
                Calculation.target_type_key == "Initiative",
                Calculation.target_field_key.in_(selected),
            )
            .limit(1)
        )
        if calculated is not None:
            raise HTTPException(422, "A calculated field cannot be a Timeline date")
    if body.create_defaults:
        initiative_type.fields_schema = schema
    await db.execute(
        update(AppSettings)
        .where(AppSettings.id == "default")
        .values(
            general_settings=func.coalesce(
                AppSettings.general_settings, cast(literal({}, JSONB), JSONB)
            ).op("||")(literal({TIMELINE_KEY: candidate.model_dump(mode="json")}, JSONB))
        )
    )
    return candidate


async def reject_mapped_calculation_target(db: AsyncSession, type_key: str, field_key: str) -> None:
    if type_key != "Initiative" or not field_key:
        return
    # Schema and mapping updates lock this same type before checking calculations.
    await db.execute(select(CardType.id).where(CardType.key == type_key).with_for_update())
    mapping = await load_timeline_mapping(db)
    if field_key in (*DEFAULT_KEYS.values(), mapping.actual_start_key, mapping.actual_end_key):
        raise HTTPException(409, "A mapped Timeline date must remain editable")


def _field_map(initiative_type: CardType) -> dict[str, dict[str, Any]]:
    fields: dict[str, dict[str, Any]] = {}
    for section in initiative_type.fields_schema or []:
        if not isinstance(section, dict):
            continue
        for field in section.get("fields") or []:
            if isinstance(field, dict) and field.get("key"):
                fields[field["key"]] = field
    return fields


def validate_timeline_mapping(mapping: PmlTimelineMapping, initiative_type: CardType) -> None:
    values = [mapping.actual_start_key, mapping.actual_end_key]
    selected = [value for value in values if value is not None]
    if len(set(selected)) != len(selected):
        raise TimelineValidationError("Actual start and end must use different fields")
    fields = _field_map(initiative_type)
    for key in selected:
        field = fields.get(key)
        if (
            key in PLANNED_KEYS
            or field is None
            or field.get("type") != "date"
            or field.get("readonly")
        ):
            raise TimelineValidationError(f"Timeline field {key} is unavailable or incompatible")


def _date_value(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        raise TimelineValidationError("Expected a date")
    if isinstance(value, date):
        return value
    if not isinstance(value, str):
        raise TimelineValidationError("Expected a date")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise TimelineValidationError("Expected an ISO date") from exc


def validate_actual_date_pair(mapping: PmlTimelineMapping, attributes: dict[str, Any]) -> None:
    start = (
        _date_value(attributes.get(mapping.actual_start_key)) if mapping.actual_start_key else None
    )
    end = _date_value(attributes.get(mapping.actual_end_key)) if mapping.actual_end_key else None
    if start is not None and end is not None and end < start:
        raise TimelineValidationError("Actual End must be on or after Actual Start")


def visible_date_fields(
    card: Card, type_schema: CardType, keys: list[str]
) -> dict[str, date | None]:
    hidden: set[str] = set()
    for subtype in type_schema.subtypes or []:
        if isinstance(subtype, dict) and subtype.get("key") == card.subtype:
            hidden.update(subtype.get("hidden_fields") or [])
    layout = type_schema.section_config or {}
    values: dict[str, date | None] = {}
    custom_index = 0
    for section in type_schema.fields_schema or []:
        if not isinstance(section, dict):
            continue
        name = section.get("section")
        if name == "__description":
            config = layout.get("description")
        else:
            config = layout.get(f"custom:{custom_index}", layout.get(name))
            custom_index += 1
        if isinstance(config, dict) and config.get("hidden"):
            continue
        hidden_in_section = (config.get("hidden_fields") or []) if isinstance(config, dict) else []
        for field in section.get("fields") or []:
            if not isinstance(field, dict):
                continue
            key = field.get("key")
            if (
                key in keys
                and key not in hidden
                and key not in hidden_in_section
                and field.get("type") == "date"
            ):
                try:
                    values[key] = _date_value((card.attributes or {}).get(key))
                except TimelineValidationError:
                    values[key] = None
    return values


def visible_actual_dates(
    mapping: PmlTimelineMapping, card: Card, type_schema: CardType
) -> tuple[date | None, date | None]:
    keys = [key for key in (mapping.actual_start_key, mapping.actual_end_key) if key]
    values = visible_date_fields(card, type_schema, keys)
    start = values.get(mapping.actual_start_key) if mapping.actual_start_key else None
    end = values.get(mapping.actual_end_key) if mapping.actual_end_key else None
    return start, end
