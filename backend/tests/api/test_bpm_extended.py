"""Integration tests for BPM assessments (extended) and BPM report endpoints.

Covers:
- POST/GET/PUT/DELETE /bpm/processes/{id}/assessments (score clamping, 404s)
- GET /reports/bpm/dashboard
- GET /reports/bpm/capability-process-matrix
- GET /reports/bpm/process-application-matrix
- GET /reports/bpm/process-dependencies
- GET /reports/bpm/capability-heatmap
- GET /reports/bpm/element-application-map
- GET /reports/bpm/process-map
"""

from __future__ import annotations

import uuid

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
# Shared fixture
# ---------------------------------------------------------------------------


@pytest.fixture
async def bpm_ext_env(db):
    """Prerequisite data for BPM extended tests.

    Creates:
    - admin role (wildcard), viewer role (no bpm.assessments),
      no_bpm_reports role (no reports.bpm_dashboard)
    - BusinessProcess, BusinessCapability, Application card types
    - admin user, viewer user, no_bpm_reports user
    - One BusinessProcess card with typical attributes
    """
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions={
            "inventory.view": True,
            "bpm.view": True,
            "bpm.assessments": False,
            "reports.bpm_dashboard": True,
        },
    )
    await create_role(
        db,
        key="no_bpm_reports",
        label="No BPM Reports",
        permissions={
            "inventory.view": True,
            "bpm.view": True,
            "reports.bpm_dashboard": False,
        },
    )

    await create_card_type(
        db,
        key="BusinessProcess",
        label="Business Process",
        fields_schema=[
            {
                "section": "General",
                "fields": [
                    {
                        "key": "processType",
                        "label": "Process Type",
                        "type": "single_select",
                        "weight": 1,
                        "options": [
                            {"key": "core", "label": "Core"},
                            {"key": "support", "label": "Support"},
                            {"key": "management", "label": "Management"},
                        ],
                    },
                    {
                        "key": "maturity",
                        "label": "Maturity",
                        "type": "single_select",
                        "weight": 1,
                        "options": [
                            {"key": "initial", "label": "Initial"},
                            {"key": "managed", "label": "Managed"},
                            {"key": "defined", "label": "Defined"},
                            {"key": "measured", "label": "Measured"},
                            {"key": "optimized", "label": "Optimized"},
                        ],
                    },
                    {
                        "key": "automationLevel",
                        "label": "Automation Level",
                        "type": "single_select",
                        "weight": 1,
                        "options": [
                            {"key": "manual", "label": "Manual"},
                            {"key": "partial", "label": "Partial"},
                            {"key": "full", "label": "Full"},
                        ],
                    },
                    {
                        "key": "riskLevel",
                        "label": "Risk Level",
                        "type": "single_select",
                        "weight": 1,
                        "options": [
                            {"key": "low", "label": "Low"},
                            {"key": "medium", "label": "Medium"},
                            {"key": "high", "label": "High"},
                            {"key": "critical", "label": "Critical"},
                        ],
                    },
                ],
            }
        ],
    )
    await create_card_type(
        db,
        key="BusinessCapability",
        label="Business Capability",
        has_hierarchy=True,
    )
    await create_card_type(
        db,
        key="Application",
        label="Application",
    )

    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    no_bpm_reports = await create_user(db, email="nobpmreports@test.com", role="no_bpm_reports")

    process = await create_card(
        db,
        card_type="BusinessProcess",
        name="Order Processing",
        user_id=admin.id,
        attributes={
            "processType": "core",
            "maturity": "defined",
            "automationLevel": "partial",
            "riskLevel": "medium",
        },
    )

    return {
        "admin": admin,
        "viewer": viewer,
        "no_bpm_reports": no_bpm_reports,
        "process": process,
    }


# ===========================================================================
# Assessments
# ===========================================================================


class TestBpmAssessments:
    """Tests for /bpm/processes/{id}/assessments CRUD."""

    async def test_create_assessment(self, client, db, bpm_ext_env):
        """POST creates an assessment and returns its id and overall_score."""
        admin = bpm_ext_env["admin"]
        process = bpm_ext_env["process"]

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/assessments",
            json={
                "assessment_date": "2025-01-15",
                "overall_score": 4,
                "efficiency": 3,
                "effectiveness": 4,
                "compliance": 5,
                "automation": 2,
                "notes": "test",
                "action_items": [],
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["overall_score"] == 4
        assert "id" in data
        assert data["process_id"] == str(process.id)

    async def test_list_assessments(self, client, db, bpm_ext_env):
        """GET lists created assessments with all score fields."""
        admin = bpm_ext_env["admin"]
        process = bpm_ext_env["process"]

        # Create an assessment
        create_resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/assessments",
            json={
                "assessment_date": "2025-01-15",
                "overall_score": 4,
                "efficiency": 3,
                "effectiveness": 4,
                "compliance": 5,
                "automation": 2,
                "notes": "initial assessment",
                "action_items": [],
            },
            headers=auth_headers(admin),
        )
        assert create_resp.status_code == 201

        # List them
        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/assessments",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1

        first = data[0]
        assert first["overall_score"] == 4
        assert first["efficiency"] == 3
        assert first["effectiveness"] == 4
        assert first["compliance"] == 5
        assert first["automation"] == 2
        assert first["notes"] == "initial assessment"
        assert "assessor_name" in first
        assert "created_at" in first

    async def test_update_assessment_scores(self, client, db, bpm_ext_env):
        """PUT updates specific score fields."""
        admin = bpm_ext_env["admin"]
        process = bpm_ext_env["process"]

        create_resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/assessments",
            json={
                "assessment_date": "2025-02-10",
                "overall_score": 2,
                "efficiency": 2,
                "effectiveness": 2,
                "compliance": 2,
                "automation": 2,
            },
            headers=auth_headers(admin),
        )
        a_id = create_resp.json()["id"]

        resp = await client.put(
            f"/api/v1/bpm/processes/{process.id}/assessments/{a_id}",
            json={"overall_score": 5, "efficiency": 4, "notes": "Improved"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "updated"

        # Verify changes persisted
        list_resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/assessments",
            headers=auth_headers(admin),
        )
        updated = [a for a in list_resp.json() if a["id"] == a_id][0]
        assert updated["overall_score"] == 5
        assert updated["efficiency"] == 4
        assert updated["notes"] == "Improved"
        # Unchanged fields should stay the same
        assert updated["effectiveness"] == 2
        assert updated["compliance"] == 2
        assert updated["automation"] == 2

    async def test_delete_assessment(self, client, db, bpm_ext_env):
        """DELETE removes the assessment and returns 204."""
        admin = bpm_ext_env["admin"]
        process = bpm_ext_env["process"]

        create_resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/assessments",
            json={
                "assessment_date": "2025-03-01",
                "overall_score": 1,
                "efficiency": 1,
                "effectiveness": 1,
                "compliance": 1,
                "automation": 1,
            },
            headers=auth_headers(admin),
        )
        a_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/bpm/processes/{process.id}/assessments/{a_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

        # Verify it is gone
        list_resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/assessments",
            headers=auth_headers(admin),
        )
        ids = [a["id"] for a in list_resp.json()]
        assert a_id not in ids

    async def test_assessment_nonexistent_process_404(self, client, db, bpm_ext_env):
        """Accessing assessments on a nonexistent process returns 404."""
        admin = bpm_ext_env["admin"]
        fake_id = uuid.uuid4()

        resp = await client.get(
            f"/api/v1/bpm/processes/{fake_id}/assessments",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_score_clamping_high(self, client, db, bpm_ext_env):
        """Scores above 5 are clamped to 5."""
        admin = bpm_ext_env["admin"]
        process = bpm_ext_env["process"]

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/assessments",
            json={
                "assessment_date": "2025-04-01",
                "overall_score": 10,
                "efficiency": 99,
                "effectiveness": 7,
                "compliance": 100,
                "automation": 6,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        a_id = resp.json()["id"]
        # The create response only returns overall_score, verify via list
        assert resp.json()["overall_score"] == 5

        list_resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/assessments",
            headers=auth_headers(admin),
        )
        clamped = [a for a in list_resp.json() if a["id"] == a_id][0]
        assert clamped["overall_score"] == 5
        assert clamped["efficiency"] == 5
        assert clamped["effectiveness"] == 5
        assert clamped["compliance"] == 5
        assert clamped["automation"] == 5

    async def test_score_clamping_low(self, client, db, bpm_ext_env):
        """Scores at or below 0 are clamped to 1."""
        admin = bpm_ext_env["admin"]
        process = bpm_ext_env["process"]

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/assessments",
            json={
                "assessment_date": "2025-04-02",
                "overall_score": 0,
                "efficiency": -5,
                "effectiveness": 0,
                "compliance": -1,
                "automation": 0,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        a_id = resp.json()["id"]
        assert resp.json()["overall_score"] == 1

        list_resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/assessments",
            headers=auth_headers(admin),
        )
        clamped = [a for a in list_resp.json() if a["id"] == a_id][0]
        assert clamped["overall_score"] == 1
        assert clamped["efficiency"] == 1
        assert clamped["effectiveness"] == 1
        assert clamped["compliance"] == 1
        assert clamped["automation"] == 1


# ===========================================================================
# BPM Reports
# ===========================================================================


class TestBpmDashboard:
    """Tests for GET /reports/bpm/dashboard."""

    async def test_dashboard_empty(self, client, db, bpm_ext_env):
        """Dashboard returns valid structure when no BP cards exist with attributes.

        Note: bpm_ext_env creates one process card, so total_processes >= 1.
        We still validate the shape of the response.
        """
        admin = bpm_ext_env["admin"]
        resp = await client.get(
            "/api/v1/reports/bpm/dashboard",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "total_processes" in data
        assert isinstance(data["total_processes"], int)
        assert "by_process_type" in data
        assert "by_maturity" in data
        assert "by_automation" in data
        assert "by_risk" in data
        assert "top_risk_processes" in data
        assert isinstance(data["top_risk_processes"], list)
        assert "diagram_coverage" in data
        coverage = data["diagram_coverage"]
        assert "with_diagram" in coverage
        assert "total" in coverage
        assert "percentage" in coverage

    async def test_dashboard_with_process_attributes(self, client, db, bpm_ext_env):
        """Dashboard aggregates process attributes correctly."""
        admin = bpm_ext_env["admin"]

        # Create additional processes with varied attributes
        await create_card(
            db,
            card_type="BusinessProcess",
            name="Invoice Processing",
            user_id=admin.id,
            attributes={
                "processType": "support",
                "maturity": "initial",
                "automationLevel": "manual",
                "riskLevel": "high",
            },
        )
        await create_card(
            db,
            card_type="BusinessProcess",
            name="Risk Management",
            user_id=admin.id,
            attributes={
                "processType": "management",
                "maturity": "optimized",
                "automationLevel": "full",
                "riskLevel": "critical",
            },
        )

        resp = await client.get(
            "/api/v1/reports/bpm/dashboard",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()

        # env already has 1 process + 2 new = 3 total
        assert data["total_processes"] == 3

        # Verify by_process_type counts
        assert data["by_process_type"]["core"] == 1
        assert data["by_process_type"]["support"] == 1
        assert data["by_process_type"]["management"] == 1

        # Verify maturity distribution
        assert data["by_maturity"]["defined"] == 1
        assert data["by_maturity"]["initial"] == 1
        assert data["by_maturity"]["optimized"] == 1

        # Verify automation distribution
        assert data["by_automation"]["partial"] == 1
        assert data["by_automation"]["manual"] == 1
        assert data["by_automation"]["full"] == 1

        # Verify risk distribution
        assert data["by_risk"]["medium"] == 1
        assert data["by_risk"]["high"] == 1
        assert data["by_risk"]["critical"] == 1

        # top_risk should include the high and critical processes
        risk_names = [p["name"] for p in data["top_risk_processes"]]
        assert "Invoice Processing" in risk_names
        assert "Risk Management" in risk_names

    async def test_dashboard_permission_denied(self, client, db, bpm_ext_env):
        """User without reports.bpm_dashboard gets 403."""
        no_bpm = bpm_ext_env["no_bpm_reports"]
        resp = await client.get(
            "/api/v1/reports/bpm/dashboard",
            headers=auth_headers(no_bpm),
        )
        assert resp.status_code == 403


class TestCapabilityProcessMatrix:
    """Tests for GET /reports/bpm/capability-process-matrix."""

    async def test_matrix_empty(self, client, db, bpm_ext_env):
        """Returns empty rows/columns/cells when no relProcessToBC relations exist."""
        admin = bpm_ext_env["admin"]
        resp = await client.get(
            "/api/v1/reports/bpm/capability-process-matrix",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["rows"] == []
        assert data["columns"] == []
        assert data["cells"] == []


class TestProcessApplicationMatrix:
    """Tests for GET /reports/bpm/process-application-matrix."""

    async def test_matrix_empty(self, client, db, bpm_ext_env):
        """Returns empty structure when no relProcessToApp relations exist."""
        admin = bpm_ext_env["admin"]
        resp = await client.get(
            "/api/v1/reports/bpm/process-application-matrix",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["rows"] == []
        assert data["columns"] == []
        assert data["cells"] == []


class TestProcessDependencies:
    """Tests for GET /reports/bpm/process-dependencies."""

    async def test_dependencies_empty(self, client, db, bpm_ext_env):
        """Returns empty nodes/edges when no relProcessDependency relations exist."""
        admin = bpm_ext_env["admin"]
        resp = await client.get(
            "/api/v1/reports/bpm/process-dependencies",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["nodes"] == []
        assert data["edges"] == []


class TestCapabilityHeatmap:
    """Tests for GET /reports/bpm/capability-heatmap."""

    async def test_heatmap_empty(self, client, db, bpm_ext_env):
        """Returns valid structure with no capabilities."""
        admin = bpm_ext_env["admin"]
        resp = await client.get(
            "/api/v1/reports/bpm/capability-heatmap?metric=process_count",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["metric"] == "process_count"
        assert isinstance(data["items"], list)
        # No capabilities created yet -> empty items
        assert len(data["items"]) == 0

    async def test_heatmap_with_capabilities(self, client, db, bpm_ext_env):
        """Heatmap includes capability cards with metric_value=0 when unlinked."""
        admin = bpm_ext_env["admin"]

        await create_card(
            db,
            card_type="BusinessCapability",
            name="Customer Management",
            user_id=admin.id,
        )

        resp = await client.get(
            "/api/v1/reports/bpm/capability-heatmap?metric=process_count",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 1
        assert data["items"][0]["name"] == "Customer Management"
        # No relations → process_count = 0
        assert data["items"][0]["metric_value"] == 0


class TestProcessMap:
    """Tests for GET /reports/bpm/process-map."""

    async def test_process_map_empty_when_no_processes(self, client, db, bpm_ext_env):
        """Process map returns items for existing processes."""
        admin = bpm_ext_env["admin"]
        resp = await client.get(
            "/api/v1/reports/bpm/process-map",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "organizations" in data
        assert "business_contexts" in data
        assert isinstance(data["items"], list)
        # The env has at least one process
        assert len(data["items"]) >= 1
        item = data["items"][0]
        assert "id" in item
        assert "name" in item
        assert "app_count" in item
        assert "has_diagram" in item


class TestElementApplicationMap:
    """Tests for GET /reports/bpm/element-application-map."""

    async def test_element_app_map_empty(self, client, db, bpm_ext_env):
        """Returns empty list when no elements have application links."""
        admin = bpm_ext_env["admin"]
        resp = await client.get(
            "/api/v1/reports/bpm/element-application-map",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 0


# ===========================================================================
# Permission tests (assessments + reports)
# ===========================================================================


class TestBpmAssessmentPermissions:
    """Tests that assessment endpoints enforce bpm.assessments permission."""

    async def test_viewer_cannot_create_assessment(self, client, db, bpm_ext_env):
        """Viewer role (bpm.assessments=False) gets 403 on POST."""
        viewer = bpm_ext_env["viewer"]
        process = bpm_ext_env["process"]
        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/assessments",
            json={
                "assessment_date": "2025-06-01",
                "overall_score": 3,
                "efficiency": 3,
                "effectiveness": 3,
                "compliance": 3,
                "automation": 3,
            },
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_viewer_cannot_delete_assessment(self, client, db, bpm_ext_env):
        """Viewer role gets 403 on DELETE."""
        admin = bpm_ext_env["admin"]
        viewer = bpm_ext_env["viewer"]
        process = bpm_ext_env["process"]

        # Admin creates assessment
        create_resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/assessments",
            json={
                "assessment_date": "2025-06-02",
                "overall_score": 3,
                "efficiency": 3,
                "effectiveness": 3,
                "compliance": 3,
                "automation": 3,
            },
            headers=auth_headers(admin),
        )
        a_id = create_resp.json()["id"]

        # Viewer tries to delete
        resp = await client.delete(
            f"/api/v1/bpm/processes/{process.id}/assessments/{a_id}",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_viewer_cannot_update_assessment(self, client, db, bpm_ext_env):
        """Viewer role gets 403 on PUT."""
        admin = bpm_ext_env["admin"]
        viewer = bpm_ext_env["viewer"]
        process = bpm_ext_env["process"]

        create_resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/assessments",
            json={
                "assessment_date": "2025-06-03",
                "overall_score": 3,
                "efficiency": 3,
                "effectiveness": 3,
                "compliance": 3,
                "automation": 3,
            },
            headers=auth_headers(admin),
        )
        a_id = create_resp.json()["id"]

        resp = await client.put(
            f"/api/v1/bpm/processes/{process.id}/assessments/{a_id}",
            json={"overall_score": 5},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_delete_nonexistent_assessment_404(self, client, db, bpm_ext_env):
        """DELETE on a nonexistent assessment returns 404."""
        admin = bpm_ext_env["admin"]
        process = bpm_ext_env["process"]
        fake_id = uuid.uuid4()

        resp = await client.delete(
            f"/api/v1/bpm/processes/{process.id}/assessments/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_update_nonexistent_assessment_404(self, client, db, bpm_ext_env):
        """PUT on a nonexistent assessment returns 404."""
        admin = bpm_ext_env["admin"]
        process = bpm_ext_env["process"]
        fake_id = uuid.uuid4()

        resp = await client.put(
            f"/api/v1/bpm/processes/{process.id}/assessments/{fake_id}",
            json={"overall_score": 5},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


class TestBpmReportPermissions:
    """Verify all BPM report endpoints enforce reports.bpm_dashboard permission."""

    REPORT_ENDPOINTS = [
        "/api/v1/reports/bpm/dashboard",
        "/api/v1/reports/bpm/capability-process-matrix",
        "/api/v1/reports/bpm/process-application-matrix",
        "/api/v1/reports/bpm/process-dependencies",
        "/api/v1/reports/bpm/capability-heatmap?metric=process_count",
        "/api/v1/reports/bpm/element-application-map",
        "/api/v1/reports/bpm/process-map",
    ]

    @pytest.mark.parametrize("endpoint", REPORT_ENDPOINTS)
    async def test_report_permission_denied(self, client, db, bpm_ext_env, endpoint):
        """User without reports.bpm_dashboard gets 403 on all BPM report endpoints."""
        no_bpm = bpm_ext_env["no_bpm_reports"]
        resp = await client.get(endpoint, headers=auth_headers(no_bpm))
        assert resp.status_code == 403


# ===========================================================================
# Data-driven BPM report tests (with relations)
# ===========================================================================


class TestCapabilityProcessMatrixWithData:
    """Tests capability-process-matrix with actual relations."""

    async def test_matrix_with_relations(self, client, db, bpm_ext_env):
        """Matrix returns rows (capabilities) and columns (processes) when linked."""
        admin = bpm_ext_env["admin"]
        process = bpm_ext_env["process"]

        cap = await create_card(
            db,
            card_type="BusinessCapability",
            name="Order Management",
            user_id=admin.id,
        )

        await create_relation_type(
            db,
            key="relProcessToBC",
            label="Process to Capability",
            source_type_key="BusinessProcess",
            target_type_key="BusinessCapability",
        )
        await create_relation(db, type_key="relProcessToBC", source_id=process.id, target_id=cap.id)

        resp = await client.get(
            "/api/v1/reports/bpm/capability-process-matrix",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["rows"]) >= 1
        assert len(data["columns"]) >= 1
        assert len(data["cells"]) >= 1

        # Verify the capability appears in rows
        row_names = [r["name"] for r in data["rows"]]
        assert "Order Management" in row_names


class TestProcessApplicationMatrixWithData:
    """Tests process-application-matrix with actual relations."""

    async def test_matrix_with_relations(self, client, db, bpm_ext_env):
        """Matrix returns processes and applications when linked."""
        admin = bpm_ext_env["admin"]
        process = bpm_ext_env["process"]

        app = await create_card(
            db,
            card_type="Application",
            name="Order Service",
            user_id=admin.id,
        )

        await create_relation_type(
            db,
            key="relProcessToApp",
            label="Process to Application",
            source_type_key="BusinessProcess",
            target_type_key="Application",
        )
        await create_relation(
            db, type_key="relProcessToApp", source_id=process.id, target_id=app.id
        )

        resp = await client.get(
            "/api/v1/reports/bpm/process-application-matrix",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["rows"]) >= 1
        assert len(data["columns"]) >= 1
        assert len(data["cells"]) >= 1


class TestProcessDependenciesWithData:
    """Tests process-dependencies with actual relations."""

    async def test_dependencies_with_relations(self, client, db, bpm_ext_env):
        """Returns nodes and edges when process dependency relations exist."""
        admin = bpm_ext_env["admin"]
        process = bpm_ext_env["process"]

        process2 = await create_card(
            db,
            card_type="BusinessProcess",
            name="Shipping Process",
            user_id=admin.id,
            attributes={"processType": "core"},
        )

        await create_relation_type(
            db,
            key="relProcessDependency",
            label="Process Dependency",
            source_type_key="BusinessProcess",
            target_type_key="BusinessProcess",
        )
        await create_relation(
            db,
            type_key="relProcessDependency",
            source_id=process.id,
            target_id=process2.id,
        )

        resp = await client.get(
            "/api/v1/reports/bpm/process-dependencies",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["nodes"]) >= 2
        assert len(data["edges"]) >= 1

        node_names = [n["name"] for n in data["nodes"]]
        assert "Order Processing" in node_names
        assert "Shipping Process" in node_names


class TestCapabilityHeatmapWithData:
    """Tests capability-heatmap with linked capabilities and processes."""

    async def test_heatmap_with_linked_capability(self, client, db, bpm_ext_env):
        """Capability linked to a process shows non-zero metric_value."""
        admin = bpm_ext_env["admin"]
        process = bpm_ext_env["process"]

        cap = await create_card(
            db,
            card_type="BusinessCapability",
            name="Supply Chain",
            user_id=admin.id,
        )

        await create_relation_type(
            db,
            key="relBCToProcess",
            label="Capability to Process",
            source_type_key="BusinessCapability",
            target_type_key="BusinessProcess",
        )
        await create_relation(db, type_key="relBCToProcess", source_id=cap.id, target_id=process.id)

        resp = await client.get(
            "/api/v1/reports/bpm/capability-heatmap?metric=process_count",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()

        linked = [i for i in data["items"] if i["name"] == "Supply Chain"]
        assert len(linked) == 1
        assert linked[0]["metric_value"] >= 1
