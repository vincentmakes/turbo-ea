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

import uuid
from collections.abc import Iterable, Mapping
from typing import Any

from sqlalchemy import ColumnElement, Text, and_, exists, false, func, not_, or_, select
from sqlalchemy.dialects.postgresql import array
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.tag import CardTag, Tag, TagGroup

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


def normalise_card_filters(raw: object) -> dict[str, Any] | None:
    """``raw`` in the ``CardFilterValue`` shape, anything malformed dropped —
    the Python twin of ``restoreCardFilters`` (``cardFilters.ts``). ``None``
    when ``raw`` is not an object at all."""
    if not isinstance(raw, dict):
        return None
    return {
        "subtypeFilters": _strings(raw.get("subtypeFilters")),
        "attrFilters": _string_lists(raw.get("attrFilters")),
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


def subtype_condition(values: Iterable[str]) -> ColumnElement[bool] | None:
    """A card whose subtype is picked; "(empty)" a card with none."""
    real, want_empty = _split(values)
    if not real and not want_empty:
        return None
    clauses: list[ColumnElement[bool]] = []
    if real:
        clauses.append(Card.subtype.in_(real))
    if want_empty:
        clauses.append(or_(Card.subtype.is_(None), Card.subtype == ""))
    return or_(*clauses)


def _absent(col) -> ColumnElement[bool]:
    """No value: the key absent, JSON null, ``""`` or an empty list — written
    as its own positive test (``card_flags._jsonb_absent``), never a negation,
    since ``NOT NULL`` drops exactly the rows "(empty)" exists to find."""
    return or_(col.astext.is_(None), col.astext == "", col.astext == "[]")


def attribute_condition(
    key: str, values: Iterable[str], field_type: str | None
) -> ColumnElement[bool] | None:
    """A card whose ``attributes[key]`` holds a picked value (``matchesFacet``).

    A select holds its option key as a string, or a list of them for a
    ``multiple_select``; JSONB ``?|`` matches either. A boolean reads the
    legacy ``"yes"`` / ``"no"`` strings too. A key that is not a facet field is
    a plain string comparison, as in the matcher's fallback.
    """
    real, want_empty = _split(values)
    if not real and not want_empty:
        return None
    col = Card.attributes[key]
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


def tag_conditions(groups: Mapping[uuid.UUID, list[uuid.UUID]]) -> list[ColumnElement[bool]]:
    """One condition per tag group: any picked tag of the group (OR within a
    group), every group with a pick required (AND across groups)."""
    return [
        Card.id.in_(select(CardTag.card_id).where(CardTag.tag_id.in_(tag_ids)))
        for tag_ids in groups.values()
        if tag_ids
    ]


# ---------------------------------------------------------------------------
# The whole preset
# ---------------------------------------------------------------------------


async def descendant_ids(db: AsyncSession, roots: Iterable[uuid.UUID]) -> set[uuid.UUID]:
    """Every card beneath ``roots``, any depth, any status."""
    root_list = list(roots)
    if not root_list:
        return set()
    # UNION, not UNION ALL: a card already reached is not walked again, which
    # is also what stops a parent cycle a bad import might have written.
    tree = select(Card.id).where(Card.parent_id.in_(root_list)).cte(recursive=True)
    child = aliased(Card)
    tree = tree.union(select(child.id).where(child.parent_id == tree.c.id))
    rows = await db.execute(select(tree.c.id))
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


def _field_types(fields_schema: object) -> dict[str, str]:
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

    if card_filters["attrFilters"]:
        ct = await db.scalar(select(CardType).where(CardType.key == card_type))
        types = _field_types(ct.fields_schema if ct else None)
        conditions.extend(
            attribute_condition(key, vals, types.get(key))
            for key, vals in sorted(card_filters["attrFilters"].items())
        )

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
