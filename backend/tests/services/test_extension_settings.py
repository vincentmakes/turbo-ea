"""Batch settings on ExtensionContext (SDK 1.4).

``get_settings`` / ``set_settings`` move N namespaced keys in ONE database
transaction — the per-key pair is a full read-modify-write transaction per
call, which turned an N-key config save into N sequential round trips on
the settings row (whole seconds on a high-latency database).
"""

from __future__ import annotations

from contextlib import asynccontextmanager

import pytest
from sqlalchemy import select

from app.models.app_settings import AppSettings
from app.services.extensions import jobs as jobs_mod
from app.services.extensions.jobs import build_context, reset_contexts

KEY = "jira-sync"


@pytest.fixture(autouse=True)
def _contexts():
    reset_contexts()
    yield
    reset_contexts()


@pytest.fixture(autouse=True)
def _patch_session(monkeypatch, db):
    @asynccontextmanager
    async def fake_session():
        yield db

    monkeypatch.setattr(jobs_mod, "async_session", fake_session)


class TestBatchSettings:
    async def test_roundtrip_many_keys_in_one_call(self, db):
        ctx = build_context(KEY)
        await ctx.set_settings({"baseUrl": "https://x", "enabled": True, "interval": 300})
        values = await ctx.get_settings(["baseUrl", "enabled", "interval"])
        assert values == {"baseUrl": "https://x", "enabled": True, "interval": 300}

    async def test_values_land_namespaced_on_the_settings_row(self, db):
        ctx = build_context(KEY)
        await ctx.set_settings({"projectKey": "PROJ"})
        row = (
            await db.execute(select(AppSettings).where(AppSettings.id == "default"))
        ).scalar_one()
        assert row.general_settings[f"ext.{KEY}.projectKey"] == "PROJ"

    async def test_missing_keys_read_as_none(self, db):
        ctx = build_context(KEY)
        await ctx.set_settings({"present": 1})
        values = await ctx.get_settings(["present", "absent"])
        assert values == {"present": 1, "absent": None}

    async def test_interoperates_with_per_key_pair(self, db):
        ctx = build_context(KEY)
        await ctx.set_setting("legacy", "old")
        await ctx.set_settings({"batch": "new"})
        assert await ctx.get_setting("batch") == "new"
        assert (await ctx.get_settings(["legacy"]))["legacy"] == "old"

    async def test_secret_names_are_refused(self, db):
        # Credentials must go through set_secret (Fernet + transfer scrub) —
        # a plaintext batch write of a secret would break that invariant.
        ctx = build_context(KEY)
        with pytest.raises(ValueError):
            await ctx.set_settings({"ok": 1, "secret.apiToken": "raw"})
        # The refused batch writes nothing at all.
        assert (await ctx.get_settings(["ok"]))["ok"] is None


class TestKeyScopedInSql:
    """2.133.1: a read selects only its keys and a write is one server-side
    ``||``. Every setting in the product shares this one JSONB row, so the old
    whole-blob SELECT + Python rewrite made every extension save pay for
    whatever any other key held — measured at 21 ms → ~500 ms once a cached
    catalogue sat in the blob, reported at 3.5 s in the field."""

    @pytest.fixture
    def statements(self, db):
        from sqlalchemy import event

        seen: list[str] = []
        engine = db.get_bind().engine if hasattr(db.get_bind(), "engine") else db.get_bind()
        sync_engine = getattr(engine, "sync_engine", engine)

        def _capture(conn, cursor, statement, parameters, context, executemany):
            seen.append(statement)

        event.listen(sync_engine, "before_cursor_execute", _capture)
        yield seen
        event.remove(sync_engine, "before_cursor_execute", _capture)

    async def test_a_large_unrelated_key_is_neither_read_nor_rewritten(self, db, statements):
        ctx = build_context(KEY)
        await ctx.set_settings({"seed": 1})
        row = (
            await db.execute(select(AppSettings).where(AppSettings.id == "default"))
        ).scalar_one()
        general = dict(row.general_settings or {})
        general["someone_elses_blob"] = "x" * 200_000
        row.general_settings = general
        await db.flush()
        db.expunge(row)
        statements.clear()

        assert (await ctx.get_settings(["seed", "other"])) == {"seed": 1, "other": None}
        await ctx.set_settings({"other": "v"})

        sql = "\n".join(statements)
        # The read names its keys; no statement SELECTs the blob column bare.
        assert "general_settings[" in sql
        selects = [s for s in statements if s.lstrip().upper().startswith("SELECT")]
        assert not any(
            "app_settings.general_settings," in s
            or s.rstrip().endswith("app_settings.general_settings")
            for s in selects
        ), selects
        # The write is a server-side concat, not a Python rewrite: the 200 kB
        # neighbour never crosses the wire in either direction.
        assert "||" in sql
        assert "x" * 1000 not in sql
        # …and the neighbour's key survived, byte for byte.
        fresh = (
            await db.execute(select(AppSettings).where(AppSettings.id == "default"))
        ).scalar_one()
        assert fresh.general_settings["someone_elses_blob"] == "x" * 200_000
        assert fresh.general_settings[f"ext.{KEY}.other"] == "v"

    async def test_two_extensions_writing_at_once_keep_both_values(self, db):
        # With a Python read-modify-write the second writer's stale snapshot
        # reverted the first's key; a server-side ``||`` cannot.
        a, b = build_context("ext-a"), build_context("ext-b")
        await a.set_settings({"k": "a1"})
        await b.set_settings({"k": "b1"})
        await a.set_settings({"k": "a2"})
        assert (await a.get_settings(["k"]))["k"] == "a2"
        assert (await b.get_settings(["k"]))["k"] == "b1"

    async def test_json_values_survive_the_round_trip(self, db):
        ctx = build_context(KEY)
        payload = {"n": 1.5, "b": False, "none": None, "list": [1, "x", {"d": True}], "s": "é"}
        await ctx.set_settings(payload)
        assert await ctx.get_settings(list(payload)) == payload
        assert await ctx.get_setting("b") is False
        assert await ctx.get_setting("nope") is None

    async def test_a_missing_settings_row_is_created_by_the_first_write(self, db):
        await db.execute(AppSettings.__table__.delete())
        await db.flush()
        ctx = build_context(KEY)
        assert await ctx.get_settings(["k"]) == {"k": None}
        await ctx.set_settings({"k": 1})
        assert (await ctx.get_settings(["k"]))["k"] == 1
