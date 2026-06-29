"""Safe interpreter for the freeform Custom Report :class:`CustomReportSpec`.

Security model (this is the crux — see CLAUDE.md and the spec module docstring):

* **No raw SQL.** Every database access is a SQLAlchemy ORM expression. The only
  dynamic values that reach a query are ``Card.type`` and ``Card.subtype`` —
  both validated against the live metamodel and passed as bound parameters.
* **Single validation chokepoint.** ``_validate_keys`` is the one place every
  attribute / relation-type / subtype / tag-group reference is checked against
  the live metamodel before it is used. Filters, dimensions and measures are
  applied **in Python** over a capped, type-scoped working set, so an untrusted
  key string can never traverse a JSONB path or be interpolated into SQL.
* **Cost RBAC.** ``costs.view`` is required if *any* cost field is touched by a
  filter, dimension or measure — a filter on a cost field leaks cost data
  through row inclusion even when the field is never displayed.
* **Resource caps.** The source working set and the distinct-group cardinality
  are both hard-capped; over-cap reports surface ``meta.truncated``.
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.tag import CardTag, Tag, TagGroup
from app.models.user import User
from app.schemas.custom_report import (
    Aggregation,
    CustomReportSpec,
    Dimension,
    DimensionKind,
    Filter,
    FilterOp,
    FilterTarget,
    Measure,
)
from app.services.cost_field_filter import cost_field_keys_from_card_schema
from app.services.permission_service import PermissionService

_SAFE_KEY_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")

# Numeric metamodel field types eligible for sum/avg/min/max measures.
_NUMERIC_FIELD_TYPES = {"number", "cost"}

# Hard resource caps (defense against a spec that scans/groups the whole landscape).
ENGINE_MAX_SOURCE_CARDS = 20000
ENGINE_MAX_GROUPS = 1000

_NONE_LABEL = "(none)"


def _field_type_map(fields_schema: list[dict] | None) -> dict[str, str]:
    """Map every field key in a type's schema to its declared field type."""
    out: dict[str, str] = {}
    for section in fields_schema or []:
        for field in section.get("fields", []) or []:
            key = field.get("key")
            if isinstance(key, str):
                out[key] = field.get("type", "text")
    return out


def _option_label_map(fields_schema: list[dict] | None) -> dict[str, dict[str, str]]:
    """For select fields, map field key -> {option key -> option label}."""
    out: dict[str, dict[str, str]] = {}
    for section in fields_schema or []:
        for field in section.get("fields", []) or []:
            key = field.get("key")
            opts = field.get("options")
            if isinstance(key, str) and isinstance(opts, list):
                out[key] = {
                    o.get("key"): o.get("label", o.get("key"))
                    for o in opts
                    if isinstance(o, dict) and o.get("key")
                }
    return out


def _num(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _subtype_keys(card_type: CardType | None) -> set[str]:
    out: set[str] = set()
    for st in (card_type.subtypes if card_type else None) or []:
        if isinstance(st, dict) and isinstance(st.get("key"), str):
            out.add(st["key"])
    return out


class _Metamodel:
    """Snapshot of the metamodel needed to validate and label a spec."""

    def __init__(
        self,
        card_types: list[CardType],
        relation_type_keys: set[str],
        tag_groups: dict[str, str],
    ) -> None:
        self.by_key = {t.key: t for t in card_types}
        self.relation_type_keys = relation_type_keys
        self.tag_group_names = tag_groups  # id(str) -> name


async def _load_metamodel(db: AsyncSession) -> _Metamodel:
    types = (await db.execute(select(CardType))).scalars().all()
    from app.models.relation_type import RelationType

    rels = (await db.execute(select(RelationType))).scalars().all()
    groups = (await db.execute(select(TagGroup))).scalars().all()
    return _Metamodel(
        card_types=list(types),
        relation_type_keys={r.key for r in rels},
        tag_groups={str(g.id): g.name for g in groups},
    )


def _require_type(mm: _Metamodel, key: str) -> CardType:
    ct = mm.by_key.get(key)
    if ct is None or ct.is_hidden:
        raise HTTPException(status_code=400, detail=f"Unknown card type '{key}'")
    return ct


def _validate_keys(
    spec: CustomReportSpec,
    mm: _Metamodel,
    source_type: CardType,
    effective_type: CardType,
) -> None:
    """The single chokepoint: every dynamic reference must pass regex + metamodel."""
    source_keys = _field_type_map(source_type.fields_schema)
    source_subtypes = _subtype_keys(source_type)
    eff_keys = _field_type_map(effective_type.fields_schema)
    eff_subtypes = _subtype_keys(effective_type)

    def _check_key(key: str | None, where: str) -> None:
        if not key or not _SAFE_KEY_RE.match(key):
            raise HTTPException(status_code=400, detail=f"Invalid key {key!r} in {where}")

    # Source filters reference the source type's fields / subtypes.
    for f in spec.source.filters:
        if f.target == FilterTarget.attribute:
            _check_key(f.key, "filter")
            if f.key not in source_keys:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unknown field '{f.key}' for type '{source_type.key}'",
                )
        if f.target == FilterTarget.subtype:
            for v in _as_list(f.value):
                if isinstance(v, str) and source_subtypes and v not in source_subtypes:
                    raise HTTPException(
                        status_code=400, detail=f"Unknown subtype '{v}' for '{source_type.key}'"
                    )

    if spec.source.subtypes and source_subtypes:
        for st in spec.source.subtypes:
            if st not in source_subtypes:
                raise HTTPException(
                    status_code=400, detail=f"Unknown subtype '{st}' for '{source_type.key}'"
                )

    if spec.source.traverse and spec.source.traverse.relation_type not in mm.relation_type_keys:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown relation type '{spec.source.traverse.relation_type}'",
        )

    # Dimensions / measures reference the *effective* (post-traversal) type.
    for d in spec.dimensions:
        if d.kind == DimensionKind.attribute:
            _check_key(d.key, "dimension")
            if d.key not in eff_keys:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unknown field '{d.key}' for type '{effective_type.key}'",
                )
        elif d.kind == DimensionKind.relation:
            _check_key(d.key, "dimension")
            if d.key not in mm.relation_type_keys:
                raise HTTPException(status_code=400, detail=f"Unknown relation type '{d.key}'")
        elif d.kind == DimensionKind.tag_group:
            if not d.key or d.key not in mm.tag_group_names:
                raise HTTPException(status_code=400, detail=f"Unknown tag group '{d.key}'")

    for m in spec.measures:
        if m.agg == Aggregation.count:
            continue
        _check_key(m.field, "measure")
        ftype = eff_keys.get(m.field)
        if ftype is None:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown field '{m.field}' for type '{effective_type.key}'",
            )
        if ftype not in _NUMERIC_FIELD_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"Field '{m.field}' is not numeric (type '{ftype}')",
            )
        _ = eff_subtypes  # reserved for future subtype-scoped measures


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _collect_cost_fields(
    spec: CustomReportSpec, source_type: CardType, effective_type: CardType
) -> set[str]:
    """Cost fields touched by ANY filter, dimension or measure (the union)."""
    source_cost = cost_field_keys_from_card_schema(source_type.fields_schema)
    eff_cost = cost_field_keys_from_card_schema(effective_type.fields_schema)
    used: set[str] = set()
    for f in spec.source.filters:
        if f.target == FilterTarget.attribute and f.key in source_cost:
            used.add(f.key)
    for d in spec.dimensions:
        if d.kind == DimensionKind.attribute and d.key in eff_cost:
            used.add(d.key)  # type: ignore[arg-type]
    for m in spec.measures:
        if m.field and m.field in eff_cost:
            used.add(m.field)
    return used


def _apply_op(actual: Any, op: FilterOp, value: Any) -> bool:
    if op == FilterOp.is_set:
        return actual is not None and actual != ""
    if op == FilterOp.is_empty:
        return actual is None or actual == ""
    if op == FilterOp.eq:
        return str(actual) == str(value)
    if op == FilterOp.ne:
        return str(actual) != str(value)
    if op == FilterOp.in_:
        return str(actual) in {str(v) for v in _as_list(value)}
    if op == FilterOp.not_in:
        return str(actual) not in {str(v) for v in _as_list(value)}
    if op == FilterOp.contains:
        return actual is not None and str(value).lower() in str(actual).lower()
    if op in (FilterOp.gt, FilterOp.gte, FilterOp.lt, FilterOp.lte):
        a, b = _num(actual), _num(value)
        if a is None or b is None:
            return False
        if op == FilterOp.gt:
            return a > b
        if op == FilterOp.gte:
            return a >= b
        if op == FilterOp.lt:
            return a < b
        return a <= b
    return False


def _card_matches_filter(
    card: Card, f: Filter, tag_ids: set[str], tag_names: set[str], phase: str | None
) -> bool:
    if f.target == FilterTarget.tag:
        wanted = {str(v).lower() for v in _as_list(f.value)}
        has = {str(t).lower() for t in (tag_ids | tag_names)}
        if f.op == FilterOp.is_set:
            return bool(has)
        if f.op == FilterOp.is_empty:
            return not has
        if f.op in (FilterOp.eq, FilterOp.in_, FilterOp.contains):
            return bool(wanted & has)
        if f.op in (FilterOp.ne, FilterOp.not_in):
            return not (wanted & has)
        return False

    if f.target == FilterTarget.attribute:
        actual = (card.attributes or {}).get(f.key)
    elif f.target == FilterTarget.subtype:
        actual = card.subtype
    elif f.target == FilterTarget.name:
        actual = card.name
    elif f.target == FilterTarget.approval_status:
        actual = card.approval_status
    elif f.target == FilterTarget.lifecycle:
        actual = phase
    else:
        return False
    return _apply_op(actual, f.op, f.value)


async def _load_tags(db: AsyncSession, card_ids: list) -> tuple[dict, dict]:
    """Return (card_id -> {tag_id}, card_id -> {tag_name}) for the working set."""
    by_id: dict[str, set[str]] = {}
    by_name: dict[str, set[str]] = {}
    if not card_ids:
        return by_id, by_name
    rows = (
        await db.execute(
            select(CardTag.card_id, CardTag.tag_id, Tag.name)
            .join(Tag, Tag.id == CardTag.tag_id)
            .where(CardTag.card_id.in_(card_ids))
        )
    ).all()
    for card_id, tag_id, name in rows:
        by_id.setdefault(str(card_id), set()).add(str(tag_id))
        by_name.setdefault(str(card_id), set()).add(name)
    return by_id, by_name


async def _tag_group_buckets(db: AsyncSession, card_ids: list, group_id: str) -> dict[str, str]:
    """card_id -> first tag name the card carries within the given tag group."""
    out: dict[str, str] = {}
    if not card_ids:
        return out
    import uuid as _uuid

    try:
        gid = _uuid.UUID(group_id)
    except (ValueError, AttributeError):
        return out
    rows = (
        await db.execute(
            select(CardTag.card_id, Tag.name)
            .join(Tag, Tag.id == CardTag.tag_id)
            .where(CardTag.card_id.in_(card_ids), Tag.tag_group_id == gid)
        )
    ).all()
    for card_id, name in rows:
        out.setdefault(str(card_id), name)
    return out


async def _relation_buckets(
    db: AsyncSession, card_ids: list, relation_type_key: str
) -> dict[str, str]:
    """card_id -> first related card name via the given relation type."""
    out: dict[str, str] = {}
    if not card_ids:
        return out
    id_set = {str(c) for c in card_ids}
    rels = (
        (
            await db.execute(
                select(Relation).where(
                    Relation.type == relation_type_key,
                    (Relation.source_id.in_(card_ids)) | (Relation.target_id.in_(card_ids)),
                )
            )
        )
        .scalars()
        .all()
    )
    other_ids: set[str] = set()
    pair: list[tuple[str, str]] = []  # (working card id, other id)
    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        if sid in id_set:
            pair.append((sid, tid))
            other_ids.add(tid)
        if tid in id_set:
            pair.append((tid, sid))
            other_ids.add(sid)
    names: dict[str, str] = {}
    if other_ids:
        for c in (
            (await db.execute(select(Card).where(Card.id.in_(list(other_ids))))).scalars().all()
        ):
            names[str(c.id)] = c.name
    for working_id, other_id in pair:
        if working_id not in out and other_id in names:
            out[working_id] = names[other_id]
    return out


async def _traverse(
    db: AsyncSession, source_cards: list[Card], spec: CustomReportSpec
) -> list[Card]:
    """One-hop relation traversal to the configured target type."""
    trav = spec.source.traverse
    assert trav is not None
    source_ids = [c.id for c in source_cards]
    source_id_set = {str(c.id) for c in source_cards}
    if not source_ids:
        return []
    rels = (
        (
            await db.execute(
                select(Relation).where(
                    Relation.type == trav.relation_type,
                    (Relation.source_id.in_(source_ids)) | (Relation.target_id.in_(source_ids)),
                )
            )
        )
        .scalars()
        .all()
    )
    target_ids: set[str] = set()
    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        if trav.direction in ("out", "any") and sid in source_id_set:
            target_ids.add(tid)
        if trav.direction in ("in", "any") and tid in source_id_set:
            target_ids.add(sid)
    target_ids -= source_id_set
    if not target_ids:
        return []
    result = (
        (
            await db.execute(
                select(Card).where(
                    Card.id.in_(list(target_ids)),
                    Card.type == trav.target_type,
                    Card.status == "ACTIVE",
                )
            )
        )
        .scalars()
        .all()
    )
    return list(result)


def _dimension_label(d: Dimension, mm: _Metamodel, eff_type: CardType) -> str:
    if d.label:
        return d.label
    if d.kind == DimensionKind.attribute:
        for section in eff_type.fields_schema or []:
            for field in section.get("fields", []) or []:
                if field.get("key") == d.key:
                    return field.get("label", d.key)
        return d.key or "attribute"
    if d.kind == DimensionKind.subtype:
        return "Subtype"
    if d.kind == DimensionKind.lifecycle:
        return "Lifecycle phase"
    if d.kind == DimensionKind.tag_group:
        return mm.tag_group_names.get(d.key or "", "Tag group")
    if d.kind == DimensionKind.relation:
        return d.key or "relation"
    return "dimension"


def _measure_label(m: Measure) -> str:
    if m.label:
        return m.label
    if m.agg == Aggregation.count:
        return "Count"
    return f"{m.agg.value}({m.field})"


async def run_custom_report(db: AsyncSession, user: User, spec: CustomReportSpec) -> dict:
    """Execute a validated :class:`CustomReportSpec` and return {columns, rows, meta}."""
    mm = await _load_metamodel(db)
    source_type = _require_type(mm, spec.source.card_type)
    effective_type = (
        _require_type(mm, spec.source.traverse.target_type) if spec.source.traverse else source_type
    )

    # 1. Validation chokepoint — every dynamic reference checked here.
    _validate_keys(spec, mm, source_type, effective_type)

    # 2. Cost RBAC on the union of touched cost fields.
    if _collect_cost_fields(spec, source_type, effective_type):
        await PermissionService.require_permission(db, user, "costs.view")

    # 3. Source working set — type + subtype equality only (both validated, bound).
    src_query = select(Card).where(Card.type == source_type.key, Card.status == "ACTIVE")
    if spec.source.subtypes:
        src_query = src_query.where(Card.subtype.in_(spec.source.subtypes))
    src_query = src_query.order_by(Card.name)
    source_cards = list((await db.execute(src_query)).scalars().all())

    truncated = False
    if len(source_cards) > ENGINE_MAX_SOURCE_CARDS:
        source_cards = source_cards[:ENGINE_MAX_SOURCE_CARDS]
        truncated = True

    # 4. Apply source filters in Python (no untrusted string ever reaches SQL).
    if spec.source.filters:
        src_ids = [c.id for c in source_cards]
        tag_ids_map, tag_names_map = await _load_tags(db, src_ids)
        filtered: list[Card] = []
        for c in source_cards:
            cid = str(c.id)
            phase = _current_phase(c.lifecycle)
            if all(
                _card_matches_filter(
                    c, f, tag_ids_map.get(cid, set()), tag_names_map.get(cid, set()), phase
                )
                for f in spec.source.filters
            ):
                filtered.append(c)
        source_cards = filtered

    # 5. Optional one-hop traversal.
    working = await _traverse(db, source_cards, spec) if spec.source.traverse else source_cards

    # 6. Pre-compute per-card dimension bucket lookups that need the DB.
    working_ids = [c.id for c in working]
    tag_group_lookup: dict[int, dict[str, str]] = {}
    relation_lookup: dict[int, dict[str, str]] = {}
    for i, d in enumerate(spec.dimensions):
        if d.kind == DimensionKind.tag_group and d.key:
            tag_group_lookup[i] = await _tag_group_buckets(db, working_ids, d.key)
        elif d.kind == DimensionKind.relation and d.key:
            relation_lookup[i] = await _relation_buckets(db, working_ids, d.key)

    opt_labels = _option_label_map(effective_type.fields_schema)

    def _dim_value(card: Card, i: int, d: Dimension) -> str:
        if d.kind == DimensionKind.attribute:
            raw = (card.attributes or {}).get(d.key)
            if raw is None or raw == "":
                return _NONE_LABEL
            label_map = opt_labels.get(d.key or "")
            if label_map and isinstance(raw, str):
                return label_map.get(raw, raw)
            return str(raw)
        if d.kind == DimensionKind.subtype:
            return card.subtype or _NONE_LABEL
        if d.kind == DimensionKind.lifecycle:
            return _current_phase(card.lifecycle) or _NONE_LABEL
        if d.kind == DimensionKind.tag_group:
            return tag_group_lookup.get(i, {}).get(str(card.id), _NONE_LABEL)
        if d.kind == DimensionKind.relation:
            return relation_lookup.get(i, {}).get(str(card.id), _NONE_LABEL)
        return _NONE_LABEL

    # 7. Group + aggregate in Python.
    dim_keys = [f"d{i}" for i in range(len(spec.dimensions))]
    measure_keys = [f"m{i}" for i in range(len(spec.measures))]
    groups: dict[tuple[str, ...], list[Card]] = {}
    for card in working:
        key = tuple(_dim_value(card, i, d) for i, d in enumerate(spec.dimensions))
        groups.setdefault(key, []).append(card)
        if len(groups) > ENGINE_MAX_GROUPS:
            truncated = True
            break

    def _measure_value(cards: list[Card], m: Measure) -> float | int:
        if m.agg == Aggregation.count:
            return len(cards)
        nums = [
            n for n in (_num((c.attributes or {}).get(m.field)) for c in cards) if n is not None
        ]
        if not nums:
            return 0
        if m.agg == Aggregation.sum:
            return round(sum(nums), 4)
        if m.agg == Aggregation.avg:
            return round(sum(nums) / len(nums), 4)
        if m.agg == Aggregation.min:
            return min(nums)
        return max(nums)

    rows: list[dict] = []
    for key, cards in groups.items():
        row: dict[str, Any] = {dim_keys[i]: key[i] for i in range(len(spec.dimensions))}
        for j, m in enumerate(spec.measures):
            row[measure_keys[j]] = _measure_value(cards, m)
        rows.append(row)

    # 8. Sort + limit.
    columns = [
        {
            "key": dim_keys[i],
            "label": _dimension_label(d, mm, effective_type),
            "kind": "dimension",
            "type": "string",
        }
        for i, d in enumerate(spec.dimensions)
    ] + [
        {
            "key": measure_keys[j],
            "label": _measure_label(m),
            "kind": "measure",
            "type": "number",
        }
        for j, m in enumerate(spec.measures)
    ]

    if spec.sort:
        sort_key = _resolve_sort_key(spec.sort.by, columns)
        if sort_key:
            rows.sort(
                key=lambda r: _sort_value(r.get(sort_key)),
                reverse=spec.sort.desc,
            )
    elif measure_keys:
        rows.sort(key=lambda r: _sort_value(r.get(measure_keys[0])), reverse=True)

    rows = rows[: spec.limit]

    return {
        "columns": columns,
        "rows": rows,
        "meta": {
            "title": spec.title,
            "card_type": source_type.key,
            "effective_type": effective_type.key,
            "visualization": spec.visualization.kind.value,
            "total_source_cards": len(source_cards),
            "total_working_cards": len(working),
            "group_count": len(rows),
            "truncated": truncated,
        },
    }


def _current_phase(lifecycle: dict | None) -> str | None:
    # Local import avoids a circular import with the reports router at module load.
    from app.api.v1.reports import _current_lifecycle_phase

    return _current_lifecycle_phase(lifecycle)


def _resolve_sort_key(by: str, columns: list[dict]) -> str | None:
    for c in columns:
        if by in (c["key"], c["label"]):
            return c["key"]
    return None


def _sort_value(v: Any) -> tuple[int, float, str]:
    """Stable ordering across mixed numeric/string cells."""
    if isinstance(v, (int, float)):
        return (0, float(v), "")
    return (1, 0.0, str(v))
