"""Integration tests for the /reports endpoints."""

from __future__ import annotations

import pytest

from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def reports_env(db):
    """Prerequisite data for report tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions={
            "reports.ea_dashboard": True,
            "inventory.view": True,
        },
    )
    await create_role(
        db,
        key="noreports",
        label="No Reports",
        permissions={"inventory.view": True},
    )
    await create_card_type(
        db,
        key="Application",
        label="Application",
        fields_schema=[
            {
                "section": "General",
                "fields": [
                    {
                        "key": "costTotalAnnual",
                        "label": "Annual Cost",
                        "type": "cost",
                        "weight": 1,
                    },
                ],
            }
        ],
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    noreports = await create_user(db, email="noreports@test.com", role="noreports")
    return {
        "admin": admin,
        "viewer": viewer,
        "noreports": noreports,
    }


class TestDashboard:
    async def test_dashboard_empty(self, client, db, reports_env):
        """Dashboard returns valid structure with no cards."""
        admin = reports_env["admin"]
        resp = await client.get(
            "/api/v1/reports/dashboard",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_cards"] == 0
        assert data["by_type"] == {}
        assert data["avg_data_quality"] == 0
        assert "approval_statuses" in data
        assert "data_quality_distribution" in data
        assert "lifecycle_distribution" in data
        assert "recent_events" in data

    async def test_dashboard_with_cards(self, client, db, reports_env):
        """Dashboard counts cards by type correctly."""
        admin = reports_env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="App A",
            user_id=admin.id,
            data_quality=80.0,
        )
        await create_card(
            db,
            card_type="Application",
            name="App B",
            user_id=admin.id,
            data_quality=40.0,
        )
        resp = await client.get(
            "/api/v1/reports/dashboard",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_cards"] == 2
        assert data["by_type"]["Application"] == 2
        assert data["avg_data_quality"] == 60.0

    async def test_dashboard_data_quality_distribution(self, client, db, reports_env):
        """Data quality distribution buckets are populated."""
        admin = reports_env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="Low DQ",
            user_id=admin.id,
            data_quality=10.0,
        )
        await create_card(
            db,
            card_type="Application",
            name="High DQ",
            user_id=admin.id,
            data_quality=90.0,
        )
        resp = await client.get(
            "/api/v1/reports/dashboard",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        dist = resp.json()["data_quality_distribution"]
        assert dist["0-25"] >= 1
        assert dist["75-100"] >= 1

    async def test_dashboard_viewer_can_access(self, client, db, reports_env):
        """Users with reports.ea_dashboard permission can view."""
        viewer = reports_env["viewer"]
        resp = await client.get(
            "/api/v1/reports/dashboard",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 200

    async def test_dashboard_forbidden_without_permission(self, client, db, reports_env):
        """Users without reports.ea_dashboard get 403."""
        noreports = reports_env["noreports"]
        resp = await client.get(
            "/api/v1/reports/dashboard",
            headers=auth_headers(noreports),
        )
        assert resp.status_code == 403

    async def test_dashboard_unauthenticated(self, client, db, reports_env):
        """No auth token returns 401."""
        resp = await client.get("/api/v1/reports/dashboard")
        assert resp.status_code == 401
