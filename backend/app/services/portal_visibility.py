"""What a published web portal shows an anonymous visitor.

An admin decides per portal which fields, built-in properties and relation types
the public page shows (``card_config.toggles``). The page applies those toggles
when it renders (``isVisible`` / ``visibleRelTypes`` in
``frontend/src/features/web-portals/PortalViewer.tsx``), but the public card
endpoint used to return every card whole regardless, so a field the admin hid
was still in the JSON anyone could read. These helpers decide what the endpoint
may send: exactly what the page could ever show, on the card tile **or** in the
detail dialog. Change the page's rules and change these.

That reduces to two rules, because of how the page's defaults fall:

* A field or built-in property with no toggle always shows in the detail dialog
  (the page's ``DEFAULT_DETAIL`` is true for every built-in, and a field's
  detail fallback is true), so it is sent. Only a toggle entry that shows it in
  neither place withholds it. The tile's own defaults, "the first three fields"
  and "no approval status", never decide what is sent for the same reason.
* A relation type has no default: it is sent only once its toggle shows it.

The page tests a toggle entry with JavaScript truthiness, so these do too.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card_type import CardType
from app.models.relation_type import RelationType
from app.services.cost_field_filter import cost_field_keys_from_card_schema

# Payload key on a public card -> the toggle that governs it. Stakeholders are
# toggled as "subscribers", the name the portal admin screen has always used.
BUILT_IN_TOGGLES: dict[str, str] = {
    "description": "description",
    "lifecycle": "lifecycle",
    "tags": "tags",
    "stakeholders": "subscribers",
    "data_quality": "data_quality",
    "approval_status": "approval_status",
}

# What a hidden built-in property is replaced with, so the payload keeps its
# shape: lists stay lists for the page's `.length` checks.
_HIDDEN_VALUE: dict[str, Any] = {
    "description": None,
    "lifecycle": None,
    "tags": [],
    "stakeholders": [],
    "data_quality": None,
    "approval_status": None,
}


def _js_truthy(value: Any) -> bool:
    """JavaScript truthiness, which is what the page tests a toggle entry with.

    Differs from Python's for empty containers: ``{}`` and ``[]`` are truthy.
    """
    if value is None or value is False:
        return False
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value == value and value != 0  # NaN and 0 are falsy
    if isinstance(value, str):
        return value != ""
    return True


def portal_toggles(card_config: Any) -> dict[str, Any]:
    """The portal's toggle map, or an empty one when it has none."""
    if not isinstance(card_config, dict):
        return {}
    toggles = card_config.get("toggles")
    return toggles if isinstance(toggles, dict) else {}


def _shown_somewhere(entry: Any) -> bool:
    """Whether a toggle entry the page reads shows its key on the tile or in
    the dialog. A non-object entry reads as ``undefined`` for both."""
    return isinstance(entry, dict) and (
        _js_truthy(entry.get("card")) or _js_truthy(entry.get("detail"))
    )


def _sent_by_default(toggles: dict[str, Any], key: str) -> bool:
    """Fields and built-in properties: sent unless a toggle entry shows them
    nowhere (see the module docstring)."""
    entry = toggles.get(key)
    return not _js_truthy(entry) or _shown_somewhere(entry)


def public_fields_schema(fields_schema: Any, cost_keys: frozenset[str]) -> list:
    """The schema a public portal publishes: the card type's, minus cost fields.

    There is no authenticated user on a portal to evaluate ``costs.view`` for,
    so cost fields are always withheld.
    """
    if not cost_keys:
        return list(fields_schema or [])
    public_schema: list = []
    for section in fields_schema or []:
        if not isinstance(section, dict):
            public_schema.append(section)
            continue
        fields = [
            f
            for f in (section.get("fields") or [])
            if not (isinstance(f, dict) and f.get("key") in cost_keys)
        ]
        public_schema.append({**section, "fields": fields})
    return public_schema


def public_field_keys(public_schema: list) -> frozenset[str]:
    """Every field key in the public schema, across all sections."""
    keys: set[str] = set()
    for section in public_schema:
        if not isinstance(section, dict):
            continue
        for field in section.get("fields") or []:
            if isinstance(field, dict) and isinstance(field.get("key"), str):
                keys.add(field["key"])
    return frozenset(keys)


def exposed_field_keys(toggles: dict[str, Any], field_keys: frozenset[str]) -> frozenset[str]:
    """The attribute keys the page shows on the tile or in the detail dialog.

    An attribute key that is not a field of the public schema is never shown,
    so it is never in ``field_keys`` to begin with.
    """
    return frozenset(k for k in field_keys if _sent_by_default(toggles, f"field:{k}"))


def exposed_built_ins(toggles: dict[str, Any]) -> frozenset[str]:
    """The built-in payload keys (description, tags, …) the page shows anywhere."""
    return frozenset(
        payload_key
        for payload_key, toggle in BUILT_IN_TOGGLES.items()
        if _sent_by_default(toggles, toggle)
    )


def visible_relation_type_keys(
    toggles: dict[str, Any], relation_type_keys: list[str]
) -> frozenset[str]:
    """The relation types the page shows. Unlike fields there is no default:
    a relation type is shown only once its toggle says so."""
    return frozenset(k for k in relation_type_keys if _shown_somewhere(toggles.get(f"rel:{k}")))


def shape_public_item(
    item: dict[str, Any],
    *,
    exposed_fields: frozenset[str],
    built_ins: frozenset[str],
    visible_relation_types: frozenset[str],
) -> dict[str, Any]:
    """Drop from one public card everything the portal's page never shows."""
    shaped = dict(item)
    shaped["attributes"] = {
        k: v for k, v in (item.get("attributes") or {}).items() if k in exposed_fields
    }
    for payload_key in BUILT_IN_TOGGLES:
        if payload_key not in built_ins:
            shaped[payload_key] = _HIDDEN_VALUE[payload_key]
    shaped["relations"] = [
        r for r in (item.get("relations") or []) if r.get("type") in visible_relation_types
    ]
    return shaped


async def portal_relation_types(db: AsyncSession, card_type: str) -> list[tuple[str, str]]:
    """``(relation type key, other end's card type)`` for every relation type a
    portal of ``card_type`` can show — the list the page's toggles apply to.

    Hidden relation types are left out, and so are those whose other end is a
    hidden card type, exactly as ``GET /web-portals/public/{slug}`` leaves them
    out of the page's ``relation_types``.
    """
    rows = (
        (
            await db.execute(
                select(RelationType).where(
                    or_(
                        RelationType.source_type_key == card_type,
                        RelationType.target_type_key == card_type,
                    ),
                    RelationType.is_hidden == False,  # noqa: E712
                )
            )
        )
        .scalars()
        .all()
    )
    pairs = [
        (
            rt.key,
            rt.target_type_key if rt.source_type_key == card_type else rt.source_type_key,
        )
        for rt in rows
    ]
    others = {other for _, other in pairs if other != card_type}
    hidden: set[str] = set()
    if others:
        hidden = set(
            (
                await db.execute(
                    select(CardType.key).where(
                        CardType.key.in_(others),
                        CardType.is_hidden == True,  # noqa: E712
                    )
                )
            )
            .scalars()
            .all()
        )
    return [(key, other) for key, other in pairs if other not in hidden]


@dataclass(frozen=True)
class PortalVisibility:
    """Everything a portal's page shows, worked out once per request."""

    exposed_fields: frozenset[str]
    built_ins: frozenset[str]
    relation_types: frozenset[str]
    # Visible relation type key -> the card type at its other end.
    relation_other_types: dict[str, str]

    def shows_built_in(self, payload_key: str) -> bool:
        return payload_key in self.built_ins

    def relation_types_reaching(self, type_key: str) -> list[str]:
        """The visible relation types whose other end is ``type_key``."""
        return sorted(k for k, other in self.relation_other_types.items() if other == type_key)


async def load_portal_visibility(
    db: AsyncSession, card_type: str, card_config: Any
) -> PortalVisibility:
    """What a portal of ``card_type`` configured with ``card_config`` shows."""
    toggles = portal_toggles(card_config)
    schema = (
        await db.execute(select(CardType.fields_schema).where(CardType.key == card_type))
    ).scalar_one_or_none()
    public = public_fields_schema(schema, cost_field_keys_from_card_schema(schema))
    pairs = await portal_relation_types(db, card_type)
    visible = visible_relation_type_keys(toggles, [key for key, _ in pairs])
    return PortalVisibility(
        exposed_fields=exposed_field_keys(toggles, public_field_keys(public)),
        built_ins=exposed_built_ins(toggles),
        relation_types=visible,
        relation_other_types={key: other for key, other in pairs if key in visible},
    )
