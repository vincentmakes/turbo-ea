"""The built-in dashboards: valid widgets, laid out on the grid, seeded once."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.dashboard import Dashboard
from app.schemas.dashboard import DashboardWidgetIn
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
from app.services.dashboard_service import seed_dashboards
from app.services.seed import DASHBOARD_NAMES
from tests.conftest import create_role

ALL_WIDGETS = [
    pytest.param(key, w, id=f"{key}:{w['id']}")
    for key, spec in DEFAULT_DASHBOARDS.items()
    for w in spec["widgets"]
]


def test_the_widget_vocabulary():
    assert len(WIDGET_TYPES) == 19
    assert {"kpi", "chart", "recent_activity", "stakeholder_directory"} <= WIDGET_TYPES
    assert len(KPI_PRESETS) == 13


def test_the_chart_kinds():
    assert CHART_KINDS == {
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
    assert TWO_DIMENSION_CHARTS == {"heatmap", "sankey", "stacked_column"}
    assert TWO_DIMENSION_CHARTS <= CHART_KINDS


def test_the_source_series_the_frontend_mirrors():
    assert dict(SOURCE_SERIES) == {
        "risks_metrics": ("total", "open", "overdue", "by_level", "by_status"),
        "compliance_overview": ("score_avg", "scores"),
        "ppm_dashboard": ("total", "at_risk", "health_schedule"),
        "bpm_dashboard": ("total", "without_diagram", "by_maturity"),
    }
    with pytest.raises(TypeError):
        SOURCE_SERIES["x"] = ()  # type: ignore[index]


def test_every_series_has_a_shape():
    named = {series for all_series in SOURCE_SERIES.values() for series in all_series}
    assert set(SERIES_SHAPES) == named
    singles = {k for k, shape in SERIES_SHAPES.items() if shape == "single"}
    assert singles == {"total", "open", "overdue", "score_avg", "at_risk", "without_diagram"}
    assert set(SERIES_SHAPES.values()) == {"single", "keyed"}


def test_every_built_in_dashboard_has_a_name():
    assert [d["key"] for d in DASHBOARD_NAMES] == ["overview", "workspace", "admin"]
    assert set(DEFAULT_DASHBOARDS) == {d["key"] for d in DASHBOARD_NAMES}
    assert [d["label"] for d in DASHBOARD_NAMES] == ["Overview", "My Workspace", "Admin"]


@pytest.mark.parametrize(("key", "widget"), ALL_WIDGETS)
def test_every_default_widget_passes_the_widget_schema(key, widget):
    parsed = DashboardWidgetIn.model_validate(widget)
    assert parsed.type in WIDGET_TYPES


@pytest.mark.parametrize("key", list(DEFAULT_DASHBOARDS))
def test_layouts_fit_the_grid_and_never_overlap(key):
    cells: set[tuple[int, int]] = set()
    for widget in DEFAULT_DASHBOARDS[key]["widgets"]:
        lay = widget["layout"]
        assert 0 <= lay["x"] and lay["x"] + lay["w"] <= GRID_COLUMNS, widget["id"]
        for x in range(lay["x"], lay["x"] + lay["w"]):
            for y in range(lay["y"], lay["y"] + lay["h"]):
                assert (x, y) not in cells, f"{key}: {widget['id']} overlaps"
                cells.add((x, y))


@pytest.mark.parametrize("key", list(DEFAULT_DASHBOARDS))
def test_widget_ids_are_unique(key):
    ids = [w["id"] for w in DEFAULT_DASHBOARDS[key]["widgets"]]
    assert len(ids) == len(set(ids))


def test_the_overview_reproduces_the_old_tab():
    widgets = {w["id"]: w for w in DEFAULT_DASHBOARDS["overview"]["widgets"]}
    assert [w["config"].get("metric") for w in widgets.values() if w["type"] == "kpi"] == [
        "total_cards",
        "avg_data_quality",
        "approved_count",
        "broken_count",
    ]
    assert widgets["chart-cards-by-type"]["config"] == {
        "query": {"group_by": "type"},
        "chart": "bar",
        "drill": True,
        "title_key": "dashboard.cardsByType",
    }
    assert widgets["chart-cards-by-type"]["layout"] == {"x": 0, "y": 2, "w": 7, "h": 5}
    assert widgets["chart-approval-status"]["config"]["chart"] == "donut"
    assert widgets["chart-completion"]["config"]["query"] == {"group_by": "data_quality_bucket"}
    assert widgets["chart-lifecycle"]["config"]["query"] == {"group_by": "lifecycle_phase"}
    assert widgets["recent-activity"]["config"] == {"max_rows": 12}
    assert widgets["browse-by-type"]["layout"] == {"x": 0, "y": 12, "w": 5, "h": 6}


def test_the_workspace_and_admin_tabs():
    workspace = [w["type"] for w in DEFAULT_DASHBOARDS["workspace"]["widgets"]]
    assert workspace == [
        "kpi",
        "kpi",
        "kpi",
        "kpi",
        "needs_attention",
        "my_favorites",
        "my_saved_reports",
        "my_roles",
        "my_todos",
        "my_pending_surveys",
        "my_created",
        "my_cards_activity",
    ]
    admin = DEFAULT_DASHBOARDS["admin"]["widgets"]
    assert [w["config"].get("metric") for w in admin if w["type"] == "kpi"] == [
        "active_users",
        "cards_without_stakeholders",
        "overdue_todos",
        "stuck_approvals",
        "overall_quality",
    ]
    directory = admin[-1]
    assert directory["type"] == "stakeholder_directory"
    assert directory["layout"] == {"x": 0, "y": 20, "w": 12, "h": 7}
    assert [DEFAULT_DASHBOARDS[k]["sort_order"] for k in ("overview", "workspace", "admin")] == [
        0,
        1,
        2,
    ]


def test_default_widgets_is_a_copy():
    first = default_widgets("overview")
    assert first is not None
    first[0]["layout"]["x"] = 99
    assert DEFAULT_DASHBOARDS["overview"]["widgets"][0]["layout"]["x"] == 0
    assert default_widgets("overview")[0]["layout"]["x"] == 0
    assert default_widgets("custom-abc123") is None


async def test_seed_inserts_the_three_built_ins_once(db):
    # The Admin dashboard's Access is seeded from the roles that hold
    # ``admin.users``: the wildcard admin, a custom role holding it — not a
    # role without it, nor an archived one.
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions={"inventory.view": True})
    await create_role(db, key="ops", label="Ops", permissions={"admin.users": True})
    retired = await create_role(
        db, key="retired", label="Retired", permissions={"admin.users": True}
    )
    retired.is_archived = True
    await db.flush()

    assert await seed_dashboards(db) == ["overview", "workspace", "admin"]
    rows = (await db.execute(select(Dashboard).order_by(Dashboard.sort_order))).scalars().all()
    assert [(d.key, d.name, d.built_in, d.is_hidden, d.allowed_roles) for d in rows] == [
        ("overview", "Overview", True, False, []),
        ("workspace", "My Workspace", True, False, []),
        ("admin", "Admin", True, False, ["admin", "ops"]),
    ]
    assert rows[0].icon == "dashboard"
    assert rows[0].widgets == DEFAULT_DASHBOARDS["overview"]["widgets"]


async def test_seed_is_insert_only(db):
    await seed_dashboards(db)
    overview = (await db.execute(select(Dashboard).where(Dashboard.key == "overview"))).scalar_one()
    overview.widgets = []
    overview.name = "Home"
    await db.flush()
    await db.delete(
        (await db.execute(select(Dashboard).where(Dashboard.key == "admin"))).scalar_one()
    )
    await db.flush()

    assert await seed_dashboards(db) == ["admin"]
    await db.refresh(overview)
    assert overview.widgets == []
    assert overview.name == "Home"
    assert len((await db.execute(select(Dashboard))).scalars().all()) == 3
