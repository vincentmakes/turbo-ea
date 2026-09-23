"""The colour legend of a published diagram.

A diagram's "colour by" choice (``data.view``) recolours its card shapes, and
those colours are saved into the XML — so a published diagram already shows
them. The account-less viewer cannot read the metamodel or the cards, so the
key has to come from the server.

What leaves here is **only what the legend itself displays**: the rule titles,
swatch labels and colours, whether any card on the canvas has no value for a
rule, and how many cards a rule coloured. No card id, name or per-card value —
a published diagram is a picture, not a slice of the inventory (see
``sanitise_public_xml``). Labels travel with their ``translations`` so the
visitor's locale resolves them client-side, like every other metamodel label.

The value rules mirror ``frontend/src/features/diagrams/viewSource.ts``
(``normaliseViewSource`` and ``colorKeyForCard``) so the published key agrees
with the one in the app.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType


def normalise_view(raw: Any) -> dict | None:
    """Parse a stored view; ``None`` means card-type colours, i.e. no legend.

    The blob is untrusted: it can predate the current shape and travels
    verbatim through workspace transfer.
    """
    if not isinstance(raw, dict):
        return None
    kind = raw.get("kind")
    if kind == "approval_status":
        return {"kind": "approval_status"}
    if kind == "card_field":  # legacy singular shape
        type_key, field_key = raw.get("type_key"), raw.get("field_key")
        if isinstance(type_key, str) and type_key and isinstance(field_key, str) and field_key:
            return {"kind": "card_fields", "fields": {type_key: field_key}}
        return None
    if kind == "card_fields" and isinstance(raw.get("fields"), dict):
        fields = {
            t: f
            for t, f in raw["fields"].items()
            if isinstance(t, str) and t and t != "__proto__" and isinstance(f, str) and f
        }
        return {"kind": "card_fields", "fields": fields} if fields else None
    return None


def _find_field(card_type: CardType, field_key: str) -> dict | None:
    for section in card_type.fields_schema or []:
        for field in (section or {}).get("fields") or []:
            if isinstance(field, dict) and field.get("key") == field_key:
                return field
    return None


def _trim_field(field: dict) -> dict:
    """The field as the legend renders it — label, translations and options only."""
    return {
        "key": field.get("key"),
        "label": field.get("label") or field.get("key"),
        "translations": field.get("translations") or {},
        "type": field.get("type"),
        "options": [
            {
                "key": o.get("key"),
                "label": o.get("label") or o.get("key"),
                "translations": o.get("translations") or {},
                "color": o.get("color"),
            }
            for o in field.get("options") or []
            if isinstance(o, dict) and o.get("key")
        ],
    }


def _is_missing(value: Any) -> bool:
    return value is None or value == ""


def legend_from_rows(
    view: dict | None,
    card_types: list[CardType],
    cards: list[tuple[str, str | None, dict | None]],
) -> dict | None:
    """Build the legend from loaded rows. ``cards`` is ``(type, approval_status, attributes)``."""
    if view is None:
        return None

    if view["kind"] == "approval_status":
        coloured = sum(1 for _, approval, _ in cards if approval)
        return {"kind": "approval_status", "coloured": coloured}

    by_key = {ct.key: ct for ct in card_types if not ct.is_hidden}
    types: list[dict] = []
    rules: list[dict] = []
    coloured = 0
    # Metamodel order, like the in-app legend (`activeRules` walks the types).
    for ct in sorted(by_key.values(), key=lambda c: (c.sort_order or 0, c.key)):
        field_key = view["fields"].get(ct.key)
        if not field_key:
            continue
        field = _find_field(ct, field_key)
        if field is None:
            continue
        trimmed = _trim_field(field)
        option_keys = {o["key"] for o in trimmed["options"]}
        has_missing = False
        for card_type, _, attributes in cards:
            if card_type != ct.key:
                continue
            value = (attributes or {}).get(field_key)
            if _is_missing(value):
                has_missing = True
            elif str(value) in option_keys:
                coloured += 1
        types.append(
            {
                "key": ct.key,
                "label": ct.label,
                "translations": ct.translations or {},
                "fields_schema": [{"section": "", "fields": [trimmed]}],
            }
        )
        rules.append({"type_key": ct.key, "field_key": field_key, "has_missing": has_missing})

    if not rules:
        return None
    return {"kind": "card_fields", "coloured": coloured, "rules": rules, "types": types}


async def build_public_legend(
    db: AsyncSession, data: dict | None, card_ids: list[str]
) -> dict | None:
    """The legend of a stored diagram, or ``None`` when it is coloured by card type."""
    view = normalise_view((data or {}).get("view"))
    if view is None:
        return None

    ids: list[uuid.UUID] = []
    for raw in card_ids:
        try:
            ids.append(uuid.UUID(raw))
        except ValueError:
            continue
    cards: list[tuple[str, str | None, dict | None]] = []
    if ids:
        result = await db.execute(
            select(Card.type, Card.approval_status, Card.attributes).where(Card.id.in_(ids))
        )
        cards = [(r[0], r[1], r[2]) for r in result.all()]

    card_types: list[CardType] = []
    if view["kind"] == "card_fields":
        result = await db.execute(
            select(CardType).where(CardType.key.in_(list(view["fields"].keys())))
        )
        card_types = list(result.scalars().all())

    return legend_from_rows(view, card_types, cards)
