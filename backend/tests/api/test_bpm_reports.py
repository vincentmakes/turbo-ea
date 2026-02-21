"""Integration tests for BPM report endpoints.

Covers all 8 endpoints in bpm_reports.py: dashboard, capability-process-matrix,
process-application-matrix, process-dependencies, capability-heatmap,
element-application-map, process-map, and value-stream-matrix.

Integration tests requiring a PostgreSQL test database.
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


@pytest.fixture
async def bpm_env(db):
    """Set up card types and relations needed for BPM reports."""
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions={"reports.bpm_dashboard": False},
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")

    await create_card_type(db, key="BusinessProcess", label="Business Process", has_hierarchy=True)
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(
        db, key="BusinessCapability", label="Business Capability", has_hierarchy=True
    )
    await create_card_type(db, key="DataObject", label="Data Object")
    await create_card_type(db, key="Organization", label="Organization")
    await create_card_type(db, key="BusinessContext", label="Business Context")

    await create_relation_type(
        db,
        key="relProcessToApp",
        label="Process to App",
        source_type_key="BusinessProcess",
        target_type_key="Application",
    )
    await create_relation_type(
        db,
        key="relProcessToBC",
        label="Process to Capability",
        source_type_key="BusinessProcess",
        target_type_key="BusinessCapability",
    )
    await create_relation_type(
        db,
        key="relProcessDependency",
        label="Process Dependency",
        source_type_key="BusinessProcess",
        target_type_key="BusinessProcess",
    )
    await create_relation_type(
        db,
        key="relProcessToDataObj",
        label="Process to Data Object",
        source_type_key="BusinessProcess",
        target_type_key="DataObject",
    )
    await create_relation_type(
        db,
        key="relProcessToOrg",
        label="Process to Org",
        source_type_key="BusinessProcess",
        target_type_key="Organization",
    )
    await create_relation_type(
        db,
        key="relProcessToBizCtx",
        label="Process to Context",
        source_type_key="BusinessProcess",
        target_type_key="BusinessContext",
    )

    return {"admin": admin, "viewer": viewer}


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


class TestBpmDashboard:
    async def test_empty_dashboard(self, client, bpm_env):
        resp = await client.get(
            "/api/v1/reports/bpm/dashboard",
            headers=auth_headers(bpm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_processes"] == 0
        assert data["diagram_coverage"]["percentage"] == 0

    async def test_dashboard_with_processes(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        await create_card(
            db,
            card_type="BusinessProcess",
            name="Order",
            user_id=admin.id,
            attributes={
                "processType": "core",
                "maturity": "defined",
                "automationLevel": "manual",
                "riskLevel": "high",
            },
        )
        await create_card(
            db,
            card_type="BusinessProcess",
            name="Billing",
            user_id=admin.id,
            attributes={
                "processType": "support",
                "maturity": "initial",
                "automationLevel": "fullyAutomated",
                "riskLevel": "critical",
            },
        )
        resp = await client.get(
            "/api/v1/reports/bpm/dashboard",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_processes"] == 2
        assert data["by_process_type"]["core"] == 1
        assert data["by_process_type"]["support"] == 1
        assert data["by_risk"]["high"] == 1
        assert data["by_risk"]["critical"] == 1

    async def test_dashboard_top_risk_sorted(self, client, db, bpm_env):
        """Critical risk should appear before high risk."""
        admin = bpm_env["admin"]
        await create_card(
            db,
            card_type="BusinessProcess",
            name="HighRisk",
            user_id=admin.id,
            attributes={"riskLevel": "high"},
        )
        await create_card(
            db,
            card_type="BusinessProcess",
            name="CriticalRisk",
            user_id=admin.id,
            attributes={"riskLevel": "critical"},
        )
        resp = await client.get(
            "/api/v1/reports/bpm/dashboard",
            headers=auth_headers(admin),
        )
        data = resp.json()
        risks = data["top_risk_processes"]
        assert len(risks) == 2
        assert risks[0]["risk"] == "critical"
        assert risks[1]["risk"] == "high"

    async def test_dashboard_permission_denied(self, client, bpm_env):
        resp = await client.get(
            "/api/v1/reports/bpm/dashboard",
            headers=auth_headers(bpm_env["viewer"]),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Capability-Process Matrix
# ---------------------------------------------------------------------------


class TestCapabilityProcessMatrix:
    async def test_empty_matrix(self, client, bpm_env):
        resp = await client.get(
            "/api/v1/reports/bpm/capability-process-matrix",
            headers=auth_headers(bpm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data == {"rows": [], "columns": [], "cells": []}

    async def test_matrix_with_relations(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        proc = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=admin.id)
        cap = await create_card(
            db, card_type="BusinessCapability", name="Billing", user_id=admin.id
        )
        await create_relation(db, type_key="relProcessToBC", source_id=proc.id, target_id=cap.id)

        resp = await client.get(
            "/api/v1/reports/bpm/capability-process-matrix",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["rows"]) == 1
        assert len(data["columns"]) == 1
        assert len(data["cells"]) == 1
        assert data["cells"][0]["process_id"] == str(proc.id)
        assert data["cells"][0]["capability_id"] == str(cap.id)


# ---------------------------------------------------------------------------
# Process-Application Matrix
# ---------------------------------------------------------------------------


class TestProcessApplicationMatrix:
    async def test_empty_matrix(self, client, bpm_env):
        resp = await client.get(
            "/api/v1/reports/bpm/process-application-matrix",
            headers=auth_headers(bpm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data == {"rows": [], "columns": [], "cells": []}

    async def test_matrix_with_relation(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        proc = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=admin.id)
        app = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        await create_relation(db, type_key="relProcessToApp", source_id=proc.id, target_id=app.id)

        resp = await client.get(
            "/api/v1/reports/bpm/process-application-matrix",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["cells"]) == 1
        assert data["cells"][0]["source"] == "relation"

    async def test_matrix_with_element_link(self, client, db, bpm_env):
        """Element-level links should also appear in the matrix."""
        from app.models.process_element import ProcessElement

        admin = bpm_env["admin"]
        proc = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=admin.id)
        app = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        elem = ProcessElement(
            process_id=proc.id,
            bpmn_element_id="task_1",
            element_type="task",
            name="Use CRM",
            application_id=app.id,
            sequence_order=0,
        )
        db.add(elem)
        await db.flush()

        resp = await client.get(
            "/api/v1/reports/bpm/process-application-matrix",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["cells"]) == 1
        assert data["cells"][0]["source"] == "element"
        assert data["cells"][0]["element_name"] == "Use CRM"


# ---------------------------------------------------------------------------
# Process Dependencies
# ---------------------------------------------------------------------------


class TestProcessDependencies:
    async def test_empty_graph(self, client, bpm_env):
        resp = await client.get(
            "/api/v1/reports/bpm/process-dependencies",
            headers=auth_headers(bpm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data == {"nodes": [], "edges": []}

    async def test_graph_with_dependency(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        p1 = await create_card(db, card_type="BusinessProcess", name="Order", user_id=admin.id)
        p2 = await create_card(db, card_type="BusinessProcess", name="Shipping", user_id=admin.id)
        await create_relation(
            db,
            type_key="relProcessDependency",
            source_id=p1.id,
            target_id=p2.id,
        )

        resp = await client.get(
            "/api/v1/reports/bpm/process-dependencies",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["nodes"]) == 2
        assert len(data["edges"]) == 1
        assert data["edges"][0]["source"] == str(p1.id)
        assert data["edges"][0]["target"] == str(p2.id)


# ---------------------------------------------------------------------------
# Capability Heatmap
# ---------------------------------------------------------------------------


class TestCapabilityHeatmap:
    async def test_empty_heatmap(self, client, bpm_env):
        resp = await client.get(
            "/api/v1/reports/bpm/capability-heatmap",
            headers=auth_headers(bpm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["metric"] == "process_count"
        assert data["items"] == []

    async def test_process_count_metric(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        cap = await create_card(
            db, card_type="BusinessCapability", name="Billing", user_id=admin.id
        )
        proc = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=admin.id)
        await create_relation(db, type_key="relProcessToBC", source_id=proc.id, target_id=cap.id)

        resp = await client.get(
            "/api/v1/reports/bpm/capability-heatmap?metric=process_count",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 1
        assert data["items"][0]["metric_value"] == 1

    async def test_maturity_metric(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        await create_card(
            db,
            card_type="BusinessCapability",
            name="Cap",
            user_id=admin.id,
            attributes={"maturity": "optimized"},
        )

        resp = await client.get(
            "/api/v1/reports/bpm/capability-heatmap?metric=maturity",
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert data["items"][0]["metric_value"] == 5  # optimized = 5

    async def test_strategic_importance_metric(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        await create_card(
            db,
            card_type="BusinessCapability",
            name="Cap",
            user_id=admin.id,
            attributes={"strategicImportance": "critical"},
        )

        resp = await client.get(
            "/api/v1/reports/bpm/capability-heatmap?metric=strategicImportance",
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert data["items"][0]["metric_value"] == 4  # critical = 4

    async def test_unknown_metric_value_defaults_to_zero(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        await create_card(
            db,
            card_type="BusinessCapability",
            name="Cap",
            user_id=admin.id,
            attributes={"maturity": "nonexistent_value"},
        )

        resp = await client.get(
            "/api/v1/reports/bpm/capability-heatmap?metric=maturity",
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert data["items"][0]["metric_value"] == 0

    async def test_capability_level_from_attributes(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        await create_card(
            db,
            card_type="BusinessCapability",
            name="Cap",
            user_id=admin.id,
            attributes={"capabilityLevel": "L3"},
        )

        resp = await client.get(
            "/api/v1/reports/bpm/capability-heatmap",
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert data["items"][0]["level"] == "L3"

    async def test_capability_level_defaults_to_l1(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        await create_card(
            db,
            card_type="BusinessCapability",
            name="Cap",
            user_id=admin.id,
        )

        resp = await client.get(
            "/api/v1/reports/bpm/capability-heatmap",
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert data["items"][0]["level"] == "L1"


# ---------------------------------------------------------------------------
# Element-Application Map
# ---------------------------------------------------------------------------


class TestElementApplicationMap:
    async def test_empty_map(self, client, bpm_env):
        resp = await client.get(
            "/api/v1/reports/bpm/element-application-map",
            headers=auth_headers(bpm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_map_with_linked_elements(self, client, db, bpm_env):
        from app.models.process_element import ProcessElement

        admin = bpm_env["admin"]
        proc = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=admin.id)
        app = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        elem = ProcessElement(
            process_id=proc.id,
            bpmn_element_id="task_1",
            element_type="userTask",
            name="Update Customer",
            application_id=app.id,
            sequence_order=0,
        )
        db.add(elem)
        await db.flush()

        resp = await client.get(
            "/api/v1/reports/bpm/element-application-map",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["application_name"] == "CRM"
        assert len(data[0]["elements"]) == 1
        assert data[0]["elements"][0]["element_name"] == "Update Customer"
        assert data[0]["elements"][0]["process_name"] == "Flow"

    async def test_map_groups_by_application(self, client, db, bpm_env):
        """Multiple elements linked to the same app are grouped."""
        from app.models.process_element import ProcessElement

        admin = bpm_env["admin"]
        proc = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=admin.id)
        app = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
        for i, name in enumerate(["Create Order", "Send Invoice"]):
            db.add(
                ProcessElement(
                    process_id=proc.id,
                    bpmn_element_id=f"task_{i}",
                    element_type="task",
                    name=name,
                    application_id=app.id,
                    sequence_order=i,
                )
            )
        await db.flush()

        resp = await client.get(
            "/api/v1/reports/bpm/element-application-map",
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert len(data) == 1
        assert len(data[0]["elements"]) == 2


# ---------------------------------------------------------------------------
# Process Map
# ---------------------------------------------------------------------------


class TestProcessMap:
    async def test_empty_map(self, client, bpm_env):
        resp = await client.get(
            "/api/v1/reports/bpm/process-map",
            headers=auth_headers(bpm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data == {
            "items": [],
            "organizations": [],
            "business_contexts": [],
        }

    async def test_process_with_linked_app(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        proc = await create_card(db, card_type="BusinessProcess", name="Order", user_id=admin.id)
        app = await create_card(
            db,
            card_type="Application",
            name="CRM",
            user_id=admin.id,
            attributes={"costTotalAnnual": 50000},
        )
        await create_relation(db, type_key="relProcessToApp", source_id=proc.id, target_id=app.id)

        resp = await client.get(
            "/api/v1/reports/bpm/process-map",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 1
        item = data["items"][0]
        assert item["app_count"] == 1
        assert item["total_cost"] == 50000
        assert len(item["apps"]) == 1
        assert item["apps"][0]["name"] == "CRM"

    async def test_process_with_org_and_context(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        proc = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=admin.id)
        org = await create_card(db, card_type="Organization", name="Sales", user_id=admin.id)
        ctx = await create_card(db, card_type="BusinessContext", name="CJ", user_id=admin.id)
        await create_relation(db, type_key="relProcessToOrg", source_id=proc.id, target_id=org.id)
        await create_relation(
            db,
            type_key="relProcessToBizCtx",
            source_id=proc.id,
            target_id=ctx.id,
        )

        resp = await client.get(
            "/api/v1/reports/bpm/process-map",
            headers=auth_headers(admin),
        )
        data = resp.json()
        item = data["items"][0]
        assert str(org.id) in item["org_ids"]
        assert str(ctx.id) in item["ctx_ids"]
        assert len(data["organizations"]) == 1
        assert len(data["business_contexts"]) == 1

    async def test_process_with_data_object(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        proc = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=admin.id)
        dobj = await create_card(db, card_type="DataObject", name="Customer", user_id=admin.id)
        await create_relation(
            db,
            type_key="relProcessToDataObj",
            source_id=proc.id,
            target_id=dobj.id,
        )

        resp = await client.get(
            "/api/v1/reports/bpm/process-map",
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert len(data["items"][0]["data_objects"]) == 1
        assert data["items"][0]["data_objects"][0]["name"] == "Customer"


# ---------------------------------------------------------------------------
# Value Stream Matrix
# ---------------------------------------------------------------------------


class TestValueStreamMatrix:
    async def test_empty_matrix(self, client, bpm_env):
        resp = await client.get(
            "/api/v1/reports/bpm/value-stream-matrix",
            headers=auth_headers(bpm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data == {
            "contexts": [],
            "organizations": [],
            "cells": {},
            "unassigned": [],
        }

    async def test_process_assigned_to_org_and_context(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        proc = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=admin.id)
        org = await create_card(db, card_type="Organization", name="Sales", user_id=admin.id)
        ctx = await create_card(
            db,
            card_type="BusinessContext",
            name="Value Stream 1",
            user_id=admin.id,
            attributes={"subtype": "valueStream"},
        )
        # Subtype must be set on the card itself
        from sqlalchemy import update

        from app.models.card import Card

        await db.execute(update(Card).where(Card.id == ctx.id).values(subtype="valueStream"))
        await db.flush()

        await create_relation(db, type_key="relProcessToOrg", source_id=proc.id, target_id=org.id)
        await create_relation(
            db,
            type_key="relProcessToBizCtx",
            source_id=proc.id,
            target_id=ctx.id,
        )

        resp = await client.get(
            "/api/v1/reports/bpm/value-stream-matrix",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["organizations"]) == 1
        assert len(data["contexts"]) == 1
        # Process should be in the cell at (org, ctx) intersection
        org_id = str(org.id)
        ctx_id = str(ctx.id)
        assert org_id in data["cells"]
        assert ctx_id in data["cells"][org_id]
        assert len(data["cells"][org_id][ctx_id]) == 1

    async def test_unassigned_process(self, client, db, bpm_env):
        """Processes without org/context relations go into unassigned."""
        admin = bpm_env["admin"]
        await create_card(db, card_type="BusinessProcess", name="Orphan", user_id=admin.id)

        resp = await client.get(
            "/api/v1/reports/bpm/value-stream-matrix",
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert len(data["unassigned"]) == 1
        assert data["unassigned"][0]["name"] == "Orphan"

    async def test_org_only_goes_to_none_context(self, client, db, bpm_env):
        """Process with org but no context assigned to __none__."""
        admin = bpm_env["admin"]
        proc = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=admin.id)
        org = await create_card(db, card_type="Organization", name="Sales", user_id=admin.id)
        await create_relation(db, type_key="relProcessToOrg", source_id=proc.id, target_id=org.id)

        resp = await client.get(
            "/api/v1/reports/bpm/value-stream-matrix",
            headers=auth_headers(admin),
        )
        data = resp.json()
        org_id = str(org.id)
        assert org_id in data["cells"]
        assert "__none__" in data["cells"][org_id]

    async def test_hierarchy_propagation(self, client, db, bpm_env):
        """Child processes inherit parent cell assignment."""
        admin = bpm_env["admin"]
        parent = await create_card(db, card_type="BusinessProcess", name="Parent", user_id=admin.id)
        await create_card(
            db,
            card_type="BusinessProcess",
            name="Child",
            user_id=admin.id,
            parent_id=parent.id,
        )
        org = await create_card(db, card_type="Organization", name="Sales", user_id=admin.id)
        # Only parent has the org relation — child should inherit
        await create_relation(db, type_key="relProcessToOrg", source_id=parent.id, target_id=org.id)

        resp = await client.get(
            "/api/v1/reports/bpm/value-stream-matrix",
            headers=auth_headers(admin),
        )
        data = resp.json()
        org_id = str(org.id)
        # Both parent and child should appear in the cell
        cell_items = data["cells"][org_id]["__none__"]
        names = {item["name"] for item in cell_items}
        assert "Parent" in names
        assert "Child" in names

    async def test_process_with_app_relation(self, client, db, bpm_env):
        """Processes in matrix should include linked apps."""
        admin = bpm_env["admin"]
        proc = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=admin.id)
        app = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        org = await create_card(db, card_type="Organization", name="Sales", user_id=admin.id)
        await create_relation(db, type_key="relProcessToOrg", source_id=proc.id, target_id=org.id)
        await create_relation(db, type_key="relProcessToApp", source_id=proc.id, target_id=app.id)

        resp = await client.get(
            "/api/v1/reports/bpm/value-stream-matrix",
            headers=auth_headers(admin),
        )
        data = resp.json()
        org_id = str(org.id)
        cell_items = data["cells"][org_id]["__none__"]
        assert len(cell_items[0]["apps"]) == 1
        assert cell_items[0]["apps"][0]["name"] == "CRM"
