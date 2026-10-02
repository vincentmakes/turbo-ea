"""``/servicenow`` — the connection test, table and field discovery, the
mapping editor, the pull / push syncs, run listings, staged records and
the apply step, against a fake Table API (``tests/seams.py``).

Connection CRUD and permissions are in ``test_servicenow.py``.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

import app.api.v1.servicenow as snow_api
import app.services.servicenow_service as snow
from app.core.permissions import VIEWER_PERMISSIONS
from app.models.card import Card
from app.models.servicenow import (
    SnowConnection,
    SnowFieldMapping,
    SnowIdentityMap,
    SnowMapping,
    SnowStagedRecord,
    SnowSyncRun,
)
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user
from tests.seams import patch_httpx_client, snow_table_handler

BASE = "/api/v1/servicenow"
INSTANCE = "https://acme.service-now.com"
S1, S2, S9 = ("1" * 32, "2" * 32, "9" * 32)


def _rec(sys_id: str, name: str) -> dict:
    return {
        "sys_id": sys_id,
        "name": name,
        "short_description": f"{name} desc",
        "busines_criticality": "1 - most critical",
    }


@pytest.fixture
async def env(db, client):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    await create_card_type(
        db,
        key="Application",
        label="Application",
        fields_schema=[
            {
                "section": "Details",
                "fields": [
                    {"key": "criticality", "type": "single_select"},
                    {"key": "tags", "type": "multiple_select"},
                    {"key": "owner", "type": "text"},
                ],
            }
        ],
    )
    headers = auth_headers(admin)
    conn = await client.post(
        f"{BASE}/connections",
        json={
            "name": "SNOW",
            "instance_url": INSTANCE,
            "auth_type": "basic",
            "username": "u",
            "password": "p",
        },
        headers=headers,
    )
    assert conn.status_code == 200, conn.text
    conn_id = conn.json()["id"]
    mapping = await client.post(
        f"{BASE}/mappings",
        json={
            "connection_id": conn_id,
            "card_type_key": "Application",
            "snow_table": "cmdb_ci_appl",
            "field_mappings": [
                {"turbo_field": "name", "snow_field": "name", "is_identity": True},
                {"turbo_field": "description", "snow_field": "short_description"},
                {
                    "turbo_field": "attributes.criticality",
                    "snow_field": "busines_criticality",
                    "transform_type": "value_map",
                    "transform_config": {"mapping": {"1 - most critical": "critical"}},
                },
                {
                    "turbo_field": "attributes.owner",
                    "snow_field": "owned_by",
                    "direction": "turbo_leads",
                },
            ],
        },
        headers=headers,
    )
    assert mapping.status_code == 200, mapping.text
    return {
        "admin": admin,
        "viewer": viewer,
        "headers": headers,
        "viewer_headers": auth_headers(viewer),
        "conn_id": conn_id,
        "mapping_id": mapping.json()["id"],
    }


async def _conn(db, conn_id) -> SnowConnection:
    return (
        await db.execute(select(SnowConnection).where(SnowConnection.id == uuid.UUID(conn_id)))
    ).scalar_one()


async def _mapping(db, mapping_id) -> SnowMapping:
    return (
        await db.execute(select(SnowMapping).where(SnowMapping.id == uuid.UUID(mapping_id)))
    ).scalar_one()


def _swappable(monkeypatch, handler):
    """Patch the service's httpx client once; tests swap the handler."""
    holder = {"handler": handler}
    seen = patch_httpx_client(monkeypatch, snow, lambda request: holder["handler"](request))
    return holder, seen


def _no_client(monkeypatch):
    monkeypatch.setattr(snow_api, "_try_build_client", lambda conn, label: None)


class _ExplodingEngine:
    def __init__(self, db, client):
        pass

    async def pull_sync(self, *args, **kwargs):
        raise RuntimeError("pull exploded")

    async def push_sync(self, *args, **kwargs):
        raise RuntimeError("push exploded")

    async def _apply_staged(self, run):
        raise RuntimeError("apply exploded")


# ---------------------------------------------------------------------------
# Connection test, tables, fields
# ---------------------------------------------------------------------------


class TestConnectionTest:
    async def test_success_and_failure_are_recorded_on_the_connection(
        self, client, db, env, monkeypatch
    ):
        holder, _ = _swappable(monkeypatch, snow_table_handler(tables=[{"name": "x"}]))
        url = f"{BASE}/connections/{env['conn_id']}/test"
        resp = await client.post(url, headers=env["headers"])
        assert resp.status_code == 200
        assert resp.json() == {"success": True, "message": "Connection successful"}
        conn = await _conn(db, env["conn_id"])
        assert conn.test_status == "success" and conn.last_tested_at is not None

        holder["handler"] = snow_table_handler(fail_status=401)
        resp = await client.post(url, headers=env["headers"])
        assert resp.json() == {"success": False, "message": "Connection failed"}
        assert conn.test_status == "failed"

    async def test_an_unbuildable_client_is_a_recorded_failure(self, client, db, env, monkeypatch):
        _no_client(monkeypatch)
        resp = await client.post(
            f"{BASE}/connections/{env['conn_id']}/test", headers=env["headers"]
        )
        assert resp.json() == {"success": False, "message": "Connection failed"}
        assert (await _conn(db, env["conn_id"])).test_status == "failed"

    async def test_a_client_exception_reads_as_failure(self, client, db, env, monkeypatch):
        async def boom(self):
            raise RuntimeError("x")

        monkeypatch.setattr(snow.ServiceNowClient, "test_connection", boom)
        resp = await client.post(
            f"{BASE}/connections/{env['conn_id']}/test", headers=env["headers"]
        )
        assert resp.json()["success"] is False

    async def test_unknown_connection_and_viewer(self, client, db, env):
        resp = await client.post(f"{BASE}/connections/{uuid.uuid4()}/test", headers=env["headers"])
        assert resp.status_code == 404
        resp = await client.post(
            f"{BASE}/connections/{env['conn_id']}/test", headers=env["viewer_headers"]
        )
        assert resp.status_code == 403


class TestTablesAndFields:
    async def test_lists_tables_and_fields(self, client, db, env, monkeypatch):
        _, seen = _swappable(
            monkeypatch,
            snow_table_handler(
                tables=[{"name": "cmdb_ci_appl", "label": "Application"}],
                dictionary=[{"element": "name", "column_label": "Name", "internal_type": "string"}],
            ),
        )
        resp = await client.get(
            f"{BASE}/connections/{env['conn_id']}/tables?search=appl", headers=env["headers"]
        )
        assert resp.status_code == 200
        assert resp.json() == [{"name": "cmdb_ci_appl", "label": "Application"}]
        assert "nameLIKEappl" in seen[-1].url.params["sysparm_query"]

        resp = await client.get(
            f"{BASE}/connections/{env['conn_id']}/tables/cmdb_ci_appl/fields",
            headers=env["headers"],
        )
        assert resp.status_code == 200
        assert resp.json() == [
            {"element": "name", "column_label": "Name", "internal_type": "string"}
        ]

    async def test_rejections(self, client, db, env):
        cid = env["conn_id"]
        resp = await client.get(
            f"{BASE}/connections/{cid}/tables/bad%20table/fields", headers=env["headers"]
        )
        assert resp.status_code == 400 and resp.json()["detail"] == "Invalid table name"
        for url in (
            f"/connections/{uuid.uuid4()}/tables",
            f"/connections/{uuid.uuid4()}/tables/t/fields",
        ):
            assert (await client.get(BASE + url, headers=env["headers"])).status_code == 404
        for url in (f"/connections/{cid}/tables", f"/connections/{cid}/tables/t/fields"):
            assert (await client.get(BASE + url, headers=env["viewer_headers"])).status_code == 403

    async def test_servicenow_failures_are_502(self, client, db, env, monkeypatch):
        _swappable(monkeypatch, snow_table_handler(fail_status=500))
        cid = env["conn_id"]
        resp = await client.get(f"{BASE}/connections/{cid}/tables", headers=env["headers"])
        assert resp.status_code == 502
        assert resp.json()["detail"] == "Failed to fetch tables from ServiceNow"
        resp = await client.get(f"{BASE}/connections/{cid}/tables/t/fields", headers=env["headers"])
        assert resp.status_code == 502
        assert resp.json()["detail"] == "Failed to fetch table fields from ServiceNow"

    async def test_an_unbuildable_client_is_502(self, client, db, env, monkeypatch):
        _no_client(monkeypatch)
        cid = env["conn_id"]
        for url in (f"/connections/{cid}/tables", f"/connections/{cid}/tables/t/fields"):
            resp = await client.get(BASE + url, headers=env["headers"])
            assert resp.status_code == 502
            assert resp.json()["detail"] == "Failed to connect to ServiceNow"


# ---------------------------------------------------------------------------
# Mappings
# ---------------------------------------------------------------------------


class TestMappings:
    async def test_create_rejections(self, client, db, env):
        body = {
            "connection_id": str(uuid.uuid4()),
            "card_type_key": "Application",
            "snow_table": "t",
        }
        resp = await client.post(f"{BASE}/mappings", json=body, headers=env["headers"])
        assert resp.status_code == 404
        body = {
            "connection_id": env["conn_id"],
            "card_type_key": "Application",
            "snow_table": "bad table",
        }
        resp = await client.post(f"{BASE}/mappings", json=body, headers=env["headers"])
        assert resp.status_code == 400 and resp.json()["detail"] == "Invalid ServiceNow table name"
        resp = await client.post(f"{BASE}/mappings", json=body, headers=env["viewer_headers"])
        assert resp.status_code == 403

    async def test_get_list_and_delete(self, client, db, env):
        mid = env["mapping_id"]
        resp = await client.get(f"{BASE}/mappings/{mid}", headers=env["headers"])
        assert resp.status_code == 200
        assert [fm["turbo_field"] for fm in resp.json()["field_mappings"]] == [
            "name",
            "description",
            "attributes.criticality",
            "attributes.owner",
        ]
        resp = await client.get(
            f"{BASE}/mappings?connection_id={env['conn_id']}", headers=env["headers"]
        )
        assert [m["id"] for m in resp.json()] == [mid]
        resp = await client.get(
            f"{BASE}/mappings?connection_id={uuid.uuid4()}", headers=env["headers"]
        )
        assert resp.json() == []
        assert (
            await client.get(f"{BASE}/mappings/{uuid.uuid4()}", headers=env["headers"])
        ).status_code == 404
        assert (
            await client.get(f"{BASE}/mappings/{mid}", headers=env["viewer_headers"])
        ).status_code == 403

        assert (
            await client.delete(f"{BASE}/mappings/{mid}", headers=env["viewer_headers"])
        ).status_code == 403
        resp = await client.delete(f"{BASE}/mappings/{mid}", headers=env["headers"])
        assert resp.status_code == 200 and resp.json() == {"ok": True}
        assert (
            await client.get(f"{BASE}/mappings/{mid}", headers=env["headers"])
        ).status_code == 404
        assert (
            await client.delete(f"{BASE}/mappings/{mid}", headers=env["headers"])
        ).status_code == 404
        rows = (await db.execute(select(SnowFieldMapping))).scalars().all()
        assert rows == []  # the field rows went with the mapping

    async def test_patch_replaces_the_field_list_and_returns_it(self, client, db, env):
        mid = env["mapping_id"]
        resp = await client.patch(
            f"{BASE}/mappings/{mid}",
            json={
                "card_type_key": "Application",
                "snow_table": "cmdb_ci_service",
                "sync_direction": "bidirectional",
                "sync_mode": "strict",
                "max_deletion_ratio": 0.2,
                "filter_query": "active=true",
                "skip_staging": True,
                "is_active": False,
                "field_mappings": [
                    {"turbo_field": "name", "snow_field": "u_name", "is_identity": True},
                    {"turbo_field": "attributes.tags", "snow_field": "", "default_value": "a, b"},
                ],
            },
            headers=env["headers"],
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["snow_table"] == "cmdb_ci_service" and body["sync_mode"] == "strict"
        assert body["sync_direction"] == "bidirectional" and body["max_deletion_ratio"] == 0.2
        assert body["filter_query"] == "active=true" and body["skip_staging"] is True
        assert body["is_active"] is False
        # The response carries the rows just saved — not the ones just deleted.
        assert [(fm["turbo_field"], fm["snow_field"]) for fm in body["field_mappings"]] == [
            ("name", "u_name"),
            ("attributes.tags", ""),
        ]
        assert body["field_mappings"][1]["default_value"] == ["a", "b"]
        again = (await client.get(f"{BASE}/mappings/{mid}", headers=env["headers"])).json()
        assert again["field_mappings"] == body["field_mappings"]
        rows = (await db.execute(select(SnowFieldMapping))).scalars().all()
        assert {r.snow_field for r in rows} == {"u_name", ""}

    async def test_patch_without_a_field_list_keeps_it(self, client, db, env):
        mid = env["mapping_id"]
        resp = await client.patch(
            f"{BASE}/mappings/{mid}", json={"sync_mode": "additive"}, headers=env["headers"]
        )
        assert resp.status_code == 200 and resp.json()["sync_mode"] == "additive"
        assert len(resp.json()["field_mappings"]) == 4

    async def test_patch_rejections(self, client, db, env):
        mid = env["mapping_id"]
        resp = await client.patch(
            f"{BASE}/mappings/{mid}", json={"snow_table": "bad table"}, headers=env["headers"]
        )
        assert resp.status_code == 400
        resp = await client.patch(
            f"{BASE}/mappings/{uuid.uuid4()}", json={}, headers=env["headers"]
        )
        assert resp.status_code == 404
        resp = await client.patch(f"{BASE}/mappings/{mid}", json={}, headers=env["viewer_headers"])
        assert resp.status_code == 403

    async def test_preview_shows_how_records_would_land(self, client, db, env, monkeypatch):
        record = _rec(S1, "Billing")
        holder, seen = _swappable(monkeypatch, snow_table_handler(records=[record], total=42))
        url = f"{BASE}/mappings/{env['mapping_id']}/preview"
        resp = await client.post(url, headers=env["headers"])
        assert resp.status_code == 200, resp.text
        assert resp.json() == {
            "total_records": 42,
            "sample_count": 1,
            "previews": [
                {
                    "snow_record": record,
                    "transformed": {
                        "name": "Billing",
                        "description": "Billing desc",
                        "attributes": {"criticality": "critical"},
                    },
                }
            ],
        }
        assert seen[-1].url.params["sysparm_limit"] == "5"

        holder["handler"] = snow_table_handler(fail_status=500)
        resp = await client.post(url, headers=env["headers"])
        assert resp.status_code == 502
        assert resp.json()["detail"] == "Failed to fetch records from ServiceNow"
        assert (await client.post(url, headers=env["viewer_headers"])).status_code == 403
        resp = await client.post(f"{BASE}/mappings/{uuid.uuid4()}/preview", headers=env["headers"])
        assert resp.status_code == 404

    async def test_preview_without_a_client_is_502(self, client, db, env, monkeypatch):
        _no_client(monkeypatch)
        resp = await client.post(
            f"{BASE}/mappings/{env['mapping_id']}/preview", headers=env["headers"]
        )
        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------


class TestPullSync:
    async def test_pull_runs_applies_and_reports(self, client, db, env, monkeypatch):
        holder, _ = _swappable(monkeypatch, snow_table_handler(records=[_rec(S1, "Billing")]))
        mid = env["mapping_id"]
        resp = await client.post(f"{BASE}/sync/pull/{mid}", headers=env["headers"])
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "completed" and body["direction"] == "pull"
        assert body["mapping_id"] == mid and body["connection_id"] == env["conn_id"]
        assert body["created_by"] == str(env["admin"].id)
        assert body["stats"]["fetched"] == 1 and body["stats"]["created"] == 1
        assert body["started_at"] and body["completed_at"] and body["error_message"] is None
        (card,) = (await db.execute(select(Card))).scalars().all()
        assert card.name == "Billing" and card.attributes == {"criticality": "critical"}

        # Without auto-apply the records wait for review.
        holder["handler"] = snow_table_handler(records=[_rec(S1, "Billing"), _rec(S2, "CRM")])
        resp = await client.post(f"{BASE}/sync/pull/{mid}?auto_apply=false", headers=env["headers"])
        run_id = resp.json()["id"]
        assert resp.json()["stats"] == {
            "fetched": 2,
            "created": 1,
            "updated": 0,
            "deleted": 0,
            "skipped": 1,
            "errors": 0,
        }
        staged = (
            await client.get(
                f"{BASE}/sync/runs/{run_id}/staged?action=create&status=pending",
                headers=env["headers"],
            )
        ).json()
        assert [s["snow_sys_id"] for s in staged] == [S2]
        assert staged[0]["card_id"] is None and staged[0]["snow_data"]["name"] == "CRM"
        assert (
            len(
                (
                    await client.get(f"{BASE}/sync/runs/{run_id}/staged", headers=env["headers"])
                ).json()
            )
            == 2
        )

    async def test_pull_rejections(self, client, db, env, monkeypatch):
        mid = env["mapping_id"]
        headers = env["headers"]
        assert (
            await client.post(f"{BASE}/sync/pull/{uuid.uuid4()}", headers=headers)
        ).status_code == 404
        assert (
            await client.post(f"{BASE}/sync/pull/{mid}", headers=env["viewer_headers"])
        ).status_code == 403

        mapping = await _mapping(db, mid)
        mapping.is_active = False
        await db.flush()
        resp = await client.post(f"{BASE}/sync/pull/{mid}", headers=headers)
        assert resp.status_code == 400 and resp.json()["detail"] == "Mapping is inactive"
        mapping.is_active = True
        conn = await _conn(db, env["conn_id"])
        conn.is_active = False
        await db.flush()
        resp = await client.post(f"{BASE}/sync/pull/{mid}", headers=headers)
        assert (
            resp.status_code == 400
            and resp.json()["detail"] == "Connection is inactive or not found"
        )
        conn.is_active = True
        await db.flush()

        monkeypatch.setattr(snow_api, "SyncEngine", _ExplodingEngine)
        _swappable(monkeypatch, snow_table_handler())
        resp = await client.post(f"{BASE}/sync/pull/{mid}", headers=headers)
        assert resp.status_code == 502 and resp.json()["detail"] == "Pull sync operation failed"

    async def test_pull_without_a_client_is_502(self, client, db, env, monkeypatch):
        _no_client(monkeypatch)
        resp = await client.post(f"{BASE}/sync/pull/{env['mapping_id']}", headers=env["headers"])
        assert (
            resp.status_code == 502 and resp.json()["detail"] == "Failed to connect to ServiceNow"
        )


class TestPushSync:
    async def test_push_runs_and_reports(self, client, db, env, monkeypatch):
        card = await create_card(db, card_type="Application", name="Fresh", user_id=env["admin"].id)
        card.attributes = {"owner": "Ann"}
        await db.flush()
        _, seen = _swappable(monkeypatch, snow_table_handler(created_sys_id=S9))
        resp = await client.post(f"{BASE}/sync/push/{env['mapping_id']}", headers=env["headers"])
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "completed" and body["direction"] == "push"
        assert body["stats"] == {
            "processed": 1,
            "created": 1,
            "updated": 0,
            "skipped": 0,
            "errors": 0,
        }
        assert [r.method for r in seen] == ["POST"]
        (entry,) = (await db.execute(select(SnowIdentityMap))).scalars().all()
        assert entry.card_id == card.id and entry.snow_sys_id == S9

    async def test_push_rejections(self, client, db, env, monkeypatch):
        mid = env["mapping_id"]
        headers = env["headers"]
        assert (
            await client.post(f"{BASE}/sync/push/{uuid.uuid4()}", headers=headers)
        ).status_code == 404
        assert (
            await client.post(f"{BASE}/sync/push/{mid}", headers=env["viewer_headers"])
        ).status_code == 403
        mapping = await _mapping(db, mid)
        mapping.is_active = False
        await db.flush()
        assert (await client.post(f"{BASE}/sync/push/{mid}", headers=headers)).status_code == 400
        mapping.is_active = True
        conn = await _conn(db, env["conn_id"])
        conn.is_active = False
        await db.flush()
        assert (await client.post(f"{BASE}/sync/push/{mid}", headers=headers)).status_code == 400
        conn.is_active = True
        await db.flush()
        monkeypatch.setattr(snow_api, "SyncEngine", _ExplodingEngine)
        _swappable(monkeypatch, snow_table_handler())
        resp = await client.post(f"{BASE}/sync/push/{mid}", headers=headers)
        assert resp.status_code == 502 and resp.json()["detail"] == "Push sync operation failed"

    async def test_push_without_a_client_is_502(self, client, db, env, monkeypatch):
        _no_client(monkeypatch)
        resp = await client.post(f"{BASE}/sync/push/{env['mapping_id']}", headers=env["headers"])
        assert resp.status_code == 502


class TestRunsAndApply:
    async def _two_runs(self, client, env, monkeypatch) -> tuple[str, str]:
        _swappable(monkeypatch, snow_table_handler(records=[_rec(S1, "Billing")]))
        mid = env["mapping_id"]
        pull = await client.post(f"{BASE}/sync/pull/{mid}?auto_apply=false", headers=env["headers"])
        push = await client.post(f"{BASE}/sync/push/{mid}", headers=env["headers"])
        return pull.json()["id"], push.json()["id"]

    async def test_runs_are_listed_and_looked_up(self, client, db, env, monkeypatch):
        pull_id, push_id = await self._two_runs(client, env, monkeypatch)
        other = SnowSyncRun(connection_id=uuid.UUID(env["conn_id"]), mapping_id=None, stats={})
        db.add(other)
        await db.flush()
        headers = env["headers"]
        runs = (await client.get(f"{BASE}/sync/runs", headers=headers)).json()
        assert {r["id"] for r in runs} == {pull_id, push_id, str(other.id)}
        runs = (
            await client.get(f"{BASE}/sync/runs?mapping_id={env['mapping_id']}", headers=headers)
        ).json()
        assert {r["id"] for r in runs} == {pull_id, push_id}
        runs = (
            await client.get(f"{BASE}/sync/runs?connection_id={uuid.uuid4()}", headers=headers)
        ).json()
        assert runs == []
        assert len((await client.get(f"{BASE}/sync/runs?limit=1", headers=headers)).json()) == 1

        resp = await client.get(f"{BASE}/sync/runs/{push_id}", headers=headers)
        assert resp.status_code == 200 and resp.json()["direction"] == "push"
        assert resp.json()["mapping_id"] == env["mapping_id"]
        assert (
            await client.get(f"{BASE}/sync/runs/{uuid.uuid4()}", headers=headers)
        ).status_code == 404
        for url in ("/sync/runs", f"/sync/runs/{pull_id}", f"/sync/runs/{pull_id}/staged"):
            assert (await client.get(BASE + url, headers=env["viewer_headers"])).status_code == 403

    async def test_apply_lands_the_staged_records(self, client, db, env, monkeypatch):
        pull_id, _ = await self._two_runs(client, env, monkeypatch)
        headers = env["headers"]
        assert (await db.execute(select(Card))).scalars().all() == []
        resp = await client.post(f"{BASE}/sync/runs/{pull_id}/apply", headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {
            "ok": True,
            "applied": {"created": 1, "updated": 0, "deleted": 0, "errors": 0},
        }
        (card,) = (await db.execute(select(Card))).scalars().all()
        assert card.name == "Billing"
        rows = (await db.execute(select(SnowStagedRecord))).scalars().all()
        assert {r.status for r in rows} == {"applied"}

        assert (
            await client.post(f"{BASE}/sync/runs/{uuid.uuid4()}/apply", headers=headers)
        ).status_code == 404
        assert (
            await client.post(f"{BASE}/sync/runs/{pull_id}/apply", headers=env["viewer_headers"])
        ).status_code == 403
        monkeypatch.setattr(snow_api, "SyncEngine", _ExplodingEngine)
        resp = await client.post(f"{BASE}/sync/runs/{pull_id}/apply", headers=headers)
        assert resp.status_code == 502 and resp.json()["detail"] == "Failed to apply staged records"

    async def test_apply_without_a_client_is_502(self, client, db, env, monkeypatch):
        pull_id, _ = await self._two_runs(client, env, monkeypatch)
        _no_client(monkeypatch)
        resp = await client.post(f"{BASE}/sync/runs/{pull_id}/apply", headers=env["headers"])
        assert resp.status_code == 502
