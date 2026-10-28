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
"""

from __future__ import annotations

import json
import math
import urllib.parse
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.services.card_read_scope import CardReadScope
from app.services.cost_value import cost_value, is_numeric_text
from app.services.lifecycle import current_lifecycle_phase

STATIC_DIMENSIONS: frozenset[str] = frozenset(
    {
        "type",
        "subtype",
        "approval_status",
        "lifecycle_phase",
        "data_quality_bucket",
        "created_month",
    }
)
FIELD_PREFIX = "field:"
METRICS: tuple[str, ...] = ("count", "sum", "avg")
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


def is_dimension(value: str) -> bool:
    if value in STATIC_DIMENSIONS:
        return True
    return value.startswith(FIELD_PREFIX) and len(value) > len(FIELD_PREFIX)


def _needs_card_type(dimension: str | None) -> bool:
    return dimension is not None and (dimension == "subtype" or dimension.startswith(FIELD_PREFIX))


def query_problem(query: DashboardQuery) -> str | None:
    """The first structural rule ``query`` breaks, as a short code, or ``None``.

    A sankey (``relation_type`` set) groups source cards by ``group_by`` and
    target cards by ``group_by_2`` (both default to ``type``); each side's
    subtype and fields resolve against the relation type's own end, so it takes
    no ``card_type`` and only counts pairs.
    """
    for dimension in (query.group_by, query.group_by_2):
        if dimension is not None and not is_dimension(dimension):
            return "unknown_dimension"
    if query.metric not in METRICS:
        return "unknown_metric"
    if query.metric != "count" and not query.metric_field:
        return "metric_field_required"
    if query.metric == "count" and query.metric_field:
        return "metric_field_unused"
    if query.lifecycle_phase is not None and query.lifecycle_phase not in LIFECYCLE_KEYS:
        return "unknown_lifecycle_phase"
    if query.relation_type is not None:
        if query.card_type or query.subtype or query.metric != "count":
            return "relation_type_conflict"
    else:
        if query.group_by_2 is not None and query.group_by is None:
            return "group_by_2_requires_group_by"
        needs_type = (
            _needs_card_type(query.group_by)
            or _needs_card_type(query.group_by_2)
            or query.metric_field is not None
            or query.subtype is not None
        )
        if needs_type and not query.card_type:
            return "card_type_required"
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


@dataclass
class ResolvedQuery:
    """A query checked against the metamodel, with what running it needs."""

    query: DashboardQuery
    field_1: dict | None = None
    field_2: dict | None = None
    metric_is_cost: bool = False
    relation: RelationType | None = None
    hidden_types: frozenset[str] = field(default_factory=frozenset)

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
    if query.metric_field:
        mdef = find_field(schema, query.metric_field)
        if mdef is None or mdef.get("type") not in METRIC_FIELD_TYPES:
            raise DashboardQueryError("unknown_field")
        resolved.metric_is_cost = mdef.get("type") == "cost"
    return resolved


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


def dimension_key(dimension: str, raw: Any, months: Sequence[str]) -> str | None:
    """The row key ``raw`` (the dimension's column for one card) falls under.
    ``None`` drops the card: a card created before the 12-month window."""
    if dimension == "lifecycle_phase":
        return lifecycle_key(raw)
    if dimension == "data_quality_bucket":
        return data_quality_bucket(raw)
    if dimension == "created_month":
        key = month_key(raw)
        return key if key in months else None
    return value_key(raw)


def dimension_domain(dimension: str | None, fdef: dict | None, months: Sequence[str]) -> list[str]:
    """The keys a dimension always shows, in display order, zero-filled when no
    card falls there — empty for a dimension whose keys are only what occurs."""
    if dimension == "lifecycle_phase":
        return list(LIFECYCLE_KEYS)
    if dimension == "data_quality_bucket":
        return list(DATA_QUALITY_BUCKETS)
    if dimension == "created_month":
        return list(months)
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
    axis_1: dict[str, float | int] = {}
    axis_2: dict[str, float | int] = {}
    for (k1, k2), v in values_2d.items():
        axis_1[k1] = axis_1.get(k1, 0) + v  # type: ignore[index]
        axis_2[k2] = axis_2.get(k2, 0) + v  # type: ignore[index]
    rank_1 = {k: i for i, k in enumerate(order_keys(axis_1, domain_1))}
    rank_2 = {k: i for i, k in enumerate(order_keys(axis_2, domain_2))}
    cells_sorted = sorted(values_2d.items(), key=lambda kv: (rank_1[kv[0][0]], rank_2[kv[0][1]]))
    return [{"x": x, "y": y, "value": v} for (x, y), v in cells_sorted], total


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
    if dimension == "lifecycle_phase":
        return card.lifecycle
    if dimension == "data_quality_bucket":
        return card.data_quality
    if dimension == "created_month":
        return card.created_at
    if dimension.startswith(FIELD_PREFIX):
        return card.attributes[dimension[len(FIELD_PREFIX) :]]
    return getattr(card, dimension)


def _live(card: Any, resolved: ResolvedQuery, read_scope: CardReadScope) -> list[Any]:
    """ACTIVE, of a visible type, readable by the caller, matching the filters."""
    q = resolved.query
    clauses = [card.status == "ACTIVE", *read_scope.where(card, mode="module")]
    if resolved.hidden_types:
        clauses.append(card.type.not_in(sorted(resolved.hidden_types)))
    if q.approval_status:
        clauses.append(card.approval_status == q.approval_status)
    return clauses


# Dimensions the fast path groups in SQL (``field:<key>`` too); lifecycle
# needs ``current_lifecycle_phase`` on the dates and stays in Python.
SQL_GROUPABLE: frozenset[str] = frozenset(
    {"type", "subtype", "approval_status", "data_quality_bucket", "created_month"}
)


def fast_path_applies(resolved: ResolvedQuery) -> bool:
    """Whether a query can be answered with ``COUNT … GROUP BY`` — a count of
    cards (no sankey, no sum / avg) with no lifecycle filter, over dimensions
    SQL can compute. Everything the Overview shows by default qualifies."""
    q = resolved.query
    if resolved.relation is not None or q.lifecycle_phase or q.metric != "count":
        return False
    return all(
        d is None or d in SQL_GROUPABLE or d.startswith(FIELD_PREFIX)
        for d in (q.group_by, q.group_by_2)
    )


def _sql_dimension(dimension: str, card: Any) -> Any:
    """The dimension as a groupable SQL expression. The quality buckets and
    the month mirror ``data_quality_bucket`` and ``month_key`` exactly (a
    missing score is 0, the month is read in UTC)."""
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
    if dimension.startswith(FIELD_PREFIX):
        return card.attributes[dimension[len(FIELD_PREFIX) :]].astext
    return getattr(card, dimension)


def sql_dimension_key(dimension: str, raw: Any, months: Sequence[str]) -> str | None:
    """``dimension_key`` for a value ``_sql_dimension`` already computed."""
    if dimension == "data_quality_bucket":
        return raw
    if dimension == "created_month":
        return raw if raw in months else None
    return value_key(raw)


def grouped_statement(resolved: ResolvedQuery, read_scope: CardReadScope) -> Any:
    """``SELECT dim…, COUNT(cards.id) … GROUP BY dim…`` for the fast path."""
    q = resolved.query
    dims = [_sql_dimension(d, Card) for d in (q.group_by, q.group_by_2) if d is not None]
    stmt = select(*dims, func.count(Card.id)).where(*_live(Card, resolved, read_scope))
    if q.card_type:
        stmt = stmt.where(Card.type == q.card_type)
    if q.subtype:
        stmt = stmt.where(Card.subtype == q.subtype)
    return stmt.group_by(*dims) if dims else stmt


async def _grouped_records(
    db: AsyncSession, resolved: ResolvedQuery, read_scope: CardReadScope, months: Sequence[str]
) -> list[tuple[Any, ...]]:
    dim_1, dim_2 = resolved.query.group_by, resolved.query.group_by_2
    records: list[tuple[Any, ...]] = []
    for row in (await db.execute(grouped_statement(resolved, read_scope))).all():
        *raws, count = row
        key_1 = sql_dimension_key(dim_1, raws[0], months) if dim_1 else None
        key_2 = sql_dimension_key(dim_2, raws[1], months) if dim_2 else None
        if (dim_1 and key_1 is None) or (dim_2 and key_2 is None):
            continue
        records.append((key_1, key_2, None, count))
    return records


async def _sankey_records(
    db: AsyncSession, resolved: ResolvedQuery, read_scope: CardReadScope, months: Sequence[str]
) -> list[tuple[Any, ...]]:
    dim_1, dim_2 = resolved.dimension, resolved.dimension_2
    phase = resolved.query.lifecycle_phase
    src, tgt = aliased(Card), aliased(Card)
    stmt = (
        select(
            _dimension_column(dim_1, src),  # type: ignore[arg-type]
            _dimension_column(dim_2, tgt),  # type: ignore[arg-type]
            src.lifecycle,
            tgt.lifecycle,
        )
        .select_from(Relation)
        .join(src, Relation.source_id == src.id)
        .join(tgt, Relation.target_id == tgt.id)
        .where(
            Relation.type == resolved.relation.key,  # type: ignore[union-attr]
            *_live(src, resolved, read_scope),
            *_live(tgt, resolved, read_scope),
        )
    )
    records: list[tuple[Any, ...]] = []
    for raw_1, raw_2, lc_src, lc_tgt in (await db.execute(stmt)).all():
        # A lifecycle filter holds for both ends of the pair.
        if phase and (lifecycle_key(lc_src) != phase or lifecycle_key(lc_tgt) != phase):
            continue
        key_1 = dimension_key(dim_1, raw_1, months)  # type: ignore[arg-type]
        key_2 = dimension_key(dim_2, raw_2, months)  # type: ignore[arg-type]
        if key_1 is None or key_2 is None:
            continue
        records.append((key_1, key_2, None))
    return records


async def _card_records(
    db: AsyncSession, resolved: ResolvedQuery, read_scope: CardReadScope, months: Sequence[str]
) -> list[tuple[Any, ...]]:
    """One record per card — for what SQL cannot group: the lifecycle phase
    (computed from the dates), and sums / averages read through ``cost_value``."""
    q = resolved.query
    dim_1, dim_2 = q.group_by, q.group_by_2
    metric_col = Card.attributes[q.metric_field] if q.metric_field else Card.id
    stmt = select(
        _dimension_column(dim_1, Card) if dim_1 else Card.id,
        _dimension_column(dim_2, Card) if dim_2 else Card.id,
        metric_col,
        Card.lifecycle,
    ).where(*_live(Card, resolved, read_scope))
    if q.card_type:
        stmt = stmt.where(Card.type == q.card_type)
    if q.subtype:
        stmt = stmt.where(Card.subtype == q.subtype)
    records: list[tuple[Any, ...]] = []
    for raw_1, raw_2, raw_metric, lifecycle in (await db.execute(stmt)).all():
        if q.lifecycle_phase and lifecycle_key(lifecycle) != q.lifecycle_phase:
            continue
        key_1 = dimension_key(dim_1, raw_1, months) if dim_1 else None
        key_2 = dimension_key(dim_2, raw_2, months) if dim_2 else None
        if (dim_1 and key_1 is None) or (dim_2 and key_2 is None):
            continue
        records.append((key_1, key_2, raw_metric if q.metric_field else None))
    return records


async def run_query(
    db: AsyncSession,
    resolved: ResolvedQuery,
    read_scope: CardReadScope,
    *,
    today: date | None = None,
    force_python: bool = False,
) -> dict[str, Any]:
    """``{"dimension", "dimension_2", "rows", "total"}`` for a resolved query.

    A count over SQL-groupable dimensions is a ``GROUP BY`` (the Overview's
    tiles and charts must not stream the card table once per widget); the rest
    reads one row per card. ``force_python`` takes the per-card path always —
    the parity test runs every fast-path query both ways.
    """
    months = last_months(today or datetime.now(timezone.utc).date())
    if resolved.relation is not None:
        records = await _sankey_records(db, resolved, read_scope, months)
    elif not force_python and fast_path_applies(resolved):
        records = await _grouped_records(db, resolved, read_scope, months)
    else:
        records = await _card_records(db, resolved, read_scope, months)
    dim_1, dim_2 = resolved.dimension, resolved.dimension_2
    rows, total = aggregate(
        records,
        metric=resolved.query.metric,
        shape=result_shape(resolved),
        domain_1=dimension_domain(dim_1, resolved.field_1, months),
        domain_2=dimension_domain(dim_2, resolved.field_2, months),
    )
    return {"dimension": dim_1, "dimension_2": dim_2, "rows": rows, "total": total}
