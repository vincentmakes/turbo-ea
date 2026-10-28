"""Integration tests for the /diagrams endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.card_type import CardType
from app.models.diagram import Diagram, diagram_cards
from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def diagrams_env(db):
    """Prerequisite data shared by all diagram tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="member",
        label="Member",
        permissions=MEMBER_PERMISSIONS,
    )
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions=VIEWER_PERMISSIONS,
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "member": member, "viewer": viewer}


# -------------------------------------------------------------------
# POST /diagrams  (create)
# -------------------------------------------------------------------


class TestCreateDiagram:
    async def test_admin_can_create(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        resp = await client.post(
            "/api/v1/diagrams",
            json={
                "name": "Architecture Overview",
                "data": {"xml": "<mxGraphModel/>"},
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Architecture Overview"

    async def test_member_can_create(self, client, db, diagrams_env):
        member = diagrams_env["member"]
        resp = await client.post(
            "/api/v1/diagrams",
            json={
                "name": "Member Diagram",
                "data": {},
            },
            headers=auth_headers(member),
        )
        assert resp.status_code == 201

    async def test_viewer_cannot_create(self, client, db, diagrams_env):
        viewer = diagrams_env["viewer"]
        resp = await client.post(
            "/api/v1/diagrams",
            json={
                "name": "Blocked",
                "data": {},
            },
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# GET /diagrams  (list)
# -------------------------------------------------------------------


class TestListDiagrams:
    async def test_list_returns_diagrams(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        await client.post(
            "/api/v1/diagrams",
            json={"name": "Diagram A", "data": {}},
            headers=auth_headers(admin),
        )
        await client.post(
            "/api/v1/diagrams",
            json={"name": "Diagram B", "data": {}},
            headers=auth_headers(admin),
        )

        resp = await client.get(
            "/api/v1/diagrams",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        names = [d["name"] for d in resp.json()]
        assert "Diagram A" in names
        assert "Diagram B" in names

    async def test_viewer_can_list(self, client, db, diagrams_env):
        viewer = diagrams_env["viewer"]
        resp = await client.get(
            "/api/v1/diagrams",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 200


# -------------------------------------------------------------------
# GET /diagrams/{id}
# -------------------------------------------------------------------


class TestGetDiagram:
    async def test_get_existing_diagram(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        create_resp = await client.post(
            "/api/v1/diagrams",
            json={
                "name": "Lookup",
                "data": {"xml": "<mxGraphModel/>"},
            },
            headers=auth_headers(admin),
        )
        diagram_id = create_resp.json()["id"]

        resp = await client.get(
            f"/api/v1/diagrams/{diagram_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Lookup"
        assert data["data"]["xml"] == "<mxGraphModel/>"

    async def test_get_nonexistent_returns_404(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        fake_id = str(uuid.uuid4())
        resp = await client.get(
            f"/api/v1/diagrams/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# -------------------------------------------------------------------
# PATCH /diagrams/{id}  (update)
# -------------------------------------------------------------------


class TestUpdateDiagram:
    async def test_update_name(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        create_resp = await client.post(
            "/api/v1/diagrams",
            json={"name": "Old Name", "data": {}},
            headers=auth_headers(admin),
        )
        diagram_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/diagrams/{diagram_id}",
            json={"name": "New Name"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "New Name"

    async def test_update_data(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        create_resp = await client.post(
            "/api/v1/diagrams",
            json={"name": "Data Update", "data": {}},
            headers=auth_headers(admin),
        )
        diagram_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/diagrams/{diagram_id}",
            json={"data": {"xml": "<mxGraphModel><root/></mxGraphModel>"}},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

    async def test_update_nonexistent_returns_404(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        fake_id = str(uuid.uuid4())
        resp = await client.patch(
            f"/api/v1/diagrams/{fake_id}",
            json={"name": "Ghost"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_viewer_cannot_update(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        viewer = diagrams_env["viewer"]
        create_resp = await client.post(
            "/api/v1/diagrams",
            json={"name": "Protected", "data": {}},
            headers=auth_headers(admin),
        )
        diagram_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/diagrams/{diagram_id}",
            json={"name": "Hacked"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# DELETE /diagrams/{id}
# -------------------------------------------------------------------


class TestDeleteDiagram:
    async def test_admin_can_delete(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        create_resp = await client.post(
            "/api/v1/diagrams",
            json={"name": "Delete Me", "data": {}},
            headers=auth_headers(admin),
        )
        diagram_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/diagrams/{diagram_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

        # Verify it's gone
        get_resp = await client.get(
            f"/api/v1/diagrams/{diagram_id}",
            headers=auth_headers(admin),
        )
        assert get_resp.status_code == 404

    async def test_viewer_cannot_delete(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        viewer = diagrams_env["viewer"]
        create_resp = await client.post(
            "/api/v1/diagrams",
            json={"name": "Protected", "data": {}},
            headers=auth_headers(admin),
        )
        diagram_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/diagrams/{diagram_id}",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_delete_nonexistent_returns_404(self, client, db, diagrams_env):
        admin = diagrams_env["admin"]
        fake_id = str(uuid.uuid4())
        resp = await client.delete(
            f"/api/v1/diagrams/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# -------------------------------------------------------------------
# dry_run, diagram events and rollback (the MCP create/update preview)
# -------------------------------------------------------------------

DIAGRAMS = "/api/v1/diagrams"


async def _diagram_count(db) -> int:
    return (await db.execute(select(func.count()).select_from(Diagram))).scalar_one()


async def _diagram_card_ids(db, diagram_id: str) -> list[str]:
    rows = await db.execute(
        select(diagram_cards.c.card_id).where(diagram_cards.c.diagram_id == uuid.UUID(diagram_id))
    )
    return sorted(str(r[0]) for r in rows.all())


async def _diagram_events(db) -> list[Event]:
    rows = await db.execute(select(Event).where(Event.event_type.startswith("diagram.")))
    return list(rows.scalars().all())


def _xml(*card_ids: str) -> str:
    cells = "".join(f'<object cardId="{c}"/>' for c in card_ids)
    return f"<mxGraphModel>{cells}</mxGraphModel>"


@pytest.fixture
async def cards_env(db, diagrams_env):
    await create_card_type(db, key="Application", label="Application")
    app_a = await create_card(db, name="App A")
    app_b = await create_card(db, name="App B")
    return {**diagrams_env, "a": str(app_a.id), "b": str(app_b.id)}


async def _hide_applications_from_members(db) -> None:
    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    ct.role_permissions = {"member": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()


class TestDiagramDryRun:
    async def test_create_dry_run_returns_the_verified_preview_and_persists_nothing(
        self, client, db, cards_env
    ):
        a = cards_env["a"]
        xml = _xml(a)
        before = await _diagram_count(db)
        resp = await client.post(
            DIAGRAMS,
            json={"name": "Preview", "data": {"xml": xml}, "card_ids": [a], "dry_run": True},
            headers=auth_headers(cards_env["admin"]),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json() == {
            "dry_run": True,
            "id": None,
            "name": "Preview",
            "card_ids": [a],
            "card_refs": [a],
            "xml_chars": len(xml),
        }
        assert await _diagram_count(db) == before
        assert await _diagram_events(db) == []

    async def test_update_dry_run_returns_the_diff_and_changes_nothing(self, client, db, cards_env):
        admin, a, b = cards_env["admin"], cards_env["a"], cards_env["b"]
        created = await client.post(
            DIAGRAMS,
            json={"name": "Old", "description": "d", "data": {"xml": "<x/>"}, "card_ids": [a]},
            headers=auth_headers(admin),
        )
        did = created.json()["id"]
        events_before = len(await _diagram_events(db))

        new_xml = _xml(b)
        resp = await client.patch(
            f"{DIAGRAMS}/{did}",
            json={"name": "New", "data": {"xml": new_xml}, "card_ids": [b], "dry_run": True},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {
            "dry_run": True,
            "id": did,
            "name": "New",
            "card_ids": [b],
            "card_refs": [b],
            "xml_chars": len(new_xml),
            "xml_changed": True,
            "changes": {"name": {"old": "Old", "new": "New"}},
            "added_card_ids": [b],
            "removed_card_ids": [a],
        }

        got = (await client.get(f"{DIAGRAMS}/{did}", headers=auth_headers(admin))).json()
        assert got["name"] == "Old"
        assert got["card_ids"] == [a]
        assert got["data"] == {"xml": "<x/>"}
        assert len(await _diagram_events(db)) == events_before

    async def test_create_dry_run_still_404s_on_a_hidden_card(self, client, db, cards_env):
        await _hide_applications_from_members(db)
        before = await _diagram_count(db)
        resp = await client.post(
            DIAGRAMS,
            json={"name": "Peek", "card_ids": [cards_env["a"]], "dry_run": True},
            headers=auth_headers(cards_env["member"]),
        )
        assert resp.status_code == 404
        assert await _diagram_count(db) == before

    async def test_update_dry_run_still_404s_on_a_hidden_card(self, client, db, cards_env):
        created = await client.post(
            DIAGRAMS, json={"name": "Mine"}, headers=auth_headers(cards_env["member"])
        )
        did = created.json()["id"]
        await _hide_applications_from_members(db)
        resp = await client.patch(
            f"{DIAGRAMS}/{did}",
            json={"name": "Renamed", "card_ids": [cards_env["a"]], "dry_run": True},
            headers=auth_headers(cards_env["member"]),
        )
        assert resp.status_code == 404
        # Validated before anything was touched: no rename, no link, no event.
        row = (await db.execute(select(Diagram).where(Diagram.id == uuid.UUID(did)))).scalar_one()
        assert row.name == "Mine"
        assert await _diagram_card_ids(db, did) == []
        assert [e.event_type for e in await _diagram_events(db)] == ["diagram.created"]

    async def test_viewer_dry_run_is_still_403(self, client, db, cards_env):
        resp = await client.post(
            DIAGRAMS,
            json={"name": "Nope", "dry_run": True},
            headers=auth_headers(cards_env["viewer"]),
        )
        assert resp.status_code == 403


class TestDiagramEvents:
    async def test_an_mcp_batch_records_create_update_and_delete(self, client, db, cards_env):
        admin, a, b = cards_env["admin"], cards_env["a"], cards_env["b"]
        mcp = {**auth_headers(admin), "X-Turbo-EA-Origin": "mcp"}
        opened = await client.post(
            "/api/v1/mutation-batches?row_count=1",
            json={"tool_name": "create_diagram", "dry_run": False},
            headers=mcp,
        )
        batch_id = opened.json()["id"]
        in_batch = {**mcp, "X-Turbo-EA-Batch": batch_id}

        xml = _xml(a)
        created = await client.post(
            DIAGRAMS,
            json={"name": "Landscape", "data": {"xml": xml}, "card_ids": [a]},
            headers=in_batch,
        )
        assert created.status_code == 201, created.text
        did = created.json()["id"]
        new_xml = _xml(a, b)
        updated = await client.patch(
            f"{DIAGRAMS}/{did}",
            json={"description": "v2", "data": {"xml": new_xml}, "card_ids": [a, b]},
            headers=in_batch,
        )
        assert updated.status_code == 200, updated.text
        deleted = await client.delete(f"{DIAGRAMS}/{did}", headers=in_batch)
        assert deleted.status_code == 204

        history = await client.get(
            f"/api/v1/mutation-batches/{batch_id}/events", headers=auth_headers(admin)
        )
        assert history.status_code == 200, history.text
        by_type = {e["event_type"]: e for e in history.json()["events"]}
        assert set(by_type) == {"diagram.created", "diagram.updated", "diagram.deleted"}
        assert by_type["diagram.created"]["data"] == {
            "id": did,
            "name": "Landscape",
            "card_ids": [a],
            "origin": "mcp",
        }
        assert by_type["diagram.updated"]["data"] == {
            "id": did,
            "name": "Landscape",
            "changes": {"description": {"old": None, "new": "v2"}},
            "added_card_ids": [b],
            "removed_card_ids": [],
            "xml_changed": True,
            "xml_chars": {"old": len(xml), "new": len(new_xml)},
            "origin": "mcp",
        }
        assert by_type["diagram.deleted"]["data"] == {
            "id": did,
            "name": "Landscape",
            "origin": "mcp",
        }
        for e in by_type.values():
            assert e["card_id"] is None
            assert e["user_id"] == str(admin.id)
            assert "<mxGraphModel" not in str(e["data"])

    async def test_a_patch_that_changes_nothing_writes_no_event(self, client, db, cards_env):
        admin, a = cards_env["admin"], cards_env["a"]
        created = await client.post(
            DIAGRAMS,
            json={"name": "Same", "data": {"xml": _xml(a)}, "card_ids": [a]},
            headers=auth_headers(admin),
        )
        did = created.json()["id"]
        resp = await client.patch(
            f"{DIAGRAMS}/{did}",
            json={"name": "Same", "data": {"xml": _xml(a)}, "card_ids": [a]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        assert [e.event_type for e in await _diagram_events(db)] == ["diagram.created"]

    async def test_a_web_create_lands_in_an_auto_batch(self, client, db, cards_env):
        resp = await client.post(
            DIAGRAMS,
            json={"name": "From the UI"},
            headers={**auth_headers(cards_env["admin"]), "X-Turbo-EA-Origin": "web"},
        )
        assert resp.status_code == 201
        (event,) = await _diagram_events(db)
        assert event.event_type == "diagram.created"
        assert event.batch_id is not None
        batch = await db.get(MutationBatch, event.batch_id)
        assert batch.origin == "web"
        assert batch.dry_run is False

    async def test_rolling_back_the_create_batch_deletes_the_diagram(self, client, db, cards_env):
        admin = cards_env["admin"]
        mcp = {**auth_headers(admin), "X-Turbo-EA-Origin": "mcp"}
        opened = await client.post(
            "/api/v1/mutation-batches?row_count=1",
            json={"tool_name": "create_diagram", "dry_run": False},
            headers=mcp,
        )
        batch_id = opened.json()["id"]
        created = await client.post(
            DIAGRAMS,
            json={"name": "Agent made this"},
            headers={**mcp, "X-Turbo-EA-Batch": batch_id},
        )
        did = created.json()["id"]
        await client.post(
            f"/api/v1/mutation-batches/{batch_id}/commit", json={"summary": {}}, headers=mcp
        )

        resp = await client.post(
            f"/api/v1/mutation-batches/{batch_id}/rollback",
            json={"dry_run": False},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        (result,) = [r for r in resp.json()["results"] if r["op"] == "delete_diagram"]
        assert result["diagram_id"] == did
        assert result["status"] == "ok"
        gone = await client.get(f"{DIAGRAMS}/{did}", headers=auth_headers(admin))
        assert gone.status_code == 404
