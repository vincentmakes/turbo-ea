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

from collections.abc import Iterator
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card_type import CardType
from app.models.relation_type import RelationType
from app.services.cost_field_filter import cost_field_keys_from_card_schema
from app.services.portal_card_filters import CONDITION_FIELD_TYPES

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


# ---------------------------------------------------------------------------
# Visitor filters (#1425)
# ---------------------------------------------------------------------------
#
# The filters a visitor of a card-list portal sees and may use, in the toggle
# key vocabulary of ``card_config.toggles``: ``subtype``, ``tags``,
# ``field:<key>`` and ``rel:<key>``. The admin lists the ones shown by default
# in ``card_config.visitor_filters`` and may forbid adding others with
# ``card_config.visitor_can_add_filters: false``. The server resolves the lists
# (``visitor_filter_lists``) and both the public metadata payload and the
# cards route read that one answer: the viewer never derives them from the
# schema, and a filter outside ``allowed`` changes nothing.

_SELECT_TYPES = frozenset({"single_select", "multiple_select"})
_CONDITION_TYPES = frozenset().union(*CONDITION_FIELD_TYPES.values())


def filter_kind(field_def: Any) -> str | None:
    """How a visitor filters on a field (``filterKindOf`` in
    ``frontend/src/lib/fieldFilters.ts``), or ``None`` when a portal never
    does: ``facet`` for a select with options or a boolean, ``text`` /
    ``number`` / ``date`` for the condition kinds. A ``cost`` field has no kind
    here — a portal never filters on costs — and neither does an extension type.
    """
    if not isinstance(field_def, dict):
        return None
    ftype = field_def.get("type")
    if ftype == "boolean":
        return "facet"
    if ftype in _SELECT_TYPES:
        options = field_def.get("options")
        return "facet" if isinstance(options, list) and options else None
    for kind, types in CONDITION_FIELD_TYPES.items():
        if ftype in types:
            return kind
    return None


def _schema_fields(schema: Any) -> Iterator[tuple[dict, bool]]:
    """``(field, its section is hidden from filters)`` over a schema, in
    schema order; a key declared twice counts once, where first declared."""
    seen: set[str] = set()
    for section in schema if isinstance(schema, list) else []:
        if not isinstance(section, dict):
            continue
        hidden = section.get("hideInFilters") is True
        for f in section.get("fields") or []:
            if isinstance(f, dict) and isinstance(f.get("key"), str) and f["key"] not in seen:
                seen.add(f["key"])
                yield f, hidden


def _filter_keys(
    public_schema: Any,
    *,
    exposed_fields: frozenset[str],
    has_subtypes: bool,
    shows_tags: bool,
    relation_types: frozenset[str],
    default_only: bool,
) -> list[str]:
    out: list[str] = []
    if has_subtypes:
        out.append("subtype")
    if shows_tags:
        out.append("tags")
    for f, hidden in _schema_fields(public_schema):
        if f["key"] not in exposed_fields or f.get("type") == "cost":
            continue
        if default_only:
            # The legacy viewer offered selects with options only — never a
            # boolean — and a section hidden from filters shows none.
            keep = f.get("type") in _SELECT_TYPES and filter_kind(f) == "facet" and not hidden
        else:
            keep = filter_kind(f) is not None
        if keep:
            out.append(f"field:{f['key']}")
    out.extend(f"rel:{key}" for key in sorted(relation_types))
    return out


def publishable_filters(
    public_schema: Any,
    *,
    exposed_fields: frozenset[str],
    has_subtypes: bool,
    shows_tags: bool,
    relation_types: frozenset[str],
) -> list[str]:
    """Every filter a visitor may ever use: the subtype (when the type has
    subtypes), the tags (only while the page shows them), each published
    field with a filter kind (``filter_kind``; never a cost field) and each
    relation type the page shows. Schema order; relation types by key."""
    return _filter_keys(
        public_schema,
        exposed_fields=exposed_fields,
        has_subtypes=has_subtypes,
        shows_tags=shows_tags,
        relation_types=relation_types,
        default_only=False,
    )


def default_shown_filters(
    public_schema: Any,
    *,
    exposed_fields: frozenset[str],
    has_subtypes: bool,
    shows_tags: bool,
    relation_types: frozenset[str],
) -> list[str]:
    """The filters shown when the admin never chose (no ``visitor_filters``):
    the bar every portal had before the choice existed — subtype, tags while
    shown, each shown single / multiple select with options and each shown
    relation type — minus the fields of a section hidden from filters.

    Its twin is ``defaultVisitorFilters`` in
    ``frontend/src/features/admin/webPortalFilters.ts``, which the portal
    dialog compares the admin's column against: change one, change both."""
    return _filter_keys(
        public_schema,
        exposed_fields=exposed_fields,
        has_subtypes=has_subtypes,
        shows_tags=shows_tags,
        relation_types=relation_types,
        default_only=True,
    )


@dataclass(frozen=True)
class VisitorFilterLists:
    """``shown``: the filters the bar renders; ``allowed``: every filter the
    cards route applies (``shown`` when adding is off); ``can_add``: may the
    visitor add fields through "Add filter". Toggle keys, never ids."""

    shown: tuple[str, ...] = ()
    allowed: tuple[str, ...] = ()
    can_add: bool = False

    def as_payload(self) -> dict[str, Any]:
        return {"shown": list(self.shown), "allowed": list(self.allowed), "can_add": self.can_add}


def visitor_filter_lists(
    card_config: Any, *, publishable: list[str], default: list[str]
) -> VisitorFilterLists:
    """The admin's ``visitor_filters`` (or ``default`` when it is not a list)
    within ``publishable``, in its order; ``can_add`` unless
    ``visitor_can_add_filters`` is ``False``. A key the portal no longer
    publishes — a field since hidden, a relation type switched off — drops out."""
    config = card_config if isinstance(card_config, dict) else {}
    raw = config.get("visitor_filters")
    chosen = {k for k in (raw if isinstance(raw, list) else default) if isinstance(k, str)}
    shown = tuple(k for k in publishable if k in chosen)
    can_add = config.get("visitor_can_add_filters") is not False
    return VisitorFilterLists(
        shown=shown, allowed=tuple(publishable) if can_add else shown, can_add=can_add
    )


@dataclass(frozen=True)
class PortalVisibility:
    """Everything a portal's page shows, worked out once per request."""

    exposed_fields: frozenset[str]
    built_ins: frozenset[str]
    relation_types: frozenset[str]
    # Visible relation type key -> the card type at its other end.
    relation_other_types: dict[str, str]
    #: What a visitor may filter on (``visitor_filter_lists``).
    visitor_filters: VisitorFilterLists = dataclass_field(default_factory=VisitorFilterLists)
    #: ``{field key: field type}`` of the public schema (no cost field).
    field_types: dict[str, str] = dataclass_field(default_factory=dict)

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
    row = (
        await db.execute(
            select(CardType.fields_schema, CardType.subtypes).where(CardType.key == card_type)
        )
    ).one_or_none()
    schema, subtypes = (row[0], row[1]) if row else (None, None)
    public = public_fields_schema(schema, cost_field_keys_from_card_schema(schema))
    pairs = await portal_relation_types(db, card_type)
    visible = visible_relation_type_keys(toggles, [key for key, _ in pairs])
    exposed = exposed_field_keys(toggles, public_field_keys(public))
    built_ins = exposed_built_ins(toggles)
    has_subtypes = isinstance(subtypes, list) and len(subtypes) > 0
    shows_tags = "tags" in built_ins
    return PortalVisibility(
        exposed_fields=exposed,
        built_ins=built_ins,
        relation_types=visible,
        relation_other_types={key: other for key, other in pairs if key in visible},
        visitor_filters=visitor_filter_lists(
            card_config,
            publishable=publishable_filters(
                public,
                exposed_fields=exposed,
                has_subtypes=has_subtypes,
                shows_tags=shows_tags,
                relation_types=visible,
            ),
            default=default_shown_filters(
                public,
                exposed_fields=exposed,
                has_subtypes=has_subtypes,
                shows_tags=shows_tags,
                relation_types=visible,
            ),
        ),
        field_types={f["key"]: str(f.get("type") or "") for f, _ in _schema_fields(public)},
    )


def filterable_relation_types(visibility: PortalVisibility, type_key: str) -> list[str]:
    """The relation types reaching ``type_key`` that a visitor may filter on
    (``visitor_filters.allowed``): the ones ``/relation-options`` lists cards
    for. Sorted by key."""
    allowed = set(visibility.visitor_filters.allowed)
    return [k for k in visibility.relation_types_reaching(type_key) if f"rel:{k}" in allowed]


#: The ``card_config`` keys of the visitor filter settings.
VISITOR_FILTERS_KEY = "visitor_filters"
VISITOR_CAN_ADD_KEY = "visitor_can_add_filters"

_BARE_FILTER_KEYS = frozenset({"subtype", "tags"})
_PREFIXED_FILTER_KEYS = ("field:", "rel:")


def is_filter_key(key: object) -> bool:
    """Is ``key`` in the visitor-filter vocabulary: ``subtype``, ``tags``,
    ``field:<key>``, ``rel:<key>`` (keys, never ids)?"""
    if not isinstance(key, str):
        return False
    if key in _BARE_FILTER_KEYS:
        return True
    return any(key.startswith(p) and len(key) > len(p) for p in _PREFIXED_FILTER_KEYS)


def normalise_visitor_filter_config(card_config: Any, view: str) -> Any:
    """A portal's ``card_config`` with its visitor filter settings as stored:
    ``visitor_filters`` a list of vocabulary keys, each once, in the order
    given (anything else in it dropped); ``visitor_can_add_filters`` kept
    only when ``False`` (absent means "visitors may add"). A board portal
    (``view != "cards"``) has no visitor filters, so both keys go.

    Raises ``ValueError`` when ``visitor_filters`` is not a list or
    ``visitor_can_add_filters`` not a boolean: a malformed setting is refused,
    not silently read as the default."""
    if not isinstance(card_config, dict):
        return card_config
    out = dict(card_config)
    raw = out.pop(VISITOR_FILTERS_KEY, None)
    can_add = out.pop(VISITOR_CAN_ADD_KEY, None)
    if raw is not None and not isinstance(raw, list):
        raise ValueError("card_config.visitor_filters must be a list of filter keys")
    if can_add is not None and not isinstance(can_add, bool):
        raise ValueError("card_config.visitor_can_add_filters must be true or false")
    if view != "cards":
        return out
    if raw is not None:
        out[VISITOR_FILTERS_KEY] = list(dict.fromkeys(k for k in raw if is_filter_key(k)))
    if can_add is False:
        out[VISITOR_CAN_ADD_KEY] = False
    return out
