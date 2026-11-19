"""Which cost values a reader does not get, for the surfaces that return
cards in bulk.

The rule itself is ``PermissionService.card_ids_with_cost_access``; the cost
keys come from the metamodel (``cost_field_filter``). This module joins the
two for a list of cards and for the portfolio payload the Portfolio and
Lifecycle reports share.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType
from app.models.user import User
from app.services.cost_field_filter import (
    cost_field_keys_from_card_schema,
    cost_field_keys_from_relation_schema,
)
from app.services.permission_service import PermissionService


async def card_cost_redaction_map(
    db: AsyncSession, user: User, cards: Sequence[Card]
) -> dict[uuid.UUID, frozenset[str]]:
    """Return a map of card_id → cost field keys to strip for this user.

    Cards whose costs the user is allowed to see are absent from the map.
    """
    if not cards:
        return {}
    type_keys = {c.type for c in cards if c.type}
    if not type_keys:
        return {}
    rows = await db.execute(
        select(CardType.key, CardType.fields_schema).where(CardType.key.in_(type_keys))
    )
    cost_keys_per_type: dict[str, frozenset[str]] = {}
    for tk, schema in rows.all():
        keys = cost_field_keys_from_card_schema(schema)
        if keys:
            cost_keys_per_type[tk] = keys
    if not cost_keys_per_type:
        return {}
    candidate_ids = [c.id for c in cards if c.type in cost_keys_per_type]
    if not candidate_ids:
        return {}
    allowed = await PermissionService.card_ids_with_cost_access(db, user, candidate_ids)
    redact: dict[uuid.UUID, frozenset[str]] = {}
    for card in cards:
        cost_keys = cost_keys_per_type.get(card.type)
        if cost_keys and card.id not in allowed:
            redact[card.id] = cost_keys
    return redact


def _without(attributes: Any, cost_keys: frozenset[str]) -> Any:
    if not cost_keys or not isinstance(attributes, dict):
        return attributes
    return {k: v for k, v in attributes.items() if k not in cost_keys}


def _relation_source(item_id: str, relation: dict) -> str:
    """The id of the card a portfolio relation entry starts from: the item's
    own when the entry is outgoing, the related card's when it is incoming."""
    return item_id if relation["direction"] == "outgoing" else relation["related_id"]


async def redact_portfolio_costs(db: AsyncSession, user: User, payload: dict) -> dict:
    """A portfolio payload (``build_portfolio_payload``) without the cost
    values ``user`` may not see.

    Each item's ``attributes`` follow the item's own card; a relation entry's
    ``attributes`` follow the relation's **source** card, as everywhere else
    (``_relation_cost_redaction``). The cost keys are read from the schemas
    the payload itself carries. Returns ``payload`` itself, without a query,
    for a reader who sees every card's costs.
    """
    if await PermissionService.sees_all_costs(db, user):
        return payload
    card_keys = cost_field_keys_from_card_schema(payload["fields_schema"])
    relation_keys = {
        rt["key"]: cost_field_keys_from_relation_schema(rt.get("attributes_schema"))
        for rt in payload["relation_types"]
    }
    if not card_keys and not any(relation_keys.values()):
        return payload

    candidates: set[uuid.UUID] = set()
    for item in payload["items"]:
        candidates.add(uuid.UUID(item["id"]))
        for relation in item["relations"]:
            if relation_keys.get(relation["relation_type"]):
                candidates.add(uuid.UUID(_relation_source(item["id"], relation)))
    allowed = {
        str(card_id)
        for card_id in await PermissionService.card_ids_with_cost_access(db, user, candidates)
    }

    items = []
    for item in payload["items"]:
        relations = [
            relation
            if _relation_source(item["id"], relation) in allowed
            else {
                **relation,
                "attributes": _without(
                    relation["attributes"],
                    relation_keys.get(relation["relation_type"], frozenset()),
                ),
            }
            for relation in item["relations"]
        ]
        attributes = item["attributes"]
        if item["id"] not in allowed:
            attributes = _without(attributes, card_keys)
        items.append({**item, "attributes": attributes, "relations": relations})
    return {**payload, "items": items}
