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
  EXISTS``; sibling hops at one level are AND.
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
- Queries **stack**. ``all_of`` lists two or more complete queries on ONE
  start type, and a card must match every one (AND); ``any_of`` lists two or
  more groups — each a plain query or an ``all_of`` — and a card is listed
  when it matches any group (OR). The groups may start from different card
  types, so one view can list several card types. Lines are combined on the
  start card only: two lines of an ``all_of`` may reach two different middle
  cards (sibling ``related`` hops on one line say "the same card"). Every
  line is evaluated exactly like a plain query, read scope at each hop
  included.
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
- ``where.eol_status`` lists end-of-life statuses (``eol``, ``approaching``,
  ``supported``, ``unknown``; OR among them) plus ``__empty__`` for a card
  with neither an EOL link nor a manual end of life — the inventory's End of
  life column, computed from endoflife.date or a custom EOL product
  (``eol_query``). Any other value is ``unknown_eol_status``; the node's card
  type must track End of Life (``eol_not_tracked``), and evaluating such a
  query or saving a view holding one needs ``eol.view`` (403
  ``eol_view_required``, ``require_eol_view``). Status is never stored, so
  for a condition asking a status the routes read the links' ``(product,
  cycle)`` pairs, release their session, fetch the cycles and compile the
  condition from the per-pair statuses; ``__empty__`` alone is pure SQL.
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

Grammar (keys only; a plain ``CardQuery`` is a query of one line)::

    Query = CardQuery | {all_of: [CardQuery, ...]} | {any_of: [Group, ...]}
    Group = CardQuery | {all_of: [CardQuery, ...]}

``any_of`` nests in nothing and ``all_of`` holds plain queries only (a shape
error, ``invalid_query``); ``all_of`` needs two lines or more
(``all_of_needs_two``) sharing one start type (``all_of_type_mismatch``),
``any_of`` two groups or more (``any_of_needs_two``).

Limits: at most ``MAX_LINES`` (6) lines in a stack (``too_many_lines``),
``MAX_DEPTH`` (3) hops below the start card of each line, ``MAX_HOPS``
(10) sibling hops at one level, ``MAX_TOTAL_HOPS`` (12) hops over all the
lines, ``MAX_QUERY_CHARS`` (8000) characters of compact JSON, 50 values in
any one condition list (``tags``, ``cards``, ``data_quality_band`` and
``eol_status`` included). A UUID anywhere but in a ``where.tags`` or ``where.cards`` list is
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
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import and_, not_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation_type import RelationType
from app.models.tag import Tag, TagGroup
from app.models.user import User
from app.services.card_flags import type_tracks_eol
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
from app.services.eol_custom_service import load_custom_cycles
from app.services.eol_query import (
    EOL_STATUS_VALUES,
    EolPair,
    asks_eol_status,
    eol_condition_types,
    eol_pairs_for_types,
    eol_status_condition,
    has_eol_condition,
    load_eol_pair_statuses,
)
from app.services.lifecycle import PHASE_CHRONOLOGICAL, current_lifecycle_phase_sql
from app.services.permission_service import PermissionService
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
#: Sibling hops at one level, at most.
MAX_HOPS = 10
#: Hops in the whole tree (siblings and nested), at most — each is one
#: correlated ``EXISTS``. Counted over every line of a stack.
MAX_TOTAL_HOPS = 12
#: Lines (complete queries) in an ``all_of`` / ``any_of`` stack, at most.
MAX_LINES = 6
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
    eol_status: list[_Value] | None = Field(None, max_length=_MAX_VALUES)
    attributes: dict[_Value, list[_Value]] | None = Field(None, max_length=20)
    tags: list[_Value] | None = Field(None, max_length=_MAX_VALUES)
    cards: list[_Value] | None = Field(None, max_length=_MAX_VALUES)
    include_descendants: bool = False


class CardHop(BaseModel):
    """A related card: one side of ``relation``, of card type ``type``."""

    model_config = ConfigDict(extra="forbid")

    relation: str = Field(min_length=1, max_length=_KEY_CHARS)
    type: str = Field(min_length=1, max_length=_KEY_CHARS)
    where: CardWhere | None = None
    negate: bool = False
    related: list[CardHop] | None = Field(None, max_length=MAX_HOPS)


CardHop.model_rebuild()


class CardQuery(BaseModel):
    """The start card type, its condition and the hops from it."""

    model_config = ConfigDict(extra="forbid")

    type: str = Field(min_length=1, max_length=_KEY_CHARS)
    where: CardWhere | None = None
    related: list[CardHop] | None = Field(None, max_length=MAX_HOPS)


class CardQueryAll(BaseModel):
    """Complete queries on one start type, AND-ed: a card matches every line."""

    model_config = ConfigDict(extra="forbid")

    all_of: list[CardQuery]


class CardQueryAny(BaseModel):
    """Groups OR-ed: a card is listed when it matches any group."""

    model_config = ConfigDict(extra="forbid")

    any_of: list[CardQuery | CardQueryAll]


#: A query as a view stores it: one line, an AND stack or an OR of groups.
CardQuerySet = CardQuery | CardQueryAll | CardQueryAny

#: The model each top-level key parses as.
_SET_MODELS: tuple[tuple[str, type[BaseModel]], ...] = (
    ("type", CardQuery),
    ("all_of", CardQueryAll),
    ("any_of", CardQueryAny),
)


class CardQueryError(ValueError):
    """A query that cannot be answered. ``code`` is the ``detail`` of the
    answer, ``status`` its HTTP status: 400 for a query to fix, 403 for one
    the caller may not evaluate (``eol_view_required``)."""

    def __init__(self, code: str, *, status: int = 400):
        super().__init__(code)
        self.code = code
        self.status = status


# ---------------------------------------------------------------------------
# Parsing and structure
# ---------------------------------------------------------------------------


def _set_model(data: Any) -> type[BaseModel] | None:
    """The model ``data`` parses as, chosen by its top-level key."""
    if not isinstance(data, Mapping):
        return None
    return next((model for key, model in _SET_MODELS if key in data), None)


def parse_card_query(raw: str | Mapping[str, Any]) -> CardQuerySet:
    """``raw`` — the JSON text of ``GET /cards?query=`` or a stored / posted
    object — as a structurally valid query: a ``CardQuery`` (a ``type`` key),
    a ``CardQueryAll`` (``all_of``) or a ``CardQueryAny`` (``any_of``).

    Codes: ``query_too_long``, ``invalid_query_json``, ``invalid_query`` (the
    shape, a top-level key that is none of the three included) and every
    ``query_problem`` code.
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
    model = _set_model(data)
    if model is None:
        raise CardQueryError("invalid_query")
    try:
        query: CardQuerySet = model.model_validate(data)  # type: ignore[assignment]
    except ValidationError as exc:
        raise CardQueryError("invalid_query") from exc
    problem = query_problem(query)
    if problem:
        raise CardQueryError(problem)
    return query


def _depth(hops: list[CardHop] | None) -> int:
    return max((1 + _depth(h.related) for h in hops or []), default=0)


def _hop_count(hops: list[CardHop] | None) -> int:
    return sum(1 + _hop_count(h.related) for h in hops or [])


def _wheres(query: CardQuery) -> list[CardWhere]:
    out: list[CardWhere] = []
    pending: list[CardQuery | CardHop] = [query]
    while pending:
        node = pending.pop()
        if node.where is not None:
            out.append(node.where)
        pending.extend(node.related or [])
    return out


def query_groups(query: CardQuerySet) -> list[list[CardQuery]]:
    """The OR groups of ``query``, each the list of its AND lines: a plain
    query is one group of one line, an ``all_of`` one group of its lines."""
    if isinstance(query, CardQuery):
        return [[query]]
    if isinstance(query, CardQueryAll):
        return [list(query.all_of)]
    return [[g] if isinstance(g, CardQuery) else list(g.all_of) for g in query.any_of]


def query_lines(query: CardQuerySet) -> list[CardQuery]:
    """Every line of ``query``, in order."""
    return [line for group in query_groups(query) for line in group]


def start_types(query: CardQuerySet) -> list[str]:
    """The start card types of ``query``'s lines, distinct, in order."""
    return list(dict.fromkeys(line.type for line in query_lines(query)))


def _set_wheres(query: CardQuerySet) -> list[CardWhere]:
    return [where for line in query_lines(query) for where in _wheres(line)]


def names_cards(query: CardQuerySet) -> bool:
    """Whether any node of any line of ``query`` pins cards (``where.cards``)."""
    return any(where.cards for where in _set_wheres(query))


#: The keys of a stored query node that hold further nodes: a node's hops,
#: and the lines / groups of a stack.
_NESTED_KEYS = ("related", "all_of", "any_of")


def stored_card_ids(stored: Any) -> set[uuid.UUID]:
    """Every card id under ``where.cards`` at any node of any line of a
    *stored* query (``bookmarks.query``), read tolerantly: a malformed node or
    value is skipped, never an error — the stored query may predate a rule."""
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
        for key in _NESTED_KEYS:
            nested = node.get(key)
            if isinstance(nested, list):
                pending.extend(nested)
    return out


def _where_problem(where: CardWhere) -> str | None:
    lists = [where.lifecycle_phase, where.subtype, where.approval_status, where.tags]
    lists.extend((where.cards, where.data_quality_band, where.eol_status))
    lists.extend((where.attributes or {}).values())
    if any(values is not None and not values for values in lists):
        return "empty_values"
    if where.include_descendants and where.cards is None:
        return "descendants_without_cards"
    if any(p not in LIFECYCLE_PHASES for p in where.lifecycle_phase or []):
        return "unknown_phase"
    if any(b not in DQ_BAND_BOUNDS for b in where.data_quality_band or []):
        return "unknown_band"
    if any(s not in EOL_STATUS_VALUES for s in where.eol_status or []):
        return "unknown_eol_status"
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
    related = out.get("related")
    if isinstance(related, list):
        out["related"] = [_without_ids(h) for h in related]
    return out


def _all_ofs(query: CardQuerySet) -> list[CardQueryAll]:
    """Every ``all_of`` of ``query``: itself, or the groups of its ``any_of``."""
    if isinstance(query, CardQueryAll):
        return [query]
    if isinstance(query, CardQueryAny):
        return [g for g in query.any_of if isinstance(g, CardQueryAll)]
    return []


def _stack_problem(query: CardQuerySet) -> str | None:
    """The problems of a stack as a whole (none for a plain query)."""
    if isinstance(query, CardQueryAny) and len(query.any_of) < 2:
        return "any_of_needs_two"
    if any(len(stack.all_of) < 2 for stack in _all_ofs(query)):
        return "all_of_needs_two"
    if any(len({line.type for line in group}) > 1 for group in query_groups(query)):
        return "all_of_type_mismatch"
    lines = query_lines(query)
    if len(lines) > MAX_LINES:
        return "too_many_lines"
    if sum(_hop_count(line.related) for line in lines) > MAX_TOTAL_HOPS:
        return "too_many_hops"
    return None


def query_problem(query: CardQuerySet) -> str | None:
    """A structural problem with ``query``, as a 400 code, or ``None``.

    For a stack first: ``any_of_needs_two`` for an ``any_of`` of fewer than
    two groups; ``all_of_needs_two`` for an ``all_of`` (at the top or inside
    ``any_of``) of fewer than two lines; ``all_of_type_mismatch`` for an
    ``all_of`` whose lines start from different card types;
    ``too_many_lines`` past ``MAX_LINES`` lines in all; ``too_many_hops``
    past ``MAX_TOTAL_HOPS`` hops over all the lines. Then, on every line in
    order, the rules of a plain query:

    ``too_deep`` past ``MAX_DEPTH`` hops; ``too_many_hops`` past
    ``MAX_TOTAL_HOPS`` hops in the whole tree; ``query_holds_an_id`` for a UUID
    anywhere but a ``where.tags`` or ``where.cards`` list (only those ids have
    a transfer map); ``empty_values`` for an empty value list (a condition
    that can match nothing is a mistake, not a filter);
    ``descendants_without_cards`` for ``include_descendants`` with no
    ``cards``; ``unknown_phase`` for a lifecycle phase outside
    ``LIFECYCLE_PHASES``; ``unknown_band`` for a data-quality band outside
    ``DQ_BAND_BOUNDS``; ``unknown_eol_status`` for an end-of-life status
    outside ``EOL_STATUS_VALUES``.
    """
    problem = _stack_problem(query)
    if problem:
        return problem
    for line in query_lines(query):
        problem = _line_problem(line)
        if problem:
            return problem
    return None


def _line_problem(query: CardQuery) -> str | None:
    """``query_problem`` for one line."""
    if _depth(query.related) > MAX_DEPTH:
        return "too_deep"
    if _hop_count(query.related) > MAX_TOTAL_HOPS:
        return "too_many_hops"
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
    hops: list[ResolvedHop] = field(default_factory=list)
    #: ``where.tags`` as ``{tag group id: [tag id, ...]}``.
    tag_groups: dict[uuid.UUID, list[uuid.UUID]] = field(default_factory=dict)
    #: ``where.cards`` as parsed ids, deduplicated in order.
    card_ids: list[uuid.UUID] = field(default_factory=list)
    #: ``where.include_descendants``.
    include_descendants: bool = False
    #: ``where.eol_status``, deduplicated in order (empty for none).
    eol_status: tuple[str, ...] = ()


@dataclass
class ResolvedHop:
    side: RelationSide
    negate: bool
    node: ResolvedNode


def _other_end(rel: RelationType, side: RelationSide) -> str:
    """The card type at the far end of ``side``."""
    return rel.target_type_key if side.card_is_source else rel.source_type_key


def _check_where(where: CardWhere | None, card_type: Any) -> dict[str, str]:
    """``where`` against ``card_type``; its ``{field key: field type}``.

    ``eol_not_tracked`` for an ``eol_status`` condition on a card type that
    does not track End of Life (``type_tracks_eol``)."""
    types = field_types(card_type.fields_schema)
    if where is None:
        return types
    if where.eol_status and not type_tracks_eol(card_type.key, card_type.section_config):
        raise CardQueryError("eol_not_tracked")
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


def _resolve_node(
    type_key: str,
    where: CardWhere | None,
    hops: list[CardHop] | None,
    types: Mapping[str, Any],
    relation_types: Mapping[str, Any],
    tags: Mapping[uuid.UUID, _TagInfo],
    check: _CardCheck | None,
) -> ResolvedNode:
    card_type = types.get(type_key)
    if card_type is None or card_type.is_hidden:
        raise CardQueryError("unknown_card_type")
    node = ResolvedNode(type_key, where, _check_where(where, card_type))
    node.include_descendants = where is not None and where.include_descendants
    if node.include_descendants and not card_type.has_hierarchy:
        raise CardQueryError("descendants_without_hierarchy")
    node.tag_groups = _tag_groups(where, type_key, tags)
    node.card_ids = _card_ids(where, type_key, check)
    node.eol_status = tuple(dict.fromkeys(where.eol_status or [])) if where is not None else ()
    for hop in hops or []:
        try:
            side = resolve_side(
                hop.relation, type_key, relation_types, bad_suffix="unknown_relation_type"
            )
        except DashboardQueryError as exc:
            raise CardQueryError(exc.code) from exc
        if _other_end(relation_types[side.relation_type], side) != hop.type:
            raise CardQueryError("hop_type_mismatch")
        child = _resolve_node(hop.type, hop.where, hop.related, types, relation_types, tags, check)
        node.hops.append(ResolvedHop(side, hop.negate, child))
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


def resolve_groups(
    query: CardQuerySet,
    types: Mapping[str, Any],
    relation_types: Mapping[str, Any],
    tags: Mapping[uuid.UUID, _TagInfo],
    check: _CardCheck | None = None,
) -> list[list[ResolvedNode]]:
    """Every line of ``query`` resolved against loaded metamodel rows, in the
    shape of ``query_groups`` — the pure core of ``resolve_card_query``."""
    return [
        [
            _resolve_node(line.type, line.where, line.related, types, relation_types, tags, check)
            for line in group
        ]
        for group in query_groups(query)
    ]


async def resolve_card_query(
    db: AsyncSession,
    query: CardQuerySet,
    *,
    read_scope: CardReadScope | None = None,
    trusted_card_ids: Collection[uuid.UUID] = (),
) -> list[list[ResolvedNode]]:
    """``query`` checked against the metamodel, as the trees ``compile`` walks:
    every line's start ``ResolvedNode``, grouped as ``query_groups`` groups
    them (``[[and, ...], ...]``, OR between the groups; a plain query is
    ``[[node]]``). Every line is checked by the rules below, and the first
    failing line answers.

    Codes: ``unknown_card_type`` (missing or hidden, at the start or a hop),
    ``unknown_relation_type`` (missing, hidden, not touching the nearer card's
    type, or a side suffix on a cross-type relation), ``relation_side_required``
    (a bare key on a self-referencing type), ``hop_type_mismatch`` (the hop's
    type is not at the relation's far end), ``unknown_subtype``,
    ``unknown_field``, ``unknown_option``, ``unknown_tag`` and
    ``tag_not_for_type`` (see ``_tag_groups``), ``descendants_without_hierarchy``
    (``include_descendants`` on a card type without ``has_hierarchy``),
    ``unknown_card`` (see ``_card_ids``; write paths only), ``eol_not_tracked``
    (an ``eol_status`` condition on a card type that does not track End of
    Life).

    ``read_scope`` is the *writer's* scope, given only when a view is saved:
    then, and only then, the picks are checked — each must exist, be of its
    node's type and be readable by the writer (``unknown_card`` otherwise), so
    nobody pins a card hidden from them. ``trusted_card_ids`` are exempt from
    the *scope* check alone (existence and type still hold): the picks a
    shared view already held, so a collaborator who cannot read the owner's
    pick can still edit the view around it. The evaluation paths resolve
    without a scope and run no card query at all — an unknown, wrong-type or
    hidden pick matches nothing in SQL — so no answer is an existence oracle.

    The tags every line names are loaded in one query, the picked cards
    (write paths only) in another (any status: an archived pick is allowed),
    for the whole stack, and neither is issued for a query naming none.

    ``query`` comes from ``parse_card_query``, the one place the structural
    rules (``query_problem``) run; they are not checked again here.
    """
    types = {t.key: t for t in (await db.execute(select(CardType))).scalars().all()}
    relation_types = {rt.key: rt for rt in (await db.execute(select(RelationType))).scalars().all()}
    wheres = _set_wheres(query)
    tags = await _load_tags(db, uuids(v for where in wheres for v in where.tags or []))
    check = None
    if read_scope is not None:
        card_ids = uuids(v for where in wheres for v in where.cards or [])
        cards = await _load_card_types(db, card_ids)
        check = _CardCheck(cards, read_scope, frozenset(trusted_card_ids))
    return resolve_groups(query, types, relation_types, tags, check)


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------


#: Each EOL link's status, as ``load_eol_pair_statuses`` prepared it.
PairStatuses = Mapping[EolPair, str]


def where_conditions(
    card: Any,
    node: ResolvedNode,
    *,
    today: date | None = None,
    pair_statuses: PairStatuses | None = None,
) -> list[Any]:
    """``node.where`` as conditions over ``card`` (``Card`` or an alias).

    An ``eol_status`` condition asking a status needs ``pair_statuses``
    (``PreparedCardQuery`` loads them); compiling one without is a
    programming error and raises ``RuntimeError``, never a silently dropped
    condition. One asking only ``__empty__`` is pure SQL and needs none."""
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
    if node.eol_status:
        if pair_statuses is None and asks_eol_status(node.eol_status):
            raise RuntimeError("an eol_status condition needs prepared pair statuses")
        clauses.append(
            eol_status_condition(
                card, node.eol_status, pair_statuses or {}, eol_types=(node.type,), today=today
            )
        )
    return clauses


def _inventory_scope(read_scope: CardReadScope, card: Any) -> tuple[Any, ...]:
    """``read_scope`` over a hop's far card ``card`` in inventory mode — the
    mode of the inventory the query filters
    (``test_a_hop_needs_inventory_not_module_reading``)."""
    # pragma: no mutate block, CardReadScope reads every mode but "module" as inventory
    return read_scope.where(card, mode="inventory")


def _hop_condition(
    near: Any,
    hop: ResolvedHop,
    read_scope: CardReadScope,
    today: date | None,
    pair_statuses: PairStatuses | None,
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
        *_node_conditions(other, hop.node, read_scope, today, pair_statuses),
    )
    return not_(condition) if hop.negate else condition


def _node_conditions(
    card: Any,
    node: ResolvedNode,
    read_scope: CardReadScope,
    today: date | None,
    pair_statuses: PairStatuses | None,
) -> list[Any]:
    return [
        *where_conditions(card, node, today=today, pair_statuses=pair_statuses),
        *(_hop_condition(card, hop, read_scope, today, pair_statuses) for hop in node.hops),
    ]


def _group_condition(
    card: Any,
    group: list[ResolvedNode],
    read_scope: CardReadScope,
    today: date | None,
    pair_statuses: PairStatuses | None,
) -> Any:
    """One AND group over ``card``: the group's start type, then every
    line's condition and hops."""
    return and_(
        card.type == group[0].type,
        *(
            c
            for node in group
            for c in _node_conditions(card, node, read_scope, today, pair_statuses)
        ),
    )


#: The per-node builders ``card_query_matches`` composes into a join along a
#: line, so a node's condition there is the one the list compiles.
inventory_scope = _inventory_scope
hop_condition = _hop_condition
group_condition = _group_condition


def compile_groups(
    groups: list[list[ResolvedNode]],
    read_scope: CardReadScope,
    card: Any = Card,
    *,
    today: date | None = None,
    pair_statuses: PairStatuses | None = None,
) -> list[Any]:
    """``compile_card_query`` over groups ``resolve_card_query`` already
    resolved: no database access."""
    conditions = [
        _group_condition(card, group, read_scope, today, pair_statuses) for group in groups
    ]
    return conditions if len(conditions) == 1 else [or_(*conditions)]


async def compile_card_query(
    db: AsyncSession,
    query: CardQuerySet,
    read_scope: CardReadScope,
    card: Any = Card,
    *,
    today: date | None = None,
    pair_statuses: PairStatuses | None = None,
) -> list[Any]:
    """The conditions ``query`` (as ``parse_card_query`` returned it, so its
    structure is not re-checked) puts on ``card``, to splat into
    ``.where(*...)``: ONE clause, the group's ``AND(type, every line's
    condition and one ``EXISTS`` per hop)`` for a plain query or an
    ``all_of``, an ``OR`` over those groups for an ``any_of``. The caller adds
    the start card's own status, hidden-type and read-scope rules, as every
    card list already does. Raises ``CardQueryError`` (see
    ``resolve_card_query``). A query with an ``eol_status`` condition needs
    ``pair_statuses`` (see ``where_conditions``); the routes go through
    ``prepare_card_query`` instead."""
    groups = await resolve_card_query(db, query)
    return compile_groups(groups, read_scope, card, today=today, pair_statuses=pair_statuses)


@dataclass(frozen=True)
class EolInputs:
    """What a query's ``eol_status`` conditions need from the database, read
    before the route releases its session: the links on the condition's
    card types and the custom products' cycles."""

    pairs: frozenset[EolPair]
    custom_cycles: Mapping[str, list[dict]]


@dataclass(frozen=True)
class PreparedCardQuery:
    """A query resolved for one reader, ready to compile.

    ``eol`` is set when the query asks an end-of-life status other than
    ``__empty__``: compiling it then fetches cycles from endoflife.date, so
    the route commits its session first (``needs_release``) — this object
    never touches it."""

    groups: list[list[ResolvedNode]]
    eol: EolInputs | None = None

    @property
    def needs_release(self) -> bool:
        """Whether ``compile`` makes an outbound call, before which the
        route must hand its database connection back."""
        return self.eol is not None

    async def compile(
        self, read_scope: CardReadScope, card: Any = Card, *, today: date | None = None
    ) -> list[Any]:
        """The query's conditions (``compile_card_query``), the EOL pair
        statuses fetched first when needed. No database access."""
        pair_statuses = await self.pair_statuses()
        return compile_groups(
            self.groups, read_scope, card, today=today, pair_statuses=pair_statuses
        )

    async def pair_statuses(self) -> PairStatuses | None:
        """Each EOL link's status, fetched from endoflife.date (the route has
        released its session first, ``needs_release``); ``None`` when the
        query asks no status. No database access."""
        if self.eol is None:
            return None
        return await load_eol_pair_statuses(self.eol.pairs, self.eol.custom_cycles)


async def require_eol_view(db: AsyncSession, user: User, groups: list[list[ResolvedNode]]) -> None:
    """``CardQueryError`` ``eol_view_required`` (status 403) when any node of
    ``groups`` carries an ``eol_status`` condition — ``__empty__`` alone
    included — and ``user`` lacks ``eol.view``, as the inventory's End of
    life column does. The one check for evaluating such a query
    (``prepare_card_query``) and for saving a view holding one
    (``bookmarks._checked_query``). Never commits."""
    if has_eol_condition(groups) and not await PermissionService.check_permission(
        db, user, "eol.view"
    ):
        raise CardQueryError("eol_view_required", status=403)


async def prepare_card_query(
    db: AsyncSession, user: User, query: CardQuerySet
) -> PreparedCardQuery:
    """``query`` resolved for ``user`` with every database read it needs —
    the route-level step ``GET /cards?query=`` and the OData feed share.

    The routes then commit when ``needs_release`` (outbound HTTP follows) and
    ``compile``. A query with an ``eol_status`` condition needs ``eol.view``
    (``require_eol_view``). Only a condition asking a status other than
    ``__empty__`` reads the links' pairs and the custom cycles; any other
    query reads nothing more than ``resolve_card_query`` and the permission.
    Never commits."""
    groups = await resolve_card_query(db, query)
    await require_eol_view(db, user, groups)
    types = eol_condition_types(groups)
    if not types:
        return PreparedCardQuery(groups)
    pairs = await eol_pairs_for_types(db, types)
    custom_cycles = await load_custom_cycles(db, {product for product, _ in pairs})
    return PreparedCardQuery(groups, EolInputs(frozenset(pairs), custom_cycles))


# ---------------------------------------------------------------------------
# Saved views
# ---------------------------------------------------------------------------


def _type_set(types: Any) -> set[str] | None:
    """A stored ``filters.types`` as a set, ``None`` when it is not a list of
    card type keys."""
    if not isinstance(types, list) or not all(isinstance(t, str) for t in types):
        return None
    return set(types)


def view_fields_for_query(
    query: CardQuerySet, card_type: str | None, filters: Mapping[str, Any] | None
) -> tuple[str | None, dict[str, Any]]:
    """The ``card_type`` and ``filters`` a saved view holding ``query`` stores,
    pinned to its start types (``start_types``) so the inventory opens on
    them: ``card_type`` the start type when there is exactly one, else
    ``None``; ``filters.types`` every start type, in order.

    ``query_type_mismatch`` when the view already names other types — a
    ``card_type`` other than the one start type (any ``card_type`` when the
    query starts from several), or a ``filters.types`` holding other types
    than exactly the start types. Absent values are filled in.
    """
    starts = start_types(query)
    single = starts[0] if len(starts) == 1 else None
    if card_type is not None and card_type != single:
        raise CardQueryError("query_type_mismatch")
    out = dict(filters or {})
    types = out.get("types")
    if types and _type_set(types) != set(starts):
        raise CardQueryError("query_type_mismatch")
    out["types"] = starts
    return single, out


def stored_query(query: CardQuerySet) -> dict[str, Any]:
    """``query`` as a view stores and returns it, in the caller's shape
    (a plain query, ``all_of`` or ``any_of``): defaults left out."""
    return query.model_dump(exclude_defaults=True)


def base_view_filters(card_types: str | Sequence[str]) -> dict[str, Any]:
    """The ``filters`` of a view on ``card_types`` (one key or several) with
    no facet set — the shape the demo ``BOOKMARK_DEFS`` spell out."""
    return {
        "types": [card_types] if isinstance(card_types, str) else list(card_types),
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


def _stored_types(
    card_type: str | None, filters: Mapping[str, Any] | None, *, query_view: bool
) -> set[str] | None:
    """The card types a stored view is on: its ``card_type``, else its
    ``filters.types`` — a lone entry on any view, every entry on a query view
    (``query_view``, whose ``filters.types`` are its start types); ``None``
    for a plain view on no single type."""
    if card_type:
        return {card_type}
    types = _type_set((filters or {}).get("types"))
    if types and (len(types) == 1 or query_view):
        return types
    return None


def view_patch(
    data: Mapping[str, Any],
    *,
    new_query: CardQuerySet | None,
    current_query: Mapping[str, Any] | None,
    current_filters: Mapping[str, Any] | None,
    current_card_type: str | None = None,
) -> dict[str, Any]:
    """The fields a PATCH of a saved view sets, ``data`` being the request's
    set fields and ``new_query`` its parsed ``query`` (``None`` when absent or
    ``null``).

    ``query: null`` clears the query and touches nothing else. Otherwise, on a
    view that will hold a query — ``new_query``, else the one stored — the
    ``card_type`` and ``filters.types`` are pinned to the start types on every
    PATCH (``view_fields_for_query``), so they can never drift from them:
    values the PATCH sends are checked (``query_type_mismatch``). When the
    PATCH sends no ``filters``, the stored ones are kept key by key with only
    ``types`` rewritten — unless the set of start types moves away from the
    set of types the view was on (``_stored_types``): the stored facets (and
    the ``groupBy`` / ``groupTree`` / ``groupTreeLevel`` grouping axis) belong
    to the old types, so ``filters`` is reset to ``base_view_filters``.
    """
    out = dict(data)
    query = new_query
    # A PATCH that sends ``query`` (``null`` included) never falls back to the
    # stored one, so ``query: null`` reaches the early return below untouched.
    if query is None and "query" not in data and current_query is not None:
        query = parse_card_query(current_query)
    if query is None:
        return out
    starts = start_types(query)
    stored = _stored_types(current_card_type, current_filters, query_view=current_query is not None)
    if "filters" in data:
        filters = data["filters"]
    elif stored not in (None, set(starts)):
        filters = base_view_filters(starts)
    else:
        filters = {k: v for k, v in (current_filters or {}).items() if k != "types"}
    out["card_type"], out["filters"] = view_fields_for_query(query, data.get("card_type"), filters)
    if new_query is not None:
        out["query"] = stored_query(new_query)
    return out
