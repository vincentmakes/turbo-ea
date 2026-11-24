"""A card-list web portal's preset filters, as SQL.

A card-list portal (``view == "cards"``) can be narrowed by the filter set the
portfolio-style reports share — *Related by* (with *Include sub-cards*), Tags,
the card's own Fields (subtype first) and Relation subtypes. The admin picks
them in the portal dialog with the very ``CardFilterSection`` the reports
render, and they are stored under ``filters.card_filters`` in exactly the
``CardFilterValue`` shape a saved report stores (``cardFilters.ts``).

The reports match that value in the browser (``matchesStaticFilters`` in
``portfolioHelpers.ts``), over a payload holding every card. A portal cannot:
its card list is paginated, public, and the preset is a publication boundary
a visitor must not be able to widen. So the same rules are written here as
where-clauses, one function per filter row, each mirroring its TypeScript
counterpart — a portal set up like a report shows the cards the report shows.

A portal saved before ``card_filters`` existed keeps its ``subtypes`` /
``tag_ids`` preset, applied exactly as before, until it is next saved;
``approval_statuses`` (set by seeds and the API, never by the dialog) applies
either way. Board portals (PPM, BPM) have their own scopes and never read
``card_filters``.

Reads only; never commits.
"""

from __future__ import annotations

import json
import math
import re
import uuid
from collections.abc import Iterable, Mapping, Sequence
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CTE,
    ColumnElement,
    Numeric,
    Text,
    and_,
    case,
    cast,
    exists,
    false,
    func,
    not_,
    or_,
    select,
)
from sqlalchemy.dialects.postgresql import array
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.tag import CardTag, Tag, TagGroup
from app.services.lifecycle import _SQL_DATE_PATTERN
from app.services.search_rank import search_filter

#: The "(empty)" option of every filter (``EMPTY_FILTER_KEY`` in
#: ``FilterSelect.tsx``): a card with no value, no relation, no subtype.
EMPTY_KEY = "__empty__"

#: The two spellings of a boolean field's stored value (``booleanValueOf`` in
#: ``lib/fieldFacets.ts``); the facet keys themselves are ``"true"`` / ``"false"``.
_LEGACY_TRUE = ("true", "yes")
_LEGACY_FALSE = ("false", "no")


# ---------------------------------------------------------------------------
# The stored value
# ---------------------------------------------------------------------------


def _strings(value: object) -> list[str]:
    return [v for v in value if isinstance(v, str)] if isinstance(value, list) else []


def _string_lists(value: object) -> dict[str, list[str]]:
    if not isinstance(value, dict):
        return {}
    out: dict[str, list[str]] = {}
    for key, vals in value.items():
        picked = _strings(vals)
        if isinstance(key, str) and picked:
            out[key] = picked
    return out


# ---------------------------------------------------------------------------
# Field conditions: text contains, number range, date range (#1425)
# ---------------------------------------------------------------------------
#
# The Python twin of ``normaliseCondition`` / ``matchesCondition`` in
# ``frontend/src/lib/fieldFilters.ts``. Both suites pin the same edge cases
# (``test_portal_card_filters.py``, ``fieldFilters.test.ts``). Known
# divergences, all outside what the UI writes:
#
# - text: ``ILIKE`` folds case by the database collation, JavaScript's
#   ``toLowerCase`` by Unicode; the tests use ASCII only. A JSON number is
#   read as Postgres prints it (``1.0`` stays ``1.0``; JavaScript prints
#   ``1``).
# - number: a JSON *number* longer than 40 characters as Postgres prints it is
#   not a number here but is in the browser; a value with more than 15
#   significant digits compares exactly here and as a double there.
# - date: an impossible calendar date (``2026-13-45``) matches the pattern
#   on both sides and is compared as its text, as ``lifecycle.py`` does.

#: The longest ``contains`` needle kept; the rest is cut off.
CONTAINS_MAX = 200

#: A plain decimal: optional sign, digits with an optional fraction (or a bare
#: fraction), an optional exponent of at most two digits. Two, not three:
#: ``9e999`` is a finite ``numeric`` in Postgres but ``Infinity`` in the
#: browser, so a three-digit exponent would let the two matchers disagree.
#: ``[0-9]``, never ``\d``, which a Postgres locale may widen past ASCII.
NUMBER_PATTERN = r"^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]{1,2})?$"
#: A numeric text longer than this is not read as a number (no cast is tried).
NUMBER_MAX_CHARS = 40

#: A date bound as the UI writes it.
_DATE_BOUND = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")

#: The keys of each condition shape, by filter kind.
_SHAPE_KEYS: dict[str, tuple[str, ...]] = {
    "text": ("contains",),
    "number": ("min", "max"),
    "date": ("from", "to"),
}

#: The field types each condition kind applies to. ``cost`` is a number field
#: the reports filter on for readers who may see costs; a portal never does.
CONDITION_FIELD_TYPES: dict[str, frozenset[str]] = {
    "text": frozenset({"text", "multiline_text", "url"}),
    "number": frozenset({"number", "percentage"}),
    "date": frozenset({"date"}),
}


def condition_shape(raw: object) -> str | None:
    """The kind a stored condition's keys name (``text`` / ``number`` /
    ``date``), or ``None`` when it is not an object or names keys of more than
    one kind (``shapeOfCondition`` in ``fieldFilters.ts``)."""
    if not isinstance(raw, dict):
        return None
    kinds = [kind for kind, keys in _SHAPE_KEYS.items() if any(k in raw for k in keys)]
    return kinds[0] if len(kinds) == 1 else None


def _finite_number(value: object) -> float | int | None:
    """A JSON number usable as a bound: not a boolean, finite."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return value if math.isfinite(float(value)) else None
    except OverflowError:
        return None


def normalise_condition(kind: str, raw: object) -> dict[str, Any] | None:
    """One condition of ``kind`` in its canonical shape, or ``None`` when it
    narrows nothing: a trimmed, non-empty ``contains`` (cut at
    ``CONTAINS_MAX``); finite ``min`` / ``max``; ``YYYY-MM-DD`` ``from`` /
    ``to``. A bound that is unusable is dropped; no usable bound, no
    condition."""
    if not isinstance(raw, dict):
        return None
    if kind == "text":
        needle = raw.get("contains")
        if not isinstance(needle, str) or not needle.strip():
            return None
        return {"contains": needle.strip()[:CONTAINS_MAX]}
    if kind == "number":
        out: dict[str, Any] = {}
        for key in ("min", "max"):
            bound = _finite_number(raw.get(key))
            if bound is not None:
                out[key] = bound
        return out or None
    if kind == "date":
        out = {}
        for key in ("from", "to"):
            bound = raw.get(key)
            if isinstance(bound, str) and _DATE_BOUND.match(bound):
                out[key] = bound
        return out or None
    return None


def normalise_attr_conditions(raw: object) -> dict[str, dict[str, Any]]:
    """``attrConditions`` with every unusable condition dropped — the twin of
    ``restoreAttrConditions`` (``fieldFilters.ts``)."""
    if not isinstance(raw, dict):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not key:
            continue
        kind = condition_shape(value)
        condition = normalise_condition(kind, value) if kind else None
        if condition is not None:
            out[key] = condition
    return out


def _text_condition(col, needle: str) -> ColumnElement[bool]:
    """A string or a number whose text contains ``needle``, case-insensitive,
    wildcards escaped (``search_filter``). A list, an object, a boolean or no
    value never matches."""
    return and_(
        func.jsonb_typeof(col).in_(("string", "number")),
        search_filter(col.astext, needle),
    )


def _decimal(value: float | int) -> Decimal:
    # ``repr`` of a float is its shortest round-tripping text: 0.1 → "0.1".
    return Decimal(value) if isinstance(value, int) else Decimal(repr(value))


def numeric_value(col) -> ColumnElement[Any]:
    """``attributes[key]`` as a ``numeric``, NULL when it is not a plain
    decimal (``numericValueOf`` in ``fieldFilters.ts``). The ``CASE`` orders
    the guard before the cast, so no stored text can make the cast raise; a
    JSON boolean reads ``true`` / ``false`` and fails the guard."""
    txt = col.astext
    guard = and_(func.char_length(txt) <= NUMBER_MAX_CHARS, txt.regexp_match(NUMBER_PATTERN))
    return case((guard, cast(txt, Numeric)))


def _number_condition(col, condition: Mapping[str, Any]) -> ColumnElement[bool]:
    # ``normalise_condition`` keeps at least one bound. A NULL (not a number)
    # compares as NULL, never true, so no separate "is a number" test is needed.
    num = numeric_value(col)
    clauses: list[ColumnElement[bool]] = []
    if "min" in condition:
        clauses.append(num >= _decimal(condition["min"]))
    if "max" in condition:
        clauses.append(num <= _decimal(condition["max"]))
    return and_(*clauses)


def _date_condition(col, condition: Mapping[str, Any]) -> ColumnElement[bool]:
    """A stored ``YYYY-MM-DD`` (a time part allowed) within the bounds, both
    ends included, compared as text behind the ``lifecycle.py`` pattern."""
    txt = col.astext
    day = func.left(txt, 10)
    clauses: list[ColumnElement[bool]] = [txt.regexp_match(_SQL_DATE_PATTERN)]
    if "from" in condition:
        clauses.append(day >= condition["from"])
    if "to" in condition:
        clauses.append(day <= condition["to"])
    return and_(*clauses)


def condition_clause(
    key: str, condition: object, field_type: str | None, *, card=Card
) -> ColumnElement[bool] | None:
    """One field condition over ``card.attributes[key]``, or ``None`` when it
    does not apply: an unknown field, a ``cost`` field, a type the
    condition's shape does not fit, or a condition that narrows nothing."""
    kind = condition_shape(condition)
    if kind is None or field_type not in CONDITION_FIELD_TYPES[kind]:
        return None
    normalised = normalise_condition(kind, condition)
    if normalised is None:
        return None
    col = card.attributes[key]
    if kind == "text":
        return _text_condition(col, normalised["contains"])
    if kind == "number":
        return _number_condition(col, normalised)
    return _date_condition(col, normalised)


def condition_clauses(
    conditions: Mapping[str, Any], types: Mapping[str, str], *, card=Card
) -> list[ColumnElement[bool]]:
    """The where-clauses for ``attrConditions`` (``{field key: condition}``),
    ``types`` being ``field_types`` of the card type; every condition that
    does not apply is skipped (``condition_clause``). The preset and a
    visitor's own conditions share this one builder."""
    out = []
    for key, condition in sorted(conditions.items()):
        clause = condition_clause(key, condition, types.get(key), card=card)
        if clause is not None:
            out.append(clause)
    return out


def normalise_card_filters(raw: object) -> dict[str, Any] | None:
    """``raw`` in the ``CardFilterValue`` shape, anything malformed dropped —
    the Python twin of ``restoreCardFilters`` (``cardFilters.ts``). ``None``
    when ``raw`` is not an object at all."""
    if not isinstance(raw, dict):
        return None
    return {
        "subtypeFilters": _strings(raw.get("subtypeFilters")),
        "attrFilters": _string_lists(raw.get("attrFilters")),
        "attrConditions": normalise_attr_conditions(raw.get("attrConditions")),
        "relationFilters": _string_lists(raw.get("relationFilters")),
        "relSubtypeFilters": _string_lists(raw.get("relSubtypeFilters")),
        "tagFilterIds": _strings(raw.get("tagFilterIds")),
        "includeDescendants": raw.get("includeDescendants") is True,
    }


def has_active_card_filters(card_filters: Mapping[str, Any] | None) -> bool:
    """Does the value narrow anything? *Include sub-cards* alone does not."""
    if not card_filters:
        return False
    return any(
        card_filters.get(key)
        for key in (
            "subtypeFilters",
            "attrFilters",
            "attrConditions",
            "relationFilters",
            "relSubtypeFilters",
            "tagFilterIds",
        )
    )


def public_filters(filters: object) -> object:
    """A portal's ``filters`` as an anonymous visitor may see them.

    ``card_filters`` names related cards by id; the viewer never reads it, and a
    published page returns the artefact, not the model behind it."""
    if not isinstance(filters, dict) or "card_filters" not in filters:
        return filters
    return {k: v for k, v in filters.items() if k != "card_filters"}


def parse_side_key(key: str) -> tuple[str, bool | None]:
    """``(relation type key, is the card the source?)`` for a facet key; the
    side is ``None`` for a bare key, which means either side. Mirror of
    ``parseSideKey`` in ``lib/relationSort.ts``."""
    if key.endswith("__out"):
        return key[: -len("__out")], True
    if key.endswith("__in"):
        return key[: -len("__in")], False
    return key, None


def _split(values: Iterable[str]) -> tuple[list[str], bool]:
    """``(the real picks, was "(empty)" picked)``."""
    vals = list(values)
    return [v for v in vals if v != EMPTY_KEY], EMPTY_KEY in vals


def uuids(values: Iterable[str]) -> list[uuid.UUID]:
    """The values that are UUIDs, as UUIDs; anything else dropped."""
    out = []
    for value in values:
        try:
            out.append(uuid.UUID(str(value)))
        except ValueError:
            continue
    return out


# ---------------------------------------------------------------------------
# One condition per filter row
# ---------------------------------------------------------------------------


def subtype_condition(values: Iterable[str], *, card=Card) -> ColumnElement[bool] | None:
    """A card whose subtype is picked; "(empty)" a card with none.

    ``card`` is the entity the condition reads — ``Card`` itself, or an alias
    of it when the card is the far end of a relation (``card_query``)."""
    real, want_empty = _split(values)
    if not real and not want_empty:
        return None
    clauses: list[ColumnElement[bool]] = []
    if real:
        clauses.append(card.subtype.in_(real))
    if want_empty:
        clauses.append(or_(card.subtype.is_(None), card.subtype == ""))
    return or_(*clauses)


def _absent(col) -> ColumnElement[bool]:
    """No value: the key absent, JSON null, ``""`` or an empty list — written
    as its own positive test (``card_flags._jsonb_absent``), never a negation,
    since ``NOT NULL`` drops exactly the rows "(empty)" exists to find."""
    return or_(col.astext.is_(None), col.astext == "", col.astext == "[]")


def attribute_condition(
    key: str, values: Iterable[str], field_type: str | None, *, card=Card
) -> ColumnElement[bool] | None:
    """A card whose ``attributes[key]`` holds a picked value (``matchesFacet``).

    A select holds its option key as a string, or a list of them for a
    ``multiple_select``; JSONB ``?|`` matches either. A boolean reads the
    legacy ``"yes"`` / ``"no"`` strings too. A key that is not a facet field is
    a plain string comparison, as in the matcher's fallback. ``card`` is the
    entity read, as in ``subtype_condition``.
    """
    real, want_empty = _split(values)
    if not real and not want_empty:
        return None
    col = card.attributes[key]
    clauses: list[ColumnElement[bool]] = []
    if field_type == "boolean":
        reading = func.lower(func.trim(col.astext))
        if "true" in real:
            clauses.append(reading.in_(_LEGACY_TRUE))
        if "false" in real:
            clauses.append(reading.in_(_LEGACY_FALSE))
        if want_empty:
            clauses.append(
                or_(col.astext.is_(None), reading.notin_((*_LEGACY_TRUE, *_LEGACY_FALSE)))
            )
    else:
        if real:
            if field_type in ("single_select", "multiple_select"):
                clauses.append(col.has_any(array(real, type_=Text)))
            else:
                clauses.append(col.astext.in_(real))
        if want_empty:
            clauses.append(_absent(col))
    return or_(*clauses) if clauses else false()


#: The card at the far end of a relation, inside the ``EXISTS`` subqueries.
_OTHER = aliased(Card, name="portal_other_end")


def _related(*, outgoing: bool, where: Iterable[ColumnElement[bool]]) -> ColumnElement[bool]:
    """``EXISTS`` a relation with the card on one side and an ACTIVE card on
    the other, matching ``where`` (which may name the far end as ``Other``)."""
    near, far = (
        (Relation.source_id, Relation.target_id)
        if outgoing
        else (Relation.target_id, Relation.source_id)
    )
    return exists(
        select(Relation.id)
        .select_from(Relation)
        .join(_OTHER, _OTHER.id == far)
        .where(near == Card.id, _OTHER.status == "ACTIVE", *where)
        .correlate(Card)
    )


def relation_condition(
    key: str,
    ids: Iterable[str],
    *,
    relation_type_keys: Iterable[str],
) -> ColumnElement[bool] | None:
    """A card related to a picked card (``matchesStaticFilters``' relation
    block).

    ``key`` is a relation type (bare: either side; ``__out`` / ``__in``: one
    side of a self-referencing type) when it names one the card type has,
    otherwise a card type — "related to an Organization at all". "(empty)" is
    a card with no such relation.
    """
    real, want_empty = _split(ids)
    picked = uuids(real)
    if not picked and not want_empty:
        return None
    rel_key, is_source = parse_side_key(key)
    if rel_key in set(relation_type_keys):
        kind: list[ColumnElement[bool]] = [Relation.type == rel_key]
        sides = (True, False) if is_source is None else (is_source,)
    else:
        kind = [_OTHER.type == key]
        sides = (True, False)

    clauses: list[ColumnElement[bool]] = []
    if picked:
        clauses.extend(
            _related(outgoing=side, where=[*kind, _OTHER.id.in_(picked)]) for side in sides
        )
    if want_empty:
        clauses.append(and_(*(not_(_related(outgoing=side, where=kind)) for side in sides)))
    return or_(*clauses)


def relation_subtype_condition(
    composite: str,
    values: Iterable[str],
    *,
    relation_type_keys: Iterable[str],
) -> ColumnElement[bool] | None:
    """A card with a relation of the type whose attribute holds a picked value;
    "(empty)" a relation of that type with no value — not a card without the
    relation. ``composite`` is ``<relation type>::<field>``."""
    rel_key, sep, field_key = composite.partition("::")
    if not sep or not field_key or rel_key not in set(relation_type_keys):
        return None
    real, want_empty = _split(values)
    if not real and not want_empty:
        return None
    col = Relation.attributes[field_key]
    value_clauses: list[ColumnElement[bool]] = []
    if real:
        value_clauses.append(col.astext.in_(real))
    if want_empty:
        value_clauses.append(_absent(col))
    where = [Relation.type == rel_key, or_(*value_clauses)]
    return or_(_related(outgoing=True, where=where), _related(outgoing=False, where=where))


def tag_conditions(
    groups: Mapping[uuid.UUID, list[uuid.UUID]], *, card=Card
) -> list[ColumnElement[bool]]:
    """One condition per tag group over ``card`` (``Card`` or an alias): any
    picked tag of the group (OR within a group), every group with a pick
    required (AND across groups)."""
    return [
        card.id.in_(select(CardTag.card_id).where(CardTag.tag_id.in_(tag_ids)))
        for tag_ids in groups.values()
        if tag_ids
    ]


# ---------------------------------------------------------------------------
# The whole preset
# ---------------------------------------------------------------------------


def descendant_cte(roots: Sequence[uuid.UUID]) -> CTE:
    """A recursive CTE whose ``id`` column is every card beneath ``roots``,
    any depth, any status — the roots themselves excluded. Anonymous, so two
    of them can sit in one statement."""
    # UNION, not UNION ALL: a card already reached is not walked again, which
    # is also what stops a parent cycle a bad import might have written.
    tree = select(Card.id).where(Card.parent_id.in_(list(roots))).cte(recursive=True)
    child = aliased(Card)
    return tree.union(select(child.id).where(child.parent_id == tree.c.id))


async def descendant_ids(db: AsyncSession, roots: Iterable[uuid.UUID]) -> set[uuid.UUID]:
    """Every card beneath ``roots``, any depth, any status."""
    root_list = list(roots)
    if not root_list:
        return set()
    rows = await db.execute(select(descendant_cte(root_list).c.id))
    return set(rows.scalars().all())


async def _widen_relation_filters(
    db: AsyncSession, relation_filters: Mapping[str, list[str]]
) -> dict[str, list[str]]:
    """Each pick plus every card beneath it (``expandRelationFilters``), so a
    filter on a parent capability also matches a card linked to a child."""
    out: dict[str, list[str]] = {}
    for key, ids in relation_filters.items():
        real, want_empty = _split(ids)
        roots = uuids(real)
        below = await descendant_ids(db, roots)
        widened = list(dict.fromkeys([*map(str, roots), *sorted(map(str, below))]))
        out[key] = [EMPTY_KEY, *widened] if want_empty else widened
    return out


def field_types(fields_schema: object) -> dict[str, str]:
    """``{field key: field type}`` over a card type's ``fields_schema``; the
    first section declaring a key wins, anything malformed is skipped."""
    out: dict[str, str] = {}
    for section in fields_schema if isinstance(fields_schema, list) else []:
        if not isinstance(section, dict):
            continue
        for f in section.get("fields") or []:
            if isinstance(f, dict) and isinstance(f.get("key"), str):
                out.setdefault(f["key"], str(f.get("type") or ""))
    return out


async def _card_filter_conditions(
    db: AsyncSession, card_type: str, card_filters: Mapping[str, Any]
) -> list[ColumnElement[bool]]:
    conditions: list[ColumnElement[bool] | None] = [
        subtype_condition(card_filters["subtypeFilters"])
    ]

    attr_conditions = card_filters.get("attrConditions") or {}
    if card_filters["attrFilters"] or attr_conditions:
        ct = await db.scalar(select(CardType).where(CardType.key == card_type))
        types = field_types(ct.fields_schema if ct else None)
        conditions.extend(
            attribute_condition(key, vals, types.get(key))
            for key, vals in sorted(card_filters["attrFilters"].items())
        )
        conditions.extend(condition_clauses(attr_conditions, types))

    if card_filters["relationFilters"] or card_filters["relSubtypeFilters"]:
        # Every visible relation type: one that does not touch this card type
        # matches no card whichever branch reads its key, so it needs no
        # filtering out. A hidden type is not in the report's payload either,
        # so a key naming one reads as a card type there; keep it so here.
        rows = await db.execute(select(RelationType.key).where(RelationType.is_hidden.is_(False)))
        rel_keys = set(rows.scalars().all())
        relation_filters = card_filters["relationFilters"]
        if card_filters["includeDescendants"]:
            relation_filters = await _widen_relation_filters(db, relation_filters)
        conditions.extend(
            relation_condition(key, ids, relation_type_keys=rel_keys)
            for key, ids in sorted(relation_filters.items())
        )
        conditions.extend(
            relation_subtype_condition(composite, vals, relation_type_keys=rel_keys)
            for composite, vals in sorted(card_filters["relSubtypeFilters"].items())
        )

    tag_ids = uuids(card_filters["tagFilterIds"])
    if tag_ids:
        tag_rows = await db.execute(
            select(Tag.id, Tag.tag_group_id, TagGroup.restrict_to_types)
            .join(TagGroup)
            .where(Tag.id.in_(tag_ids))
        )
        groups: dict[uuid.UUID, list[uuid.UUID]] = {}
        for tag_id, group_id, restrict in tag_rows.all():
            # A group restricted to other types does not apply to this one —
            # the report never offers or matches it — so its picks are ignored.
            if not restrict or card_type in restrict:
                groups.setdefault(group_id, []).append(tag_id)
        conditions.extend(tag_conditions(groups))

    return [c for c in conditions if c is not None]


def _legacy_conditions(filters: Mapping[str, Any]) -> list[ColumnElement[bool]]:
    """The preset every portal had before ``card_filters``: any of the
    subtypes, any of the tags, a malformed tag list ignored whole."""
    conditions: list[ColumnElement[bool]] = []
    subtypes = filters.get("subtypes")
    if subtypes:
        conditions.append(Card.subtype.in_(subtypes))
    tag_ids = filters.get("tag_ids") or []
    if tag_ids:
        try:
            uuids = [uuid.UUID(str(t)) for t in tag_ids]
        except ValueError:
            return conditions
        conditions.append(Card.id.in_(select(CardTag.card_id).where(CardTag.tag_id.in_(uuids))))
    return conditions


async def preset_conditions(
    db: AsyncSession, card_type: str, filters: object
) -> list[ColumnElement[bool]]:
    """The where-clauses a card-list portal's ``filters`` impose on ``Card``.

    ``card_filters`` when they narrow anything (a portal saved by this
    dialog), the legacy ``subtypes`` / ``tag_ids`` otherwise;
    ``approval_statuses`` in both cases.
    """
    if not isinstance(filters, dict):
        return []
    conditions: list[ColumnElement[bool]] = []
    approval = _strings(filters.get("approval_statuses"))
    if approval:
        conditions.append(Card.approval_status.in_(approval))
    card_filters = normalise_card_filters(filters.get("card_filters"))
    if card_filters is not None and has_active_card_filters(card_filters):
        conditions.extend(await _card_filter_conditions(db, card_type, card_filters))
    else:
        # No card filters, or ones that narrow nothing: the legacy keys (which
        # the dialog never writes beside card filters) are what is left.
        conditions.extend(_legacy_conditions(filters))
    return conditions


# ---------------------------------------------------------------------------
# A visitor's own filters (#1425)
# ---------------------------------------------------------------------------
#
# A visitor of a card-list portal narrows the page with the ``filters`` query
# parameter of ``GET /web-portals/public/{slug}/cards``: a JSON object in the
# ``CardFilterValue`` subset the viewer edits (``cardQueryParams`` in
# ``portalViewerState.ts``). It is parsed (``normalise_visitor_filters``),
# cut to what the portal lets a visitor filter on (``restrict_visitor_filters``
# with ``visitor_filter_lists(...).allowed``) and turned into where-clauses
# ANDed with the preset (``visitor_conditions``) — so a visitor can narrow the
# page, never widen it, and a filter on anything the portal does not publish
# changes nothing, not even ``total``.
#
# The query parameters the viewer sent before (``subtype``, ``tag_ids``,
# ``attr_filters``, ``relation_filters``, ``related_type`` / ``related_id``)
# keep working through ``legacy_visitor_filters``, onto the same builders and
# the same restriction. Tags differ on purpose: ``tagFilterIds`` in
# ``filters`` matches like the reports (any tag of a group, every group with
# a pick — ``tag_conditions``), while the legacy ``tag_ids`` keeps its old
# any-of meaning (``anyTagIds``, which ``filters`` itself never carries).

#: The longest ``filters`` parameter read; a longer one is ignored whole.
VISITOR_FILTERS_MAX_CHARS = 8192

#: The keys of a visitor's filter value.
_VISITOR_KEYS = ("subtypeFilters", "attrFilters", "attrConditions", "relationFilters")


def _empty_visitor_filters() -> dict[str, Any]:
    return {
        "subtypeFilters": [],
        "attrFilters": {},
        "attrConditions": {},
        "relationFilters": {},
        "tagFilterIds": [],
        "anyTagIds": [],
    }


def normalise_visitor_filters(raw: object) -> dict[str, Any]:
    """The ``filters`` parameter (JSON text, or an already parsed object) as
    a visitor's filter value: ``subtypeFilters``, ``attrFilters``,
    ``attrConditions``, ``relationFilters`` and ``tagFilterIds``, anything
    malformed dropped. Text over ``VISITOR_FILTERS_MAX_CHARS``, invalid JSON
    or anything but an object is no filter at all. Relation subtypes and
    *Include sub-cards* are preset-only."""
    out = _empty_visitor_filters()
    if isinstance(raw, str):
        if len(raw) > VISITOR_FILTERS_MAX_CHARS:
            return out
        try:
            raw = json.loads(raw)
        except ValueError:
            return out
    if not isinstance(raw, dict):
        return out
    out["subtypeFilters"] = _strings(raw.get("subtypeFilters"))
    out["attrFilters"] = _string_lists(raw.get("attrFilters"))
    out["attrConditions"] = normalise_attr_conditions(raw.get("attrConditions"))
    out["relationFilters"] = _string_lists(raw.get("relationFilters"))
    out["tagFilterIds"] = _strings(raw.get("tagFilterIds"))
    return out


def restrict_visitor_filters(
    value: Mapping[str, Any], allowed: Iterable[str], field_types: Mapping[str, str]
) -> dict[str, Any]:
    """``value`` without every filter outside ``allowed`` (toggle keys:
    ``subtype``, ``tags``, ``field:<key>``, ``rel:<key>``) — and, defensively,
    without any field the public schema types ``cost`` or does not know."""
    keys = set(allowed)

    def field_ok(key: str) -> bool:
        ftype = field_types.get(key)
        return f"field:{key}" in keys and ftype is not None and ftype != "cost"

    tags = "tags" in keys
    return {
        "subtypeFilters": list(value.get("subtypeFilters") or []) if "subtype" in keys else [],
        "attrFilters": {k: v for k, v in (value.get("attrFilters") or {}).items() if field_ok(k)},
        "attrConditions": {
            k: v for k, v in (value.get("attrConditions") or {}).items() if field_ok(k)
        },
        "relationFilters": {
            k: v for k, v in (value.get("relationFilters") or {}).items() if f"rel:{k}" in keys
        },
        "tagFilterIds": list(value.get("tagFilterIds") or []) if tags else [],
        "anyTagIds": list(value.get("anyTagIds") or []) if tags else [],
    }


def _json_object(raw: str | None) -> dict:
    if not raw or len(raw) > VISITOR_FILTERS_MAX_CHARS:
        return {}
    try:
        parsed = json.loads(raw)
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _legacy_value(value: object) -> str | None:
    """One legacy filter value as the option key it names: a string as is, a
    JSON boolean as ``"true"`` / ``"false"`` (a facet's keys), a number as its
    text; anything else (a list, an object, null, ``""``) names nothing."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return value if isinstance(value, str) and value else None


def legacy_visitor_filters(
    *,
    subtype: str | None = None,
    tag_ids: str | None = None,
    attr_filters: str | None = None,
    relation_filters: str | None = None,
    related_type: str | None = None,
    related_id: str | None = None,
) -> dict[str, Any]:
    """The query parameters the viewer sent before ``filters``, as a visitor's
    filter value: each single value becomes a one-value list, so a
    ``multiple_select`` now matches a card holding the value among others.
    Malformed JSON, a malformed id or an unusable value is ignored, never an
    error. ``tag_ids`` keeps its any-of meaning (``anyTagIds``);
    ``related_type`` / ``related_id`` join ``relation_filters`` (a pick on the
    same relation type matches either card)."""
    out = _empty_visitor_filters()
    if subtype:
        out["subtypeFilters"] = [subtype]
    if tag_ids:
        out["anyTagIds"] = [str(t) for t in uuids(t.strip() for t in tag_ids.split(","))]
    for key, value in _json_object(attr_filters).items():
        picked = _legacy_value(value)
        if isinstance(key, str) and picked is not None:
            out["attrFilters"][key] = [picked]
    relations: dict[str, list[str]] = {}
    pairs = list(_json_object(relation_filters).items())
    if related_type and related_id:
        pairs.append((related_type, related_id))
    for key, value in pairs:
        ids = uuids([value] if isinstance(value, str) else [])
        if isinstance(key, str) and ids:
            bucket = relations.setdefault(key, [])
            if str(ids[0]) not in bucket:
                bucket.append(str(ids[0]))
    out["relationFilters"] = relations
    return out


def has_visitor_filters(value: Mapping[str, Any]) -> bool:
    """Does a visitor's value narrow anything?"""
    return any(value.get(key) for key in (*_VISITOR_KEYS, "tagFilterIds", "anyTagIds"))


async def visitor_conditions(
    db: AsyncSession, card_type: str, value: Mapping[str, Any]
) -> list[ColumnElement[bool]]:
    """The where-clauses a visitor's (restricted) value adds to the preset,
    built with the preset's own builders. Call it on a value that went through
    ``restrict_visitor_filters``: a relation key is then a relation type the
    page shows, never read as a card type."""
    if not has_visitor_filters(value):
        return []
    conditions = await _card_filter_conditions(
        db,
        card_type,
        {
            "subtypeFilters": list(value.get("subtypeFilters") or []),
            "attrFilters": dict(value.get("attrFilters") or {}),
            "attrConditions": dict(value.get("attrConditions") or {}),
            "relationFilters": dict(value.get("relationFilters") or {}),
            "relSubtypeFilters": {},
            "tagFilterIds": list(value.get("tagFilterIds") or []),
            "includeDescendants": False,
        },
    )
    any_tags = uuids(value.get("anyTagIds") or [])
    if any_tags:
        conditions.append(Card.id.in_(select(CardTag.card_id).where(CardTag.tag_id.in_(any_tags))))
    return conditions


async def public_visitor_conditions(
    db: AsyncSession,
    card_type: str,
    *,
    allowed: Iterable[str],
    field_types: Mapping[str, str],
    filters: str | None,
    legacy: Mapping[str, str | None],
) -> list[ColumnElement[bool]]:
    """Every where-clause a visitor's query adds to a card-list portal: the
    ``filters`` parameter and the legacy parameters (``legacy``, the keyword
    arguments of ``legacy_visitor_filters``), each restricted to ``allowed``.
    When both are sent, both apply (AND): a legacy parameter can only narrow
    what ``filters`` already narrowed, never undo it."""
    allowed = list(allowed)
    conditions: list[ColumnElement[bool]] = []
    for value in (normalise_visitor_filters(filters), legacy_visitor_filters(**legacy)):
        restricted = restrict_visitor_filters(value, allowed, field_types)
        conditions.extend(await visitor_conditions(db, card_type, restricted))
    return conditions
