"""Integration tests for PPM report endpoints.

Covers the 3 endpoints in ppm_reports.py: group-options, dashboard, and gantt.

Integration tests requiring a PostgreSQL test database.
"""

from __future__ import annotations

import pytest

from app.core.permissions import VIEWER_PERMISSIONS
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
async def ppm_env(db):
    """Set up card types and relations needed for PPM reports."""
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions={**VIEWER_PERMISSIONS},
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")

    await create_card_type(db, key="Initiative", label="Initiative")
    await create_card_type(db, key="Organization", label="Organization")
    await create_card_type(db, key="Application", label="Application")

    return {"admin": admin, "viewer": viewer}


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


class TestPpmDashboard:
    async def test_empty_dashboard(self, client, ppm_env):
        resp = await client.get(
            "/api/v1/reports/ppm/dashboard",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_initiatives"] == 0
        assert data["by_subtype"] == {}
        assert data["by_status"] == {}
        assert data["total_budget"] == 0
        assert data["total_actual"] == 0
        assert data["health_schedule"] == {
            "onTrack": 0,
            "atRisk": 0,
            "offTrack": 0,
            "noReport": 0,
        }
        assert data["health_cost"] == {
            "onTrack": 0,
            "atRisk": 0,
            "offTrack": 0,
            "noReport": 0,
        }
        assert data["health_scope"] == {
            "onTrack": 0,
            "atRisk": 0,
            "offTrack": 0,
            "noReport": 0,
        }

    async def test_dashboard_with_initiatives(self, client, db, ppm_env):
        admin = ppm_env["admin"]
        await create_card(
            db,
            card_type="Initiative",
            name="Project Alpha",
            user_id=admin.id,
            subtype="Project",
            attributes={"initiativeStatus": "Active"},
        )
        await create_card(
            db,
            card_type="Initiative",
            name="Program Beta",
            user_id=admin.id,
            subtype="Program",
            attributes={"initiativeStatus": "Planned"},
        )
        resp = await client.get(
            "/api/v1/reports/ppm/dashboard",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_initiatives"] == 2
        assert data["by_subtype"]["Project"] == 1
        assert data["by_subtype"]["Program"] == 1
        assert data["by_status"]["Active"] == 1
        assert data["by_status"]["Planned"] == 1
        # No status reports → all go to noReport
        assert data["health_schedule"]["noReport"] == 2
        assert data["health_cost"]["noReport"] == 2
        assert data["health_scope"]["noReport"] == 2

    async def test_dashboard_excludes_archived(self, client, db, ppm_env):
        """Archived initiatives should not appear in the dashboard."""
        admin = ppm_env["admin"]
        await create_card(
            db,
            card_type="Initiative",
            name="Active Init",
            user_id=admin.id,
        )
        await create_card(
            db,
            card_type="Initiative",
            name="Archived Init",
            user_id=admin.id,
            status="ARCHIVED",
        )
        resp = await client.get(
            "/api/v1/reports/ppm/dashboard",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["total_initiatives"] == 1


# ---------------------------------------------------------------------------
# Gantt
# ---------------------------------------------------------------------------


class TestPpmGantt:
    async def test_empty_gantt(self, client, ppm_env):
        resp = await client.get(
            "/api/v1/reports/ppm/gantt",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_gantt_returns_initiatives(self, client, db, ppm_env):
        admin = ppm_env["admin"]
        await create_card(
            db,
            card_type="Initiative",
            name="Project Alpha",
            user_id=admin.id,
            subtype="Project",
            attributes={
                "initiativeStatus": "Active",
                "startDate": "2026-01-01",
                "endDate": "2026-12-31",
            },
        )
        resp = await client.get(
            "/api/v1/reports/ppm/gantt",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        item = data[0]
        assert item["name"] == "Project Alpha"
        assert item["subtype"] == "Project"
        assert item["status"] == "Active"
        assert item["start_date"] == "2026-01-01"
        assert item["end_date"] == "2026-12-31"
        assert item["group_id"] is None
        assert item["group_name"] is None

    async def test_gantt_with_group_by(self, client, db, ppm_env):
        """When group_by is specified, initiatives should include group info."""
        admin = ppm_env["admin"]
        await create_relation_type(
            db,
            key="relInitToOrg",
            label="Initiative to Org",
            source_type_key="Initiative",
            target_type_key="Organization",
        )
        org = await create_card(
            db,
            card_type="Organization",
            name="Engineering",
            user_id=admin.id,
        )
        init = await create_card(
            db,
            card_type="Initiative",
            name="Project Alpha",
            user_id=admin.id,
        )
        await create_relation(
            db,
            type_key="relInitToOrg",
            source_id=init.id,
            target_id=org.id,
        )

        resp = await client.get(
            "/api/v1/reports/ppm/gantt?group_by=Organization",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["group_id"] == str(org.id)
        assert data[0]["group_name"] == "Engineering"

    async def test_gantt_group_by_no_relation(self, client, db, ppm_env):
        """group_by with a type that has no relations returns null group."""
        admin = ppm_env["admin"]
        await create_card(
            db,
            card_type="Initiative",
            name="Solo Project",
            user_id=admin.id,
        )
        resp = await client.get(
            "/api/v1/reports/ppm/gantt?group_by=Organization",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["group_id"] is None
        assert data[0]["group_name"] is None


# ---------------------------------------------------------------------------
# Group Options
# ---------------------------------------------------------------------------


class TestPpmGroupOptions:
    async def test_no_relation_types(self, client, ppm_env):
        """Without relation types linking Initiative, returns empty list."""
        resp = await client.get(
            "/api/v1/reports/ppm/group-options",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_returns_related_types(self, client, db, ppm_env):
        """Should return types that Initiative has relation types to."""
        await create_relation_type(
            db,
            key="relInitToOrg",
            label="Initiative to Org",
            source_type_key="Initiative",
            target_type_key="Organization",
        )
        await create_relation_type(
            db,
            key="relInitToApp",
            label="Initiative to App",
            source_type_key="Initiative",
            target_type_key="Application",
        )
        resp = await client.get(
            "/api/v1/reports/ppm/group-options",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        type_keys = [o["type_key"] for o in data]
        assert "Organization" in type_keys
        assert "Application" in type_keys
        # Should not include Initiative itself
        assert "Initiative" not in type_keys

    async def test_returns_sorted_options(self, client, db, ppm_env):
        """Options should be sorted alphabetically by type_label."""
        await create_relation_type(
            db,
            key="relInitToOrg",
            label="Init to Org",
            source_type_key="Initiative",
            target_type_key="Organization",
        )
        await create_relation_type(
            db,
            key="relInitToApp",
            label="Init to App",
            source_type_key="Initiative",
            target_type_key="Application",
        )
        resp = await client.get(
            "/api/v1/reports/ppm/group-options",
            headers=auth_headers(ppm_env["admin"]),
        )
        data = resp.json()
        labels = [o["type_label"] for o in data]
        assert labels == sorted(labels)

    async def test_reverse_relation_included(self, client, db, ppm_env):
        """Relation where Initiative is the target should also appear."""
        await create_relation_type(
            db,
            key="relOrgToInit",
            label="Org to Initiative",
            source_type_key="Organization",
            target_type_key="Initiative",
        )
        resp = await client.get(
            "/api/v1/reports/ppm/group-options",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        type_keys = [o["type_key"] for o in data]
        assert "Organization" in type_keys

    async def test_hidden_relation_excluded(self, client, db, ppm_env):
        """Hidden relation types should not appear in group options."""
        await create_relation_type(
            db,
            key="relInitToOrgHidden",
            label="Hidden Rel",
            source_type_key="Initiative",
            target_type_key="Organization",
            is_hidden=True,
        )
        resp = await client.get(
            "/api/v1/reports/ppm/group-options",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []


# ---------------------------------------------------------------------------
# Permission checks
# ---------------------------------------------------------------------------


class TestPpmReportsPermission:
    async def test_viewer_can_access_dashboard(self, client, ppm_env):
        """Viewers have ppm.view=True so they should access the dashboard."""
        resp = await client.get(
            "/api/v1/reports/ppm/dashboard",
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 200

    async def test_viewer_can_access_gantt(self, client, ppm_env):
        resp = await client.get(
            "/api/v1/reports/ppm/gantt",
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 200

    async def test_viewer_can_access_group_options(self, client, ppm_env):
        resp = await client.get(
            "/api/v1/reports/ppm/group-options",
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 200

    async def test_unauthenticated_rejected(self, client, ppm_env):
        resp = await client.get("/api/v1/reports/ppm/dashboard")
        assert resp.status_code in (401, 403)

    async def test_no_ppm_permission_denied(self, client, db, ppm_env):
        """A role with ppm.view=False should be denied."""
        await create_role(
            db,
            key="no_ppm",
            label="No PPM",
            permissions={"ppm.view": False, "inventory.view": True},
        )
        user = await create_user(db, email="noppm@test.com", role="no_ppm")
        resp = await client.get(
            "/api/v1/reports/ppm/dashboard",
            headers=auth_headers(user),
        )
        assert resp.status_code == 403
