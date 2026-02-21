"""Integration tests for extended /reports endpoints.

Covers: landscape, portfolio, matrix, roadmap, cost, cost-treemap,
capability-heatmap, dependencies, and data-quality.

These endpoints require a PostgreSQL test database.
"""

from __future__ import annotations

import pytest

from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

# Application fields_schema with all fields needed by portfolio tests
APP_FIELDS_SCHEMA = [
    {
        "section": "General",
        "fields": [
            {
                "key": "costTotalAnnual",
                "label": "Annual Cost",
                "type": "cost",
                "weight": 1,
            },
            {
                "key": "functionalFit",
                "label": "Functional Fit",
                "type": "single_select",
                "weight": 1,
                "options": [
                    {"key": "excellent", "label": "Excellent"},
                    {"key": "adequate", "label": "Adequate"},
                    {"key": "insufficient", "label": "Insufficient"},
                ],
            },
            {
                "key": "technicalFit",
                "label": "Technical Fit",
                "type": "single_select",
                "weight": 1,
                "options": [
                    {"key": "excellent", "label": "Excellent"},
                    {"key": "adequate", "label": "Adequate"},
                    {"key": "insufficient", "label": "Insufficient"},
                ],
            },
            {
                "key": "businessCriticality",
                "label": "Business Criticality",
                "type": "single_select",
                "weight": 1,
                "options": [
                    {"key": "mission_critical", "label": "Mission Critical"},
                    {"key": "business_critical", "label": "Business Critical"},
                    {"key": "business_operational", "label": "Business Operational"},
                    {"key": "administrative", "label": "Administrative"},
                ],
            },
        ],
    }
]


@pytest.fixture
async def env(db):
    """Prerequisite data shared by all extended report tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="noreports",
        label="No Reports",
        permissions={
            "inventory.view": True,
            "reports.ea_dashboard": False,
            "reports.portfolio": False,
        },
    )

    app_type = await create_card_type(
        db,
        key="Application",
        label="Application",
        has_hierarchy=True,
        fields_schema=APP_FIELDS_SCHEMA,
    )
    bc_type = await create_card_type(
        db,
        key="BusinessCapability",
        label="Business Capability",
        has_hierarchy=True,
    )
    itc_type = await create_card_type(
        db,
        key="ITComponent",
        label="IT Component",
    )

    await create_relation_type(
        db,
        key="app_to_bc",
        label="Application to Business Capability",
        source_type_key="Application",
        target_type_key="BusinessCapability",
        reverse_label="Business Capability to Application",
    )
    await create_relation_type(
        db,
        key="app_to_itc",
        label="Application to IT Component",
        source_type_key="Application",
        target_type_key="ITComponent",
        reverse_label="IT Component to Application",
    )
    await create_relation_type(
        db,
        key="app_to_app",
        label="Application to Application",
        source_type_key="Application",
        target_type_key="Application",
        reverse_label="Application to Application (reverse)",
    )

    admin = await create_user(db, email="admin@reports-ext.com", role="admin")
    noreports = await create_user(db, email="noreports@reports-ext.com", role="noreports")

    return {
        "admin": admin,
        "noreports": noreports,
        "app_type": app_type,
        "bc_type": bc_type,
        "itc_type": itc_type,
    }


# ---------------------------------------------------------------------------
# Landscape
# ---------------------------------------------------------------------------


class TestLandscape:
    async def test_landscape_empty(self, client, db, env):
        """Landscape returns empty groups/ungrouped with no cards."""
        resp = await client.get(
            "/api/v1/reports/landscape",
            params={"type": "Application", "group_by": "BusinessCapability"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["groups"] == []
        assert data["ungrouped"] == []

    async def test_landscape_with_data(self, client, db, env):
        """Cards are grouped by related type; ungrouped catches the rest."""
        admin = env["admin"]
        bc = await create_card(db, card_type="BusinessCapability", name="Sales", user_id=admin.id)
        app1 = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
        # Link only app1 to bc
        await create_relation(db, type_key="app_to_bc", source_id=app1.id, target_id=bc.id)

        resp = await client.get(
            "/api/v1/reports/landscape",
            params={"type": "Application", "group_by": "BusinessCapability"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        # One group with one item
        assert len(data["groups"]) == 1
        assert data["groups"][0]["name"] == "Sales"
        assert len(data["groups"][0]["items"]) == 1
        assert data["groups"][0]["items"][0]["name"] == "CRM"
        # ERP is ungrouped
        assert len(data["ungrouped"]) == 1
        assert data["ungrouped"][0]["name"] == "ERP"

    async def test_landscape_reverse_relation(self, client, db, env):
        """Relation in reverse direction (target=app, source=bc) is still grouped."""
        admin = env["admin"]
        bc = await create_card(db, card_type="BusinessCapability", name="Finance", user_id=admin.id)
        app = await create_card(db, card_type="Application", name="Ledger", user_id=admin.id)
        # Reverse direction: source=bc, target=app
        await create_relation(db, type_key="app_to_bc", source_id=bc.id, target_id=app.id)

        resp = await client.get(
            "/api/v1/reports/landscape",
            params={"type": "Application", "group_by": "BusinessCapability"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["groups"]) == 1
        assert len(data["groups"][0]["items"]) == 1
        assert data["groups"][0]["items"][0]["name"] == "Ledger"

    async def test_landscape_permission_denied(self, client, db, env):
        """User without reports.ea_dashboard gets 403."""
        resp = await client.get(
            "/api/v1/reports/landscape",
            params={"type": "Application", "group_by": "BusinessCapability"},
            headers=auth_headers(env["noreports"]),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Portfolio
# ---------------------------------------------------------------------------


class TestPortfolio:
    async def test_portfolio_empty(self, client, db, env):
        """Portfolio returns empty items list with no cards."""
        resp = await client.get(
            "/api/v1/reports/portfolio",
            params={
                "type": "Application",
                "x_axis": "functionalFit",
                "y_axis": "technicalFit",
                "size_field": "costTotalAnnual",
                "color_field": "businessCriticality",
            },
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["x_axis"] == "functionalFit"
        assert data["y_axis"] == "technicalFit"

    async def test_portfolio_with_data(self, client, db, env):
        """Portfolio returns card attributes mapped to axes."""
        admin = env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="CRM",
            user_id=admin.id,
            attributes={
                "functionalFit": "excellent",
                "technicalFit": "adequate",
                "costTotalAnnual": 50000,
                "businessCriticality": "mission_critical",
            },
        )
        await create_card(
            db,
            card_type="Application",
            name="ERP",
            user_id=admin.id,
            attributes={
                "functionalFit": "adequate",
                "technicalFit": "insufficient",
                "costTotalAnnual": 120000,
                "businessCriticality": "business_critical",
            },
        )

        resp = await client.get(
            "/api/v1/reports/portfolio",
            params={
                "type": "Application",
                "x_axis": "functionalFit",
                "y_axis": "technicalFit",
                "size_field": "costTotalAnnual",
                "color_field": "businessCriticality",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2
        names = {item["name"] for item in data["items"]}
        assert names == {"CRM", "ERP"}
        # Verify axis mapping
        crm = next(i for i in data["items"] if i["name"] == "CRM")
        assert crm["x"] == "excellent"
        assert crm["y"] == "adequate"
        assert crm["size"] == 50000
        assert crm["color"] == "mission_critical"

    async def test_portfolio_invalid_field_400(self, client, db, env):
        """Invalid/unknown field name returns 400."""
        resp = await client.get(
            "/api/v1/reports/portfolio",
            params={
                "type": "Application",
                "x_axis": "nonExistentField",
                "y_axis": "technicalFit",
                "size_field": "costTotalAnnual",
                "color_field": "businessCriticality",
            },
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400

    async def test_portfolio_unsafe_field_format_400(self, client, db, env):
        """Field name with special characters is rejected."""
        resp = await client.get(
            "/api/v1/reports/portfolio",
            params={
                "type": "Application",
                "x_axis": "field; DROP TABLE",
                "y_axis": "technicalFit",
                "size_field": "costTotalAnnual",
                "color_field": "businessCriticality",
            },
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400

    async def test_portfolio_permission_denied(self, client, db, env):
        """User without reports.portfolio gets 403."""
        resp = await client.get(
            "/api/v1/reports/portfolio",
            params={
                "type": "Application",
                "x_axis": "functionalFit",
                "y_axis": "technicalFit",
                "size_field": "costTotalAnnual",
                "color_field": "businessCriticality",
            },
            headers=auth_headers(env["noreports"]),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Matrix
# ---------------------------------------------------------------------------


class TestMatrix:
    async def test_matrix_empty(self, client, db, env):
        """Matrix returns empty rows/columns/intersections with no cards."""
        resp = await client.get(
            "/api/v1/reports/matrix",
            params={"row_type": "Application", "col_type": "BusinessCapability"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["rows"] == []
        assert data["columns"] == []
        assert data["intersections"] == []

    async def test_matrix_with_data(self, client, db, env):
        """Matrix returns rows, columns, and intersections from relations."""
        admin = env["admin"]
        app1 = await create_card(db, card_type="Application", name="App A", user_id=admin.id)
        app2 = await create_card(db, card_type="Application", name="App B", user_id=admin.id)
        bc1 = await create_card(db, card_type="BusinessCapability", name="Cap X", user_id=admin.id)
        bc2 = await create_card(db, card_type="BusinessCapability", name="Cap Y", user_id=admin.id)
        # App A -> Cap X, App B -> Cap Y
        await create_relation(db, type_key="app_to_bc", source_id=app1.id, target_id=bc1.id)
        await create_relation(db, type_key="app_to_bc", source_id=app2.id, target_id=bc2.id)

        resp = await client.get(
            "/api/v1/reports/matrix",
            params={"row_type": "Application", "col_type": "BusinessCapability"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["rows"]) == 2
        assert len(data["columns"]) == 2
        assert len(data["intersections"]) == 2

        # Verify specific intersections
        row_names = {r["name"] for r in data["rows"]}
        col_names = {c["name"] for c in data["columns"]}
        assert row_names == {"App A", "App B"}
        assert col_names == {"Cap X", "Cap Y"}

    async def test_matrix_same_type_diagonal(self, client, db, env):
        """When row_type == col_type, self-relations appear on the diagonal."""
        admin = env["admin"]
        await create_card(db, card_type="Application", name="Solo App", user_id=admin.id)

        resp = await client.get(
            "/api/v1/reports/matrix",
            params={"row_type": "Application", "col_type": "Application"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["rows"]) == 1
        assert len(data["columns"]) == 1
        # Self-relation on diagonal
        assert len(data["intersections"]) == 1
        ix = data["intersections"][0]
        assert ix["row_id"] == ix["col_id"]

    async def test_matrix_permission_denied(self, client, db, env):
        """User without reports.ea_dashboard gets 403."""
        resp = await client.get(
            "/api/v1/reports/matrix",
            params={"row_type": "Application", "col_type": "BusinessCapability"},
            headers=auth_headers(env["noreports"]),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Roadmap
# ---------------------------------------------------------------------------


class TestRoadmap:
    async def test_roadmap_empty(self, client, db, env):
        """Roadmap returns empty items with no cards."""
        resp = await client.get(
            "/api/v1/reports/roadmap",
            params={"type": "Application"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []

    async def test_roadmap_with_lifecycle(self, client, db, env):
        """Cards with lifecycle dates appear in roadmap."""
        admin = env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="Legacy App",
            user_id=admin.id,
            lifecycle={
                "plan": "2020-01-01",
                "phaseIn": "2020-06-01",
                "active": "2021-01-01",
                "phaseOut": "2025-01-01",
                "endOfLife": "2026-01-01",
            },
        )
        # Card without lifecycle should not appear
        await create_card(
            db,
            card_type="Application",
            name="New App",
            user_id=admin.id,
            lifecycle={},
        )

        resp = await client.get(
            "/api/v1/reports/roadmap",
            params={"type": "Application"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 1
        assert data["items"][0]["name"] == "Legacy App"
        assert data["items"][0]["lifecycle"]["active"] == "2021-01-01"

    async def test_roadmap_no_type_filter(self, client, db, env):
        """Without type filter, all types with lifecycle are returned."""
        admin = env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="App With LC",
            user_id=admin.id,
            lifecycle={"active": "2022-01-01"},
        )
        await create_card(
            db,
            card_type="BusinessCapability",
            name="Cap With LC",
            user_id=admin.id,
            lifecycle={"active": "2023-01-01"},
        )

        resp = await client.get(
            "/api/v1/reports/roadmap",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2
        types = {item["type"] for item in data["items"]}
        assert types == {"Application", "BusinessCapability"}

    async def test_roadmap_permission_denied(self, client, db, env):
        """User without reports.ea_dashboard gets 403."""
        resp = await client.get(
            "/api/v1/reports/roadmap",
            params={"type": "Application"},
            headers=auth_headers(env["noreports"]),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Cost
# ---------------------------------------------------------------------------


class TestCost:
    async def test_cost_empty(self, client, db, env):
        """Cost report returns empty items and zero total with no cards."""
        resp = await client.get(
            "/api/v1/reports/cost",
            params={"type": "Application"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0

    async def test_cost_with_data(self, client, db, env):
        """Cost report aggregates cost fields and sorts descending."""
        admin = env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="Expensive App",
            user_id=admin.id,
            attributes={"costTotalAnnual": 200000},
        )
        await create_card(
            db,
            card_type="Application",
            name="Cheap App",
            user_id=admin.id,
            attributes={"costTotalAnnual": 5000},
        )
        # Card with no cost should not appear
        await create_card(
            db,
            card_type="Application",
            name="Free App",
            user_id=admin.id,
            attributes={},
        )

        resp = await client.get(
            "/api/v1/reports/cost",
            params={"type": "Application"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2
        assert data["total"] == 205000
        # Sorted descending by cost
        assert data["items"][0]["name"] == "Expensive App"
        assert data["items"][0]["cost"] == 200000
        assert data["items"][1]["name"] == "Cheap App"
        assert data["items"][1]["cost"] == 5000

    async def test_cost_permission_denied(self, client, db, env):
        """User without reports.ea_dashboard gets 403."""
        resp = await client.get(
            "/api/v1/reports/cost",
            params={"type": "Application"},
            headers=auth_headers(env["noreports"]),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Cost Treemap
# ---------------------------------------------------------------------------


class TestCostTreemap:
    async def test_cost_treemap_empty(self, client, db, env):
        """Cost treemap returns empty items and zero total with no cards."""
        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={"type": "Application", "cost_field": "costTotalAnnual"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0
        assert data["groups"] is None

    async def test_cost_treemap_with_data(self, client, db, env):
        """Cost treemap returns items sorted by cost descending."""
        admin = env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="Big App",
            user_id=admin.id,
            attributes={"costTotalAnnual": 100000},
        )
        await create_card(
            db,
            card_type="Application",
            name="Small App",
            user_id=admin.id,
            attributes={"costTotalAnnual": 15000},
        )

        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={"type": "Application", "cost_field": "costTotalAnnual"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2
        assert data["total"] == 115000
        assert data["items"][0]["name"] == "Big App"
        assert data["items"][0]["cost"] == 100000

    async def test_cost_treemap_with_group_by(self, client, db, env):
        """Cost treemap with group_by adds group labels to items."""
        admin = env["admin"]
        bc = await create_card(
            db, card_type="BusinessCapability", name="Marketing", user_id=admin.id
        )
        app1 = await create_card(
            db,
            card_type="Application",
            name="Ad Platform",
            user_id=admin.id,
            attributes={"costTotalAnnual": 75000},
        )
        await create_card(
            db,
            card_type="Application",
            name="Standalone",
            user_id=admin.id,
            attributes={"costTotalAnnual": 20000},
        )
        await create_relation(db, type_key="app_to_bc", source_id=app1.id, target_id=bc.id)

        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={
                "type": "Application",
                "cost_field": "costTotalAnnual",
                "group_by": "BusinessCapability",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2
        assert data["groups"] is not None
        assert len(data["groups"]) == 2  # Marketing + Ungrouped

        # Verify group assignment
        ad_item = next(i for i in data["items"] if i["name"] == "Ad Platform")
        standalone_item = next(i for i in data["items"] if i["name"] == "Standalone")
        assert ad_item["group"] == "Marketing"
        assert standalone_item["group"] == "Ungrouped"

    async def test_cost_treemap_invalid_cost_field_400(self, client, db, env):
        """Invalid cost_field format returns 400."""
        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={"type": "Application", "cost_field": "cost;DROP TABLE"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400

    async def test_cost_treemap_permission_denied(self, client, db, env):
        """User without reports.ea_dashboard gets 403."""
        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={"type": "Application", "cost_field": "costTotalAnnual"},
            headers=auth_headers(env["noreports"]),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Capability Heatmap
# ---------------------------------------------------------------------------


class TestCapabilityHeatmap:
    async def test_capability_heatmap_empty(self, client, db, env):
        """Capability heatmap returns empty items with no capabilities."""
        resp = await client.get(
            "/api/v1/reports/capability-heatmap",
            params={"metric": "app_count"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["metric"] == "app_count"

    async def test_capability_heatmap_with_data(self, client, db, env):
        """Capabilities with linked apps show correct app_count."""
        admin = env["admin"]
        bc1 = await create_card(db, card_type="BusinessCapability", name="Sales", user_id=admin.id)
        bc2 = await create_card(db, card_type="BusinessCapability", name="HR", user_id=admin.id)
        app1 = await create_card(
            db,
            card_type="Application",
            name="CRM",
            user_id=admin.id,
            attributes={"costTotalAnnual": 50000},
        )
        app2 = await create_card(
            db,
            card_type="Application",
            name="ATS",
            user_id=admin.id,
            attributes={"costTotalAnnual": 30000},
        )
        # CRM -> Sales, ATS -> HR
        await create_relation(db, type_key="app_to_bc", source_id=app1.id, target_id=bc1.id)
        await create_relation(db, type_key="app_to_bc", source_id=app2.id, target_id=bc2.id)

        resp = await client.get(
            "/api/v1/reports/capability-heatmap",
            params={"metric": "app_count"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2

        sales = next(i for i in data["items"] if i["name"] == "Sales")
        hr = next(i for i in data["items"] if i["name"] == "HR")
        assert sales["app_count"] == 1
        assert hr["app_count"] == 1
        # total_cost should reflect linked app costs
        assert sales["total_cost"] == 50000
        assert hr["total_cost"] == 30000

    async def test_capability_heatmap_hierarchy(self, client, db, env):
        """Parent capabilities include parent_id field."""
        admin = env["admin"]
        parent = await create_card(
            db, card_type="BusinessCapability", name="Enterprise", user_id=admin.id
        )
        await create_card(
            db,
            card_type="BusinessCapability",
            name="Operations",
            user_id=admin.id,
            parent_id=parent.id,
        )

        resp = await client.get(
            "/api/v1/reports/capability-heatmap",
            params={"metric": "app_count"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2

        child_item = next(i for i in data["items"] if i["name"] == "Operations")
        parent_item = next(i for i in data["items"] if i["name"] == "Enterprise")
        assert child_item["parent_id"] == str(parent.id)
        assert parent_item["parent_id"] is None

    async def test_capability_heatmap_invalid_metric_400(self, client, db, env):
        """Invalid metric value returns 400."""
        resp = await client.get(
            "/api/v1/reports/capability-heatmap",
            params={"metric": "invalid_metric"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400

    async def test_capability_heatmap_total_cost_metric(self, client, db, env):
        """total_cost metric is accepted (whitelisted)."""
        resp = await client.get(
            "/api/v1/reports/capability-heatmap",
            params={"metric": "total_cost"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["metric"] == "total_cost"

    async def test_capability_heatmap_risk_count_metric(self, client, db, env):
        """risk_count metric is accepted (whitelisted)."""
        resp = await client.get(
            "/api/v1/reports/capability-heatmap",
            params={"metric": "risk_count"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["metric"] == "risk_count"

    async def test_capability_heatmap_permission_denied(self, client, db, env):
        """User without reports.ea_dashboard gets 403."""
        resp = await client.get(
            "/api/v1/reports/capability-heatmap",
            params={"metric": "app_count"},
            headers=auth_headers(env["noreports"]),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------


class TestDependencies:
    async def test_dependencies_empty(self, client, db, env):
        """Dependencies returns empty nodes/edges with no cards."""
        resp = await client.get(
            "/api/v1/reports/dependencies",
            params={"depth": 2},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["nodes"] == []
        assert data["edges"] == []

    async def test_dependencies_with_data(self, client, db, env):
        """Dependencies returns nodes and edges from relations."""
        admin = env["admin"]
        app1 = await create_card(db, card_type="Application", name="App A", user_id=admin.id)
        app2 = await create_card(db, card_type="Application", name="App B", user_id=admin.id)
        app3 = await create_card(db, card_type="Application", name="App C", user_id=admin.id)
        await create_relation(db, type_key="app_to_app", source_id=app1.id, target_id=app2.id)
        await create_relation(db, type_key="app_to_app", source_id=app2.id, target_id=app3.id)

        resp = await client.get(
            "/api/v1/reports/dependencies",
            params={"depth": 2},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["nodes"]) == 3
        assert len(data["edges"]) == 2

        node_names = {n["name"] for n in data["nodes"]}
        assert node_names == {"App A", "App B", "App C"}

        # Edges should have label and type from relation type
        for edge in data["edges"]:
            assert "source" in edge
            assert "target" in edge
            assert "type" in edge
            assert "label" in edge

    async def test_dependencies_with_center_id_bfs(self, client, db, env):
        """BFS from center_id limits nodes to given depth."""
        admin = env["admin"]
        # Create a chain: A -> B -> C -> D
        app_a = await create_card(db, card_type="Application", name="Center", user_id=admin.id)
        app_b = await create_card(db, card_type="Application", name="Depth 1", user_id=admin.id)
        app_c = await create_card(db, card_type="Application", name="Depth 2", user_id=admin.id)
        app_d = await create_card(db, card_type="Application", name="Depth 3", user_id=admin.id)
        await create_relation(db, type_key="app_to_app", source_id=app_a.id, target_id=app_b.id)
        await create_relation(db, type_key="app_to_app", source_id=app_b.id, target_id=app_c.id)
        await create_relation(db, type_key="app_to_app", source_id=app_c.id, target_id=app_d.id)

        # BFS depth=1 from Center: should get Center + Depth 1
        resp = await client.get(
            "/api/v1/reports/dependencies",
            params={"center_id": str(app_a.id), "depth": 1},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        node_names = {n["name"] for n in data["nodes"]}
        assert "Center" in node_names
        assert "Depth 1" in node_names
        assert "Depth 3" not in node_names

        # BFS depth=2 from Center: should get Center + Depth 1 + Depth 2
        resp2 = await client.get(
            "/api/v1/reports/dependencies",
            params={"center_id": str(app_a.id), "depth": 2},
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 200
        data2 = resp2.json()
        node_names2 = {n["name"] for n in data2["nodes"]}
        assert "Center" in node_names2
        assert "Depth 1" in node_names2
        assert "Depth 2" in node_names2
        assert "Depth 3" not in node_names2

    async def test_dependencies_type_filter(self, client, db, env):
        """Type filter limits nodes to the specified card type."""
        admin = env["admin"]
        app = await create_card(db, card_type="Application", name="My App", user_id=admin.id)
        itc = await create_card(db, card_type="ITComponent", name="My Server", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=app.id, target_id=itc.id)

        # Filter to Application only
        resp = await client.get(
            "/api/v1/reports/dependencies",
            params={"type": "Application", "depth": 2},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        node_types = {n["type"] for n in data["nodes"]}
        assert node_types == {"Application"}

    async def test_dependencies_ancestor_path(self, client, db, env):
        """Nodes include ancestor path for hierarchical cards."""
        admin = env["admin"]
        parent = await create_card(db, card_type="Application", name="Parent App", user_id=admin.id)
        await create_card(
            db,
            card_type="Application",
            name="Child App",
            user_id=admin.id,
            parent_id=parent.id,
        )

        resp = await client.get(
            "/api/v1/reports/dependencies",
            params={"depth": 2},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        child_node = next(n for n in data["nodes"] if n["name"] == "Child App")
        assert child_node["path"] == ["Parent App"]
        assert child_node["parent_id"] == str(parent.id)

    async def test_dependencies_permission_denied(self, client, db, env):
        """User without reports.ea_dashboard gets 403."""
        resp = await client.get(
            "/api/v1/reports/dependencies",
            params={"depth": 2},
            headers=auth_headers(env["noreports"]),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Data Quality
# ---------------------------------------------------------------------------


class TestDataQuality:
    async def test_data_quality_empty(self, client, db, env):
        """Data quality returns zero summary with no cards."""
        resp = await client.get(
            "/api/v1/reports/data-quality",
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["overall_data_quality"] == 0
        assert data["total_items"] == 0
        assert data["with_lifecycle"] == 0
        assert data["orphaned"] == 0
        assert data["stale"] == 0
        assert data["by_type"] == []
        assert data["worst_items"] == []

    async def test_data_quality_with_data(self, client, db, env):
        """Data quality correctly categorizes cards into buckets."""
        admin = env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="Complete App",
            user_id=admin.id,
            data_quality=90.0,
            lifecycle={"active": "2023-01-01"},
        )
        await create_card(
            db,
            card_type="Application",
            name="Partial App",
            user_id=admin.id,
            data_quality=55.0,
        )
        await create_card(
            db,
            card_type="Application",
            name="Minimal App",
            user_id=admin.id,
            data_quality=10.0,
        )

        resp = await client.get(
            "/api/v1/reports/data-quality",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_items"] == 3
        assert data["with_lifecycle"] == 1
        # All are orphaned (no relations)
        assert data["orphaned"] == 3

        # By type breakdown
        assert len(data["by_type"]) == 1
        app_stats = data["by_type"][0]
        assert app_stats["type"] == "Application"
        assert app_stats["total"] == 3
        assert app_stats["complete"] == 1  # >= 80
        assert app_stats["partial"] == 1  # >= 40 and < 80
        assert app_stats["minimal"] == 1  # < 40

        # Worst items
        assert len(data["worst_items"]) == 3
        # Sorted by data_quality ascending
        assert data["worst_items"][0]["name"] == "Minimal App"

    async def test_data_quality_orphaned_vs_connected(self, client, db, env):
        """Cards with relations are not counted as orphaned."""
        admin = env["admin"]
        app1 = await create_card(db, card_type="Application", name="Connected", user_id=admin.id)
        await create_card(db, card_type="Application", name="Orphan", user_id=admin.id)
        bc = await create_card(db, card_type="BusinessCapability", name="Cap", user_id=admin.id)
        await create_relation(db, type_key="app_to_bc", source_id=app1.id, target_id=bc.id)

        resp = await client.get(
            "/api/v1/reports/data-quality",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_items"] == 3  # 2 apps + 1 bc
        # app1 and bc are connected; app2 is orphaned
        assert data["orphaned"] == 1

    async def test_data_quality_overall_average(self, client, db, env):
        """Overall data quality is the average of all scores."""
        admin = env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="App 100",
            user_id=admin.id,
            data_quality=100.0,
        )
        await create_card(
            db,
            card_type="Application",
            name="App 0",
            user_id=admin.id,
            data_quality=0.0,
        )

        resp = await client.get(
            "/api/v1/reports/data-quality",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["overall_data_quality"] == 50.0

    async def test_data_quality_permission_denied(self, client, db, env):
        """User without reports.ea_dashboard gets 403."""
        resp = await client.get(
            "/api/v1/reports/data-quality",
            headers=auth_headers(env["noreports"]),
        )
        assert resp.status_code == 403
