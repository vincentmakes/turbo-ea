"""The aggregation behind the dashboard Chart and KPI widgets.

One query shape (``DashboardQuery``) serves three endpoints — ``GET
/dashboards/query`` (rows for a chart), ``/dashboards/kpi`` (one number and its
trend) and ``/dashboards/kpi-history`` (a line of daily snapshots) — and the
``query`` an admin stores in a widget's config. It names card-type, field and
status **keys** only, never a card id, so a widget survives a workspace
transfer verbatim.

Rules every result obeys:

- Only ACTIVE cards of a visible (not ``is_hidden``) card type count.
- The caller's ``CardReadScope`` in **module** mode filters every card (both
  ends of a relation for a sankey): a card the caller may not read is not
  counted, so no total or bucket reveals it.
- Rows carry dimension **keys** only (a type key, an option key, a lifecycle
  phase, ``"2026-10"``), never labels — the frontend resolves those with its
  metamodel hooks, in the reader's language.

The work is split so the arithmetic carries a mutation score: everything that
decides a number is a plain function (``query_problem``, ``dimension_key``,
``dimension_domain``, ``aggregate``, ``metric_key``…); ``resolve_query`` and
``run_query`` only read the database and hand rows to them. A count over
dimensions SQL can compute takes a ``COUNT … GROUP BY`` fast path whose grouped
rows go through the same ``aggregate`` as weighted records; the parity test
(``TestSqlFastPathParity``) runs each such query both ways.

Beyond plain fields a query can

- group by a **related card** (``related:<relation type>``, ``__out`` / ``__in``
  on a self-referencing type — the frontend's ``sideKey``), by the **card**
  itself (``card`` — a sankey end, or each card of ``card_type``), by **EOL
  coverage**, by whether a card has **stakeholders**, or by the month a
  lifecycle phase falls in
  (``phase_month:<phase>``);
- measure ``@relations:<rt>``, ``@data_quality`` or ``@age_days`` instead of a
  field;
- narrow by the health **flags** of ``card_flags`` (one definition each) and by
  the presence or absence of a relation (``related:`` / ``unrelated:``);
- show a **share** — the narrowed count as a percentage of the same query
  without its narrowing filters.

Card ids appear in a *response* only (``labels`` and the keys of card-keyed
rows), always resolved through the caller's read scope; a widget config never
holds one. A sum or average of a cost field counts only the cards
``is_live_in_fiscal_year`` keeps for the current fiscal year, like the Cost
report, and names that year in the response.
"""

from __future__ import annotations

import json
import math
import urllib.parse
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import case, exists, func, not_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.services.card_flags import (
    EOL_BUCKETS,
    EOL_TYPES,
    eol_bucket_condition,
    has_eol_link,
    has_manual_eol,
    orphaned_condition,
    stakeholder_condition,
    stale_condition,
)
from app.services.card_read_scope import CardReadScope
from app.services.cost_value import cost_value, is_numeric_text
from app.services.fiscal_year import fiscal_year_for, get_fiscal_year_start
from app.services.lifecycle import (
    PHASE_CHRONOLOGICAL,
    current_lifecycle_phase,
    is_live_in_fiscal_year,
    parse_lifecycle_date,
)

STATIC_DIMENSIONS: frozenset[str] = frozenset(
    {
        "type",
        "subtype",
        "approval_status",
        "lifecycle_phase",
        "data_quality_bucket",
        "created_month",
        "eol_coverage",
        "stakeholders",
    }
)
FIELD_PREFIX = "field:"
# Card by card (keys are card ids, named in ``labels``): a sankey end, or the
# cards of ``card_type`` themselves (one row each — cost per application).
CARD_DIMENSION = "card"
# ``related:<rt>`` groups a card by the cards it is related to through ``rt``.
RELATED_PREFIX = "related:"
# ``phase_month:<phase>`` groups by the month the card's ``<phase>`` date is in.
PHASE_MONTH_PREFIX = "phase_month:"
PHASE_MONTHS_BACK = 6
PHASE_MONTHS_AHEAD = 11
METRICS: tuple[str, ...] = ("count", "sum", "avg", "share")
# The metrics that read a ``metric_field``; ``count`` and ``share`` take none.
FIELD_METRICS: tuple[str, ...] = ("sum", "avg")
# A ``metric_field`` starting with ``@`` is a computed measure, not a field.
MEASURE_PREFIX = "@"
RELATIONS_MEASURE = "@relations:"
DATA_QUALITY_MEASURE = "@data_quality"
AGE_DAYS_MEASURE = "@age_days"
STATIC_MEASURES: frozenset[str] = frozenset({DATA_QUALITY_MEASURE, AGE_DAYS_MEASURE})
# Flags: every one a SQL condition, so a flagged count keeps the fast path.
EOL_FLAGS: dict[str, str] = {
    "eol_linked": "linked",
    "eol_manual": "manual",
    "eol_missing": "missing",
}
STAKEHOLDER_FLAGS: tuple[str, str] = ("with_stakeholders", "without_stakeholders")
STATIC_FLAGS: frozenset[str] = frozenset({"orphaned", "stale", *STAKEHOLDER_FLAGS, *EOL_FLAGS})
RELATED_FLAG = "related:"
UNRELATED_FLAG = "unrelated:"
# The filters a ``share`` divides by, and a KPI's ``base`` strips.
NARROWING_FIELDS: tuple[str, ...] = ("approval_status", "lifecycle_phase", "flags")
# A card-keyed chart keeps its ``top`` largest cards and folds the rest here
# (the frontend's ``OTHER_KEY``), or drops them for an average or a share.
OTHER_KEY = "__other__"
SIDE_SUFFIXES: tuple[str, ...] = ("out", "in")
# The same six keys as ``GET /reports/dashboard``'s lifecycle distribution.
LIFECYCLE_KEYS: tuple[str, ...] = ("plan", "phaseIn", "active", "phaseOut", "endOfLife", "none")
DATA_QUALITY_BUCKETS: tuple[str, ...] = ("0-25", "25-50", "50-75", "75-100")
NONE_KEY = "none"
CREATED_MONTHS = 12
# A field a chart may group by: one value per card. ``multiple_select`` is out
# on purpose — one card would count in several buckets and the total would lie.
DIMENSION_FIELD_TYPES: frozenset[str] = frozenset({"single_select", "boolean"})
METRIC_FIELD_TYPES: frozenset[str] = frozenset({"number", "cost", "percentage"})
# ``dashboard_kpi_snapshots.metric_key`` is String(300).
MAX_METRIC_KEY_LENGTH = 300


class DashboardQuery(BaseModel):
    """What a chart or KPI counts. Structural rules live in ``query_problem``
    (a plain function, so they carry a mutation score and the query endpoint
    can answer 400 rather than 422); metamodel rules in ``resolve_query``."""

    model_config = ConfigDict(extra="forbid")

    card_type: str | None = Field(None, max_length=100)
    group_by: str | None = Field(None, max_length=120)
    group_by_2: str | None = Field(None, max_length=120)
    metric: str = Field("count", max_length=10)
    metric_field: str | None = Field(None, max_length=100)
    approval_status: str | None = Field(None, max_length=20)
    lifecycle_phase: str | None = Field(None, max_length=20)
    subtype: str | None = Field(None, max_length=100)
    relation_type: str | None = Field(None, max_length=200)
    flags: str | None = Field(None, max_length=300)

    @field_validator("flags")
    @classmethod
    def _canonical_flags(cls, value: str | None) -> str | None:
        return canonical_flags(value)


def canonical_flags(value: str | None) -> str | None:
    """``" stale,orphaned,,stale"`` → ``"orphaned,stale"``: split on commas,
    strip, drop empties and repeats, sort — ``None`` when nothing is left. The
    frontend's ``cleanQuery`` sorts identically, so ``metric_key`` agrees."""
    if value is None:
        return None
    parts = sorted({part.strip() for part in value.split(",") if part.strip()})
    return ",".join(parts) or None


class DashboardQueryError(ValueError):
    """A query the metamodel cannot answer (unknown type, field, relation type).
    ``code`` is the 400 ``detail``."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def metric_key(query: DashboardQuery) -> str:
    """The canonical query string of ``query``: its set fields sorted by name,
    URL-encoded, with the default ``metric=count`` left out.

    It is both the querystring the frontend sends (``metricKey`` in
    ``features/dashboard/dashboardQuery.ts`` builds the byte-identical string)
    and the ``dashboard_kpi_snapshots.metric_key`` a KPI's history is stored
    under, so the row a widget reads back is the row the capture wrote.
    """
    items = query.model_dump(exclude_none=True).items()
    return urllib.parse.urlencode(
        sorted((k, v) for k, v in items if not (k == "metric" and v == "count"))
    )


def related_spec(value: str | None) -> str | None:
    """The relation side a ``related:<rt>[__out|__in]`` dimension names."""
    if value is None or not value.startswith(RELATED_PREFIX):
        return None
    return value[len(RELATED_PREFIX) :] or None


def phase_month_phase(value: str | None) -> str | None:
    """The phase a ``phase_month:<phase>`` dimension reads (unchecked)."""
    if value is None or not value.startswith(PHASE_MONTH_PREFIX):
        return None
    return value[len(PHASE_MONTH_PREFIX) :]


def relations_measure_spec(value: str | None) -> str | None:
    """The relation side an ``@relations:<rt>[__out|__in]`` measure counts."""
    if value is None or not value.startswith(RELATIONS_MEASURE):
        return None
    return value[len(RELATIONS_MEASURE) :] or None


def is_measure(value: str) -> bool:
    """Whether an ``@``-prefixed ``metric_field`` is a known computed measure."""
    return value in STATIC_MEASURES or relations_measure_spec(value) is not None


def is_card_keyed(dimension: str | None) -> bool:
    """Whether a dimension's keys are card ids (named in ``labels``)."""
    return dimension == CARD_DIMENSION or related_spec(dimension) is not None


def is_dimension(value: str) -> bool:
    if value in STATIC_DIMENSIONS or value == CARD_DIMENSION:
        return True
    if related_spec(value) is not None:
        return True
    phase = phase_month_phase(value)
    if phase is not None:
        return phase in PHASE_CHRONOLOGICAL
    return value.startswith(FIELD_PREFIX) and len(value) > len(FIELD_PREFIX)


def flag_list(flags: str | None) -> list[str]:
    """The flags of a (canonical) ``flags`` string."""
    return flags.split(",") if flags else []


def relation_flag(flag: str) -> tuple[bool, str] | None:
    """``(present, side)`` for ``related:<side>`` / ``unrelated:<side>``."""
    for prefix, present in ((RELATED_FLAG, True), (UNRELATED_FLAG, False)):
        if flag.startswith(prefix) and len(flag) > len(prefix):
            return present, flag[len(prefix) :]
    return None


def flags_problem(flags: str | None) -> str | None:
    """``unknown_flag`` for a flag nobody defines; ``flags_conflict`` for two
    that can never hold together — both stakeholder flags, two EOL buckets, or
    ``related:`` and ``unrelated:`` of the same relation side."""
    items = flag_list(flags)
    if any(f not in STATIC_FLAGS and relation_flag(f) is None for f in items):
        return "unknown_flag"
    if all(f in items for f in STAKEHOLDER_FLAGS):
        return "flags_conflict"
    if len([f for f in items if f in EOL_FLAGS]) > 1:
        return "flags_conflict"
    parsed = [r for r in map(relation_flag, items) if r is not None]
    present = {side for has, side in parsed if has}
    absent = {side for has, side in parsed if not has}
    if present & absent:
        return "flags_conflict"
    return None


def relation_specs(query: DashboardQuery) -> list[str]:
    """Every relation side the query names outside ``relation_type`` — a
    ``related:`` dimension, an ``@relations:`` measure, a relation flag."""
    specs = [related_spec(d) for d in (query.group_by, query.group_by_2)]
    specs.append(relations_measure_spec(query.metric_field))
    specs.extend(r[1] for r in map(relation_flag, flag_list(query.flags)) if r is not None)
    return [spec for spec in specs if spec is not None]


def is_narrowed(query: DashboardQuery) -> bool:
    """Whether a filter a ``share`` divides by is set."""
    return any(getattr(query, name) for name in NARROWING_FIELDS)


def base_query(query: DashboardQuery) -> DashboardQuery:
    """The count a ``share`` (and a KPI's ``base``) divides by: the same query
    without its narrowing filters."""
    return query.model_copy(update={"metric": "count", **dict.fromkeys(NARROWING_FIELDS)})


def _needs_card_type(dimension: str | None) -> bool:
    return dimension is not None and (dimension == "subtype" or dimension.startswith(FIELD_PREFIX))


def query_problem(query: DashboardQuery) -> str | None:
    """The first structural rule ``query`` breaks, as a short code, or ``None``.

    A sankey (``relation_type`` set) groups source cards by ``group_by`` and
    target cards by ``group_by_2`` (both default to ``type``; ``card`` groups
    an end card by card); each side's subtype and fields resolve against the
    relation type's own end, so it takes no ``card_type`` and only counts
    pairs. Anything else naming a relation side (``related:``,
    ``@relations:``, a relation flag) reads it from ``card_type``'s side.
    Outside a sankey ``card`` is the first dimension only (one row per card
    of ``card_type``, folded to ``top``), never the second.
    """
    for dimension in (query.group_by, query.group_by_2):
        if dimension is None:
            continue
        phase = phase_month_phase(dimension)
        if phase is not None and phase not in PHASE_CHRONOLOGICAL:
            return "unknown_phase"
        if not is_dimension(dimension):
            return "unknown_dimension"
    if query.metric not in METRICS:
        return "unknown_metric"
    if query.metric in FIELD_METRICS and not query.metric_field:
        return "metric_field_required"
    if query.metric not in FIELD_METRICS and query.metric_field:
        return "metric_field_unused"
    field_key = query.metric_field or ""
    if field_key.startswith(MEASURE_PREFIX) and not is_measure(field_key):
        return "unknown_field"
    if query.lifecycle_phase is not None and query.lifecycle_phase not in LIFECYCLE_KEYS:
        return "unknown_lifecycle_phase"
    problem = flags_problem(query.flags)
    if problem:
        return problem
    names_a_side = bool(relation_specs(query))
    if query.relation_type is not None:
        if query.card_type or query.subtype or query.metric != "count" or names_a_side:
            return "relation_type_conflict"
    else:
        if query.group_by_2 is not None and query.group_by is None:
            return "group_by_2_requires_group_by"
        if query.group_by_2 == CARD_DIMENSION:
            return "card_dimension_not_second"
        if query.group_by == CARD_DIMENSION and not query.card_type:
            return "card_dimension_needs_card_type"
        if names_a_side and not query.card_type:
            return "related_needs_card_type"
        needs_type = (
            _needs_card_type(query.group_by)
            or _needs_card_type(query.group_by_2)
            or (field_key != "" and not field_key.startswith(MEASURE_PREFIX))
            or query.subtype is not None
        )
        if needs_type and not query.card_type:
            return "card_type_required"
    if query.metric == "share" and not is_narrowed(query):
        return "share_needs_filter"
    if len(metric_key(query)) > MAX_METRIC_KEY_LENGTH:
        return "query_too_long"
    return None


# ── Metamodel resolution ─────────────────────────────────────────────────


def find_field(fields_schema: Any, key: str) -> dict | None:
    """The field definition ``key`` in a card type's ``fields_schema``."""
    if not isinstance(fields_schema, list):
        return None
    for section in fields_schema:
        if not isinstance(section, dict):
            continue
        for fdef in section.get("fields") or []:
            if isinstance(fdef, dict) and fdef.get("key") == key:
                return fdef
    return None


def _dimension_field(dimension: str | None, fields_schema: Any) -> dict | None:
    """The field a ``field:<key>`` dimension groups by; raises when the type
    has no such field, or one that does not hold a single value."""
    if dimension is None or not dimension.startswith(FIELD_PREFIX):
        return None
    fdef = find_field(fields_schema, dimension[len(FIELD_PREFIX) :])
    if fdef is None or fdef.get("type") not in DIMENSION_FIELD_TYPES:
        raise DashboardQueryError("unknown_field")
    return fdef


@dataclass(frozen=True)
class RelationSide:
    """One side of a relation type: rows of ``relation_type`` where the card
    counted sits at the source (``card_is_source``) or the target end."""

    relation_type: str
    card_is_source: bool


def split_side(spec: str) -> tuple[str, str | None]:
    """``"rel__out"`` → ``("rel", "out")``; a bare key → ``(key, None)``."""
    base, sep, suffix = spec.rpartition("__")
    if sep and base and suffix in SIDE_SUFFIXES:
        return base, suffix
    return spec, None


def resolve_side(
    spec: str, card_type: str | None, relation_types: Mapping[str, Any], *, bad_suffix: str
) -> RelationSide:
    """The side ``spec`` names for cards of ``card_type`` — the frontend's
    ``sideKey`` convention: a cross-type relation type by its bare key, a
    self-referencing one with ``__out`` (the card is the source) or ``__in``.

    ``unknown_relation_type`` for a missing or hidden type, or one
    ``card_type`` is not an end of; ``relation_side_required`` for a bare key
    on a self-referencing type; ``bad_suffix`` (the context's own unknown
    code: ``unknown_dimension``, ``unknown_field``, ``unknown_flag``) for a
    suffix on a cross-type one.
    """
    key, suffix = (spec, None) if spec in relation_types else split_side(spec)
    rel = relation_types.get(key)
    if rel is None or rel.is_hidden:
        raise DashboardQueryError("unknown_relation_type")
    source, target = rel.source_type_key, rel.target_type_key
    if source == target:
        if card_type != source:
            raise DashboardQueryError("unknown_relation_type")
        if suffix is None:
            raise DashboardQueryError("relation_side_required")
        return RelationSide(key, suffix == "out")
    if suffix is not None:
        raise DashboardQueryError(bad_suffix)
    if card_type not in (source, target):
        raise DashboardQueryError("unknown_relation_type")
    return RelationSide(key, card_type == source)


@dataclass
class ResolvedQuery:
    """A query checked against the metamodel, with what running it needs."""

    query: DashboardQuery
    field_1: dict | None = None
    field_2: dict | None = None
    metric_is_cost: bool = False
    relation: RelationType | None = None
    hidden_types: frozenset[str] = field(default_factory=frozenset)
    # Relation spec (``rel`` / ``rel__out``) → the side it names.
    sides: dict[str, RelationSide] = field(default_factory=dict)

    @property
    def dimension(self) -> str | None:
        if self.relation is not None:
            return self.query.group_by or "type"
        return self.query.group_by

    @property
    def dimension_2(self) -> str | None:
        if self.relation is not None:
            return self.query.group_by_2 or "type"
        return self.query.group_by_2


async def resolve_query(db: AsyncSession, query: DashboardQuery) -> ResolvedQuery:
    """Check ``query`` against the metamodel. Raises ``DashboardQueryError``
    for a structural problem or an unknown / hidden card type, field or
    relation type."""
    problem = query_problem(query)
    if problem:
        raise DashboardQueryError(problem)
    types = {t.key: t for t in (await db.execute(select(CardType))).scalars().all()}
    hidden = frozenset(k for k, t in types.items() if t.is_hidden)
    resolved = ResolvedQuery(query=query, hidden_types=hidden)

    if query.relation_type is not None:
        rel = (
            await db.execute(select(RelationType).where(RelationType.key == query.relation_type))
        ).scalar_one_or_none()
        if rel is None or rel.is_hidden:
            raise DashboardQueryError("unknown_relation_type")
        source, target = types.get(rel.source_type_key), types.get(rel.target_type_key)
        resolved.relation = rel
        resolved.field_1 = _dimension_field(
            resolved.dimension, source.fields_schema if source else None
        )
        resolved.field_2 = _dimension_field(
            resolved.dimension_2, target.fields_schema if target else None
        )
        return resolved

    card_type = types.get(query.card_type) if query.card_type else None
    if query.card_type and (card_type is None or card_type.is_hidden):
        raise DashboardQueryError("unknown_card_type")
    schema = card_type.fields_schema if card_type else None
    resolved.field_1 = _dimension_field(query.group_by, schema)
    resolved.field_2 = _dimension_field(query.group_by_2, schema)
    resolved.sides = await _resolve_sides(db, query)
    if query.metric_field and not query.metric_field.startswith(MEASURE_PREFIX):
        mdef = find_field(schema, query.metric_field)
        if mdef is None or mdef.get("type") not in METRIC_FIELD_TYPES:
            raise DashboardQueryError("unknown_field")
        resolved.metric_is_cost = mdef.get("type") == "cost"
    return resolved


async def _resolve_sides(db: AsyncSession, query: DashboardQuery) -> dict[str, RelationSide]:
    """Every relation side the query names, resolved for ``card_type``; each
    context answers its own unknown code for a suffix on a cross-type rt."""
    contexts: dict[str, str] = {}
    for dimension in (query.group_by, query.group_by_2):
        spec = related_spec(dimension)
        if spec is not None:
            contexts.setdefault(spec, "unknown_dimension")
    measure = relations_measure_spec(query.metric_field)
    if measure is not None:
        contexts.setdefault(measure, "unknown_field")
    for flag in flag_list(query.flags):
        parsed = relation_flag(flag)
        if parsed is not None:
            contexts.setdefault(parsed[1], "unknown_flag")
    if not contexts:
        return {}
    keys = {k for spec in contexts for k in (spec, split_side(spec)[0])}
    rows = (await db.execute(select(RelationType).where(RelationType.key.in_(keys)))).scalars()
    relation_types = {rt.key: rt for rt in rows}
    return {
        spec: resolve_side(spec, query.card_type, relation_types, bad_suffix=code)
        for spec, code in contexts.items()
    }


# ── Pure arithmetic ──────────────────────────────────────────────────────


def last_months(today: date, count: int = CREATED_MONTHS) -> list[str]:
    """``count`` ``YYYY-MM`` keys ending with ``today``'s month, oldest first."""
    months: list[str] = []
    year, month = today.year, today.month
    for _ in range(count):
        months.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    return months[::-1]


def phase_months(today: date) -> list[str]:
    """The ``phase_month:`` window: ``PHASE_MONTHS_BACK`` months before
    ``today``'s, ``today``'s, and ``PHASE_MONTHS_AHEAD`` after — oldest first.
    One window for every phase, so go-lives and retirements line up month for
    month."""
    start = today.year * 12 + today.month - 1 - PHASE_MONTHS_BACK
    count = PHASE_MONTHS_BACK + 1 + PHASE_MONTHS_AHEAD
    return [f"{m // 12:04d}-{m % 12 + 1:02d}" for m in range(start, start + count)]


def phase_month_key(lifecycle: Any, phase: str, window: Sequence[str]) -> str | None:
    """The ``YYYY-MM`` of a card's ``phase`` date, or ``None`` (the card is
    dropped) without one or outside the window."""
    if not isinstance(lifecycle, dict):
        return None
    day = parse_lifecycle_date(lifecycle.get(phase))
    if day is None:
        return None
    key = f"{day.year:04d}-{day.month:02d}"
    return key if key in window else None


def eol_coverage_key(raw: Any) -> str | None:
    """A card's EOL coverage bucket from ``[type, attributes, lifecycle]`` —
    the Python twin of the ``eol_bucket_condition`` ``case`` the fast path
    groups by; ``None`` (the card is dropped) for a type outside
    ``EOL_TYPES``."""
    if not isinstance(raw, (list, tuple)) or len(raw) != 3:
        return None
    card_type, attributes, lifecycle = raw
    if card_type not in EOL_TYPES:
        return None
    if has_eol_link(attributes if isinstance(attributes, dict) else None):
        return "linked"
    if has_manual_eol(lifecycle if isinstance(lifecycle, dict) else None):
        return "manual"
    return "missing"


def age_days(created_at: Any, today: date) -> int | None:
    """Whole days from a card's creation (its UTC date) to ``today``."""
    if not isinstance(created_at, datetime):
        return None
    stamp = created_at.astimezone(timezone.utc) if created_at.tzinfo else created_at
    return (today - stamp.date()).days


def data_quality_bucket(value: Any) -> str:
    """The completion bucket of a ``data_quality`` score (the four the
    Overview's Completion chart has always shown)."""
    score = value if isinstance(value, (int, float)) and not isinstance(value, bool) else 0
    if score < 25:
        return "0-25"
    if score < 50:
        return "25-50"
    if score < 75:
        return "50-75"
    return "75-100"


def lifecycle_key(lifecycle: Any) -> str:
    """The card's current lifecycle phase, or ``"none"`` without dates."""
    phase = current_lifecycle_phase(lifecycle if isinstance(lifecycle, dict) else None)
    return phase if phase in LIFECYCLE_KEYS else NONE_KEY


def value_key(value: Any) -> str:
    """A stored value as a row key: booleans as ``true`` / ``false``, nothing
    as ``none``."""
    if value is None or value == "":
        return NONE_KEY
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (list, dict)):
        # Spelled as PostgreSQL prints JSON (``->>``), so a malformed stored
        # value keys the same on the SQL fast path and the Python path.
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def month_key(value: Any) -> str | None:
    if not isinstance(value, datetime):
        return None
    stamp = value.astimezone(timezone.utc) if value.tzinfo else value
    return f"{stamp.year:04d}-{stamp.month:02d}"


def dimension_key(
    dimension: str, raw: Any, months: Sequence[str], phase_window: Sequence[str] = ()
) -> str | None:
    """The row key ``raw`` (the dimension's column for one card) falls under.
    ``None`` drops the card: created before the 12-month window, a phase date
    outside ``phase_window``, a type with no EOL coverage."""
    if dimension == "lifecycle_phase":
        return lifecycle_key(raw)
    if dimension == "data_quality_bucket":
        return data_quality_bucket(raw)
    if dimension == "created_month":
        key = month_key(raw)
        return key if key in months else None
    if dimension == "eol_coverage":
        return eol_coverage_key(raw)
    phase = phase_month_phase(dimension)
    if phase is not None:
        return phase_month_key(raw, phase, phase_window)
    return value_key(raw)


def dimension_domain(
    dimension: str | None,
    fdef: dict | None,
    months: Sequence[str],
    phase_window: Sequence[str] = (),
) -> list[str]:
    """The keys a dimension always shows, in display order, zero-filled when no
    card falls there — empty for a dimension whose keys are only what occurs."""
    if dimension == "lifecycle_phase":
        return list(LIFECYCLE_KEYS)
    if dimension == "data_quality_bucket":
        return list(DATA_QUALITY_BUCKETS)
    if dimension == "created_month":
        return list(months)
    if dimension == "eol_coverage":
        return list(EOL_BUCKETS)
    if dimension == "stakeholders":
        return ["true", "false"]
    if phase_month_phase(dimension) is not None:
        return list(phase_window)
    if fdef is not None and fdef.get("type") == "boolean":
        return ["true", "false"]
    if fdef is not None and fdef.get("type") == "single_select":
        options = fdef.get("options") or []
        return [o["key"] for o in options if isinstance(o, dict) and isinstance(o.get("key"), str)]
    return []


def numeric_value(raw: Any) -> float | int | None:
    """A field value as a number for sum / avg, or ``None`` when it is not one
    (it then counts in neither the sum nor the average's denominator)."""
    if isinstance(raw, bool) or raw is None:
        return None
    if isinstance(raw, (int, float)):
        return raw if math.isfinite(raw) else None
    if is_numeric_text(raw):
        return cost_value(raw)
    return None


def tidy_number(value: float | int) -> float | int:
    """Two decimals, and a whole number as an ``int`` (``12`` not ``12.0``)."""
    rounded = round(value, 2)
    return int(rounded) if rounded == int(rounded) else rounded


@dataclass
class Accumulator:
    count: int = 0
    total: float = 0
    numeric: int = 0

    def add(self, raw: Any, weight: int = 1) -> None:
        """Count ``weight`` cards holding ``raw`` — more than one when the
        rows were already grouped in SQL (``count`` only, where ``raw`` is
        ``None``)."""
        self.count += weight
        number = numeric_value(raw)
        if number is not None:
            self.total += number * weight
            self.numeric += weight

    def value(self, metric: str) -> float | int:
        if metric == "count":
            return self.count
        if metric == "sum":
            return tidy_number(self.total)
        return tidy_number(self.total / self.numeric) if self.numeric else 0


def order_keys(values: dict[str, float | int], domain: Sequence[str]) -> list[str]:
    """The domain in its own order, then every other key that occurred,
    largest first (ties by key) — so a chart's bars are stable."""
    rest = sorted((k for k in values if k not in domain), key=lambda k: (-values[k], k))
    return [*domain, *rest]


def aggregate(
    records: Iterable[tuple[Any, ...]],
    *,
    metric: str,
    shape: str,
    domain_1: Sequence[str] = (),
    domain_2: Sequence[str] = (),
) -> tuple[list[dict[str, Any]], float | int]:
    """Group ``(key_1, key_2, metric_raw[, weight])`` records into result rows.

    A record stands for ``weight`` cards (default 1): the SQL fast path hands
    in one record per group with its ``COUNT``, the Python path one per card,
    and both go through the ordering, zero-fill and total below.

    ``shape`` is ``single`` (no rows, the total only — a KPI or gauge),
    ``keyed`` (``{key, value}``), ``grid`` (``{x, y, value}`` — a heatmap) or
    ``flow`` (``{source, target, value}`` — a sankey). The total is the metric
    over every record, never a sum of averages.
    """
    overall = Accumulator()
    cells: dict[tuple[str | None, str | None], Accumulator] = {}
    for record in records:
        key_1, key_2, raw = record[0], record[1], record[2]
        weight = record[3] if len(record) > 3 else 1
        overall.add(raw, weight)
        if shape != "single":
            cells.setdefault((key_1, key_2), Accumulator()).add(raw, weight)
    total = overall.value(metric)
    if shape == "single":
        return [], total
    if shape == "keyed":
        values = {k1: acc.value(metric) for (k1, _k2), acc in cells.items() if k1 is not None}
        ordered = order_keys(values, domain_1)
        return [{"key": k, "value": values.get(k, 0)} for k in ordered], total
    values_2d = {k: acc.value(metric) for k, acc in cells.items()}
    if shape == "flow":
        flows = sorted(values_2d.items(), key=lambda kv: (-kv[1], kv[0][0] or "", kv[0][1] or ""))
        return [{"source": s, "target": t, "value": v} for (s, t), v in flows], total
    # grid: each axis ordered like a keyed chart over that axis's own totals.
    # Both dimensions are set on a grid, so a cell's keys are never missing;
    # a missing one would read as ``NONE_KEY`` rather than break the sort.
    grid = {(k1 or NONE_KEY, k2 or NONE_KEY): v for (k1, k2), v in values_2d.items()}
    axis_1: dict[str, float | int] = {}
    axis_2: dict[str, float | int] = {}
    for (k1, k2), v in grid.items():
        axis_1[k1] = axis_1.get(k1, 0) + v
        axis_2[k2] = axis_2.get(k2, 0) + v
    rank_1 = {k: i for i, k in enumerate(order_keys(axis_1, domain_1))}
    rank_2 = {k: i for i, k in enumerate(order_keys(axis_2, domain_2))}
    cells_sorted = sorted(grid.items(), key=lambda kv: (rank_1[kv[0][0]], rank_2[kv[0][1]]))
    return [{"x": x, "y": y, "value": v} for (x, y), v in cells_sorted], total


def percent(part: float | int, whole: float | int) -> float | int:
    """``part`` as a percentage of ``whole`` (0 when ``whole`` is 0)."""
    return tidy_number(part / whole * 100) if whole else 0


def _row_identity(row: Mapping[str, Any]) -> tuple[tuple[str, Any], ...]:
    return tuple((k, v) for k, v in row.items() if k != "value")


def share_rows(
    full_rows: Sequence[Mapping[str, Any]],
    base_rows: Sequence[Mapping[str, Any]],
    full_total: float | int,
    base_total: float | int,
) -> tuple[list[dict[str, Any]], float | int]:
    """A ``share``: each base row's narrowed count as a percentage of its base
    count, in the base's order (its domain and zero-fill), and the overall
    ratio as the total. The narrowed rows are a subset of the base rows."""
    full = {_row_identity(r): r["value"] for r in full_rows}
    rows = [{**r, "value": percent(full.get(_row_identity(r), 0), r["value"])} for r in base_rows]
    return rows, percent(full_total, base_total)


def _ranked(values: Mapping[str, float | int], top: int) -> set[str]:
    return set(sorted(values, key=lambda k: (-values[k], k))[:top])


def _fold_keyed(
    rows: Sequence[Mapping[str, Any]], top: int, merge: bool
) -> tuple[list[dict[str, Any]], int]:
    """``fold_keyed``'s rows and the number of card keys it did not keep."""
    cards = {r["key"]: r["value"] for r in rows if r["key"] != NONE_KEY}
    kept = _ranked(cards, top)
    out = [dict(r) for r in rows if r["key"] in kept or r["key"] == NONE_KEY]
    rest = [v for k, v in cards.items() if k not in kept]
    if rest and merge:
        out.append({"key": OTHER_KEY, "value": tidy_number(sum(rest))})
    return out, len(cards) - len(kept)


def fold_keyed(
    rows: Sequence[Mapping[str, Any]], top: int, *, merge: bool = True
) -> list[dict[str, Any]]:
    """Keep the ``top`` largest card keys (ties by key) and merge the rest into
    ``OTHER_KEY``, appended last. ``none`` (no related card) is not a card and
    is never folded. ``merge=False`` drops the rest instead — an average or a
    share of several cards is not their sum."""
    return _fold_keyed(rows, top, merge)[0]


def _fold_flows(
    rows: Sequence[Mapping[str, Any]], top: int, sides: Sequence[str]
) -> tuple[list[dict[str, Any]], int]:
    """``fold_flows``'s rows and the number of keys it did not keep, summed
    over the folded sides (a card at both ends counts once per side)."""
    kept: dict[str, set[str]] = {}
    folded_count = 0
    for side in sides:
        totals: dict[str, float | int] = {}
        for r in rows:
            totals[r[side]] = totals.get(r[side], 0) + r["value"]
        kept[side] = _ranked(totals, top)
        folded_count += len(totals) - len(kept[side])

    def folded(row: Mapping[str, Any], side: str) -> str:
        if side in kept and row[side] not in kept[side]:
            return OTHER_KEY
        return str(row[side])

    merged: dict[tuple[str, str], float | int] = {}
    for r in rows:
        pair = (folded(r, "source"), folded(r, "target"))
        merged[pair] = merged.get(pair, 0) + r["value"]
    flows = sorted(merged.items(), key=lambda kv: (-kv[1], kv[0][0], kv[0][1]))
    return [{"source": s, "target": t, "value": v} for (s, t), v in flows], folded_count


def fold_flows(
    rows: Sequence[Mapping[str, Any]],
    top: int,
    *,
    sides: Sequence[str] = ("source", "target"),
) -> list[dict[str, Any]]:
    """Keep the ``top`` largest keys of each side in ``sides`` (by the side's
    own total, ties by key), merge that side's other keys into ``OTHER_KEY``,
    and re-sort the flows like ``aggregate``. A side not in ``sides`` (one
    that is not card-keyed) is never folded."""
    return _fold_flows(rows, top, sides)[0]


def row_keys(rows: Iterable[Mapping[str, Any]]) -> set[str]:
    """Every dimension key a result's rows name."""
    return {str(r[k]) for r in rows for k in ("key", "source", "target", "x", "y") if k in r}


def result_shape(resolved: ResolvedQuery) -> str:
    if resolved.relation is not None:
        return "flow"
    if resolved.query.group_by is None:
        return "single"
    if resolved.query.group_by_2 is None:
        return "keyed"
    return "grid"


# ── Database ─────────────────────────────────────────────────────────────


def _dimension_column(dimension: str, card: Any) -> Any:
    """What the Python path reads for a dimension on one card (``card`` is
    ``Card`` or a sankey end's alias); ``dimension_key`` turns it into a key."""
    if dimension in ("lifecycle_phase", "data_quality_bucket", "created_month"):
        return {
            "lifecycle_phase": card.lifecycle,
            "data_quality_bucket": card.data_quality,
            "created_month": card.created_at,
        }[dimension]
    if dimension == CARD_DIMENSION:
        return card.id
    if dimension == "eol_coverage":
        # ``eol_coverage_key`` reads the three in Python, the twin of the
        # ``eol_bucket_condition`` case the fast path groups by.
        return func.jsonb_build_array(card.type, card.attributes, card.lifecycle, type_=JSONB)
    if dimension == "stakeholders":
        return stakeholder_condition(True, card=card)
    if phase_month_phase(dimension) is not None:
        return card.lifecycle
    if dimension.startswith(FIELD_PREFIX):
        return card.attributes[dimension[len(FIELD_PREFIX) :]]
    return getattr(card, dimension)


def _visible(card: Any, resolved: ResolvedQuery, read_scope: CardReadScope) -> list[Any]:
    """ACTIVE, of a visible type, readable by the caller — what the other end
    of a relation must be to count (the query's own filters describe the card
    counted, not the cards it is related to)."""
    clauses = [card.status == "ACTIVE", *read_scope.where(card, mode="module")]
    if resolved.hidden_types:
        clauses.append(card.type.not_in(sorted(resolved.hidden_types)))
    return clauses


def _side_columns(side: RelationSide) -> tuple[Any, Any]:
    """``(the counted card's end, the other end)`` of a relation row."""
    if side.card_is_source:
        return Relation.source_id, Relation.target_id
    return Relation.target_id, Relation.source_id


def _related_exists(
    card: Any, side: RelationSide, resolved: ResolvedQuery, read_scope: CardReadScope
) -> Any:
    """``card`` has a relation on ``side`` whose other end is visible."""
    other = aliased(Card)
    mine, theirs = _side_columns(side)
    return exists(
        select(Relation.id)
        .join(other, other.id == theirs)
        .where(
            Relation.type == side.relation_type,
            mine == card.id,
            *_visible(other, resolved, read_scope),
        )
    )


def flag_conditions(card: Any, resolved: ResolvedQuery, read_scope: CardReadScope) -> list[Any]:
    """One SQL condition per flag — the ``card_flags`` definitions, so a flag
    reads exactly what the inventory filter and the Data Quality report do."""
    clauses: list[Any] = []
    for flag in flag_list(resolved.query.flags):
        if flag == "orphaned":
            clauses.append(orphaned_condition(card=card))
        elif flag == "stale":
            clauses.append(stale_condition(card=card))
        elif flag in STAKEHOLDER_FLAGS:
            clauses.append(stakeholder_condition(flag == "with_stakeholders", card=card))
        elif flag in EOL_FLAGS:
            clauses.append(eol_bucket_condition(EOL_FLAGS[flag], card=card))
        else:
            present, spec = relation_flag(flag)  # type: ignore[misc]
            condition = _related_exists(card, resolved.sides[spec], resolved, read_scope)
            clauses.append(condition if present else not_(condition))
    return clauses


def _live(card: Any, resolved: ResolvedQuery, read_scope: CardReadScope) -> list[Any]:
    """ACTIVE, of a visible type, readable by the caller, matching the filters
    (both ends of a sankey: the approval status and the flags hold for each)."""
    q = resolved.query
    clauses = _visible(card, resolved, read_scope)
    if q.approval_status:
        clauses.append(card.approval_status == q.approval_status)
    clauses.extend(flag_conditions(card, resolved, read_scope))
    return clauses


# Dimensions the fast path groups in SQL (``field:<key>`` too); lifecycle
# needs ``current_lifecycle_phase`` on the dates and stays in Python, like the
# phase months, a related card fans one card out into several rows, and the
# card itself (``card``) is one row per card, folded in Python.
SQL_GROUPABLE: frozenset[str] = frozenset(
    {
        "type",
        "subtype",
        "approval_status",
        "data_quality_bucket",
        "created_month",
        "eol_coverage",
        "stakeholders",
    }
)


def fast_path_applies(resolved: ResolvedQuery) -> bool:
    """Whether a query can be answered with ``COUNT … GROUP BY`` — a count of
    cards (no sankey, no sum / avg / share, no ``@`` measure) with no lifecycle
    filter, over dimensions SQL can compute. Flags are SQL conditions and keep
    it. Everything the Overview shows by default qualifies."""
    q = resolved.query
    if resolved.relation is not None or q.lifecycle_phase or q.metric != "count":
        return False
    return all(
        d is None or d in SQL_GROUPABLE or d.startswith(FIELD_PREFIX)
        for d in (q.group_by, q.group_by_2)
    )


def _sql_dimension(dimension: str, card: Any) -> Any:
    """The dimension as a groupable SQL expression. The quality buckets, the
    month, the EOL buckets and the stakeholder split mirror
    ``data_quality_bucket``, ``month_key``, ``eol_coverage_key`` and the
    Python column exactly (a missing score is 0, the month is read in UTC)."""
    if dimension == "data_quality_bucket":
        score = func.coalesce(card.data_quality, 0)
        return case(
            (score < 25, "0-25"),
            (score < 50, "25-50"),
            (score < 75, "50-75"),
            else_="75-100",
        )
    if dimension == "created_month":
        return func.to_char(func.timezone("UTC", card.created_at), "YYYY-MM")
    if dimension == "eol_coverage":
        return case(*((eol_bucket_condition(b, card=card), b) for b in EOL_BUCKETS), else_=None)
    if dimension == "stakeholders":
        return case((stakeholder_condition(True, card=card), "true"), else_="false")
    if dimension.startswith(FIELD_PREFIX):
        return card.attributes[dimension[len(FIELD_PREFIX) :]].astext
    return getattr(card, dimension)


def sql_dimension_key(dimension: str, raw: Any, months: Sequence[str]) -> str | None:
    """``dimension_key`` for a value ``_sql_dimension`` already computed."""
    if dimension in ("data_quality_bucket", "stakeholders"):
        return None if raw is None else str(raw)
    if dimension == "created_month":
        return raw if raw in months else None
    if dimension == "eol_coverage":
        return raw if raw in EOL_BUCKETS else None
    return value_key(raw)


def grouped_statement(resolved: ResolvedQuery, read_scope: CardReadScope) -> Any:
    """``SELECT dim…, COUNT(cards.id) … GROUP BY dim…`` for the fast path."""
    q = resolved.query
    dims = [
        _sql_dimension(d, Card).label(f"dim_{i}")
        for i, d in enumerate((q.group_by, q.group_by_2))
        if d is not None
    ]
    stmt = select(*dims, func.count(Card.id)).where(*_live(Card, resolved, read_scope))
    if q.card_type:
        stmt = stmt.where(Card.type == q.card_type)
    if q.subtype:
        stmt = stmt.where(Card.subtype == q.subtype)
    return stmt.group_by(*dims) if dims else stmt


@dataclass
class Window:
    """The time frames one run reads: the 12 creation months, the phase-month
    window, today, and the fiscal year a cost counts in (``None`` unless the
    metric sums or averages a cost field)."""

    months: Sequence[str]
    phase_window: Sequence[str]
    today: date
    fiscal: tuple[int, int] | None = None


@dataclass
class Records:
    """What a read hands ``aggregate``: ``records`` for the rows, ``totals``
    (one per card) when a ``related:`` dimension fans a card out into several
    records — the total counts each card once — and ``labels`` naming the
    card keys."""

    records: list[tuple[Any, ...]]
    totals: list[tuple[Any, ...]] | None = None
    labels: dict[str, str] = field(default_factory=dict)


async def _grouped_records(
    db: AsyncSession, resolved: ResolvedQuery, read_scope: CardReadScope, window: Window
) -> Records:
    dim_1, dim_2 = resolved.query.group_by, resolved.query.group_by_2
    records: list[tuple[Any, ...]] = []
    for row in (await db.execute(grouped_statement(resolved, read_scope))).all():
        *raws, count = row
        key_1 = sql_dimension_key(dim_1, raws[0], window.months) if dim_1 else None
        key_2 = sql_dimension_key(dim_2, raws[1], window.months) if dim_2 else None
        if (dim_1 and key_1 is None) or (dim_2 and key_2 is None):
            continue
        records.append((key_1, key_2, None, count))
    return Records(records)


async def _sankey_records(
    db: AsyncSession, resolved: ResolvedQuery, read_scope: CardReadScope, window: Window
) -> Records:
    dim_1, dim_2 = resolved.dimension, resolved.dimension_2
    phase = resolved.query.lifecycle_phase
    relation = resolved.relation
    assert relation is not None  # a sankey always resolves its relation type
    src, tgt = aliased(Card), aliased(Card)
    stmt = (
        select(
            _dimension_column(dim_1, src),  # type: ignore[arg-type]
            _dimension_column(dim_2, tgt),  # type: ignore[arg-type]
            src.lifecycle,
            tgt.lifecycle,
            src.name,
            tgt.name,
        )
        .select_from(Relation)
        .join(src, Relation.source_id == src.id)
        .join(tgt, Relation.target_id == tgt.id)
        .where(
            Relation.type == relation.key,
            *_live(src, resolved, read_scope),
            *_live(tgt, resolved, read_scope),
        )
    )
    out = Records([])
    for raw_1, raw_2, lc_src, lc_tgt, name_src, name_tgt in (await db.execute(stmt)).all():
        # A lifecycle filter holds for both ends of the pair.
        if phase and (lifecycle_key(lc_src) != phase or lifecycle_key(lc_tgt) != phase):
            continue
        key_1 = dimension_key(dim_1, raw_1, window.months, window.phase_window)  # type: ignore[arg-type]
        key_2 = dimension_key(dim_2, raw_2, window.months, window.phase_window)  # type: ignore[arg-type]
        if key_1 is None or key_2 is None:
            continue
        out.records.append((key_1, key_2, None))
        if dim_1 == CARD_DIMENSION:
            out.labels[key_1] = name_src
        if dim_2 == CARD_DIMENSION:
            out.labels[key_2] = name_tgt
    return out


def _related_pairs(side: RelationSide, resolved: ResolvedQuery, read_scope: CardReadScope) -> Any:
    """``(card_id, other_id, other_name)`` for every relation on ``side``
    whose other end is visible — outer-joined, so a card with none keeps a
    ``NULL`` (the ``none`` key) and a hidden related card is simply absent."""
    other = aliased(Card)
    mine, theirs = _side_columns(side)
    return (
        select(
            mine.label("card_id"),
            other.id.label("other_id"),
            other.name.label("other_name"),
        )
        .select_from(Relation)
        .join(other, other.id == theirs)
        .where(Relation.type == side.relation_type, *_visible(other, resolved, read_scope))
        .subquery()
    )


def _measure_column(resolved: ResolvedQuery, read_scope: CardReadScope) -> Any:
    """What a sum / average reads for one card: a field, or a ``@`` measure."""
    field_key = resolved.query.metric_field
    if not field_key:
        return Card.id
    if field_key == DATA_QUALITY_MEASURE:
        return Card.data_quality
    if field_key == AGE_DAYS_MEASURE:
        return Card.created_at
    spec = relations_measure_spec(field_key)
    if spec is not None:
        other = aliased(Card)
        mine, theirs = _side_columns(resolved.sides[spec])
        return (
            select(func.count(Relation.id))
            .join(other, other.id == theirs)
            .where(
                Relation.type == resolved.sides[spec].relation_type,
                mine == Card.id,
                *_visible(other, resolved, read_scope),
            )
            .scalar_subquery()
        )
    return Card.attributes[field_key]


def measure_value(field_key: str | None, raw: Any, today: date) -> Any:
    """The raw value a record carries for the metric (``None`` for a count)."""
    if not field_key:
        return None
    if field_key == AGE_DAYS_MEASURE:
        return age_days(raw, today)
    return raw


async def _card_records(
    db: AsyncSession, resolved: ResolvedQuery, read_scope: CardReadScope, window: Window
) -> Records:
    """One record per card — or per (card, related card) for a ``related:``
    dimension — for what SQL cannot group: the lifecycle phase (computed from
    the dates), the phase months, the card itself, related cards, ``@``
    measures, and sums /
    averages read through ``cost_value``. A cost counts only for the cards
    ``is_live_in_fiscal_year`` keeps in the current fiscal year."""
    q = resolved.query
    dims = (q.group_by, q.group_by_2)
    columns: list[Any] = []
    names: list[Any] = []
    joins: list[Any] = []
    for dimension in dims:
        spec = related_spec(dimension)
        if spec is not None:
            pairs = _related_pairs(resolved.sides[spec], resolved, read_scope)
            joins.append(pairs)
            columns.append(pairs.c.other_id)
            names.append(pairs.c.other_name)
        else:
            columns.append(_dimension_column(dimension, Card) if dimension else Card.id)
            names.append(Card.name)
    stmt = select(
        Card.id,
        *columns,
        _measure_column(resolved, read_scope),
        Card.lifecycle,
        *names,
    ).select_from(Card)
    for pairs in joins:
        stmt = stmt.outerjoin(pairs, pairs.c.card_id == Card.id)
    stmt = stmt.where(*_live(Card, resolved, read_scope))
    if q.card_type:
        stmt = stmt.where(Card.type == q.card_type)
    if q.subtype:
        stmt = stmt.where(Card.subtype == q.subtype)

    out = Records([])
    per_card: dict[Any, tuple[Any, ...]] = {}
    for card_id, raw_1, raw_2, raw_metric, lifecycle, name_1, name_2 in (
        await db.execute(stmt)
    ).all():
        if q.lifecycle_phase and lifecycle_key(lifecycle) != q.lifecycle_phase:
            continue
        if window.fiscal is not None:
            fiscal_year, start_month = window.fiscal
            lc = lifecycle if isinstance(lifecycle, dict) else None
            if not is_live_in_fiscal_year(lc, fiscal_year, start_month):
                continue
        keys: list[str | None] = []
        for dimension, raw in zip(dims, (raw_1, raw_2)):
            keys.append(
                dimension_key(dimension, raw, window.months, window.phase_window)
                if dimension
                else None
            )
        if any(d and k is None for d, k in zip(dims, keys)):
            continue
        metric = measure_value(q.metric_field, raw_metric, window.today)
        out.records.append((keys[0], keys[1], metric))
        per_card.setdefault(card_id, (None, None, metric))
        for dimension, raw, name in zip(dims, (raw_1, raw_2), (name_1, name_2)):
            if is_card_keyed(dimension) and raw is not None:
                out.labels[str(raw)] = name
    if any(related_spec(d) is not None for d in dims):
        out.totals = list(per_card.values())
    return out


async def fiscal_year_keys(
    db: AsyncSession, resolved: ResolvedQuery, today: date | None = None
) -> dict[str, int]:
    """``{"fiscal_year", "fiscal_year_start"}`` for a cost metric (the year
    its sum or average counts in, so the widget can name it), else ``{}``."""
    if not resolved.metric_is_cost:
        return {}
    start_month = await get_fiscal_year_start(db)
    day = today or datetime.now(timezone.utc).date()
    return {"fiscal_year": fiscal_year_for(day, start_month), "fiscal_year_start": start_month}


async def _compute(
    db: AsyncSession,
    resolved: ResolvedQuery,
    read_scope: CardReadScope,
    window: Window,
    force_python: bool,
) -> tuple[list[dict[str, Any]], float | int, dict[str, str]]:
    if resolved.relation is not None:
        read = await _sankey_records(db, resolved, read_scope, window)
    elif not force_python and fast_path_applies(resolved):
        read = await _grouped_records(db, resolved, read_scope, window)
    else:
        read = await _card_records(db, resolved, read_scope, window)
    dim_1, dim_2 = resolved.dimension, resolved.dimension_2
    metric = resolved.query.metric
    rows, total = aggregate(
        read.records,
        metric=metric,
        shape=result_shape(resolved),
        domain_1=dimension_domain(dim_1, resolved.field_1, window.months, window.phase_window),
        domain_2=dimension_domain(dim_2, resolved.field_2, window.months, window.phase_window),
    )
    if read.totals is not None:
        _, total = aggregate(read.totals, metric=metric, shape="single")
    return rows, total, read.labels


def with_query(resolved: ResolvedQuery, query: DashboardQuery) -> ResolvedQuery:
    """``resolved`` answering ``query`` instead (the halves of a share)."""
    return replace(resolved, query=query)


def fold_rows(
    rows: list[dict[str, Any]], resolved: ResolvedQuery, top: int
) -> tuple[list[dict[str, Any]], int]:
    """Fold a card-keyed result to the ``top`` largest cards (a sankey per card
    end): the rest into ``OTHER_KEY``, or dropped for an average or a share.
    Returns the rows and the number of cards not kept — for a sankey, summed
    over its folded ends; ``none`` is not a card and never counts."""
    shape = result_shape(resolved)
    dim_1, dim_2 = resolved.dimension, resolved.dimension_2
    if shape == "keyed" and is_card_keyed(dim_1):
        return _fold_keyed(rows, top, resolved.query.metric in ("count", "sum"))
    if shape == "flow":
        sides = [s for s, d in (("source", dim_1), ("target", dim_2)) if d == CARD_DIMENSION]
        if sides:
            return _fold_flows(rows, top, sides)
    return rows, 0


async def run_query(
    db: AsyncSession,
    resolved: ResolvedQuery,
    read_scope: CardReadScope,
    *,
    today: date | None = None,
    force_python: bool = False,
    top: int | None = None,
) -> dict[str, Any]:
    """``{"dimension", "dimension_2", "rows", "total"}`` for a resolved query,
    plus ``labels`` (card id → name, only the readable cards the rows name)
    for a card-keyed dimension and ``fiscal_year`` / ``fiscal_year_start``
    for a cost.

    A count over SQL-groupable dimensions is a ``GROUP BY`` (the Overview's
    tiles and charts must not stream the card table once per widget); the rest
    reads one row per card. ``force_python`` takes the per-card path always —
    the parity test runs every fast-path query both ways. A ``share`` runs the
    count twice (narrowed and base), each on its own best path. ``top`` keeps
    a card-keyed result's ``top`` largest cards and folds the rest into
    ``OTHER_KEY``, or drops them for an average or a share; when any card is
    not kept, ``folded`` says so: ``{"top": top, "cards": <cards not kept>}``.
    """
    day = today or datetime.now(timezone.utc).date()
    fiscal = await fiscal_year_keys(db, resolved, day)
    window = Window(
        months=last_months(day),
        phase_window=phase_months(day),
        today=day,
        fiscal=(fiscal["fiscal_year"], fiscal["fiscal_year_start"]) if fiscal else None,
    )
    q = resolved.query
    if q.metric == "share":
        count = q.model_copy(update={"metric": "count"})
        full_rows, full_total, _ = await _compute(
            db, with_query(resolved, count), read_scope, window, force_python
        )
        base_rows, base_total, labels = await _compute(
            db, with_query(resolved, base_query(q)), read_scope, window, force_python
        )
        rows, total = share_rows(full_rows, base_rows, full_total, base_total)
    else:
        rows, total, labels = await _compute(db, resolved, read_scope, window, force_python)
    folded = 0
    if top is not None:
        rows, folded = fold_rows(rows, resolved, top)
    dim_1, dim_2 = resolved.dimension, resolved.dimension_2
    out: dict[str, Any] = {"dimension": dim_1, "dimension_2": dim_2, "rows": rows, "total": total}
    if folded > 0:
        out["folded"] = {"top": top, "cards": folded}
    if is_card_keyed(dim_1) or is_card_keyed(dim_2):
        named = row_keys(rows)
        out["labels"] = {k: v for k, v in labels.items() if k in named}
    out.update(fiscal)
    return out
