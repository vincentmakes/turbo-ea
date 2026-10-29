"""Homepage dashboards: who sees which, what a widget may hold, copies, resets.

The route module (``api/v1/dashboards.py``) only wires these together. Every
decision is a plain function here so mutmut can reach it — a decorated route
body is invisible to it.

Invariants (``.claude/rules/dashboards.md``):

- A widget's config never holds a card, relation or tag id
  (``contains_uuid`` refuses any UUID-shaped string), so the ``widgets``
  column transfers between instances verbatim.
- ``allowed_roles`` holds role keys that exist. An empty list means every
  role; a wildcard role sees every dashboard whether or not it is listed, and
  the seeded Admin dashboard lists the roles holding ``admin.users`` so Access
  reads as it works.
- The three built-in dashboards are never deleted, only hidden; **Reset to
  default** rewrites their widgets from ``dashboard_defaults``.
"""

from __future__ import annotations

import math
import re
import secrets
import uuid
from collections.abc import Callable, Iterable, Mapping, Sequence
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dashboard import Dashboard
from app.models.role import Role
from app.services import audit_changes
from app.services.dashboard_defaults import (
    CHART_KINDS,
    DEFAULT_DASHBOARDS,
    GRID_COLUMNS,
    KPI_PRESETS,
    SERIES_SHAPES,
    SOURCE_SERIES,
    TWO_DIMENSION_CHARTS,
    WIDGET_TYPES,
    default_widgets,
)
from app.services.dashboard_query import DashboardQuery, query_problem

MAX_WIDGETS = 60
MAX_CONFIG_CHARS = 4000
MAX_RECENT_ROWS = 50
KEY_MAX = 60
_SLUG_BODY_MAX = KEY_MAX - 7  # room for "-" + 6 hex characters
_SUFFIX_RE = re.compile(r"-[0-9a-f]{6}$")
_UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}"
)
GOOD_DIRECTIONS = ("up", "down")
KPI_FORMATS = ("number", "percent")
# What a query KPI shows under its value: its share of the unnarrowed count,
# or that count itself ("of 120") — both read ``base`` from ``/dashboards/kpi``.
KPI_SECONDARY = ("share_of_total", "base_count")


class DashboardError(Exception):
    """A request the dashboard rules refuse; ``status`` / ``code`` become the
    HTTP status and ``detail``."""

    def __init__(self, status: int, code: str):
        super().__init__(code)
        self.status = status
        self.code = code


# ── Visibility ───────────────────────────────────────────────────────────


def can_see(dashboard: Any, *, role_key: str, wildcard: bool, can_manage: bool) -> bool:
    """Whether a user sees ``dashboard`` as a homepage tab.

    A manager (``admin.dashboards``) sees every dashboard, hidden or
    restricted, since they are the ones who configure it. Anyone else sees a
    dashboard that is not hidden and is open to every role (``[]``), to their
    effective role (impersonation honoured by the caller), or to everything
    because their role is a wildcard.
    """
    if can_manage:
        return True
    if dashboard.is_hidden:
        return False
    roles = dashboard.allowed_roles or []
    return wildcard or not roles or role_key in roles


def dashboard_payload(dashboard: Any, *, can_manage: bool) -> dict[str, Any]:
    """The API shape. ``allowed_roles`` is access-control configuration, so it
    goes to managers only — the trim ``_user_response_lite`` makes for users."""
    out: dict[str, Any] = {
        "id": str(dashboard.id),
        "key": dashboard.key,
        "name": dashboard.name,
        "translations": dict(dashboard.translations or {}),
        "description": dashboard.description,
        "icon": dashboard.icon,
        "built_in": bool(dashboard.built_in),
        "is_hidden": bool(dashboard.is_hidden),
        "sort_order": dashboard.sort_order,
        "widgets": list(dashboard.widgets or []),
        "can_manage": can_manage,
    }
    if can_manage:
        out["allowed_roles"] = list(dashboard.allowed_roles or [])
    return out


def sort_dashboards(dashboards: Iterable[Any]) -> list[Any]:
    return sorted(dashboards, key=lambda d: (d.sort_order, d.name.casefold(), d.key))


# ── Widget validation ────────────────────────────────────────────────────


def contains_uuid(value: Any) -> bool:
    """Whether any string anywhere in ``value`` carries a UUID."""
    if isinstance(value, str):
        return bool(_UUID_RE.search(value))
    if isinstance(value, Mapping):
        return any(contains_uuid(k) or contains_uuid(v) for k, v in value.items())
    if isinstance(value, (list, tuple)):
        return any(contains_uuid(v) for v in value)
    return False


def _query_config_problem(raw: Any) -> str | None:
    if not isinstance(raw, dict):
        return "query_required"
    try:
        query = DashboardQuery.model_validate(raw)
    except ValidationError:
        return "invalid_query"
    return query_problem(query)


def _source_problem(config: Mapping[str, Any], shape: str) -> str | None:
    """A ``source`` + ``series`` pair must name a series of that source of the
    ``shape`` the widget draws (``single`` for a KPI or a gauge)."""
    series = SOURCE_SERIES.get(config["source"]) if isinstance(config["source"], str) else None
    if series is None:
        return "unknown_source"
    if config.get("series") not in series:
        return "unknown_series"
    if SERIES_SHAPES[config["series"]] != shape:
        return "series_shape_mismatch"
    return None


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _max_problem(config: Mapping[str, Any]) -> str | None:
    limit = config.get("max")
    if limit is not None and not _is_number(limit):
        return "invalid_max"
    return None


def _gauge_problem(config: Mapping[str, Any]) -> str | None:
    """A gauge's bands: ``thresholds`` is ``[warn, good]`` — two finite numbers,
    ascending, within the scale (``max``, else 100) — and ``good_direction``
    says which way is good (the KPI vocabulary). Both optional; other chart
    kinds carry neither."""
    if config.get("good_direction", "up") not in GOOD_DIRECTIONS:
        return "invalid_good_direction"
    bands = config.get("thresholds")
    if bands is None:
        return None
    scale = config.get("max") if _is_number(config.get("max")) else 100
    if (
        not isinstance(bands, (list, tuple))
        or len(bands) != 2
        or not all(_is_number(b) for b in bands)
        or not 0 <= bands[0] < bands[1] <= scale
    ):
        return "invalid_thresholds"
    return None


def _show_values_problem(config: Mapping[str, Any]) -> str | None:
    """``show_values`` prints the figures on the marks — a bool when present
    (``isinstance(1, bool)`` is false, so a ``1`` is refused too)."""
    if "show_values" in config and not isinstance(config["show_values"], bool):
        return "invalid_show_values"
    return None


def _chart_problem(config: Mapping[str, Any]) -> str | None:
    """A chart draws a ``query`` or a module ``source`` series — exactly one."""
    if ("query" in config) == ("source" in config):
        return "chart_needs_query_or_source"
    chart = config.get("chart")
    if "source" in config:
        if chart not in CHART_KINDS:
            return "unknown_chart"
        if chart in TWO_DIMENSION_CHARTS:
            return "source_chart_kind"
        problem = _source_problem(config, "single" if chart == "gauge" else "keyed")
        return (
            problem
            or _max_problem(config)
            or _gauge_problem(config)
            or _show_values_problem(config)
        )
    problem = _query_config_problem(config.get("query"))
    if problem:
        return problem
    if chart not in CHART_KINDS:
        return "unknown_chart"
    query = config["query"]
    if (chart == "sankey") != bool(query.get("relation_type")):
        return "sankey_needs_relation_type"
    two_dimensions = bool(query.get("group_by") and query.get("group_by_2"))
    if chart == "heatmap" and not two_dimensions:
        return "heatmap_needs_two_dimensions"
    if chart == "stacked_column" and not two_dimensions:
        return "stacked_column_needs_two_dimensions"
    if "drill" in config and not isinstance(config["drill"], bool):
        return "invalid_drill"
    return _max_problem(config) or _gauge_problem(config) or _show_values_problem(config)


def _kpi_problem(config: Mapping[str, Any]) -> str | None:
    """A KPI shows a preset ``metric``, a ``query`` or a module ``source``
    series — exactly one of the three."""
    if sum(key in config for key in ("metric", "query", "source")) != 1:
        return "kpi_needs_metric_query_or_source"
    if "metric" in config:
        return None if config["metric"] in KPI_PRESETS else "unknown_kpi_metric"
    if "source" in config:
        problem = _source_problem(config, "single")
    else:
        problem = _query_config_problem(config["query"])
        if problem:
            return problem
        if config.get("good_direction", "up") not in GOOD_DIRECTIONS:
            return "invalid_good_direction"
        if not isinstance(config.get("sparkline", False), bool):
            return "invalid_sparkline"
        if "secondary" in config and config["secondary"] not in KPI_SECONDARY:
            return "invalid_secondary"
    if problem:
        return problem
    if config.get("format", "number") not in KPI_FORMATS:
        return "invalid_format"
    return None


def _recent_activity_problem(config: Mapping[str, Any]) -> str | None:
    rows = config.get("max_rows", 12)
    if isinstance(rows, bool) or not isinstance(rows, int) or not 1 <= rows <= MAX_RECENT_ROWS:
        return "invalid_max_rows"
    return None


def widget_config_problem(widget_type: str, config: Any) -> str | None:
    """The first rule a widget's ``config`` breaks, or ``None``."""
    if widget_type not in WIDGET_TYPES:
        return "unknown_widget_type"
    if not isinstance(config, dict):
        return "invalid_config"
    if len(repr(config)) > MAX_CONFIG_CHARS:
        return "config_too_large"
    if contains_uuid(config):
        return "config_holds_an_id"
    if widget_type == "kpi":
        return _kpi_problem(config)
    if widget_type == "chart":
        return _chart_problem(config)
    if widget_type == "recent_activity":
        return _recent_activity_problem(config)
    return None


def layout_problem(x: int, w: int) -> str | None:
    """A widget must fit inside the 12-column grid."""
    if x + w > GRID_COLUMNS:
        return "layout_overflows_grid"
    return None


def duplicate_widget_id(ids: Iterable[str]) -> str | None:
    """The first widget id that occurs twice, or ``None``."""
    seen: set[str] = set()
    for widget_id in ids:
        if widget_id in seen:
            return widget_id
        seen.add(widget_id)
    return None


def normalize_widget(widget: Mapping[str, Any]) -> dict[str, Any]:
    """A validated widget as stored: a fixed key set, ``minW`` / ``minH`` only
    when given, and a query config rewritten to its canonical form (set fields
    only) so the capture's ``metric_key`` matches what the frontend sends."""
    layout = {k: widget["layout"][k] for k in ("x", "y", "w", "h")}
    for extra in ("minW", "minH"):
        if widget["layout"].get(extra) is not None:
            layout[extra] = widget["layout"][extra]
    config = dict(widget.get("config") or {})
    if isinstance(config.get("query"), dict):
        config["query"] = DashboardQuery.model_validate(config["query"]).model_dump(
            exclude_none=True
        )
    return {
        "id": widget["id"],
        "type": widget["type"],
        "title": widget.get("title"),
        "config": config,
        "layout": layout,
    }


# ── Keys, copies, defaults ───────────────────────────────────────────────


def slugify(name: str) -> str:
    """``"Sales & Ops 2026"`` → ``"sales-ops-2026"``; ``"dashboard"`` when the
    name has no letter or digit to keep (an Arabic or Chinese name)."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-")
    slug = slug[:_SLUG_BODY_MAX].strip("-")
    return slug or "dashboard"


def new_key(name: str, existing: set[str], token: Callable[[], str] | None = None) -> str:
    """A key no other dashboard has: the name's slug and 6 hex characters."""
    draw = token or (lambda: secrets.token_hex(3))
    while True:
        key = f"{slugify(name)}-{draw()}"
        if key not in existing:
            return key


def copied_widget_id(widget_id: str, token: str) -> str:
    """A fresh id for a widget copied to another dashboard. A previous copy's
    suffix is replaced, not stacked, so copies of copies stay readable."""
    base = _SUFFIX_RE.sub("", widget_id)[:33]
    return f"{base}-{token}"


def copy_widgets(
    widgets: Sequence[Mapping[str, Any]], token: Callable[[], str] | None = None
) -> list[dict[str, Any]]:
    draw = token or (lambda: secrets.token_hex(3))
    return [{**dict(w), "id": copied_widget_id(str(w["id"]), draw())} for w in widgets]


def copy_name(name: str, requested: str | None) -> str:
    """The duplicate's name: the client's (it localises "Copy of …"), else
    the English default — clipped to the column."""
    chosen = (requested or "").strip() or f"Copy of {name}"
    return chosen[:200]


def roles_holding(
    permission: str, roles: Iterable[tuple[str, Mapping[str, Any] | None, bool, int]]
) -> list[str]:
    """The keys of the roles that hold ``permission`` (or the wildcard), active
    ones only, in ``(sort_order, key)`` order — what a built-in dashboard's
    Access is seeded from. ``roles`` are ``(key, permissions, is_archived,
    sort_order)`` rows."""
    holders = [
        (sort_order, key)
        for key, permissions, archived, sort_order in roles
        if not archived and ((permissions or {}).get("*") or (permissions or {}).get(permission))
    ]
    return [key for _, key in sorted(holders)]


async def seeded_access(db: AsyncSession, spec: Mapping[str, Any]) -> list[str]:
    """A built-in dashboard's initial ``allowed_roles``: every role that could
    see it through its widgets' permission (``access_permission``), so Access
    reads as it works — ``[]`` (everyone) for a spec naming none."""
    permission = spec.get("access_permission")
    if not permission:
        return []
    rows = (
        await db.execute(select(Role.key, Role.permissions, Role.is_archived, Role.sort_order))
    ).all()
    return roles_holding(permission, [tuple(r) for r in rows])


async def seed_dashboards(db: AsyncSession) -> list[str]:
    """Insert the built-in dashboards the table lacks. Insert-only — a default
    already there keeps whatever an admin made of it — and keyed on ``key``.
    Returns the keys inserted. Flushes, never commits."""
    from app.services.seed import DASHBOARD_NAMES

    existing = set((await db.execute(select(Dashboard.key))).scalars().all())
    inserted: list[str] = []
    for entry in DASHBOARD_NAMES:
        key = entry["key"]
        spec = DEFAULT_DASHBOARDS.get(key)
        if key in existing or spec is None:
            continue
        db.add(
            Dashboard(
                id=uuid.uuid4(),
                key=key,
                name=entry["label"],
                translations=dict(entry.get("translations") or {}),
                icon=spec["icon"],
                built_in=True,
                is_hidden=False,
                sort_order=spec["sort_order"],
                allowed_roles=await seeded_access(db, spec),
                widgets=default_widgets(key),
            )
        )
        inserted.append(key)
    if inserted:
        await db.flush()
    return inserted


async def next_sort_order(db: AsyncSession) -> int:
    highest = (await db.execute(select(func.max(Dashboard.sort_order)))).scalar()
    return 0 if highest is None else highest + 1


# ── Roles ────────────────────────────────────────────────────────────────


def allowed_roles_problem(keys: Sequence[str], roles: Mapping[str, Any]) -> str | None:
    """``unknown_role`` for a key with no role. ``roles`` maps key →
    permissions; an archived role is accepted — it is inert until restored —
    and so is a wildcard role: it sees every dashboard whatever the list says
    (``can_see``), and listing it lets Access *state* who sees the dashboard
    (the seeded Admin dashboard names the admin role)."""
    for key in keys:
        if key not in roles:
            return "unknown_role"
    return None


def dedupe(keys: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(keys))


async def check_allowed_roles(db: AsyncSession, keys: Sequence[str]) -> list[str]:
    """``keys`` without repeats, or ``DashboardError(400)``."""
    wanted = dedupe(keys)
    if not wanted:
        return []
    rows = (await db.execute(select(Role.key, Role.permissions).where(Role.key.in_(wanted)))).all()
    problem = allowed_roles_problem(wanted, {k: p for k, p in rows})
    if problem:
        raise DashboardError(400, problem)
    return wanted


async def role_labels(db: AsyncSession, *key_lists: Iterable[str]) -> dict[str, str]:
    keys = {k for keys in key_lists for k in keys}
    if not keys:
        return {}
    rows = (await db.execute(select(Role.key, Role.label).where(Role.key.in_(keys)))).all()
    return {k: label or k for k, label in rows}


# ── Audit ────────────────────────────────────────────────────────────────


def _clip(text: Any, limit: int = 200) -> Any:
    if isinstance(text, str) and len(text) > limit:
        return text[: limit - 1] + "…"
    return text


def audit_snapshot(dashboard: Any) -> dict[str, Any]:
    """The fields an audit row compares, as plain values."""
    return {
        "name": dashboard.name,
        "description": dashboard.description,
        "icon": dashboard.icon,
        "is_hidden": bool(dashboard.is_hidden),
        "sort_order": dashboard.sort_order,
        "allowed_roles": list(dashboard.allowed_roles or []),
        "widgets": list(dashboard.widgets or []),
    }


def _widget_name(widget: Mapping[str, Any]) -> str:
    return str(widget.get("title") or widget.get("type") or widget.get("id"))


def widget_items(old: Any, new: Any) -> list[dict[str, Any]]:
    """``dashboard_widget.added`` / ``.removed`` per widget id — a moved or
    resized widget is the same widget and is not reported."""
    before = {w.get("id"): w for w in old or [] if isinstance(w, Mapping)}
    after = {w.get("id"): w for w in new or [] if isinstance(w, Mapping)}
    added = [
        audit_changes.item("dashboard_widget.added", widget=_widget_name(w), type=w.get("type"))
        for wid, w in after.items()
        if wid not in before
    ]
    removed = [
        audit_changes.item("dashboard_widget.removed", widget=_widget_name(w), type=w.get("type"))
        for wid, w in before.items()
        if wid not in after
    ]
    return added + removed


def audit_changes_for(
    before: Mapping[str, Any], after: Mapping[str, Any], labels: Mapping[str, str]
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """``(changes, items)`` between two ``audit_snapshot``s. Roles are named by
    label (the drawer has no role table to resolve a key against); a widget
    edit is a widget count plus one item per widget added or removed."""
    changes: dict[str, Any] = {}
    for name in ("name", "description", "icon", "is_hidden", "sort_order"):
        if before.get(name) != after.get(name):
            changes[name] = {"old": _clip(before.get(name)), "new": _clip(after.get(name))}
    if before.get("allowed_roles") != after.get("allowed_roles"):
        changes["allowed_roles"] = {
            side: [labels.get(k, k) for k in snap.get("allowed_roles") or []]
            for side, snap in (("old", before), ("new", after))
        }
    old_widgets, new_widgets = before.get("widgets") or [], after.get("widgets") or []
    if len(old_widgets) != len(new_widgets):
        changes["widget_count"] = {"old": len(old_widgets), "new": len(new_widgets)}
    items = audit_changes.cap_items(widget_items(old_widgets, new_widgets))
    return changes, items
