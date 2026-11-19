"""Helpers to identify and strip cost-typed fields from card and relation attributes.

Used by endpoints that gate cost visibility behind the `costs.view` permission, or
a stakeholder role granting `card.view_costs` — see PermissionService.can_view_costs().
"""

from __future__ import annotations

from typing import Any

from app.models.card_type import CardType
from app.models.relation_type import RelationType


def _cost_keys_from_card_schema(fields_schema: Any) -> frozenset[str]:
    keys: set[str] = set()
    if not isinstance(fields_schema, list):
        return frozenset()
    for section in fields_schema:
        if not isinstance(section, dict):
            continue
        fields = section.get("fields") or []
        if not isinstance(fields, list):
            continue
        for field in fields:
            if isinstance(field, dict) and field.get("type") == "cost":
                key = field.get("key")
                if isinstance(key, str):
                    keys.add(key)
    return frozenset(keys)


def _cost_keys_from_flat_schema(attributes_schema: Any) -> frozenset[str]:
    keys: set[str] = set()
    if not isinstance(attributes_schema, list):
        return frozenset()
    for field in attributes_schema:
        if isinstance(field, dict) and field.get("type") == "cost":
            key = field.get("key")
            if isinstance(key, str):
                keys.add(key)
    return frozenset(keys)


def cost_field_keys_for_card_type(card_type: CardType | None) -> frozenset[str]:
    """Return the keys of all type=='cost' fields in a CardType.fields_schema."""
    if card_type is None:
        return frozenset()
    return _cost_keys_from_card_schema(card_type.fields_schema)


def cost_field_keys_from_card_schema(fields_schema: Any) -> frozenset[str]:
    """Same as cost_field_keys_for_card_type but operates on a raw schema list."""
    return _cost_keys_from_card_schema(fields_schema)


def cost_field_keys_for_relation_type(relation_type: RelationType | None) -> frozenset[str]:
    """Return the keys of all type=='cost' fields in a RelationType.attributes_schema."""
    if relation_type is None:
        return frozenset()
    return _cost_keys_from_flat_schema(relation_type.attributes_schema)


def cost_field_keys_from_relation_schema(attributes_schema: Any) -> frozenset[str]:
    """Same as cost_field_keys_for_relation_type but operates on a raw schema list."""
    return _cost_keys_from_flat_schema(attributes_schema)


def keep_stored_cost_values(
    stored: dict | None, incoming: dict, cost_keys: frozenset[str] | set[str]
) -> dict:
    """What a caller without cost access may write over ``stored``.

    A write replaces the whole ``attributes`` dict, so dropping the cost keys
    from the request would wipe values the caller was never shown, and taking
    them would let the caller overwrite those values. The result is
    ``incoming`` without its cost keys, plus the stored value of every cost
    key that has one — the one merge the card and relation write paths share.
    """
    current = stored or {}
    merged = {key: value for key, value in incoming.items() if key not in cost_keys}
    for key in cost_keys:
        if key in current:
            merged[key] = current[key]
    return merged


def strip_costs_from_attributes(card_type: CardType | None, attributes: dict | None) -> dict:
    """Return a shallow copy of `attributes` with all cost-typed keys removed."""
    if not attributes:
        return {} if attributes is None else dict(attributes)
    cost_keys = cost_field_keys_for_card_type(card_type)
    if not cost_keys:
        return dict(attributes)
    return {k: v for k, v in attributes.items() if k not in cost_keys}


def strip_costs_from_relation_attributes(
    relation_type: RelationType | None, attributes: dict | None
) -> dict:
    """Return a shallow copy of relation `attributes` with cost keys removed."""
    if not attributes:
        return {} if attributes is None else dict(attributes)
    cost_keys = cost_field_keys_for_relation_type(relation_type)
    if not cost_keys:
        return dict(attributes)
    return {k: v for k, v in attributes.items() if k not in cost_keys}
