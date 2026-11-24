"""Scope-aware values for configured PML financial rows."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.ppm_field_settings import _protected_fields
from app.models.card import Card
from app.models.user import User
from app.schemas.ppm_fields import PmlSectionConfig
from app.services.card_read_scope import CardReadScope
from app.services.ppm_fields import (
    UNAVAILABLE,
    PmlFieldError,
    evaluate_row_fields,
    validate_field_values,
)


async def validate_values(
    db: AsyncSession,
    user: User,
    config: PmlSectionConfig,
    submitted: dict[str, Any],
    existing: dict[str, Any],
    *,
    creating: bool,
) -> dict[str, Any]:
    protected_references = [
        field
        for field in config.fields
        if field.active
        and field.kind == "card_reference"
        and field.key in submitted
        and existing.get(field.key) is not None
    ]
    if protected_references:
        scope = await CardReadScope.load(db, user, include_subtype_denials=True)
        for field in protected_references:
            card = await db.scalar(
                select(Card.id).where(
                    Card.id == uuid.UUID(str(existing[field.key])),
                    Card.type == field.card_type,
                    *scope.where(Card, mode="module"),
                )
            )
            if card is None:
                raise HTTPException(403, "A referenced card is unavailable")
    try:
        result = validate_field_values(config, submitted, existing, creating=creating)
    except PmlFieldError as exc:
        raise HTTPException(422, detail=exc.errors) from exc
    changed_references = [
        field
        for field in config.fields
        if field.active
        and field.kind == "card_reference"
        and result.get(field.key) is not None
        and (creating or result.get(field.key) != existing.get(field.key))
    ]
    if changed_references:
        scope = await CardReadScope.load(db, user, include_subtype_denials=True)
        for field in changed_references:
            identifier = uuid.UUID(result[field.key])
            card = await db.scalar(
                select(Card).where(
                    Card.id == identifier,
                    Card.type == field.card_type,
                    Card.status == "ACTIVE",
                    *scope.where(Card, mode="module"),
                )
            )
            if card is None:
                raise HTTPException(422, detail={field.key: "Card is unavailable"})
    return result


async def project_many(
    db: AsyncSession,
    user: User,
    config: PmlSectionConfig,
    rows: list[tuple[dict[str, Any], dict[str, Any]]],
    *,
    protected: set[str] | None = None,
) -> list[tuple[dict[str, Any], dict[str, Any], dict[str, Any]]]:
    reference_fields = [
        field for field in config.fields if field.active and field.kind == "card_reference"
    ]
    ids = {
        uuid.UUID(str(stored[field.key]))
        for stored, _standard in rows
        for field in reference_fields
        if stored.get(field.key) is not None
    }
    cards: dict[str, Card] = {}
    if ids:
        scope = await CardReadScope.load(db, user, include_subtype_denials=True)
        cards = {
            str(card.id): card
            for card in (
                await db.scalars(
                    select(Card).where(Card.id.in_(ids), *scope.where(Card, mode="module"))
                )
            ).all()
        }
    if protected is None:
        protected = await _protected_fields(db, user, config)
    output = []
    for stored, standard in rows:
        values: dict[str, Any] = {}
        visible: dict[str, Any] = {}
        references: dict[str, Any] = {}
        for field in config.fields:
            if not field.active or field.kind == "calculated" or field.key not in stored:
                continue
            value = stored[field.key]
            if field.kind == "card_reference" and value is not None:
                card = cards.get(str(value))
                if card is None or card.type != field.card_type:
                    values[field.key] = UNAVAILABLE
                    references[field.key] = {"status": "UNAVAILABLE"}
                    continue
                references[field.key] = {
                    "id": str(card.id),
                    "name": card.name,
                    "status": card.status,
                }
            values[field.key] = value
            visible[field.key] = value
        calculated, _errors = evaluate_row_fields(
            config, values, standard, unavailable_calculations=protected
        )
        output.append((visible, calculated, references))
    return output


async def project_values(
    db: AsyncSession,
    user: User,
    config: PmlSectionConfig,
    stored: dict[str, Any],
    standard: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    return (await project_many(db, user, config, [(stored, standard)]))[0]
