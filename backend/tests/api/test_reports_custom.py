"""Integration tests for POST /reports/custom (freeform Custom Report endpoint)."""

from __future__ import annotations

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)

SCHEMA = [
    {
        "section": "g",
        "fields": [
            {"key": "costTotalAnnual", "type": "cost", "weight": 1},
            {
                "key": "businessCriticality",
                "type": "single_select",
                "weight": 0,
                "options": [{"key": "high", "label": "High"}, {"key": "low", "label": "Low"}],
            },
        ],
    }
]


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
    await create_role(db, key="noreports", permissions={"inventory.view": True})
    await create_card_type(db, key="Application", fields_schema=SCHEMA)
    admin = await create_user(db, email="a@test.com", role="admin")
    member = await create_user(db, email="m@test.com", role="member")
    viewer = await create_user(db, email="v@test.com", role="viewer")
    noreports = await create_user(db, email="n@test.com", role="noreports")
    await create_card(
        db,
        card_type="Application",
        name="A",
        attributes={"businessCriticality": "high", "costTotalAnnual": 100},
    )
    await create_card(
        db,
        card_type="Application",
        name="B",
        attributes={"businessCriticality": "low", "costTotalAnnual": 50},
    )
    return {"admin": admin, "member": member, "viewer": viewer, "noreports": noreports}


def _spec(**over):
    base = {
        "title": "Apps by criticality",
        "source": {"card_type": "Application"},
        "dimensions": [{"kind": "attribute", "key": "businessCriticality"}],
        "measures": [{"agg": "count"}],
        "visualization": {"kind": "pie"},
    }
    base.update(over)
    return base


class TestCustomReportEndpoint:
    async def test_member_runs_report(self, client, db, env):
        r = await client.post(
            "/api/v1/reports/custom", json=_spec(), headers=auth_headers(env["member"])
        )
        assert r.status_code == 200
        body = r.json()
        assert {row["d0"]: row["m0"] for row in body["rows"]} == {"High": 1, "Low": 1}
        assert body["meta"]["card_type"] == "Application"

    async def test_no_reports_permission_blocked(self, client, db, env):
        r = await client.post(
            "/api/v1/reports/custom", json=_spec(), headers=auth_headers(env["noreports"])
        )
        assert r.status_code == 403

    async def test_invalid_spec_unprocessable(self, client, db, env):
        # measures is required (min_length=1) -> Pydantic 422 before the engine.
        bad = _spec()
        bad["measures"] = []
        r = await client.post(
            "/api/v1/reports/custom", json=bad, headers=auth_headers(env["admin"])
        )
        assert r.status_code == 422

    async def test_unknown_field_rejected(self, client, db, env):
        r = await client.post(
            "/api/v1/reports/custom",
            json=_spec(dimensions=[{"kind": "attribute", "key": "ghost"}]),
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 400

    async def test_cost_measure_gated(self, client, db, env):
        spec = _spec(
            dimensions=[],
            measures=[{"agg": "sum", "field": "costTotalAnnual"}],
            visualization={"kind": "kpi"},
        )
        blocked = await client.post(
            "/api/v1/reports/custom", json=spec, headers=auth_headers(env["viewer"])
        )
        assert blocked.status_code == 403
        ok = await client.post(
            "/api/v1/reports/custom", json=spec, headers=auth_headers(env["member"])
        )
        assert ok.status_code == 200
        assert ok.json()["rows"][0]["m0"] == 150


class TestSavedReportCustomType:
    async def test_saved_report_accepts_custom_type(self, client, db, env):
        r = await client.post(
            "/api/v1/saved-reports",
            json={
                "name": "My custom report",
                "report_type": "custom",
                "config": _spec(),
                "visibility": "private",
            },
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code in (200, 201)
        assert r.json()["report_type"] == "custom"
