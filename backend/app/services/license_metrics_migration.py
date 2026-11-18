"""Data steps of migration 192 (license metrics), as functions over a ``Session``.

They use lightweight Core tables, never the ORM models: a later migration may add a column
to a model, and a model-wide SELECT would then fail here on an older database. Nothing here
commits; none of it touches ``cards.updated_at`` (a Core update does not fire ``onupdate``).
The migration reads the old ``license_types`` rows itself (raw, before its DDL) and hands a
plan to ``apply_type_plan``; ``licensing_migration`` holds the pure helpers.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Session

from app.services.licensing_migration import (
    DEFAULT_METRICS,
    LICENSING_TYPES,
    MODEL_KEY,
    citing_model_calculations,
    without_model_field,
)

REPORT_KEY = "license_metrics_migration_report"
REPORT_CAP = 200

_metrics = sa.table(
    "license_metrics",
    sa.column("id", UUID(as_uuid=True)),
    sa.column("key", sa.String),
    sa.column("label", sa.String),
    sa.column("sort_order", sa.Integer),
    sa.column("archived", sa.Boolean),
    sa.column("translations", JSONB),
)
_types = sa.table(
    "license_types",
    sa.column("id", UUID(as_uuid=True)),
    sa.column("metric_key", sa.String),
    sa.column("key", sa.String),
    sa.column("label", sa.String),
    sa.column("sort_order", sa.Integer),
    sa.column("archived", sa.Boolean),
    sa.column("translations", JSONB),
)
_cards = sa.table(
    "cards",
    sa.column("id", UUID(as_uuid=True)),
    sa.column("type", sa.String),
    sa.column("attributes", JSONB),
)
_card_types = sa.table("card_types", sa.column("key", sa.String), sa.column("fields_schema", JSONB))
_licenses = sa.table(
    "card_licenses", sa.column("card_id", UUID(as_uuid=True)), sa.column("items", JSONB)
)
_calcs = sa.table(
    "calculations",
    sa.column("id", UUID(as_uuid=True)),
    sa.column("name", sa.String),
    sa.column("formula", sa.Text),
)
_settings = sa.table(
    "app_settings", sa.column("id", sa.String), sa.column("general_settings", JSONB)
)


def seed_default_metrics(session: Session) -> None:
    """``users`` and ``installations``, insert-only."""
    have = set(session.execute(sa.select(_metrics.c.key)).scalars())
    for order, (key, label) in enumerate(DEFAULT_METRICS):
        if key not in have:
            session.execute(
                sa.insert(_metrics).values(
                    id=uuid.uuid4(),
                    key=key,
                    label=label,
                    sort_order=order,
                    archived=False,
                    translations={},
                )
            )


def used_metrics(session: Session) -> dict[str, set[str]]:
    """``{type_key: {metric_key, ...}}``: where ``card_licenses.items`` holds a cell."""
    used: dict[str, set[str]] = {}
    for items in session.execute(sa.select(_licenses.c["items"])).scalars():
        for metric, cells in (items or {}).items():
            for type_key in cells or {}:
                used.setdefault(type_key, set()).add(metric)
    return used


def apply_type_plan(
    session: Session, plan: Iterable[tuple[str, str]], templates: dict[str, dict]
) -> None:
    """Give every ``(type_key, metric_key)`` of the plan its row. A row of the type with no
    metric yet (the old row, mid-migration) is claimed first; any further metric gets a copy
    of ``templates[type_key]`` (``label``, ``sort_order``, ``archived``, ``translations``).
    A pair that already has its row is left alone, so a re-run adds nothing."""
    for type_key, metric_key in plan:
        pair = sa.and_(_types.c.key == type_key, _types.c.metric_key == metric_key)
        if session.execute(sa.select(_types.c.id).where(pair)).first():
            continue
        orphan = session.execute(
            sa.select(_types.c.id)
            .where(_types.c.key == type_key, _types.c.metric_key.is_(None))
            .limit(1)
        ).scalar()
        if orphan is not None:
            session.execute(
                sa.update(_types).where(_types.c.id == orphan).values(metric_key=metric_key)
            )
            continue
        t = templates[type_key]
        session.execute(
            sa.insert(_types).values(
                id=uuid.uuid4(),
                metric_key=metric_key,
                key=type_key,
                label=t["label"],
                sort_order=t["sort_order"],
                archived=t["archived"],
                translations=t["translations"],
            )
        )


def strip_model_field(session: Session) -> None:
    """``licensingModel`` and its emptied ``Licensing`` section leave both card types."""
    rows = session.execute(
        sa.select(_card_types.c.key, _card_types.c.fields_schema).where(
            _card_types.c.key.in_(LICENSING_TYPES)
        )
    ).all()
    for key, schema in rows:
        after = without_model_field(key, schema or [])
        if after != (schema or []):
            session.execute(
                sa.update(_card_types).where(_card_types.c.key == key).values(fields_schema=after)
            )


def ignored_metric_cards(session: Session) -> list[dict]:
    """Cards of the two types holding data under a metric their ``licensingModel`` did not
    list: until now stored but ignored, from now on shown. Read this BEFORE
    ``clear_model_values``."""
    metrics_of: dict[uuid.UUID, set[str]] = {}
    attrs_of: dict[uuid.UUID, dict] = {}
    rows = session.execute(
        sa.select(_licenses.c.card_id, _licenses.c["items"], _cards.c.attributes)
        .join(_cards, _cards.c.id == _licenses.c.card_id)
        .where(_cards.c.type.in_(LICENSING_TYPES))
        .order_by(_licenses.c.card_id)
    ).all()
    for card_id, items, attrs in rows:
        attrs_of[card_id] = attrs or {}
        metrics_of.setdefault(card_id, set()).update(
            m for m, cells in (items or {}).items() if cells
        )
    out = []
    for card_id, metrics in metrics_of.items():
        model = attrs_of[card_id].get(MODEL_KEY)
        ignored = sorted(metrics - set(model if isinstance(model, list) else []))
        if ignored:
            out.append({"card_id": str(card_id), "metrics": ignored})
    return sorted(out, key=lambda c: c["card_id"])


def clear_model_values(session: Session) -> int:
    """Drop ``attributes.licensingModel`` of both card types; returns how many cards had it.
    A type whose schema still holds a field of that key (an extension's, which
    ``without_model_field`` keeps) keeps its values. ``updated_at`` stays where it is."""
    owned = {
        key
        for key, schema in session.execute(
            sa.select(_card_types.c.key, _card_types.c.fields_schema).where(
                _card_types.c.key.in_(LICENSING_TYPES)
            )
        )
        if any(
            isinstance(f, dict) and f.get("key") == MODEL_KEY
            for s in without_model_field(key, schema or [])
            if isinstance(s, dict)
            for f in s.get("fields", [])
        )
    }
    rows = session.execute(
        sa.select(_cards.c.id, _cards.c.attributes).where(
            _cards.c.type.in_(LICENSING_TYPES - owned), _cards.c.attributes.has_key(MODEL_KEY)
        )
    ).all()
    for card_id, attrs in rows:
        session.execute(
            sa.update(_cards)
            .where(_cards.c.id == card_id)
            .values(attributes={k: v for k, v in attrs.items() if k != MODEL_KEY})
        )
    return len(rows)


def can_downgrade(session: Session) -> bool:
    """False while a type key exists under more than one metric (the old unique key
    could not hold it)."""
    dup = session.execute(
        sa.select(_types.c.key)
        .group_by(_types.c.key)
        .having(sa.func.count(sa.distinct(_types.c.metric_key)) > 1)
        .limit(1)
    ).first()
    return dup is None


def collect_report(
    session: Session,
    plan: list[tuple[str, str]],
    used: dict[str, set[str]],
    templates: dict[str, dict],
    cards: list[dict],
) -> dict:
    """What the admin should look at after 192, capped at ``REPORT_CAP`` lines per list."""
    by_type: dict[str, list[str]] = {}
    for type_key, metric_key in plan:
        by_type.setdefault(type_key, []).append(metric_key)
    duplicated = [
        {"key": k, "label": templates[k]["label"], "metrics": ms}
        for k, ms in by_type.items()
        if len(ms) > 1 and len(used.get(k) or ()) > 1
    ]
    attached = [
        {"key": k, "label": templates[k]["label"]}
        for k, ms in by_type.items()
        if len(ms) > 1 and len(used.get(k) or ()) <= 1
    ]
    calcs = citing_model_calculations(
        (str(i), name, formula)
        for i, name, formula in session.execute(
            sa.select(_calcs.c.id, _calcs.c.name, _calcs.c.formula)
        )
    )
    return {
        "duplicated_types": duplicated[:REPORT_CAP],
        "attached_to_both": attached[:REPORT_CAP],
        "calculations": calcs[:REPORT_CAP],
        "cards": cards[:REPORT_CAP],
        "total_cards": len(cards),
    }


def write_report(session: Session, report: dict) -> None:
    """Key-scoped: only ``REPORT_KEY`` of ``general_settings`` is written."""
    patch = sa.literal({REPORT_KEY: report}, JSONB)
    session.execute(
        sa.update(_settings)
        .where(_settings.c.id == "default")
        .values(
            general_settings=sa.func.coalesce(
                _settings.c.general_settings, sa.cast(sa.literal("{}"), JSONB)
            ).op("||")(patch)
        )
    )
