"""Extension-gated Transition Planning authoring.

Transition Planning ships as inert core plumbing: reading, rendering, and
deleting plans always work, but authoring (create, edit, commit) is unlocked
only while an installed, licensed extension grants the matching capability.
This is the monetisation boundary — guard it. A lapse must degrade to
read-only, never trap or destroy data.
"""

from __future__ import annotations

import pytest

from app.api.v1.transition_plans import CAP_TRANSITION_PLANNING
from app.models.transition_plan import TransitionPlan
from app.services.extensions.registry import extension_registry
from tests.conftest import auth_headers, create_role, create_user


@pytest.fixture
async def admin(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    return await create_user(db, email="admin@test.com", role="admin")


@pytest.fixture(autouse=True)
def _clear_registry():
    extension_registry.clear()
    yield
    extension_registry.clear()


@pytest.fixture
def granted(monkeypatch):
    monkeypatch.setattr(
        extension_registry,
        "granted_capabilities",
        lambda now=None: {CAP_TRANSITION_PLANNING},
    )


async def _seed_plan(db, admin) -> TransitionPlan:
    """Insert a plan directly — simulates data authored while licensed."""
    p = TransitionPlan(
        title="Stored plan",
        scope={},
        plan_data={"changes": [{"op": "remove_card", "cardId": "x"}]},
        created_by=admin.id,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


class TestUngatedBlocksAuthoring:
    async def test_create_requires_grant(self, client, db, admin):
        resp = await client.post(
            "/api/v1/transition-plans",
            headers=auth_headers(admin),
            json={"title": "New plan"},
        )
        assert resp.status_code == 403
        assert "extension" in resp.json()["detail"].lower()

    async def test_update_requires_grant(self, client, db, admin):
        p = await _seed_plan(db, admin)
        resp = await client.patch(
            f"/api/v1/transition-plans/{p.id}",
            headers=auth_headers(admin),
            json={"title": "Renamed"},
        )
        assert resp.status_code == 403

    async def test_commit_requires_grant(self, client, db, admin):
        p = await _seed_plan(db, admin)
        resp = await client.post(
            f"/api/v1/transition-plans/{p.id}/commit",
            headers=auth_headers(admin),
            json={
                "initiative_name": "Init",
                "start_date": "2026-01-01",
                "end_date": "2026-12-31",
            },
        )
        assert resp.status_code == 403


class TestUngatedKeepsReadAndDelete:
    async def test_list_and_detail_stay_open(self, client, db, admin):
        p = await _seed_plan(db, admin)
        resp = await client.get("/api/v1/transition-plans", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert any(row["id"] == str(p.id) for row in resp.json())

        resp = await client.get(f"/api/v1/transition-plans/{p.id}", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert resp.json()["title"] == "Stored plan"

    async def test_delete_stays_open(self, client, db, admin):
        p = await _seed_plan(db, admin)
        resp = await client.delete(f"/api/v1/transition-plans/{p.id}", headers=auth_headers(admin))
        assert resp.status_code == 204


class TestGrantedUnlocksAuthoring:
    async def test_create_and_update_with_grant(self, client, db, admin, granted):
        resp = await client.post(
            "/api/v1/transition-plans",
            headers=auth_headers(admin),
            json={"title": "New plan"},
        )
        assert resp.status_code == 201
        plan_id = resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/transition-plans/{plan_id}",
            headers=auth_headers(admin),
            json={"title": "Renamed"},
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Renamed"
