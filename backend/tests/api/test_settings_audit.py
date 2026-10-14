"""Settings writes record ``admin.settings.updated`` — with every secret masked.

``_rows`` rolls the session back before reading, so only what the route
committed is seen; ids and headers are captured before the request.

DB-backed tests are skipped locally without PostgreSQL and run in CI; the
``setting_changes`` unit tests at the bottom need no database.
"""

from __future__ import annotations

import io

import pytest
from sqlalchemy import select

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.audit_log import AuditLogEntry
from tests.conftest import auth_headers, create_role, create_user


async def _rows(db) -> list[AuditLogEntry]:
    await db.rollback()
    result = await db.execute(
        select(AuditLogEntry)
        .where(AuditLogEntry.action == "admin.settings.updated")
        .order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars().all())


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin_id": admin.id, "h": auth_headers(admin), "viewer_h": auth_headers(viewer)}


def _setting(row, key: str, env) -> None:
    assert (row.category, row.outcome) == ("admin", "success")
    assert row.actor_user_id == env["admin_id"]
    assert row.actor_email == "admin@test.com"
    assert (row.target_type, row.target_id, row.target_label) == ("setting", key, key)


class TestSecretsAreMasked:
    async def test_smtp_password_is_masked(self, client, db, env):
        resp = await client.patch(
            "/api/v1/settings/email",
            json={"smtp_host": "smtp.example.com", "smtp_password": "hunter2-smtp"},
            headers=env["h"],
        )
        assert resp.status_code == 200

        [row] = await _rows(db)
        _setting(row, "email", env)
        assert row.details["smtp_host"] == {"old": None, "new": "smtp.example.com"}
        assert row.details["smtp_password"] == {"old": None, "new": "***"}
        assert "hunter2-smtp" not in str(row.details)
        assert "enc:" not in str(row.details)

    async def test_changing_the_smtp_password_masks_both_sides(self, client, db, env):
        for value in ("first-secret", "second-secret"):
            resp = await client.patch(
                "/api/v1/settings/email", json={"smtp_password": value}, headers=env["h"]
            )
            assert resp.status_code == 200

        rows = await _rows(db)
        assert rows[-1].details == {"smtp_password": {"old": "***", "new": "***"}}
        assert rows[0].details == {"smtp_password": {"old": None, "new": "***"}}
        stored = str([r.details for r in rows])
        assert "first-secret" not in stored and "second-secret" not in stored

    async def test_sso_client_secret_is_masked(self, client, db, env):
        resp = await client.patch(
            "/api/v1/settings/sso",
            json={
                "enabled": True,
                "provider": "microsoft",
                "client_id": "app-id",
                "client_secret": "sso-shhh-123",
            },
            headers=env["h"],
        )
        assert resp.status_code == 200

        [row] = await _rows(db)
        _setting(row, "sso", env)
        assert row.details["enabled"] == {"old": None, "new": True}
        assert row.details["client_id"] == {"old": None, "new": "app-id"}
        assert row.details["client_secret"] == {"old": None, "new": "***"}
        assert "sso-shhh-123" not in str(row.details)

    async def test_ai_api_key_is_masked(self, client, db, env):
        resp = await client.patch(
            "/api/v1/settings/ai",
            json={
                "enabled": True,
                "provider_type": "openai",
                "provider_url": "https://api.openai.com",
                "api_key": "sk-live-abc",
                "model": "gpt",
            },
            headers=env["h"],
        )
        assert resp.status_code == 200

        [row] = await _rows(db)
        _setting(row, "ai", env)
        assert row.details["apiKey"] == {"old": None, "new": "***"}
        assert row.details["model"] == {"old": None, "new": "gpt"}
        assert "sk-live-abc" not in str(row.details)


class TestEachKindOfSetting:
    async def test_scalar_toggle_reads_as_value(self, client, db, env):
        resp = await client.patch(
            "/api/v1/settings/bpm-enabled", json={"enabled": False}, headers=env["h"]
        )
        assert resp.status_code == 200

        [row] = await _rows(db)
        _setting(row, "bpm-enabled", env)
        assert row.details == {"value": {"old": True, "new": False}}

    async def test_unchanged_save_records_an_empty_diff(self, client, db, env):
        resp = await client.patch(
            "/api/v1/settings/currency", json={"currency": "USD"}, headers=env["h"]
        )
        assert resp.status_code == 200

        [row] = await _rows(db)
        _setting(row, "currency", env)
        assert row.details == {}

    async def test_audit_log_retention_change_is_itself_recorded(self, client, db, env):
        resp = await client.patch(
            "/api/v1/settings/audit-log-retention-days", json={"days": 90}, headers=env["h"]
        )
        assert resp.status_code == 200

        [row] = await _rows(db)
        _setting(row, "audit-log-retention-days", env)
        assert row.details == {"value": {"old": 365, "new": 90}}

    async def test_structured_setting_names_the_field(self, client, db, env):
        resp = await client.patch(
            "/api/v1/settings/navbar-style",
            json={"navbar_bg": "#000000", "navbar_fg": "#ffffff"},
            headers=env["h"],
        )
        assert resp.status_code == 200

        [row] = await _rows(db)
        _setting(row, "navbar-style", env)
        assert row.details == {"navbar_bg": {"old": "#1a1a2e", "new": "#000000"}}

    async def test_mcp_toggle_is_recorded(self, client, db, env):
        resp = await client.patch("/api/v1/settings/mcp", json={"enabled": True}, headers=env["h"])
        assert resp.status_code == 200

        [row] = await _rows(db)
        _setting(row, "mcp", env)
        assert row.details == {"enabled": {"old": None, "new": True}}

    async def test_logo_upload_and_reset_record_metadata_not_bytes(self, client, db, env):
        png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
        resp = await client.post(
            "/api/v1/settings/logo",
            files={"file": ("logo.png", io.BytesIO(png), "image/png")},
            headers=env["h"],
        )
        assert resp.status_code == 200
        resp = await client.delete("/api/v1/settings/logo", headers=env["h"])
        assert resp.status_code == 200

        upload, reset = await _rows(db)
        _setting(upload, "logo", env)
        assert upload.details == {
            "mime": {"old": None, "new": "image/png"},
            "size_bytes": {"old": None, "new": len(png)},
        }
        assert reset.details == {"mime": {"old": "image/png", "new": None}}


class TestNotRecorded:
    async def test_denied_write_records_nothing(self, client, db, env):
        resp = await client.patch(
            "/api/v1/settings/currency", json={"currency": "EUR"}, headers=env["viewer_h"]
        )
        assert resp.status_code == 403
        assert await _rows(db) == []

    async def test_rejected_input_records_nothing(self, client, db, env):
        resp = await client.patch(
            "/api/v1/settings/date-format", json={"date_format": "nonsense"}, headers=env["h"]
        )
        assert resp.status_code == 400
        assert await _rows(db) == []


class TestSettingChanges:
    """``setting_changes`` — the pure shape of a settings audit row."""

    def test_scalar(self):
        from app.api.v1.settings import setting_changes

        assert setting_changes("USD", "EUR") == {"value": {"old": "USD", "new": "EUR"}}
        assert setting_changes("USD", "USD") == {}
        assert setting_changes(["a", "b"], ["b", "a"]) == {
            "value": {"old": ["a", "b"], "new": ["b", "a"]}
        }

    def test_mapping_compares_key_by_key(self):
        from app.api.v1.settings import setting_changes

        assert setting_changes(
            {"host": "a", "port": 25, "gone": 1}, {"host": "b", "port": 25, "added": 2}
        ) == {
            "added": {"old": None, "new": 2},
            "gone": {"old": 1, "new": None},
            "host": {"old": "a", "new": "b"},
        }

    def test_mapping_against_nothing(self):
        from app.api.v1.settings import setting_changes

        assert setting_changes(None, {"enabled": True}) == {"enabled": {"old": None, "new": True}}
        assert setting_changes({"enabled": True}, None) == {"enabled": {"old": True, "new": None}}
