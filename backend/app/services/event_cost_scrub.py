"""Cost values in event payloads, removed for a reader without cost access.

A card's cost fields are redacted wherever the card itself is returned
(``PermissionService.can_view_costs`` / ``card_ids_with_cost_access``). The
events written about the card carry the same values a second time:

* ``card.updated`` stores ``changes.attributes`` as the **whole** old and new
  dict (the only shape the History tab renders), whoever made the edit — the
  PATCH route merges the cost values an editor may not see back in before the
  write, so even their own event holds them;
* a survey apply written before 2.163.0 stored one ``changes.attr_<key>`` per
  attribute, and a few writers one ``changes.<key>``;
* a rollback operation (``rollback.restore_card_fields``, a rollback batch's
  ``summary.results``, the rollback preview) carries the old values under
  ``fields``.

Nothing here touches what is stored: rollback restores a card from exactly
those values, so removing them at write time would turn a rollback into a wipe
of the cost fields. The values are removed when a payload is **read**, for a
reader who may not see that card's costs, by every feed that returns stored
events to someone other than an ``admin.events`` holder.
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
from app.services.cost_field_filter import cost_field_keys_from_card_schema
from app.services.permission_service import PermissionService

# The per-attribute change key survey applies wrote before 2.163.0.
LEGACY_ATTRIBUTE_PREFIX = "attr_"

# Payload keys that name the card an event (or a rollback operation) is about,
# tried in order when the event row itself carries no ``card_id``.
_CARD_ID_KEYS = ("card_id", "id")


def _is_cost_entry(field: str, cost_keys: frozenset[str]) -> bool:
    """True for a ``changes`` / ``fields`` entry that is one cost field's own."""
    if field in cost_keys:
        return True
    return (
        field.startswith(LEGACY_ATTRIBUTE_PREFIX)
        and field[len(LEGACY_ATTRIBUTE_PREFIX) :] in cost_keys
    )


def _without(value: Any, cost_keys: frozenset[str]) -> Any:
    """``value`` without the cost keys when it is an attributes dict."""
    if isinstance(value, dict):
        return {k: v for k, v in value.items() if k not in cost_keys}
    return value


def _strip_changes(changes: dict, cost_keys: frozenset[str]) -> dict:
    """``changes`` (``{field: {"old", "new"}}``) without any cost value.

    A cost key leaves **both** sides of ``attributes``: gone from one side
    only, it would read as a change from or to nothing.
    """
    out: dict = {}
    for field, change in changes.items():
        if _is_cost_entry(field, cost_keys):
            continue
        if field == "attributes" and isinstance(change, dict):
            change = {side: _without(value, cost_keys) for side, value in change.items()}
        out[field] = change
    return out


def _strip_fields(fields: dict, cost_keys: frozenset[str]) -> dict:
    """A rollback operation's ``fields`` (``{field: old value}``) without any
    cost value."""
    out: dict = {}
    for field, value in fields.items():
        if _is_cost_entry(field, cost_keys):
            continue
        out[field] = _without(value, cost_keys) if field == "attributes" else value
    return out


def strip_cost_values(data: dict, cost_keys: frozenset[str]) -> dict:
    """One payload without the values of ``cost_keys``.

    Returns ``data`` itself when there is nothing to remove from, so a caller
    can tell an untouched payload by identity; never mutates its input.
    """
    if not cost_keys:
        return data
    out = data
    changes = data.get("changes")
    if isinstance(changes, dict):
        out = {**out, "changes": _strip_changes(changes, cost_keys)}
    fields = data.get("fields")
    if isinstance(fields, dict):
        out = {**out, "fields": _strip_fields(fields, cost_keys)}
    return out


def carries_values(data: Any) -> bool:
    """True for a payload that can hold field values at all."""
    return isinstance(data, dict) and (
        isinstance(data.get("changes"), dict) or isinstance(data.get("fields"), dict)
    )


def subject_card_id(card_id: uuid.UUID | None, data: dict) -> uuid.UUID | None:
    """The card a payload is about: the event row's own, else the payload's."""
    if card_id is not None:
        return card_id
    for key in _CARD_ID_KEYS:
        try:
            return uuid.UUID(str(data.get(key)))
        except (ValueError, TypeError):
            continue
    return None


async def scrub_event_costs(
    db: AsyncSession, user: User, events: Sequence[tuple[uuid.UUID | None, Any]]
) -> list[Any]:
    """The payloads of ``events`` (``(event card id, data)`` pairs), with cost
    values removed where ``user`` may not see that card's costs.

    Issues no query when no payload carries values or the reader sees every
    card's costs. A payload whose card no longer exists is judged by the type
    it names (``data.type``), and failing that loses every cost key any card
    type defines: with no card left to ask about, the answer is "no".
    """
    payloads = [data for _, data in events]
    carrying = [i for i, data in enumerate(payloads) if carries_values(data)]
    if not carrying or await PermissionService.sees_all_costs(db, user):
        return payloads

    subjects = {i: subject_card_id(events[i][0], payloads[i]) for i in carrying}
    card_ids = {card_id for card_id in subjects.values() if card_id is not None}
    type_of: dict[uuid.UUID, str] = {}
    if card_ids:
        rows = await db.execute(select(Card.id, Card.type).where(Card.id.in_(card_ids)))
        type_of = {card_id: type_key for card_id, type_key in rows.all()}

    schemas = await db.execute(select(CardType.key, CardType.fields_schema))
    keys_of = {key: cost_field_keys_from_card_schema(schema) for key, schema in schemas.all()}
    every_key = frozenset().union(*keys_of.values())
    if not every_key:
        return payloads

    allowed = await PermissionService.card_ids_with_cost_access(db, user, type_of)
    for i in carrying:
        card_id = subjects[i]
        if card_id in allowed:
            continue
        data = payloads[i]
        type_key = type_of.get(card_id) if card_id is not None else None
        if type_key is None:
            type_key = data.get("type")
        cost_keys = keys_of[type_key] if type_key in keys_of else every_key
        payloads[i] = strip_cost_values(data, cost_keys)
    return payloads


async def scrub_operation_costs(db: AsyncSession, user: User, operations: Any) -> Any:
    """Rollback operations (each names its ``card_id`` and the old ``fields``)
    with cost values removed where ``user`` may not see that card's costs.
    Anything that is not a list is returned as it is."""
    if not isinstance(operations, list):
        return operations
    return await scrub_event_costs(db, user, [(None, op) for op in operations])


# Where a mutation batch's summary, a rollback preview and a rollback result
# list their operations.
_OPERATION_LISTS = ("results", "operations")


async def scrub_summary_costs(db: AsyncSession, user: User, summary: Any) -> Any:
    """A batch summary or rollback response with its operation lists scrubbed.
    Returns ``summary`` itself when it lists none."""
    if not isinstance(summary, dict):
        return summary
    out = summary
    for key in _OPERATION_LISTS:
        if isinstance(summary.get(key), list):
            out = {**out, key: await scrub_operation_costs(db, user, summary[key])}
    return out
