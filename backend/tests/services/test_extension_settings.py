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
