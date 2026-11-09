"""Multi-hop card queries: "Organizations that *use* an Application whose
lifecycle is Active, which *is affected by* an Initiative on track".

A ``CardQuery`` names a start card type, an optional condition on the start
card, and a tree of **hops** — each a relation type (one side of it), the card
type at the far end, a condition on that far card and further hops from it.
The grammar holds metamodel **keys** (card type, relation type, field, option
keys) and two kinds of id, each in one place only: **tag ids** under
``where.tags`` and **card ids** under ``where.cards``. A query stored on a
saved inventory view (``bookmarks.query``) therefore survives a workspace
transfer: its keys verbatim, its tag and card ids through the transfer's id
maps (``workspace_io.remap.rewrite_card_query_ids``). It is authored through the
MCP server or the inventory's query builder and evaluated here on every
read — ``GET /cards?query=`` and the bookmark OData feed — so a saved view
stays dynamic.

Semantics, decided once here and nowhere else:

- A hop is ``EXISTS`` (any related card matching), ``negate`` is ``NOT
  EXISTS``; sibling hops in ``related`` are AND. ``related_any`` holds OR
  branches: at least one of its hops must hold, beside every hop in
  ``related`` — ``h1 AND h2 AND (h3 OR h4)``. ``negate`` stays per hop, inside
  ``related_any`` too; an OR of fewer than two hops is refused
  (``or_needs_two``). One OR group per card: ``(A OR B) AND (C OR D)`` under
  the same card is not expressible.
- The related card at a hop must be ACTIVE, of the hop's card type (which
  ``resolve_card_query`` has checked is visible, i.e. not ``is_hidden``), and
  **readable by the caller in inventory mode** (``CardReadScope``). Inventory
  mode is deliberate: the result is an inventory list, gated on the inventory,
  and a module-mode reader would otherwise learn through the list that a card
  it cannot browse exists. It is stricter than the dashboards' module mode.
- A card the caller may not read **breaks the chain** at that hop, as the
  dependencies BFS does: the start card matches only through readable middle
  cards, so the result never reveals a hidden card by its effect.
- A self-referencing relation type names its side, ``<key>__out`` (the
  nearer card is the source) or ``<key>__in``; a cross-type one its bare key.
- Lifecycle phases are computed in SQL by ``current_lifecycle_phase_sql``,
  the twin of the Python ``current_lifecycle_phase`` every other surface
  shows; ``none`` is a card in no phase.
- ``where.tags`` lists tag ids, grouped by tag group: any tag of a group (OR
  within a group), every group named required (AND across groups) — the rule
  the inventory's tag facet and the portals apply (``tag_conditions``). A tag
  whose group is restricted to other card types than the node's is refused
  (``tag_not_for_type``); a ``None`` or empty restriction means every type.
  There is no "(empty)" for tags in v1: it would need a tag *group* id, which
  has no transfer map.
- ``where.data_quality_band`` lists bands of the data-quality score
  (``DQ_BAND_BOUNDS``: ``complete`` >= 80, ``partial`` 40 up to, but
  excluding, 80, ``minimal`` < 40; OR among them), the report's and the
  inventory facet's vocabulary. A card never scored holds 0; any other band
  is ``unknown_band``.
- ``where.cards`` pins the node to specific cards (OR among them), each of the
  node's card type. With ``include_descendants`` a pick also covers every card
  beneath it through ``parent_id``, any depth (the reports' "Include
  sub-cards"); the flag needs a hierarchical card type (``has_hierarchy``),
  ``descendants_without_hierarchy`` otherwise. An archived pick is accepted
  and simply matches nothing at a hop, where the related card must be ACTIVE.
- The picks are checked **only when a view is saved** (``resolve_card_query``
  given the writer's ``read_scope``): a pick that names no card, a card of
  another type, or one the writer cannot read is refused with one code,
  ``unknown_card``. The evaluation paths (``GET /cards?query=``, the OData
  feed) resolve without a scope and issue no card query at all: an unknown,
  wrong-type or hidden pick simply matches nothing in SQL, so comparing two
  answers never confirms that a hidden card exists. A reader opening a shared
  view that names a card hidden from them gets the view narrowed by the hop's
  read scope, not a 400.

Grammar (keys only, plus the ids under ``where.tags`` / ``where.cards``)::

    CardQuery = {type, where?, related?: [CardHop], related_any?: [CardHop]}
    CardHop   = {relation, type, where?, negate?, related?: [CardHop],
                 related_any?: [CardHop]}

Limits: at most ``MAX_DEPTH`` (3) hops below the start card (through
``related`` and ``related_any`` alike), ``MAX_HOPS`` (10) hops in one
``related`` or one ``related_any`` list, ``MAX_TOTAL_HOPS`` (12) hops in the
whole tree, both lists counted, ``MAX_QUERY_CHARS`` (8000) characters of compact JSON, 50 values in
any one condition list (``tags``, ``cards`` and ``data_quality_band``
included). A UUID anywhere but in a ``where.tags`` or ``where.cards`` list is
refused (``query_holds_an_id``), so an id never hides in a key, a subtype or a
field value.

Structural rules (``query_problem``) and metamodel rules
(``resolve_card_query``) are plain functions answering a 400 code, so the
routes answer 400 rather than 422 and the rules carry a mutation score.

Reads only; never commits.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Collection, Mapping
from dataclasses import dataclass, field
from datetime import date
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import not_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation_type import RelationType
from app.models.tag import Tag, TagGroup
from app.services.card_read_scope import CardReadScope
from app.services.dashboard_query import (
    DashboardQueryError,
    RelationSide,
    find_field,
    relation_exists,
    resolve_side,
)
from app.services.dashboard_service import contains_uuid
from app.services.data_quality_bands import DQ_BAND_BOUNDS, dq_band_condition
from app.services.lifecycle import PHASE_CHRONOLOGICAL, current_lifecycle_phase_sql
from app.services.portal_card_filters import (
    EMPTY_KEY,
    attribute_condition,
    descendant_cte,
    field_types,
    subtype_condition,
    tag_conditions,
    uuids,
)

#: The longest query accepted, as compact JSON (``GET /cards?query=`` answers
#: an over-long one 400 ``query_too_long`` here, not 422 at the parameter).
MAX_QUERY_CHARS = 8000
#: Hops below the start card, at most.
MAX_DEPTH = 3
#: Hops in one ``related`` (or one ``related_any``) list, at most.
MAX_HOPS = 10
#: Hops in the whole tree (siblings and nested, ``related`` and
#: ``related_any`` alike), at most — each is one correlated ``EXISTS``.
MAX_TOTAL_HOPS = 12
#: The lifecycle "phase" of a card with no phase.
NO_PHASE = "none"
LIFECYCLE_PHASES: tuple[str, ...] = (*PHASE_CHRONOLOGICAL, NO_PHASE)
#: The field types whose values are option keys.
_SELECT_TYPES = ("single_select", "multiple_select")
#: The facet keys of a boolean field.
_BOOLEAN_VALUES = ("true", "false")

_KEY_CHARS = 200
_MAX_VALUES = 50
#: One value in a condition list: a key, or a text field's exact value.
_Value = Annotated[str, Field(max_length=_KEY_CHARS)]


class CardWhere(BaseModel):
    """A condition on one card. Each list is OR within itself; the keys AND.

    ``tags`` holds tag ids — OR within a tag group, AND across groups.
    ``cards`` holds card ids of the node's type; ``include_descendants`` widens
    each to the cards beneath it."""

    model_config = ConfigDict(extra="forbid")

    lifecycle_phase: list[_Value] | None = Field(None, max_length=_MAX_VALUES)
    subtype: list[_Value] | None = Field(None, max_length=_MAX_VALUES)
    approval_status: list[_Value] | None = Field(None, max_length=_MAX_VALUES)
    data_quality_band: list[_Value] | None = Field(None, max_length=_MAX_VALUES)
    attributes: dict[_Value, list[_Value]] | None = Field(None, max_length=20)
    tags: list[_Value] | None = Field(None, max_length=_MAX_VALUES)
    cards: list[_Value] | None = Field(None, max_length=_MAX_VALUES)
    include_descendants: bool = False


class CardHop(BaseModel):
    """A related card: one side of ``relation``, of card type ``type``.

    ``related`` hops from it must all hold; of ``related_any``, at least one."""

    model_config = ConfigDict(extra="forbid")

    relation: str = Field(min_length=1, max_length=_KEY_CHARS)
    type: str = Field(min_length=1, max_length=_KEY_CHARS)
    where: CardWhere | None = None
    negate: bool = False
    related: list[CardHop] | None = Field(None, max_length=MAX_HOPS)
    related_any: list[CardHop] | None = Field(None, max_length=MAX_HOPS)


CardHop.model_rebuild()


class CardQuery(BaseModel):
    """The start card type, its condition and the hops from it: every hop in
    ``related`` and, when given, at least one in ``related_any``."""

    model_config = ConfigDict(extra="forbid")

    type: str = Field(min_length=1, max_length=_KEY_CHARS)
    where: CardWhere | None = None
    related: list[CardHop] | None = Field(None, max_length=MAX_HOPS)
    related_any: list[CardHop] | None = Field(None, max_length=MAX_HOPS)


class CardQueryError(ValueError):
    """A query that cannot be answered. ``code`` is the 400 ``detail``."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


# ---------------------------------------------------------------------------
# Parsing and structure
# ---------------------------------------------------------------------------


def parse_card_query(raw: str | Mapping[str, Any]) -> CardQuery:
    """``raw`` — the JSON text of ``GET /cards?query=`` or a stored / posted
    object — as a structurally valid ``CardQuery``.

    Codes: ``query_too_long``, ``invalid_query_json``, ``invalid_query`` (the
    shape) and every ``query_problem`` code.
    """
    if isinstance(raw, str):
        if len(raw) > MAX_QUERY_CHARS:
            raise CardQueryError("query_too_long")
        try:
            data = json.loads(raw)
        except ValueError as exc:
            raise CardQueryError("invalid_query_json") from exc
    else:
        data = raw
        if len(json.dumps(data, separators=(",", ":"), default=str)) > MAX_QUERY_CHARS:
            raise CardQueryError("query_too_long")
    try:
        query = CardQuery.model_validate(data)
    except ValidationError as exc:
        raise CardQueryError("invalid_query") from exc
    problem = query_problem(query)
    if problem:
        raise CardQueryError(problem)
    return query


def _children(node: CardQuery | CardHop) -> list[CardHop]:
    """Every hop from ``node``: its ``related`` and its ``related_any``."""
    return [*(node.related or []), *(node.related_any or [])]


def _depth(node: CardQuery | CardHop) -> int:
    return max((1 + _depth(h) for h in _children(node)), default=0)


def _hop_count(node: CardQuery | CardHop) -> int:
    return sum(1 + _hop_count(h) for h in _children(node))


def _nodes(query: CardQuery) -> list[CardQuery | CardHop]:
    """Every node of ``query``: the start card and every hop, both lists."""
    out: list[CardQuery | CardHop] = []
    pending: list[CardQuery | CardHop] = [query]
    while pending:
        node = pending.pop()
        out.append(node)
        pending.extend(_children(node))
    return out


def _wheres(query: CardQuery) -> list[CardWhere]:
    return [node.where for node in _nodes(query) if node.where is not None]


def names_cards(query: CardQuery) -> bool:
    """Whether any node of ``query`` pins cards (``where.cards``)."""
    return any(where.cards for where in _wheres(query))


def stored_card_ids(stored: Any) -> set[uuid.UUID]:
    """Every card id under ``where.cards`` at any node of a *stored* query
    (``bookmarks.query``), read tolerantly: a malformed node or value is
    skipped, never an error — the stored query may predate a rule."""
    out: set[uuid.UUID] = set()
    pending = [stored]
    while pending:
        node = pending.pop()
        if not isinstance(node, Mapping):
            continue
        where = node.get("where")
        cards = where.get("cards") if isinstance(where, Mapping) else None
        if isinstance(cards, list):
            out.update(uuids(cards))
        for key in ("related", "related_any"):
            hops = node.get(key)
            if isinstance(hops, list):
                pending.extend(hops)
    return out


def _where_problem(where: CardWhere) -> str | None:
    lists = [where.lifecycle_phase, where.subtype, where.approval_status, where.tags]
    lists.extend((where.cards, where.data_quality_band))
    lists.extend((where.attributes or {}).values())
    if any(values is not None and not values for values in lists):
        return "empty_values"
    if where.include_descendants and where.cards is None:
        return "descendants_without_cards"
    if any(p not in LIFECYCLE_PHASES for p in where.lifecycle_phase or []):
        return "unknown_phase"
    if any(b not in DQ_BAND_BOUNDS for b in where.data_quality_band or []):
        return "unknown_band"
    return None


#: The ``where`` keys whose values are ids: the grammar's only legitimate UUIDs.
_ID_KEYS = ("tags", "cards")


def _without_ids(node: Mapping[str, Any]) -> dict[str, Any]:
    """A dumped query node with every ``where.tags`` and ``where.cards``
    removed, at every depth — the grammar's only legitimate UUIDs."""
    out = dict(node)
    where = out.get("where")
    if isinstance(where, Mapping):
        out["where"] = {k: v for k, v in where.items() if k not in _ID_KEYS}
    for key in ("related", "related_any"):
        hops = out.get(key)
        if isinstance(hops, list):
            out[key] = [_without_ids(h) for h in hops]
    return out


def query_problem(query: CardQuery) -> str | None:
    """A structural problem with ``query``, as a 400 code, or ``None``.

    ``too_deep`` past ``MAX_DEPTH`` hops; ``too_many_hops`` past
    ``MAX_TOTAL_HOPS`` hops in the whole tree (both lists counted);
    ``or_needs_two`` for a ``related_any`` of fewer than two hops (an OR of
    one is an AND hop in disguise, of none a condition that can never hold);
    ``query_holds_an_id`` for a UUID
    anywhere but a ``where.tags`` or ``where.cards`` list (only those ids have
    a transfer map); ``empty_values`` for an empty value list (a condition
    that can match nothing is a mistake, not a filter);
    ``descendants_without_cards`` for ``include_descendants`` with no
    ``cards``; ``unknown_phase`` for a lifecycle phase outside
    ``LIFECYCLE_PHASES``; ``unknown_band`` for a data-quality band outside
    ``DQ_BAND_BOUNDS``.
    """
    if _depth(query) > MAX_DEPTH:
        return "too_deep"
    if _hop_count(query) > MAX_TOTAL_HOPS:
        return "too_many_hops"
    if any(n.related_any is not None and len(n.related_any) < 2 for n in _nodes(query)):
        return "or_needs_two"
    if contains_uuid(_without_ids(query.model_dump())):
        return "query_holds_an_id"
    for where in _wheres(query):
        problem = _where_problem(where)
        if problem:
            return problem
    return None


# ---------------------------------------------------------------------------
# The metamodel
# ---------------------------------------------------------------------------


@dataclass
class ResolvedNode:
    """A card in the query, checked against the metamodel."""

    type: str
    where: CardWhere | None
    field_types: dict[str, str]
    #: ``related``: every one must hold.
    hops: list[ResolvedHop] = field(default_factory=list)
    #: ``related_any``: at least one must hold (none given: no condition).
    any_hops: list[ResolvedHop] = field(default_factory=list)
    #: ``where.tags`` as ``{tag group id: [tag id, ...]}``.
    tag_groups: dict[uuid.UUID, list[uuid.UUID]] = field(default_factory=dict)
    #: ``where.cards`` as parsed ids, deduplicated in order.
    card_ids: list[uuid.UUID] = field(default_factory=list)
    #: ``where.include_descendants``.
    include_descendants: bool = False


@dataclass
class ResolvedHop:
    side: RelationSide
    negate: bool
    node: ResolvedNode


def _other_end(rel: RelationType, side: RelationSide) -> str:
    """The card type at the far end of ``side``."""
    return rel.target_type_key if side.card_is_source else rel.source_type_key


def _check_where(where: CardWhere | None, card_type: Any) -> dict[str, str]:
    """``where`` against ``card_type``; its ``{field key: field type}``."""
    types = field_types(card_type.fields_schema)
    if where is None:
        return types
    if where.subtype:
        known = {s.get("key") for s in card_type.subtypes or [] if isinstance(s, dict)}
        if any(v != EMPTY_KEY and v not in known for v in where.subtype):
            raise CardQueryError("unknown_subtype")
    for key, values in (where.attributes or {}).items():
        if key not in types:
            raise CardQueryError("unknown_field")
        real = [v for v in values if v != EMPTY_KEY]
        if types[key] == "boolean":
            allowed: set[Any] | None = set(_BOOLEAN_VALUES)
        elif types[key] in _SELECT_TYPES:
            fdef = find_field(card_type.fields_schema, key) or {}
            allowed = {o.get("key") for o in fdef.get("options") or [] if isinstance(o, dict)}
        else:
            allowed = None
        if allowed is not None and any(v not in allowed for v in real):
            raise CardQueryError("unknown_option")
    return types


#: A tag as ``resolve_card_query`` loads it: ``(tag group id, the group's
#: ``restrict_to_types``)``.
_TagInfo = tuple[uuid.UUID, Any]


def _tag_groups(
    where: CardWhere | None, type_key: str, tags: Mapping[uuid.UUID, _TagInfo]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """``where.tags`` as ``{tag group id: [tag id, ...]}``.

    ``unknown_tag`` for a value that is not a UUID or names no tag;
    ``tag_not_for_type`` for a tag whose group is restricted to card types
    other than ``type_key`` (a ``None`` or empty restriction is every type)."""
    groups: dict[uuid.UUID, list[uuid.UUID]] = {}
    for value in (where.tags if where is not None else None) or []:
        parsed = uuids([value])
        info = tags.get(parsed[0]) if parsed else None
        if info is None:
            raise CardQueryError("unknown_tag")
        group_id, restrict = info
        if restrict and type_key not in restrict:
            raise CardQueryError("tag_not_for_type")
        picked = groups.setdefault(group_id, [])
        if parsed[0] not in picked:
            picked.append(parsed[0])
    return groups


@dataclass(frozen=True)
class _CardCheck:
    """What the write paths check the picks against: ``cards`` the picked
    cards as ``{id: type key}``, ``read_scope`` the writer's, and
    ``trusted`` the ids exempt from the scope check (the picks a shared view
    already held when a collaborator edits it)."""

    cards: Mapping[uuid.UUID, str]
    read_scope: CardReadScope
    trusted: frozenset[uuid.UUID]


def _pick_readable(card_id: uuid.UUID, type_key: str, check: _CardCheck) -> bool:
    """Whether the writer's scope reads the pick ``card_id`` (of ``type_key``)
    in inventory mode — the mode of the inventory the view opens on
    (``test_a_pick_needs_inventory_not_module_reading``)."""
    # pragma: no mutate block, CardReadScope reads every mode but "module" as inventory
    return check.read_scope.readable(card_id, type_key, mode="inventory")


def _card_ids(where: CardWhere | None, type_key: str, check: _CardCheck | None) -> list[uuid.UUID]:
    """``where.cards`` as ids, deduplicated in order.

    Without ``check`` (the evaluation paths) nothing is checked: a value that
    is no UUID is left out, and an id naming no card, a card of another type
    or a hidden one is kept and matches nothing in SQL.

    With ``check``: ``unknown_card`` for a value that is not a UUID, names no
    card, names a card of another type than ``type_key``, or names a card the
    writer's scope cannot read in inventory mode (unless it is ``trusted``).
    One code for all four, so the answer never confirms a hidden card
    exists."""
    out: list[uuid.UUID] = []
    for value in (where.cards if where is not None else None) or []:
        parsed = uuids([value])
        card_id = parsed[0] if parsed else None
        if check is not None:
            if card_id is None or check.cards.get(card_id) != type_key:
                raise CardQueryError("unknown_card")
            if card_id not in check.trusted and not _pick_readable(card_id, type_key, check):
                raise CardQueryError("unknown_card")
        if card_id is not None and card_id not in out:
            out.append(card_id)
    return out


def _resolve_hops(
    type_key: str,
    hops: list[CardHop] | None,
    types: Mapping[str, Any],
    relation_types: Mapping[str, Any],
    tags: Mapping[uuid.UUID, _TagInfo],
    check: _CardCheck | None,
) -> list[ResolvedHop]:
    """The hops ``hops`` from a card of ``type_key``, each resolved."""
    out: list[ResolvedHop] = []
    for hop in hops or []:
        try:
            side = resolve_side(
                hop.relation, type_key, relation_types, bad_suffix="unknown_relation_type"
            )
        except DashboardQueryError as exc:
            raise CardQueryError(exc.code) from exc
        if _other_end(relation_types[side.relation_type], side) != hop.type:
            raise CardQueryError("hop_type_mismatch")
        child = _resolve_node(hop, types, relation_types, tags, check)
        out.append(ResolvedHop(side, hop.negate, child))
    return out


def _resolve_node(
    spec: CardQuery | CardHop,
    types: Mapping[str, Any],
    relation_types: Mapping[str, Any],
    tags: Mapping[uuid.UUID, _TagInfo],
    check: _CardCheck | None,
) -> ResolvedNode:
    """The start card or a hop's far card ``spec``, with every hop from it."""
    type_key, where = spec.type, spec.where
    card_type = types.get(type_key)
    if card_type is None or card_type.is_hidden:
        raise CardQueryError("unknown_card_type")
    node = ResolvedNode(type_key, where, _check_where(where, card_type))
    node.include_descendants = where is not None and where.include_descendants
    if node.include_descendants and not card_type.has_hierarchy:
        raise CardQueryError("descendants_without_hierarchy")
    node.tag_groups = _tag_groups(where, type_key, tags)
    node.card_ids = _card_ids(where, type_key, check)
    node.hops = _resolve_hops(type_key, spec.related, types, relation_types, tags, check)
    node.any_hops = _resolve_hops(type_key, spec.related_any, types, relation_types, tags, check)
    return node


async def _load_tags(db: AsyncSession, tag_ids: list[uuid.UUID]) -> dict[uuid.UUID, _TagInfo]:
    """The tags ``tag_ids`` as ``{id: _TagInfo}``; no query for none."""
    if not tag_ids:
        return {}
    rows = await db.execute(
        select(Tag.id, Tag.tag_group_id, TagGroup.restrict_to_types)
        .join(TagGroup)
        .where(Tag.id.in_(tag_ids))
    )
    return {tag_id: (group_id, restrict) for tag_id, group_id, restrict in rows.all()}


async def _load_card_types(db: AsyncSession, card_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    """The cards ``card_ids`` (any status) as ``{id: type key}``; no query for none."""
    if not card_ids:
        return {}
    rows = await db.execute(select(Card.id, Card.type).where(Card.id.in_(card_ids)))
    return {card_id: type_key for card_id, type_key in rows.all()}


async def resolve_card_query(
    db: AsyncSession,
    query: CardQuery,
    *,
    read_scope: CardReadScope | None = None,
    trusted_card_ids: Collection[uuid.UUID] = (),
) -> ResolvedNode:
    """``query`` checked against the metamodel, as the tree ``compile`` walks.

    Codes: ``unknown_card_type`` (missing or hidden, at the start or a hop),
    ``unknown_relation_type`` (missing, hidden, not touching the nearer card's
    type, or a side suffix on a cross-type relation), ``relation_side_required``
    (a bare key on a self-referencing type), ``hop_type_mismatch`` (the hop's
    type is not at the relation's far end), ``unknown_subtype``,
    ``unknown_field``, ``unknown_option``, ``unknown_tag`` and
    ``tag_not_for_type`` (see ``_tag_groups``), ``descendants_without_hierarchy``
    (``include_descendants`` on a card type without ``has_hierarchy``),
    ``unknown_card`` (see ``_card_ids``; write paths only).

    ``read_scope`` is the *writer's* scope, given only when a view is saved:
    then, and only then, the picks are checked — each must exist, be of its
    node's type and be readable by the writer (``unknown_card`` otherwise), so
    nobody pins a card hidden from them. ``trusted_card_ids`` are exempt from
    the *scope* check alone (existence and type still hold): the picks a
    shared view already held, so a collaborator who cannot read the owner's
    pick can still edit the view around it. The evaluation paths resolve
    without a scope and run no card query at all — an unknown, wrong-type or
    hidden pick matches nothing in SQL — so no answer is an existence oracle.

    The tags the whole tree names are loaded in one query, the picked cards
    (write paths only) in another (any status: an archived pick is allowed),
    and neither is issued for a query naming none.

    ``query`` comes from ``parse_card_query``, the one place the structural
    rules (``query_problem``) run; they are not checked again here.
    """
    types = {t.key: t for t in (await db.execute(select(CardType))).scalars().all()}
    relation_types = {rt.key: rt for rt in (await db.execute(select(RelationType))).scalars().all()}
    tags = await _load_tags(db, uuids(v for where in _wheres(query) for v in where.tags or []))
    check = None
    if read_scope is not None:
        card_ids = uuids(v for where in _wheres(query) for v in where.cards or [])
        cards = await _load_card_types(db, card_ids)
        check = _CardCheck(cards, read_scope, frozenset(trusted_card_ids))
    return _resolve_node(query, types, relation_types, tags, check)


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------


def where_conditions(card: Any, node: ResolvedNode, *, today: date | None = None) -> list[Any]:
    """``node.where`` as conditions over ``card`` (``Card`` or an alias)."""
    where = node.where
    if where is None:
        return []
    clauses: list[Any] = []
    if where.lifecycle_phase:
        phase = current_lifecycle_phase_sql(card, today=today)
        real = [p for p in where.lifecycle_phase if p != NO_PHASE]
        options: list[Any] = []
        if real:
            options.append(phase.in_(real))
        if NO_PHASE in where.lifecycle_phase:
            options.append(phase.is_(None))
        clauses.append(or_(*options))
    if where.subtype:
        clauses.append(subtype_condition(where.subtype, card=card))
    if where.approval_status:
        clauses.append(card.approval_status.in_(where.approval_status))
    if where.data_quality_band:
        clauses.append(dq_band_condition(where.data_quality_band, card=card))
    for key, values in sorted((where.attributes or {}).items()):
        clauses.append(attribute_condition(key, values, node.field_types.get(key), card=card))
    if where.cards is not None:
        # ``where.cards``, not ``node.card_ids``: on the evaluation path a pick
        # that is no UUID is left out of the ids, and a list left empty must
        # still match nothing rather than drop the condition.
        picked = card.id.in_(node.card_ids)
        if node.include_descendants and node.card_ids:
            below = descendant_cte(node.card_ids)
            picked = or_(picked, card.id.in_(select(below.c.id)))
        clauses.append(picked)
    clauses.extend(tag_conditions(node.tag_groups, card=card))
    return clauses


def _inventory_scope(read_scope: CardReadScope, card: Any) -> tuple[Any, ...]:
    """``read_scope`` over a hop's far card ``card`` in inventory mode — the
    mode of the inventory the query filters
    (``test_a_hop_needs_inventory_not_module_reading``)."""
    # pragma: no mutate block, CardReadScope reads every mode but "module" as inventory
    return read_scope.where(card, mode="inventory")


def _hop_condition(
    near: Any, hop: ResolvedHop, read_scope: CardReadScope, today: date | None
) -> Any:
    """``EXISTS`` (``NOT EXISTS`` when negated) a relation on ``hop.side``
    from ``near`` to a live, readable card matching the hop — a fresh alias
    per hop, correlated to the nearer card."""
    other = aliased(Card)
    condition = relation_exists(
        near,
        hop.side,
        other,
        other.type == hop.node.type,
        other.status == "ACTIVE",
        *_inventory_scope(read_scope, other),
        *_node_conditions(other, hop.node, read_scope, today),
    )
    return not_(condition) if hop.negate else condition


def _node_conditions(
    card: Any, node: ResolvedNode, read_scope: CardReadScope, today: date | None
) -> list[Any]:
    """``node``'s own condition, one ``EXISTS`` per ``hops`` entry and, when
    ``any_hops`` is given, one ``OR`` over theirs."""
    clauses = [
        *where_conditions(card, node, today=today),
        *(_hop_condition(card, hop, read_scope, today) for hop in node.hops),
    ]
    if node.any_hops:
        clauses.append(or_(*(_hop_condition(card, h, read_scope, today) for h in node.any_hops)))
    return clauses


async def compile_card_query(
    db: AsyncSession,
    query: CardQuery,
    read_scope: CardReadScope,
    card: Any = Card,
    *,
    today: date | None = None,
) -> list[Any]:
    """The conditions ``query`` (as ``parse_card_query`` returned it, so its
    structure is not re-checked) puts on ``card`` — its type, its condition
    and one ``EXISTS`` per hop — to splat into ``.where(*...)``. The caller
    adds the start card's own status, hidden-type and read-scope rules, as
    every card list already does. Raises ``CardQueryError`` (see
    ``resolve_card_query``)."""
    root = await resolve_card_query(db, query)
    return [card.type == root.type, *_node_conditions(card, root, read_scope, today)]


# ---------------------------------------------------------------------------
# Saved views
# ---------------------------------------------------------------------------


def view_fields_for_query(
    query: CardQuery, card_type: str | None, filters: Mapping[str, Any] | None
) -> tuple[str, dict[str, Any]]:
    """The ``card_type`` and ``filters`` a saved view holding ``query`` stores:
    both pinned to the start type, so the inventory opens on it.

    ``query_type_mismatch`` when the view already names another type — a
    ``card_type`` other than the start, or a ``filters.types`` other than
    exactly ``[start]``. Absent values are filled in.
    """
    if card_type is not None and card_type != query.type:
        raise CardQueryError("query_type_mismatch")
    out = dict(filters or {})
    types = out.get("types")
    if types and types != [query.type]:
        raise CardQueryError("query_type_mismatch")
    out["types"] = [query.type]
    return query.type, out


def stored_query(query: CardQuery) -> dict[str, Any]:
    """``query`` as a view stores and returns it: defaults left out."""
    return query.model_dump(exclude_defaults=True)


def base_view_filters(card_type: str) -> dict[str, Any]:
    """The ``filters`` of a view on ``card_type`` with no facet set — the shape
    the demo ``BOOKMARK_DEFS`` spell out."""
    return {
        "types": [card_type],
        "search": "",
        "subtypes": [],
        "lifecyclePhases": [],
        "dataQualityMin": None,
        "approvalStatuses": [],
        "showArchived": False,
        "attributes": {},
        "relations": {},
        "tagIds": [],
    }


def _stored_type(card_type: str | None, filters: Mapping[str, Any] | None) -> str | None:
    """The one card type a stored view is on: its ``card_type``, else a lone
    ``filters.types`` entry; ``None`` for a view on no single type."""
    if card_type:
        return card_type
    types = (filters or {}).get("types")
    return types[0] if isinstance(types, list) and len(types) == 1 else None


def view_patch(
    data: Mapping[str, Any],
    *,
    new_query: CardQuery | None,
    current_query: Mapping[str, Any] | None,
    current_filters: Mapping[str, Any] | None,
    current_card_type: str | None = None,
) -> dict[str, Any]:
    """The fields a PATCH of a saved view sets, ``data`` being the request's
    set fields and ``new_query`` its parsed ``query`` (``None`` when absent or
    ``null``).

    ``query: null`` clears the query and touches nothing else. Otherwise, on a
    view that will hold a query — ``new_query``, else the one stored — the
    ``card_type`` and ``filters.types`` are pinned to the start type on every
    PATCH, so they can never drift from it: values the PATCH sends are checked
    (``query_type_mismatch``). When the PATCH sends no ``filters``, the stored
    ones are kept key by key with only ``types`` rewritten — unless the start
    type moves away from the stored ``card_type``: the stored facets (and the
    ``groupBy`` / ``groupTree`` / ``groupTreeLevel`` grouping axis) belong to
    the old type, so ``filters`` is reset to ``base_view_filters``.
    """
    out = dict(data)
    query = new_query
    # A PATCH that sends ``query`` (``null`` included) never falls back to the
    # stored one, so ``query: null`` reaches the early return below untouched.
    if query is None and "query" not in data and current_query is not None:
        query = parse_card_query(current_query)
    if query is None:
        return out
    if "filters" in data:
        filters = data["filters"]
    elif _stored_type(current_card_type, current_filters) not in (None, query.type):
        filters = base_view_filters(query.type)
    else:
        filters = {k: v for k, v in (current_filters or {}).items() if k != "types"}
    out["card_type"], out["filters"] = view_fields_for_query(query, data.get("card_type"), filters)
    if new_query is not None:
        out["query"] = stored_query(new_query)
    return out
