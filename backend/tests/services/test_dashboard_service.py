"""The dashboard rules: visibility, widget validation, keys, copies, audit."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.dashboard import DashboardCreate, DashboardUpdate, DashboardWidgetIn
from app.services.dashboard_service import (
    DashboardError,
    allowed_roles_problem,
    audit_changes_for,
    audit_snapshot,
    can_see,
    check_allowed_roles,
    contains_uuid,
    copied_widget_id,
    copy_name,
    copy_widgets,
    dashboard_payload,
    dedupe,
    duplicate_widget_id,
    layout_problem,
    new_key,
    next_sort_order,
    normalize_widget,
    role_labels,
    slugify,
    sort_dashboards,
    widget_config_problem,
    widget_items,
)
from tests.conftest import create_role


def _dash(**kw):
    base = {
        "id": "00000000-0000-0000-0000-000000000001",
        "key": "k",
        "name": "N",
        "translations": {"de": "D"},
        "description": None,
        "icon": "dashboard",
        "built_in": False,
        "is_hidden": False,
        "sort_order": 0,
        "allowed_roles": [],
        "widgets": [],
    }
    return SimpleNamespace(**{**base, **kw})


class TestVisibility:
    @pytest.mark.parametrize(
        ("dash", "role", "wildcard", "manager", "seen"),
        [
            (_dash(), "viewer", False, False, True),
            (_dash(allowed_roles=["viewer"]), "viewer", False, False, True),
            (_dash(allowed_roles=["member"]), "viewer", False, False, False),
            (_dash(allowed_roles=["member"]), "admin", True, False, True),
            (_dash(is_hidden=True), "admin", True, False, False),
            (_dash(is_hidden=True), "viewer", False, True, True),
            (_dash(allowed_roles=["member"]), "viewer", False, True, True),
        ],
    )
    def test_can_see(self, dash, role, wildcard, manager, seen):
        assert can_see(dash, role_key=role, wildcard=wildcard, can_manage=manager) is seen

    def test_payload_trims_access_control_for_non_managers(self):
        dash = _dash(allowed_roles=["viewer"], widgets=[{"id": "a"}])
        lite = dashboard_payload(dash, can_manage=False)
        assert "allowed_roles" not in lite
        assert lite == {
            "id": "00000000-0000-0000-0000-000000000001",
            "key": "k",
            "name": "N",
            "translations": {"de": "D"},
            "description": None,
            "icon": "dashboard",
            "built_in": False,
            "is_hidden": False,
            "sort_order": 0,
            "widgets": [{"id": "a"}],
            "can_manage": False,
        }
        full = dashboard_payload(dash, can_manage=True)
        assert full["allowed_roles"] == ["viewer"]
        assert full["can_manage"] is True

    def test_sort_dashboards(self):
        rows = [
            _dash(key="c", name="beta", sort_order=1),
            _dash(key="b", name="Alpha", sort_order=1),
            _dash(key="a", name="zed", sort_order=0),
        ]
        assert [d.key for d in sort_dashboards(rows)] == ["a", "b", "c"]


QUERY = {"card_type": "Application", "group_by": "approval_status"}


class TestWidgetConfig:
    @pytest.mark.parametrize(
        ("wtype", "config", "problem"),
        [
            ("kpi", {"metric": "total_cards"}, None),
            ("kpi", {"query": {}, "good_direction": "down", "format": "percent"}, None),
            ("kpi", {}, "kpi_needs_metric_or_query"),
            ("kpi", {"metric": "total_cards", "query": {}}, "kpi_needs_metric_or_query"),
            ("kpi", {"metric": "nope"}, "unknown_kpi_metric"),
            ("kpi", {"query": "x"}, "query_required"),
            ("kpi", {"query": {"bogus": 1}}, "invalid_query"),
            ("kpi", {"query": {"group_by": "name"}}, "unknown_dimension"),
            ("kpi", {"query": {}, "good_direction": "left"}, "invalid_good_direction"),
            ("kpi", {"query": {}, "format": "money"}, "invalid_format"),
            ("chart", {"query": QUERY, "chart": "bar", "drill": True, "max": 10}, None),
            ("chart", {"query": QUERY, "chart": "radar"}, "unknown_chart"),
            ("chart", {"chart": "bar"}, "query_required"),
            ("chart", {"query": QUERY, "chart": "sankey"}, "sankey_needs_relation_type"),
            (
                "chart",
                {"query": {"relation_type": "r"}, "chart": "bar"},
                "sankey_needs_relation_type",
            ),
            ("chart", {"query": {"relation_type": "r"}, "chart": "sankey"}, None),
            ("chart", {"query": QUERY, "chart": "heatmap"}, "heatmap_needs_two_dimensions"),
            (
                "chart",
                {"query": {**QUERY, "group_by_2": "type"}, "chart": "heatmap"},
                None,
            ),
            ("chart", {"query": QUERY, "chart": "bar", "drill": "yes"}, "invalid_drill"),
            ("chart", {"query": QUERY, "chart": "bar", "max": "10"}, "invalid_max"),
            ("chart", {"query": QUERY, "chart": "bar", "max": True}, "invalid_max"),
            ("recent_activity", {}, None),
            ("recent_activity", {"max_rows": 50}, None),
            ("recent_activity", {"max_rows": 0}, "invalid_max_rows"),
            ("recent_activity", {"max_rows": 51}, "invalid_max_rows"),
            ("recent_activity", {"max_rows": True}, "invalid_max_rows"),
            ("my_todos", {}, None),
            ("bogus", {}, "unknown_widget_type"),
            ("my_todos", ["x"], "invalid_config"),
            ("my_todos", {"x": "y" * 4000}, "config_too_large"),
            ("my_todos", {"card": "0b8e1c5e-8f7a-4c1b-9d3e-2f6a7b8c9d0e"}, "config_holds_an_id"),
        ],
    )
    def test_rules(self, wtype, config, problem):
        assert widget_config_problem(wtype, config) == problem

    def test_contains_uuid_looks_everywhere(self):
        uid = "0b8e1c5e8f7a4c1b9d3e2f6a7b8c9d0e"
        assert contains_uuid({"a": [{"b": f"x {uid}"}]})
        assert contains_uuid({uid: 1})
        assert contains_uuid((uid,))
        assert not contains_uuid({"a": [1, "Application", None]})

    def test_layout_problem(self):
        assert layout_problem(0, 12) is None
        assert layout_problem(9, 3) is None
        assert layout_problem(10, 3) == "layout_overflows_grid"

    def test_duplicate_widget_id(self):
        assert duplicate_widget_id(["a", "b", "a", "b"]) == "a"
        assert duplicate_widget_id(["a", "b"]) is None

    def test_normalize_widget(self):
        raw = {
            "id": "w",
            "type": "chart",
            "title": None,
            "config": {"query": {"card_type": "A", "group_by": None, "metric": "count"}},
            "layout": {"x": 1, "y": 2, "w": 3, "h": 4, "minW": None, "minH": 2},
        }
        assert normalize_widget(raw) == {
            "id": "w",
            "type": "chart",
            "title": None,
            "config": {"query": {"card_type": "A", "metric": "count"}},
            "layout": {"x": 1, "y": 2, "w": 3, "h": 4, "minH": 2},
        }


class TestSchemas:
    WIDGET = {"id": "w", "type": "my_todos", "layout": {"x": 0, "y": 0, "w": 6, "h": 6}}

    def test_a_widget_is_validated_through_the_rules(self):
        assert DashboardWidgetIn.model_validate(self.WIDGET).title is None
        with pytest.raises(ValidationError, match="unknown_widget_type"):
            DashboardWidgetIn.model_validate({**self.WIDGET, "type": "bogus"})
        with pytest.raises(ValidationError, match="layout_overflows_grid"):
            DashboardWidgetIn.model_validate(
                {**self.WIDGET, "layout": {"x": 8, "y": 0, "w": 6, "h": 1}}
            )
        with pytest.raises(ValidationError):
            DashboardWidgetIn.model_validate({**self.WIDGET, "id": "has space"})
        with pytest.raises(ValidationError):
            DashboardWidgetIn.model_validate({**self.WIDGET, "extra": 1})

    def test_create_and_update_bodies(self):
        assert DashboardCreate(name="  Sales  ").name == "Sales"
        with pytest.raises(ValidationError, match="blank"):
            DashboardCreate(name="   ")
        with pytest.raises(ValidationError, match="duplicate widget id"):
            DashboardCreate(name="x", widgets=[self.WIDGET, self.WIDGET])
        with pytest.raises(ValidationError, match="invalid role key"):
            DashboardCreate(name="x", allowed_roles=[""])
        with pytest.raises(ValidationError):
            DashboardCreate(name="x", icon="Bad Icon")
        assert DashboardUpdate(name=" N ").name == "N"
        assert DashboardUpdate().name is None
        with pytest.raises(ValidationError, match="blank"):
            DashboardUpdate(name=" ")
        with pytest.raises(ValidationError, match="duplicate widget id"):
            DashboardUpdate(widgets=[self.WIDGET, self.WIDGET])
        with pytest.raises(ValidationError, match="invalid role key"):
            DashboardUpdate(allowed_roles=["x" * 51])


class TestKeysAndCopies:
    @pytest.mark.parametrize(
        ("name", "slug"),
        [
            ("Sales & Ops 2026", "sales-ops-2026"),
            ("  --Hi--  ", "hi"),
            ("仪表板", "dashboard"),
            ("x" * 80, "x" * 53),
            ("a" * 52 + " b", "a" * 52),
        ],
    )
    def test_slugify(self, name, slug):
        assert slugify(name) == slug

    def test_new_key_avoids_existing_keys(self):
        tokens = iter(["aaaaaa", "bbbbbb"])
        assert new_key("Sales", {"sales-aaaaaa"}, lambda: next(tokens)) == "sales-bbbbbb"
        key = new_key("Sales", set())
        assert key.startswith("sales-") and len(key) == len("sales-") + 6

    def test_copied_widget_ids(self):
        assert copied_widget_id("kpi-total", "abc123") == "kpi-total-abc123"
        assert copied_widget_id("kpi-total-abc123", "def456") == "kpi-total-def456"
        assert copied_widget_id("x" * 40, "abc123") == "x" * 33 + "-abc123"
        tokens = iter(["111111", "222222"])
        copied = copy_widgets([{"id": "a", "type": "kpi"}, {"id": "b"}], lambda: next(tokens))
        assert copied == [{"id": "a-111111", "type": "kpi"}, {"id": "b-222222"}]

    def test_copy_name(self):
        assert copy_name("Overview", None) == "Copy of Overview"
        assert copy_name("Overview", "  ") == "Copy of Overview"
        assert copy_name("Overview", "Kopie von Übersicht") == "Kopie von Übersicht"
        assert len(copy_name("x" * 200, None)) == 200


class TestRoles:
    def test_allowed_roles_problem(self):
        roles = {"viewer": {"inventory.view": True}, "admin": {"*": True}, "old": None}
        assert allowed_roles_problem(["viewer", "old"], roles) is None
        assert allowed_roles_problem(["viewer", "ghost"], roles) == "unknown_role"
        assert allowed_roles_problem(["admin"], roles) == "wildcard_role"
        assert dedupe(["b", "a", "b"]) == ["b", "a"]

    async def test_check_and_label(self, db):
        await create_role(db, key="viewer", label="Viewer", permissions={"x": True})
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        assert await check_allowed_roles(db, ["viewer", "viewer"]) == ["viewer"]
        assert await check_allowed_roles(db, []) == []
        with pytest.raises(DashboardError) as exc:
            await check_allowed_roles(db, ["admin"])
        assert (exc.value.status, exc.value.code) == (400, "wildcard_role")
        with pytest.raises(DashboardError) as exc:
            await check_allowed_roles(db, ["ghost"])
        assert exc.value.code == "unknown_role"
        assert await role_labels(db, ["viewer"], ["ghost"]) == {"viewer": "Viewer"}
        assert await role_labels(db) == {}

    async def test_next_sort_order(self, db):
        from app.models.dashboard import Dashboard

        assert await next_sort_order(db) == 0
        db.add(Dashboard(key="a", name="A", sort_order=4))
        await db.flush()
        assert await next_sort_order(db) == 5


class TestAudit:
    def test_widget_items(self):
        old = [{"id": "a", "type": "kpi", "title": "Total"}, {"id": "b", "type": "my_todos"}]
        new = [{"id": "a", "type": "kpi", "layout": {"x": 3}}, {"id": "c", "type": "chart"}]
        assert widget_items(old, new) == [
            {"kind": "dashboard_widget.added", "widget": "chart", "type": "chart"},
            {"kind": "dashboard_widget.removed", "widget": "my_todos", "type": "my_todos"},
        ]
        assert widget_items(None, [{"id": "x", "type": "kpi", "title": "T"}]) == [
            {"kind": "dashboard_widget.added", "widget": "T", "type": "kpi"}
        ]

    def test_changes_name_roles_by_label_and_count_widgets(self):
        before = audit_snapshot(_dash(allowed_roles=["viewer"], widgets=[{"id": "a"}]))
        after = audit_snapshot(
            _dash(
                name="New",
                description="d" * 300,
                is_hidden=True,
                allowed_roles=["viewer", "member"],
                widgets=[{"id": "a"}, {"id": "b", "type": "kpi"}],
            )
        )
        changes, items = audit_changes_for(before, after, {"viewer": "Viewer"})
        assert changes == {
            "name": {"old": "N", "new": "New"},
            "description": {"old": None, "new": "d" * 199 + "…"},
            "is_hidden": {"old": False, "new": True},
            "allowed_roles": {"old": ["Viewer"], "new": ["Viewer", "member"]},
            "widget_count": {"old": 1, "new": 2},
        }
        assert items == [{"kind": "dashboard_widget.added", "widget": "kpi", "type": "kpi"}]

    def test_nothing_changed(self):
        snap = audit_snapshot(_dash(widgets=[{"id": "a", "layout": {"x": 0}}]))
        moved = audit_snapshot(_dash(widgets=[{"id": "a", "layout": {"x": 6}}]))
        assert audit_changes_for(snap, moved, {}) == ({}, [])
