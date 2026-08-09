"""Encrypted extension secrets on ExtensionContext (SDK 1.2)."""

from __future__ import annotations

from contextlib import asynccontextmanager

import pytest
from sqlalchemy import select

from app.core import encryption
from app.models.app_settings import AppSettings
from app.services.extensions import jobs as jobs_mod
from app.services.extensions.jobs import build_context, reset_contexts
from app.services.workspace_io.secrets import strip_secrets

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


class TestSecrets:
    async def test_roundtrip_and_encrypted_at_rest(self, db):
        ctx = build_context(KEY)
        await ctx.set_secret("apiToken", "super-secret-token")
        assert await ctx.get_secret("apiToken") == "super-secret-token"

        row = (
            await db.execute(select(AppSettings).where(AppSettings.id == "default"))
        ).scalar_one()
        stored = row.general_settings[f"ext.{KEY}.secret.apiToken"]
        assert stored.startswith("enc:")
        assert "super-secret-token" not in stored

    async def test_missing_secret_is_none(self, db):
        ctx = build_context(KEY)
        assert await ctx.get_secret("nope") is None

    async def test_non_str_raises(self, db):
        ctx = build_context(KEY)
        with pytest.raises(TypeError):
            await ctx.set_secret("apiToken", {"not": "a string"})  # type: ignore[arg-type]

    async def test_secret_key_rotation_returns_empty(self, db, monkeypatch):
        ctx = build_context(KEY)
        await ctx.set_secret("apiToken", "value-under-old-key")
        # Rotate the instance SECRET_KEY: the Fernet token no longer decrypts
        # and get_secret degrades to "" — "missing, re-prompt the operator".
        monkeypatch.setattr(encryption.settings, "SECRET_KEY", "a-completely-different-key")
        assert await ctx.get_secret("apiToken") == ""

    async def test_workspace_export_scrubs_encrypted_secret(self, db):
        ctx = build_context(KEY)
        await ctx.set_secret("apiToken", "must-not-leave-instance")
        # Plaintext setting for contrast: exports as-is (status quo).
        await ctx.set_setting("projectKey", "PROJ")

        row = (
            await db.execute(select(AppSettings).where(AppSettings.id == "default"))
        ).scalar_one()
        general, _email = strip_secrets(row.general_settings, {})
        assert f"ext.{KEY}.secret.apiToken" not in general
        assert general[f"ext.{KEY}.projectKey"] == "PROJ"
