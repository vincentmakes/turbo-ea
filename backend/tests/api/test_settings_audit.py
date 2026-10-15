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
from tests.conftest import auth_headers, create_card_type, create_role, create_user


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
        assert set(row.details) == {"changes"}
        assert row.details["changes"]["smtp_host"] == {"old": None, "new": "smtp.example.com"}
        assert row.details["changes"]["smtp_password"] == {"old": None, "new": "***"}
        assert "hunter2-smtp" not in str(row.details)
        assert "enc:" not in str(row.details)

    async def test_changing_the_smtp_password_masks_both_sides(self, client, db, env):
        for value in ("first-secret", "second-secret"):
            resp = await client.patch(
                "/api/v1/settings/email", json={"smtp_password": value}, headers=env["h"]
            )
            assert resp.status_code == 200

        rows = await _rows(db)
        assert rows[-1].details == {"changes": {"smtp_password": {"old": "***", "new": "***"}}}
        assert rows[0].details == {"changes": {"smtp_password": {"old": None, "new": "***"}}}
        stored = str([r.details for r in rows])
        assert "first-secret" not in stored and "second-secret" not in stored

    async def test_email_oauth_secrets_are_masked(self, client, db, env):
        resp = await client.patch(
            "/api/v1/settings/email",
            json={
                "method": "graph_api",
                "oauth_client_secret": "graph-shhh",
                "service_account_json": '{"private_key": "pk-shhh"}',
            },
            headers=env["h"],
        )
        assert resp.status_code == 200

        [row] = await _rows(db)
        changes = row.details["changes"]
        assert changes["method"] == {"old": None, "new": "graph_api"}
        assert changes["oauth_client_secret"] == {"old": None, "new": "***"}
        assert changes["service_account_json"] == {"old": None, "new": "***"}
        assert "shhh" not in str(row.details)

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
        changes = row.details["changes"]
        assert changes["enabled"] == {"old": None, "new": True}
        assert changes["client_id"] == {"old": None, "new": "app-id"}
        assert changes["client_secret"] == {"old": None, "new": "***"}
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
        # Stored camelCase keys are recorded snake_case; the key stays masked.
        assert row.details == {
            "changes": {
                "api_key": {"old": None, "new": "***"},
                "api_version": {"old": None, "new": ""},
                "enabled": {"old": None, "new": True},
                "enabled_types": {"old": None, "new": []},
                "model": {"old": None, "new": "gpt"},
                "portfolio_insights_enabled": {"old": None, "new": False},
                "provider_type": {"old": None, "new": "openai"},
                "provider_url": {"old": None, "new": "https://api.openai.com"},
                "search_provider": {"old": None, "new": "duckduckgo"},
                "search_url": {"old": None, "new": ""},
            }
        }
        assert "sk-live-abc" not in str(row.details)

    async def test_ai_enabled_types_are_recorded_by_label(self, client, db, env):
        await create_card_type(db, key="Application", label="Business App")
        await create_card_type(db, key="ITComponent", label="IT Component")
        body = {"enabled": True, "provider_type": "ollama", "provider_url": "http://o:1"}
        for types in (["Application"], ["ITComponent", "Gone", "Application"]):
            resp = await client.patch(
                "/api/v1/settings/ai", json={**body, "enabled_types": types}, headers=env["h"]
            )
            assert resp.status_code == 200, resp.text

        first, second = await _rows(db)
        assert first.details["changes"]["enabled_types"] == {"old": None, "new": ["Business App"]}
        # Only the list moved; a key with no card type is kept as it is.
        assert second.details == {
            "changes": {
                "enabled_types": {
                    "old": ["Business App"],
                    "new": ["IT Component", "Gone", "Business App"],
                }
            }
        }


class TestEachKindOfSetting:
    async def test_scalar_toggle_reads_as_enabled(self, client, db, env):
        resp = await client.patch(
            "/api/v1/settings/bpm-enabled", json={"enabled": False}, headers=env["h"]
        )
        assert resp.status_code == 200

        [row] = await _rows(db)
        _setting(row, "bpm-enabled", env)
        assert row.details == {"changes": {"enabled": {"old": True, "new": False}}}

    async def test_scalar_settings_are_named_by_their_field(self, client, db, env):
        writes = [
            ("date-format", {"date_format": "DD/MM/YYYY"}),
            ("registration", {"enabled": False}),
            ("principles-display", {"enabled": False}),
            ("bpm-row-order", {"row_order": ["core", "support", "management"]}),
            ("archive-retention-days", {"days": 7}),
        ]
        for slug, body in writes:
            resp = await client.patch(f"/api/v1/settings/{slug}", json=body, headers=env["h"])
            assert resp.status_code == 200, (slug, resp.text)

        rows = await _rows(db)
        assert [r.target_id for r in rows] == [slug for slug, _ in writes]
        assert [list(r.details["changes"]) for r in rows] == [
            ["date_format"],
            ["enabled"],
            ["show_principles_tab"],
            ["row_order"],
            ["retention_days"],
        ]
        assert rows[3].details["changes"]["row_order"] == {
            "old": ["management", "core", "support"],
            "new": ["core", "support", "management"],
        }

    async def test_unchanged_save_records_nothing(self, client, db, env):
        resp = await client.patch(
            "/api/v1/settings/currency", json={"currency": "USD"}, headers=env["h"]
        )
        assert resp.status_code == 200
        assert await _rows(db) == []

    async def test_unchanged_structured_save_records_nothing(self, client, db, env):
        resp = await client.patch(
            "/api/v1/settings/navbar-style",
            json={"navbar_bg": "#1a1a2e", "navbar_fg": "#ffffff"},
            headers=env["h"],
        )
        assert resp.status_code == 200
        assert await _rows(db) == []

    async def test_a_changed_save_after_a_no_op_is_recorded(self, client, db, env):
        """The no-op skip is per save, not a latch."""
        for currency in ("USD", "EUR"):
            resp = await client.patch(
                "/api/v1/settings/currency", json={"currency": currency}, headers=env["h"]
            )
            assert resp.status_code == 200

        [row] = await _rows(db)
        _setting(row, "currency", env)
        assert row.details == {"changes": {"currency": {"old": "USD", "new": "EUR"}}}

    async def test_audit_log_retention_change_is_itself_recorded(self, client, db, env):
        resp = await client.patch(
            "/api/v1/settings/audit-log-retention-days", json={"days": 90}, headers=env["h"]
        )
        assert resp.status_code == 200

        [row] = await _rows(db)
        _setting(row, "audit-log-retention-days", env)
        assert row.details == {"changes": {"retention_days": {"old": 365, "new": 90}}}

    async def test_structured_setting_names_the_field(self, client, db, env):
        resp = await client.patch(
            "/api/v1/settings/navbar-style",
            json={"navbar_bg": "#000000", "navbar_fg": "#ffffff"},
            headers=env["h"],
        )
        assert resp.status_code == 200

        [row] = await _rows(db)
        _setting(row, "navbar-style", env)
        assert row.details == {"changes": {"navbar_bg": {"old": "#1a1a2e", "new": "#000000"}}}

    async def test_mcp_toggle_is_recorded(self, client, db, env):
        resp = await client.patch("/api/v1/settings/mcp", json={"enabled": True}, headers=env["h"])
        assert resp.status_code == 200

        [row] = await _rows(db)
        _setting(row, "mcp", env)
        assert row.details == {"changes": {"enabled": {"old": None, "new": True}}}

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
            "items": [{"kind": "image.replaced", "image": "logo"}],
            "context": {"mime": "image/png", "size_bytes": len(png)},
        }
        _setting(reset, "logo", env)
        assert reset.details == {"items": [{"kind": "image.removed", "image": "logo"}]}

    async def test_favicon_reset_without_a_custom_one_records_nothing(self, client, db, env):
        resp = await client.delete("/api/v1/settings/favicon", headers=env["h"])
        assert resp.status_code == 200
        assert await _rows(db) == []

        png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8
        for _ in range(2):
            # A second upload over a custom favicon is still a replacement.
            resp = await client.post(
                "/api/v1/settings/favicon",
                files={"file": ("f.png", io.BytesIO(png), "image/png")},
                headers=env["h"],
            )
            assert resp.status_code == 200
        resp = await client.delete("/api/v1/settings/favicon", headers=env["h"])
        assert resp.status_code == 200

        first, second, reset = await _rows(db)
        _setting(first, "favicon", env)
        assert (
            first.details
            == second.details
            == {
                "items": [{"kind": "image.replaced", "image": "favicon"}],
                "context": {"mime": "image/png", "size_bytes": len(png)},
            }
        )
        assert reset.details == {"items": [{"kind": "image.removed", "image": "favicon"}]}

    async def test_enabled_locales_are_items_not_a_value(self, client, db, env):
        resp = await client.patch(
            "/api/v1/settings/enabled-locales",
            json={"locales": ["en", "de", "fr"]},
            headers=env["h"],
        )
        assert resp.status_code == 200
        resp = await client.patch(
            "/api/v1/settings/enabled-locales",
            json={"locales": ["en", "fr", "da"]},
            headers=env["h"],
        )
        assert resp.status_code == 200
        # The same list again is a no-op.
        resp = await client.patch(
            "/api/v1/settings/enabled-locales",
            json={"locales": ["en", "fr", "da"]},
            headers=env["h"],
        )
        assert resp.status_code == 200

        narrowed, swapped = await _rows(db)
        _setting(narrowed, "enabled-locales", env)
        assert narrowed.details == {
            "items": [
                {"kind": "locale.disabled", "locale": loc}
                for loc in ("es", "it", "pt", "zh", "ru", "da", "ar")
            ]
        }
        assert swapped.details == {
            "items": [
                {"kind": "locale.enabled", "locale": "da"},
                {"kind": "locale.disabled", "locale": "de"},
            ]
        }


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
    """``setting_changes`` — the pure shape of a settings audit row's ``changes``."""

    def test_scalar_is_named_by_its_field(self):
        from app.api.v1.settings import setting_changes

        assert setting_changes("currency", "USD", "EUR") == {
            "currency": {"old": "USD", "new": "EUR"}
        }
        assert setting_changes("currency", "USD", "USD") == {}
        assert setting_changes("bpm-row-order", ["a", "b"], ["b", "a"]) == {
            "row_order": {"old": ["a", "b"], "new": ["b", "a"]}
        }

    def test_mapping_compares_key_by_key_in_snake_case(self):
        from app.api.v1.settings import setting_changes

        assert setting_changes(
            "ai",
            {"host": "a", "providerUrl": "x", "port": 25, "gone": 1},
            {"host": "b", "providerUrl": "y", "port": 25, "addedKey": 2},
        ) == {
            "added_key": {"old": None, "new": 2},
            "gone": {"old": 1, "new": None},
            "host": {"old": "a", "new": "b"},
            "provider_url": {"old": "x", "new": "y"},
        }

    def test_mapping_against_nothing(self):
        from app.api.v1.settings import setting_changes

        assert setting_changes("mcp", None, {"enabled": True}) == {
            "enabled": {"old": None, "new": True}
        }
        assert setting_changes("mcp", {"enabled": True}, None) == {
            "enabled": {"old": True, "new": None}
        }


class TestSettingField:
    def test_explicit_names(self):
        from app.api.v1.settings import setting_field

        assert setting_field("date-format") == "date_format"
        assert setting_field("app-title") == "app_title"
        assert setting_field("fiscal-year-start") == "fiscal_year_start"
        assert setting_field("audit-log-retention-days") == "retention_days"
        assert setting_field("archive-retention-days") == "retention_days"
        assert setting_field("principles-display") == "show_principles_tab"
        assert setting_field("bpm-separate-approver") == "separate_approver"
        assert setting_field("registration") == "enabled"
        assert setting_field("currency") == "currency"

    def test_every_enabled_toggle_reads_as_enabled(self):
        from app.api.v1.settings import setting_field

        for slug in ("bpm-enabled", "turbolens-enabled", "update-check-enabled"):
            assert setting_field(slug) == "enabled"

    def test_an_unlisted_slug_is_snake_cased(self):
        from app.api.v1.settings import setting_field

        assert setting_field("some-new-thing") == "some_new_thing"


class TestSnakeCase:
    def test_camel_case_keys(self):
        from app.api.v1.settings import snake_case

        assert snake_case("providerUrl") == "provider_url"
        assert snake_case("portfolioInsightsEnabled") == "portfolio_insights_enabled"
        assert snake_case("apiKey") == "api_key"
        assert snake_case("smtp_host") == "smtp_host"
        assert snake_case("key2Value") == "key2_value"
        assert snake_case("enabled") == "enabled"
