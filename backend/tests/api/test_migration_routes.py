"""``/migration`` — upload, the parse-and-stage job, preview, field
mappings, the apply job, the error report and delete, driven by an
in-memory source registered for the test.

The two background jobs run on the test session (``patched_async_session``)
and roll back on failure, so the setup rows are committed first.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

import app.api.v1.migration as migration_api
from app.core.permissions import VIEWER_PERMISSIONS
from app.models.card import Card
from app.models.migration import Migration, StagedRecord
from app.services.migration.registry import register_source
from app.services.migration.snapshot import MetamodelField
from tests.conftest import auth_headers, create_role, create_user
from tests.migration_helpers import (
    InMemorySource,
    make_migration,
    migration_metamodel,
    sample_snapshot,
    stage_all,
)

BASE = "/api/v1/migration"
BUILTIN_TYPES = ("Application", "BusinessCapability", "BusinessProcess", "Organization")
BUILTIN_RELS = ("relAppToBC", "relAppSuccessor", "relProcessToApp", "relOrgToApp")
FIELD_TYPES = {
    "COST": "cost",
    "SINGLE_SELECT": "single_select",
    "MULTIPLE_SELECT": "multiple_select",
    "TEXT": "text",
    "DATE": "date",
}
PAYLOAD = b'{"export": 1}'
LIFECYCLE_SLOTS = [
    f"__lifecycle__:{p}" for p in ("plan", "phaseIn", "active", "phaseOut", "endOfLife")
]


def _source(snapshot, **kw) -> InMemorySource:
    kw.setdefault("type_mapping", {k: k for k in BUILTIN_TYPES})
    kw.setdefault("relation_mapping", {k: k for k in BUILTIN_RELS})
    kw.setdefault("field_type_mapping", FIELD_TYPES)
    return InMemorySource(snapshot, **kw)


@pytest.fixture
async def env(db, monkeypatch, tmp_path, sources_registry_snapshot, patched_async_session):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_role(db, key="member", label="Member", permissions={})
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    await migration_metamodel(db)
    # A failing job rolls back; what it must not take with it is committed.
    await db.commit()
    snapshot = sample_snapshot()
    source = _source(snapshot)
    register_source(source)
    snapdir = tmp_path / "snapshots"
    monkeypatch.setattr(migration_api, "_SNAPSHOT_DIR", snapdir)
    return {
        "admin": admin,
        "viewer": viewer,
        "source": source,
        "snapshot": snapshot,
        "snapdir": snapdir,
    }


@pytest.fixture
async def staged(db, env):
    """A migration parsed and staged from the sample snapshot, committed."""
    m = await make_migration(db, user=env["admin"])
    await stage_all(db, m, env["source"], env["snapshot"])
    await db.commit()
    return m


async def _upload(
    client,
    user,
    *,
    payload: bytes = PAYLOAD,
    name="Q3 export",
    source_key="inmem",
    include_archived=False,
):
    return await client.post(
        f"{BASE}/upload",
        data={
            "source_key": source_key,
            "name": name,
            "include_archived": "true" if include_archived else "false",
        },
        files={"file": ("export.json", payload, "application/json")},
        headers=auth_headers(user),
    )


async def _get(client, user, mid) -> dict:
    resp = await client.get(f"{BASE}/{mid}", headers=auth_headers(user))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _staged_records(db, mid):
    stmt = select(StagedRecord).where(StagedRecord.migration_id == uuid.UUID(str(mid)))
    return (await db.execute(stmt)).scalars().all()


class TestSources:
    async def test_lists_every_registered_adapter(self, client, db, env):
        resp = await client.get(f"{BASE}/sources", headers=auth_headers(env["admin"]))
        assert resp.status_code == 200
        by_key = {s["key"]: s for s in resp.json()}
        assert by_key["inmem"] == {
            "key": "inmem",
            "label": "In-memory source",
            "accepted_extensions": [".json"],
            "supports_export": False,
        }
        assert by_key["leanix"]["supports_export"] is True

    async def test_requires_the_migrate_permission(self, client, db, env):
        resp = await client.get(f"{BASE}/sources", headers=auth_headers(env["viewer"]))
        assert resp.status_code == 403


class TestUpload:
    async def test_upload_stores_the_file_and_stages_the_snapshot(self, client, db, env):
        resp = await _upload(client, env["admin"], include_archived=True)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == "uploaded" and body["source_type"] == "inmem"
        assert body["name"] == "Q3 export" and body["file_size"] == len(PAYLOAD)
        assert body["stats"] == {"options": {"include_archived": True}}
        assert body["field_mappings"] == {}
        stored = env["snapdir"] / f"{body['id']}.bin"
        assert stored.read_bytes() == PAYLOAD
        assert env["source"].parsed_paths == [stored]

        # The background job has run by the time the response is back.
        m = await _get(client, env["admin"], body["id"])
        assert m["status"] == "parsed" and m["parsed_at"] is not None
        assert m["snapshot_version"] == "turbo-ea" and m["error_message"] is None
        stats = m["stats"]
        assert stats["options"] == {"include_archived": True}  # kept by the merge
        assert stats["cards"]["create"] == 7 and stats["create"] == 7  # nested + legacy flat
        assert stats["entities"] == 7 and stats["fact_sheets"] == 7
        assert stats["metamodel"]["new_types"] == 1
        assert stats["relations"] == {
            "create": 5,
            "update": 0,
            "skip": 0,
            "conflict": 1,
            "unknown_type": 0,
        }
        assert stats["tags"]["groups_create"] == 2 and stats["tag_count"] == 2
        assert stats["users"]["create"] == 2 and stats["subscriptions"]["create"] == 2
        assert stats["documents"]["create"] == 1 and stats["comments"]["create"] == 1
        assert stats["parse_errors"] == 0
        assert len(await _staged_records(db, body["id"])) > 7

    async def test_the_same_bytes_return_the_existing_migration(self, client, db, env):
        first = (await _upload(client, env["admin"])).json()
        again = await _upload(client, env["admin"], name="Other name")
        assert again.status_code == 201 and again.json()["id"] == first["id"]
        assert again.json()["name"] == "Q3 export" and again.json()["status"] == "parsed"
        assert len(list(env["snapdir"].iterdir())) == 1
        assert len(env["source"].parsed_paths) == 1

    async def test_rejected_uploads(self, client, db, env):
        resp = await _upload(client, env["admin"], source_key="nope")
        assert resp.status_code == 400
        assert "Unknown migration source 'nope'" in resp.json()["detail"]

        resp = await _upload(client, env["admin"], payload=b"")
        assert resp.status_code == 400 and resp.json()["detail"] == "Empty snapshot file"

        env["source"].validate_payload = lambda head: False
        resp = await _upload(client, env["admin"])
        assert resp.status_code == 400
        assert resp.json()["detail"] == "File does not match In-memory source (.json)."
        assert not env["snapdir"].exists()

        assert (await _upload(client, env["viewer"])).status_code == 403

    async def test_a_parse_failure_marks_the_migration_failed(self, client, db, env):
        env["source"].parse_error = ValueError("not a snapshot")
        body = (await _upload(client, env["admin"])).json()
        m = await _get(client, env["admin"], body["id"])
        assert m["status"] == "failed" and m["error_message"] == "not a snapshot"
        assert await _staged_records(db, body["id"]) == []

    async def test_a_staging_failure_rolls_back_and_marks_failed(
        self, client, db, env, monkeypatch
    ):
        async def boom(*args, **kwargs):
            raise RuntimeError("staging exploded")

        monkeypatch.setattr(migration_api, "stage_relations", boom)
        body = (await _upload(client, env["admin"])).json()
        await db.refresh(env["admin"])  # the job's rollback expired every loaded row
        m = await _get(client, env["admin"], body["id"])
        assert m["status"] == "failed" and m["error_message"] == "staging exploded"
        # The card rows staged before the failure went with the rollback.
        assert await _staged_records(db, body["id"]) == []


class TestListAndGet:
    async def test_list_with_a_source_filter(self, client, db, env):
        a = await make_migration(db, user=env["admin"], source_type="inmem", name="a")
        b = await make_migration(db, user=env["admin"], source_type="leanix", name="b")
        resp = await client.get(BASE, headers=auth_headers(env["admin"]))
        assert resp.status_code == 200
        assert {m["name"] for m in resp.json()} == {"a", "b"}
        resp = await client.get(f"{BASE}?source_type=leanix", headers=auth_headers(env["admin"]))
        assert [m["id"] for m in resp.json()] == [str(b.id)]
        assert str(a.id) != str(b.id)
        assert (await client.get(BASE, headers=auth_headers(env["viewer"]))).status_code == 403

    async def test_unknown_migration_is_404(self, client, db, env):
        resp = await client.get(f"{BASE}/{uuid.uuid4()}", headers=auth_headers(env["admin"]))
        assert resp.status_code == 404 and resp.json()["detail"] == "Migration not found"
        resp = await client.get(f"{BASE}/{uuid.uuid4()}", headers=auth_headers(env["viewer"]))
        assert resp.status_code == 403


class TestPreview:
    async def test_pages_and_filters_one_kind(self, client, db, env, staged):
        url = f"{BASE}/{staged.id}/preview"
        headers = auth_headers(env["admin"])
        page = (await client.get(f"{url}?limit=3", headers=headers)).json()
        assert page["total"] == 7 and page["limit"] == 3 and page["offset"] == 0
        assert len(page["items"]) == 3
        item = page["items"][0]
        assert item["entity_kind"] == "card" and item["status"] == "pending"
        assert item["action"] == "create" and item["target_id"] is None
        page2 = (await client.get(f"{url}?limit=3&offset=6", headers=headers)).json()
        assert len(page2["items"]) == 1 and page2["offset"] == 6

        bcs = (await client.get(f"{url}?card_type_key=BusinessCapability", headers=headers)).json()
        assert {i["display_name"] for i in bcs["items"]} == {"Sales", "Lead Mgmt"}

        conflicts = (
            await client.get(f"{url}?entity_kind=relation&action=conflict", headers=headers)
        ).json()
        assert conflicts["total"] == 1 and conflicts["items"][0]["source_id"] == "rel-6"
        assert conflicts["items"][0]["diff"]["reason"].startswith("Endpoint not staged")
        assert conflicts["items"][0]["card_type_key"] is None

    @pytest.mark.parametrize(
        "kind,expected",
        [
            (
                "card",
                {
                    "Salesforce",
                    "New CRM",
                    "Sales",
                    "Lead Mgmt",
                    "Order to Cash",
                    "Sales EMEA",
                    "db-01",
                },
            ),
            ("metamodel_type", {"Server"}),
            ("metamodel_field", {"Total annual cost", "Hosting type", "Regions", "Unused"}),
            ("metamodel_relation_type", {"hosts"}),
            ("user", {"Owner", "A"}),
            ("tag", {"EMEA", "Pilot"}),
            ("tag_group", {"Region", "Stage"}),
            (
                "relation",
                {
                    "relAppToBC",
                    "relAppSuccessor",
                    "relProcessToApp",
                    "relOrgToApp",
                    "relServerToApp",
                },
            ),
            ("subscription", {"owner@example.com (Application Owner)", "a@example.com (Observer)"}),
            ("document", {"Runbook"}),
            ("comment", {None}),
        ],
    )
    async def test_display_names_per_kind(self, client, db, env, staged, kind, expected):
        resp = await client.get(
            f"{BASE}/{staged.id}/preview?entity_kind={kind}", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 200
        assert {i["display_name"] for i in resp.json()["items"]} == expected

    async def test_unknown_migration_and_viewer(self, client, db, env, staged):
        resp = await client.get(
            f"{BASE}/{uuid.uuid4()}/preview", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 404
        resp = await client.get(f"{BASE}/{staged.id}/preview", headers=auth_headers(env["viewer"]))
        assert resp.status_code == 403


class TestFieldMappings:
    async def test_get_lists_source_fields_and_targets(self, client, db, env, staged):
        resp = await client.get(
            f"{BASE}/{staged.id}/field-mappings", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        (block,) = body["blocks"]
        assert block["native_type"] == "Application" and block["target_tea_type"] == "Application"
        assert block["target_type_label"] == "Application"
        assert [f["source_field_key"] for f in block["source_fields"]] == [
            "costTotalAnnual",
            "hostingType",
            "regions",
            "unusedField",
        ]
        hosting = block["source_fields"][1]
        assert hosting["tea_type"] == "single_select" and hosting["mapped_to"] is None
        assert hosting["label"] == "Hosting type"
        # The type's own fields, by label, then the lifecycle slots in order.
        targets = [t["key"] for t in block["available_targets"]]
        assert targets == ["costTotalAnnual", "hostingType", *LIFECYCLE_SLOTS]
        assert block["available_targets"][0] == {
            "key": "costTotalAnnual",
            "label": "Annual cost",
            "type": "cost",
            "section": "General",
        }
        assert block["available_targets"][-1]["section"] == "Lifecycle"
        assert body["auto_mapped_columns"] == [
            {"source_column": "displayName", "tea_target": "Name"}
        ]

    async def test_a_custom_target_type_offers_the_lifecycle_slots_only(self, client, db, env):
        snap = sample_snapshot()
        server = next(t for t in snap.metamodel_types if t.name == "Server")
        server.fields.append(MetamodelField("Server", "rack", "Rack", "TEXT"))
        m = await make_migration(db, user=env["admin"])
        await stage_all(db, m, _source(snap), snap)
        body = (
            await client.get(f"{BASE}/{m.id}/field-mappings", headers=auth_headers(env["admin"]))
        ).json()
        block = next(b for b in body["blocks"] if b["target_tea_type"] == "Server")
        assert block["target_type_label"] == "Server" and block["native_type"] == "Server"
        assert [t["key"] for t in block["available_targets"]] == LIFECYCLE_SLOTS
        assert [f["source_field_key"] for f in block["source_fields"]] == ["rack"]

    async def test_an_unregistered_source_has_no_auto_mapped_columns(self, client, db, env):
        m = await make_migration(db, user=env["admin"], source_type="ghost")
        body = (
            await client.get(f"{BASE}/{m.id}/field-mappings", headers=auth_headers(env["admin"]))
        ).json()
        assert body == {"blocks": [], "auto_mapped_columns": []}

    async def test_put_cleans_and_stores_the_mapping(self, client, db, env, staged):
        url = f"{BASE}/{staged.id}/field-mappings"
        headers = auth_headers(env["admin"])
        resp = await client.put(
            url,
            json={
                "field_mappings": {
                    "Application": {"regions": "regions", "alias": "", "unusedField": "__skip__"},
                    "Empty": {"x": ""},
                }
            },
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["field_mappings"] == {
            "Application": {"regions": "regions", "unusedField": "__skip__"}
        }
        assert body["status"] == "previewed"
        mapped = (await client.get(url, headers=headers)).json()
        rows = {f["source_field_key"]: f["mapped_to"] for f in mapped["blocks"][0]["source_fields"]}
        assert rows["unusedField"] == "__skip__" and rows["regions"] == "regions"
        assert rows["hostingType"] is None

        # A second save keeps the status and can clear everything.
        resp = await client.put(url, json={"field_mappings": {}}, headers=headers)
        assert resp.json()["status"] == "previewed" and resp.json()["field_mappings"] == {}

    async def test_put_is_refused_outside_parsed_or_previewed(self, client, db, env, staged):
        m = await make_migration(db, user=env["admin"], status="applied")
        resp = await client.put(
            f"{BASE}/{m.id}/field-mappings",
            json={"field_mappings": {}},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400 and "'applied'" in resp.json()["detail"]
        resp = await client.put(
            f"{BASE}/{staged.id}/field-mappings",
            json={"field_mappings": {}},
            headers=auth_headers(env["viewer"]),
        )
        assert resp.status_code == 403
        resp = await client.get(
            f"{BASE}/{staged.id}/field-mappings", headers=auth_headers(env["viewer"])
        )
        assert resp.status_code == 403


class TestApply:
    async def test_apply_runs_the_job_and_records_the_counts(self, client, db, env, staged):
        resp = await client.post(f"{BASE}/{staged.id}/apply", headers=auth_headers(env["admin"]))
        assert resp.status_code == 202, resp.text
        assert resp.json()["status"] == "applying"

        m = await _get(client, env["admin"], staged.id)
        assert m["status"] == "applied" and m["applied_at"] is not None
        assert m["error_message"] == "1 unresolved conflict(s) skipped — see staged records"
        apply = m["stats"]["apply"]
        assert apply["errors"] == 0 and apply["conflicts"] == 1
        assert apply["per_pass"]["card"]["created"] == 7
        assert apply["per_pass"]["relation"]["created"] == 5
        assert m["stats"]["cards"]["create"] == 7  # the staging stats survive the merge
        assert len((await db.execute(select(Card))).scalars().all()) == 7
        assert all(r.status == "applied" for r in await _staged_records(db, staged.id))

    async def test_apply_is_refused_outside_parsed_or_previewed(self, client, db, env):
        for status in ("uploaded", "applying", "applied"):
            m = await make_migration(db, user=env["admin"], status=status)
            resp = await client.post(f"{BASE}/{m.id}/apply", headers=auth_headers(env["admin"]))
            assert resp.status_code == 400 and f"'{status}'" in resp.json()["detail"]
        m = await make_migration(db, user=env["admin"], status="parsed")
        resp = await client.post(f"{BASE}/{m.id}/apply", headers=auth_headers(env["viewer"]))
        assert resp.status_code == 403
        resp = await client.post(f"{BASE}/{uuid.uuid4()}/apply", headers=auth_headers(env["admin"]))
        assert resp.status_code == 404

    async def test_errors_fail_the_migration_and_feed_the_csv_report(self, client, db, env, staged):
        row = next(r for r in await _staged_records(db, staged.id) if r.source_id == "app-1")
        row.action = "update"
        row.target_id = None
        await db.commit()

        await client.post(f"{BASE}/{staged.id}/apply", headers=auth_headers(env["admin"]))
        m = await _get(client, env["admin"], staged.id)
        assert m["status"] == "failed"
        assert m["error_message"] == (
            "1 entity error(s) · 1 unresolved conflict(s) skipped — see staged records"
        )

        resp = await client.get(
            f"{BASE}/{staged.id}/errors.csv", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/csv")
        assert f'filename="migration-{staged.id}-errors.csv"' in resp.headers["content-disposition"]
        lines = resp.text.strip().splitlines()
        assert lines[0] == "entity_kind,source_id,card_type_key,action,error_message"
        assert len(lines) == 2
        assert lines[1].startswith("card,app-1,Application,update,update staged row ")

        resp = await client.get(
            f"{BASE}/{staged.id}/errors.csv", headers=auth_headers(env["viewer"])
        )
        assert resp.status_code == 403

    async def test_a_vanished_user_fails_the_apply(self, client, db, env, staged):
        await migration_api._apply_job(str(staged.id), str(uuid.uuid4()))
        m = await _get(client, env["admin"], staged.id)
        assert m["status"] == "failed" and m["error_message"] == "Apply user no longer exists"

    async def test_an_exception_in_the_pipeline_rolls_back(
        self, client, db, env, staged, monkeypatch
    ):
        async def boom(db, m, user):
            raise RuntimeError("pipeline exploded")

        monkeypatch.setattr(migration_api, "apply_migration", boom)
        mid = str(staged.id)
        resp = await client.post(f"{BASE}/{mid}/apply", headers=auth_headers(env["admin"]))
        assert resp.status_code == 202
        await db.refresh(env["admin"])  # the job's rollback expired every loaded row
        m = await _get(client, env["admin"], mid)
        assert m["status"] == "failed" and m["error_message"] == "pipeline exploded"
        assert m["applied_at"] is None

    async def test_the_jobs_are_no_ops_for_a_missing_migration(self, db, env):
        missing = str(uuid.uuid4())
        await migration_api._apply_job(missing, str(env["admin"].id))
        await migration_api._parse_and_stage_job(missing)
        await migration_api._record_migration_failure(uuid.UUID(missing), RuntimeError("x"))
        m = await make_migration(db, user=env["admin"], storage_path=None)
        await migration_api._parse_and_stage_job(str(m.id))
        assert m.status == "uploaded" and env["source"].parsed_paths == []


class TestDelete:
    async def test_delete_removes_the_row_its_records_and_the_file(self, client, db, env, staged):
        env["snapdir"].mkdir(parents=True)
        path = env["snapdir"] / "x.bin"
        path.write_bytes(b"x")
        staged.storage_path = str(path)
        await db.commit()

        resp = await client.delete(f"{BASE}/{staged.id}", headers=auth_headers(env["admin"]))
        assert resp.status_code == 204
        assert not path.exists()
        row = (
            await db.execute(select(Migration).where(Migration.id == staged.id))
        ).scalar_one_or_none()
        assert row is None
        assert await _staged_records(db, staged.id) == []

    async def test_an_applying_migration_cannot_be_deleted(self, client, db, env, staged):
        m = await make_migration(db, user=env["admin"], status="applying")
        resp = await client.delete(f"{BASE}/{m.id}", headers=auth_headers(env["admin"]))
        assert resp.status_code == 400 and "'applying'" in resp.json()["detail"]
        resp = await client.delete(f"{BASE}/{staged.id}", headers=auth_headers(env["viewer"]))
        assert resp.status_code == 403
        resp = await client.delete(f"{BASE}/{uuid.uuid4()}", headers=auth_headers(env["admin"]))
        assert resp.status_code == 404
