"""The widget vocabulary and the three built-in homepage dashboards.

Pure data, no I/O. ``WIDGET_TYPES`` is the closed set of widget types a
dashboard may hold; the frontend registry (``features/dashboard/widgets/
registry.ts``) mirrors it and a source-scan test there pins the two together,
so a type cannot exist on one side only.

``DEFAULT_DASHBOARDS`` reproduces the three tabs the homepage showed before it
became editable — Overview, My Workspace, Admin — on a 12-column grid whose row
height is about 60 px (a KPI tile is 2 rows, a chart 5, a list section 6).
The built-in *names* are not here: they live in ``DASHBOARD_NAMES`` in
``seed.py``, where the ``/translate`` seed pass and ``test_i18n_seed.py`` look.

Seeding is insert-only, so an edit here reaches an existing install only
through **Reset to default** — by design, an admin's layout is never
overwritten on upgrade.
"""

from __future__ import annotations

import copy
from collections.abc import Mapping
from types import MappingProxyType
from typing import Any

GRID_COLUMNS = 12

WIDGET_TYPES: frozenset[str] = frozenset(
    {
        "kpi",
        "chart",
        "recent_activity",
        "browse_by_type",
        "needs_attention",
        "my_favorites",
        "my_saved_reports",
        "my_roles",
        "my_todos",
        "my_pending_surveys",
        "my_created",
        "my_cards_activity",
        "top_contributors",
        "stakeholder_coverage",
        "idle_users",
        "approval_pipeline",
        "system_activity",
        "unassigned_todos",
        "stakeholder_directory",
    }
)

# A ``kpi`` widget shows one of these preset metrics (read from the existing
# report endpoints) or a generic ``query``.
KPI_PRESETS: frozenset[str] = frozenset(
    {
        "total_cards",
        "avg_data_quality",
        "approved_count",
        "broken_count",
        "favorites",
        "stakeholder_cards",
        "open_todos",
        "pending_surveys",
        "active_users",
        "cards_without_stakeholders",
        "overdue_todos",
        "stuck_approvals",
        "overall_quality",
    }
)

CHART_KINDS: frozenset[str] = frozenset(
    {
        "bar",
        "column",
        "stacked_column",
        "line",
        "pie",
        "donut",
        "gauge",
        "heatmap",
        "treemap",
        "sankey",
    }
)

# Chart kinds a module ``source`` series cannot feed: each needs two
# dimensions (or a relation type), and a series is one list of keys.
TWO_DIMENSION_CHARTS: frozenset[str] = frozenset({"heatmap", "sankey", "stacked_column"})

# A ``kpi`` or ``chart`` widget may draw a series of a module report the
# frontend already fetches (``source`` + ``series``) instead of a ``query``.
# Mirrored by ``frontend/src/features/dashboard/widgets/sourceSeries.ts`` and
# pinned to it by a source scan, like ``WIDGET_TYPES``.
SOURCE_SERIES: Mapping[str, tuple[str, ...]] = MappingProxyType(
    {
        "risks_metrics": ("total", "open", "overdue", "by_level", "by_status"),
        "compliance_overview": ("score_avg", "scores"),
        "ppm_dashboard": ("total", "at_risk", "health_schedule"),
        "bpm_dashboard": ("total", "without_diagram", "by_maturity"),
    }
)

# A series is one number (``single`` — a KPI or a gauge) or a list of
# ``{key, value}`` (``keyed`` — any other one-dimension chart).
SERIES_SHAPES: Mapping[str, str] = MappingProxyType(
    {
        "total": "single",
        "open": "single",
        "overdue": "single",
        "score_avg": "single",
        "at_risk": "single",
        "without_diagram": "single",
        "by_level": "keyed",
        "by_status": "keyed",
        "scores": "keyed",
        "health_schedule": "keyed",
        "by_maturity": "keyed",
    }
)


def _w(
    widget_id: str,
    widget_type: str,
    x: int,
    y: int,
    w: int,
    h: int,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": widget_id,
        "type": widget_type,
        "title": None,
        "config": config or {},
        "layout": {"x": x, "y": y, "w": w, "h": h},
    }


def _kpi(widget_id: str, metric: str, x: int, y: int, w: int) -> dict[str, Any]:
    return _w(widget_id, "kpi", x, y, w, 2, {"metric": metric})


def _chart(
    widget_id: str, group_by: str, chart: str, title_key: str, x: int, y: int, w: int
) -> dict[str, Any]:
    # ``title_key`` lets the frontend name a built-in chart in the reader's
    # language; an admin's own chart carries a free-text ``title`` instead.
    return _w(
        widget_id,
        "chart",
        x,
        y,
        w,
        5,
        {"query": {"group_by": group_by}, "chart": chart, "drill": True, "title_key": title_key},
    )


_OVERVIEW: list[dict[str, Any]] = [
    _kpi("kpi-total-cards", "total_cards", 0, 0, 3),
    _kpi("kpi-avg-data-quality", "avg_data_quality", 3, 0, 3),
    _kpi("kpi-approved", "approved_count", 6, 0, 3),
    _kpi("kpi-broken", "broken_count", 9, 0, 3),
    _chart("chart-cards-by-type", "type", "bar", "dashboard.cardsByType", 0, 2, 7),
    _chart(
        "chart-approval-status",
        "approval_status",
        "donut",
        "dashboard.approvalStatusDistribution",
        7,
        2,
        5,
    ),
    _chart(
        "chart-completion",
        "data_quality_bucket",
        "column",
        "dashboard.completionDistribution",
        0,
        7,
        6,
    ),
    _chart("chart-lifecycle", "lifecycle_phase", "column", "dashboard.lifecycleOverview", 6, 7, 6),
    _w("browse-by-type", "browse_by_type", 0, 12, 5, 6),
    _w("recent-activity", "recent_activity", 5, 12, 7, 6, {"max_rows": 12}),
]

_WORKSPACE: list[dict[str, Any]] = [
    _kpi("kpi-favorites", "favorites", 0, 0, 3),
    _kpi("kpi-stakeholder-cards", "stakeholder_cards", 3, 0, 3),
    _kpi("kpi-open-todos", "open_todos", 6, 0, 3),
    _kpi("kpi-pending-surveys", "pending_surveys", 9, 0, 3),
    _w("needs-attention", "needs_attention", 0, 2, 12, 2),
    _w("my-favorites", "my_favorites", 0, 4, 6, 6),
    _w("my-saved-reports", "my_saved_reports", 6, 4, 6, 6),
    _w("my-roles", "my_roles", 0, 10, 6, 6),
    _w("my-todos", "my_todos", 6, 10, 6, 6),
    _w("my-pending-surveys", "my_pending_surveys", 0, 16, 6, 6),
    _w("my-created", "my_created", 6, 16, 6, 6),
    _w("my-cards-activity", "my_cards_activity", 0, 22, 6, 6),
]

_ADMIN: list[dict[str, Any]] = [
    _kpi("kpi-active-users", "active_users", 0, 0, 3),
    _kpi("kpi-cards-without-stakeholders", "cards_without_stakeholders", 3, 0, 2),
    _kpi("kpi-overdue-todos", "overdue_todos", 5, 0, 2),
    _kpi("kpi-stuck-approvals", "stuck_approvals", 7, 0, 2),
    _kpi("kpi-overall-quality", "overall_quality", 9, 0, 3),
    _w("top-contributors", "top_contributors", 0, 2, 6, 6),
    _w("stakeholder-coverage", "stakeholder_coverage", 6, 2, 6, 6),
    _w("idle-users", "idle_users", 0, 8, 6, 6),
    _w("approval-pipeline", "approval_pipeline", 6, 8, 6, 6),
    _w("system-activity", "system_activity", 0, 14, 6, 6),
    _w("unassigned-todos", "unassigned_todos", 6, 14, 6, 6),
    _w("stakeholder-directory", "stakeholder_directory", 0, 20, 12, 7),
]

# key → the non-name attributes of a built-in dashboard. Every widget carries
# its own permission on the frontend (a tab with no visible widget is not
# shown), which is how the old Overview / Admin gating is reproduced without
# restricting ``/``. The Admin dashboard additionally names, in
# ``access_permission``, the permission its roles are seeded from: Access then
# *states* who sees it (the roles holding ``admin.users`` — the admin role on a
# fresh install) instead of reading "everyone" while admins alone see it.
DEFAULT_DASHBOARDS: dict[str, dict[str, Any]] = {
    "overview": {"icon": "dashboard", "sort_order": 0, "widgets": _OVERVIEW},
    "workspace": {"icon": "person", "sort_order": 1, "widgets": _WORKSPACE},
    "admin": {
        "icon": "admin_panel_settings",
        "sort_order": 2,
        "widgets": _ADMIN,
        "access_permission": "admin.users",
    },
}


def default_widgets(key: str) -> list[dict[str, Any]] | None:
    """A fresh copy of a built-in dashboard's widgets, or ``None`` for a key
    that is not built in. A copy, so a caller mutating the list (or SQLAlchemy
    holding it as a JSONB value) can never edit the module constant."""
    spec = DEFAULT_DASHBOARDS.get(key)
    if spec is None:
        return None
    widgets: list[dict[str, Any]] = copy.deepcopy(spec["widgets"])
    return widgets
