"""The shared test seams work the way the tests built on them assume.

A broken seam fails every suite that uses it in the same confusing way,
so each helper has a test of its own here. No database except where a
helper is itself a database helper.
"""

from __future__ import annotations

import asyncio

import httpx
import pytest
from sqlalchemy import select

from tests.migration_helpers import (
    InMemorySource,
    empty_snapshot,
    make_migration,
    migration_metamodel,
    sample_snapshot,
    stage_all,
    staged_rows,
)
from tests.seams import (
    FakeCallAi,
    ai_settings,
    one_shot_asyncio,
    patch_httpx_client,
    session_factory_for,
    snow_table_handler,
)


class TestFakeCallAi:
    async def test_queue_is_served_first_then_routes_then_default(self):
        fake = FakeCallAi(default="dflt")
        fake.queue({"a": 1}).route(contains="vendor", text="routed", max_tokens=256)
        assert await fake("vendor x", 256) == {"text": '{"a": 1}', "truncated": False}
        assert await fake("vendor y", 256) == {"text": "routed", "truncated": False}
        assert await fake("other", 256) == {"text": "dflt", "truncated": False}
        assert [c[1] for c in fake.calls] == [256, 256, 256]

    async def test_route_matches_on_max_tokens_and_can_raise(self):
        fake = FakeCallAi()
        fake.route(max_tokens=1600, text="batch").route(max_tokens=256, raises=ValueError("boom"))
        assert (await fake("p", 1600))["text"] == "batch"
        with pytest.raises(ValueError, match="boom"):
            await fake("p", 256)

    async def test_unscripted_call_fails_loudly(self):
        with pytest.raises(AssertionError, match="unscripted call_ai"):
            await FakeCallAi()("anything")

    def test_install_patches_the_consumers(self, monkeypatch):
        import app.services.turbolens_vendors as vendors

        fake = FakeCallAi().install(monkeypatch)
        assert vendors.call_ai is fake

    def test_fixture_is_installed(self, fake_call_ai):
        import app.services.compliance_scanner as scanner

        assert scanner.call_ai is fake_call_ai


class TestHttpxSeams:
    async def test_patch_httpx_client_routes_and_records(self, monkeypatch):
        import app.services.sso_service as sso

        seen = patch_httpx_client(
            monkeypatch, sso, lambda req: httpx.Response(200, json={"ok": True})
        )
        async with sso.httpx.AsyncClient(timeout=1.0) as client:
            resp = await client.get("https://idp.test/.well-known/openid-configuration")
        assert resp.json() == {"ok": True}
        assert [r.url.host for r in seen] == ["idp.test"]

    async def test_snow_table_handler_pages_posts_and_patches(self):
        records = [{"sys_id": f"{i:032x}", "name": f"r{i}"} for i in range(3)]
        handler = snow_table_handler(records=records, total=600, tables=[{"name": "t"}])
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler), base_url="https://snow.test"
        ) as c:
            page = await c.get(
                "/api/now/table/cmdb_ci_appl", params={"sysparm_offset": 1, "sysparm_limit": 1}
            )
            assert page.json()["result"] == [records[1]]
            assert page.headers["X-Total-Count"] == "600"
            assert (await c.get("/api/now/table/sys_db_object")).json()["result"] == [{"name": "t"}]
            created = await c.post("/api/now/table/cmdb_ci_appl", json={"name": "n"})
            assert created.json()["result"]["sys_id"] == "a" * 32
            patched = await c.patch(f"/api/now/table/cmdb_ci_appl/{'b' * 32}", json={"x": 1})
            assert patched.json()["result"] == {"sys_id": "b" * 32, "x": 1}
            assert (await c.get("/elsewhere")).status_code == 404

    async def test_snow_table_handler_fail_status(self):
        handler = snow_table_handler(fail_status=500)
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler), base_url="https://snow.test"
        ) as c:
            assert (await c.get("/api/now/table/x")).status_code == 500


class TestOneShotAsyncio:
    async def test_second_sleep_cancels(self):
        ns = one_shot_asyncio()
        await ns.sleep(5)
        with pytest.raises(asyncio.CancelledError):
            await ns.sleep(7)
        assert ns.sleeps == [5, 7]
        assert ns.CancelledError is asyncio.CancelledError


class TestSessionSeams:
    async def test_session_factory_for_yields_the_session(self, db):
        async with session_factory_for(db)() as handed:
            assert handed is db

    async def test_patched_async_session_covers_every_target(self, db, patched_async_session):
        import app.api.v1.migration as migration_api
        import app.database as database

        assert migration_api.async_session is patched_async_session
        assert database.async_session is patched_async_session

    async def test_ai_settings_upserts_and_encrypts(self, db):
        from app.core.encryption import decrypt_value
        from app.models.app_settings import AppSettings

        row = await ai_settings(
            db, general={"turboLensEnabled": False}, enabledTypes=["Application"]
        )
        assert row.general_settings["turboLensEnabled"] is False
        ai = row.general_settings["ai"]
        assert ai["providerType"] == "openai" and ai["enabledTypes"] == ["Application"]
        assert ai["apiKey"].startswith("enc:") and decrypt_value(ai["apiKey"]) == "sk-test"

        again = await ai_settings(db, provider_type="ollama", api_key=None, model="m2")
        rows = (await db.execute(select(AppSettings))).scalars().all()
        assert len(rows) == 1 and again is rows[0]
        assert again.general_settings["ai"]["providerType"] == "ollama"
        assert again.general_settings["ai"]["apiKey"] == ""
        assert again.general_settings["turboLensEnabled"] is False  # merged, not replaced


class TestMigrationHelpers:
    def test_in_memory_source_defaults_to_identity_mappings(self):
        src = InMemorySource(sample_snapshot())
        assert src.type_mapping["Server"] == "Server"
        assert src.relation_mapping["relAppToBC"] == "relAppToBC"
        assert src.validate_payload(b"anything")
        assert src.parse("/tmp/x.json") is src.snapshot
        assert src.map_subscription_role("Owner", "RESPONSIBLE") == "responsible"
        assert src.map_subscription_role("Watcher", "OBSERVER") == "observer"
        assert src.map_subscription_role("Lead", None) == "responsible"

    def test_in_memory_source_parse_error_and_key_limit(self):
        src = InMemorySource(empty_snapshot(), parse_error=RuntimeError("bad file"))
        with pytest.raises(RuntimeError, match="bad file"):
            src.parse("x")
        with pytest.raises(AssertionError):
            InMemorySource(empty_snapshot(), key="k" * 21)

    async def test_stage_all_stages_every_kind(self, db, admin_user):
        await migration_metamodel(db)
        snapshot = sample_snapshot()
        source = InMemorySource(snapshot)
        migration = await make_migration(db, user=admin_user)

        stats = await stage_all(db, migration, source, snapshot)

        assert migration.status == "parsed"
        assert set(stats) == {
            "metamodel",
            "cards",
            "relations",
            "tags",
            "users",
            "subscriptions",
            "documents",
            "comments",
        }
        kinds = {r.entity_kind for r in await staged_rows(db, migration)}
        assert {"card", "relation", "tag", "user", "subscription", "document", "comment"} <= kinds
        cards = await staged_rows(db, migration, "card")
        assert [c.source_id for c in cards] == sorted(e.source_id for e in snapshot.entities)
