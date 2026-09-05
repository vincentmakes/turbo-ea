"""Integration tests for notification preferences API endpoints.

Tests GET/PATCH /users/me/notification-preferences.
Requires a PostgreSQL test database.
"""

from __future__ import annotations

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_role,
    create_user,
)

# ---------------------------------------------------------------------------
# GET /users/me/notification-preferences
# ---------------------------------------------------------------------------


class TestGetNotificationPreferences:
    async def test_returns_default_preferences(self, client, db):
        """New user should get DEFAULT_NOTIFICATION_PREFERENCES."""
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")

        resp = await client.get(
            "/api/v1/users/me/notification-preferences",
            headers=auth_headers(user),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "in_app" in data
        assert "email" in data
        # Should match defaults
        assert data["in_app"]["card_updated"] is True
        assert data["email"]["card_updated"] is False

    async def test_requires_auth(self, client, db):
        """Endpoint requires authentication."""
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        resp = await client.get("/api/v1/users/me/notification-preferences")
        assert resp.status_code == 401

    async def test_returns_custom_preferences(self, client, db):
        """User with custom preferences should see those."""
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")
        user.notification_preferences = {
            "in_app": {"card_updated": False, "todo_assigned": True},
            "email": {"card_updated": True},
        }
        await db.flush()

        resp = await client.get(
            "/api/v1/users/me/notification-preferences",
            headers=auth_headers(user),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["in_app"]["card_updated"] is False
        assert data["email"]["card_updated"] is True

    async def test_different_users_see_own_prefs(self, client, db):
        """Each user sees their own preferences."""
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user1 = await create_user(db, email="user1@test.com", role="member")
        user2 = await create_user(db, email="user2@test.com", role="member")

        # Customize user1's prefs
        user1.notification_preferences = {
            "in_app": {"card_updated": False},
            "email": {},
        }
        await db.flush()

        # User1 sees their custom prefs
        resp1 = await client.get(
            "/api/v1/users/me/notification-preferences",
            headers=auth_headers(user1),
        )
        assert resp1.json()["in_app"]["card_updated"] is False

        # User2 sees default prefs
        resp2 = await client.get(
            "/api/v1/users/me/notification-preferences",
            headers=auth_headers(user2),
        )
        assert resp2.json()["in_app"]["card_updated"] is True


# ---------------------------------------------------------------------------
# PATCH /users/me/notification-preferences
# ---------------------------------------------------------------------------


class TestUpdateNotificationPreferences:
    async def test_partial_update_in_app(self, client, db):
        """Updating in_app should merge with existing prefs."""
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")

        resp = await client.patch(
            "/api/v1/users/me/notification-preferences",
            json={"in_app": {"card_updated": False}},
            headers=auth_headers(user),
        )
        assert resp.status_code == 200
        data = resp.json()
        # card_updated should be updated
        assert data["in_app"]["card_updated"] is False
        # Other in_app prefs should remain from defaults
        assert data["in_app"]["todo_assigned"] is True

    async def test_partial_update_email(self, client, db):
        """Updating email channel should merge with existing prefs."""
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")

        resp = await client.patch(
            "/api/v1/users/me/notification-preferences",
            json={"email": {"card_updated": True}},
            headers=auth_headers(user),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"]["card_updated"] is True
        # in_app should be unchanged from defaults
        assert data["in_app"]["card_updated"] is True

    async def test_update_both_channels(self, client, db):
        """Updating both in_app and email simultaneously."""
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")

        resp = await client.patch(
            "/api/v1/users/me/notification-preferences",
            json={
                "in_app": {"comment_added": False},
                "email": {"comment_added": True},
            },
            headers=auth_headers(user),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["in_app"]["comment_added"] is False
        assert data["email"]["comment_added"] is True

    async def test_preferences_persist(self, client, db):
        """Updated preferences should persist across requests."""
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")

        # Update
        await client.patch(
            "/api/v1/users/me/notification-preferences",
            json={"in_app": {"card_updated": False}},
            headers=auth_headers(user),
        )

        # Read back
        resp = await client.get(
            "/api/v1/users/me/notification-preferences",
            headers=auth_headers(user),
        )
        assert resp.json()["in_app"]["card_updated"] is False

    async def test_update_requires_auth(self, client, db):
        """PATCH requires authentication."""
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        resp = await client.patch(
            "/api/v1/users/me/notification-preferences",
            json={"in_app": {"card_updated": False}},
        )
        assert resp.status_code == 401

    async def test_empty_body_no_change(self, client, db):
        """Empty update body should not change preferences."""
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")

        resp = await client.patch(
            "/api/v1/users/me/notification-preferences",
            json={},
            headers=auth_headers(user),
        )
        assert resp.status_code == 200
        data = resp.json()
        # Should match defaults
        assert data["in_app"]["card_updated"] is True

    async def test_new_notification_type_accepted(self, client, db):
        """Preferences are extensible — new notif types are accepted."""
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")

        resp = await client.patch(
            "/api/v1/users/me/notification-preferences",
            json={"in_app": {"custom_event": False}},
            headers=auth_headers(user),
        )
        assert resp.status_code == 200
        assert resp.json()["in_app"]["custom_event"] is False

    async def test_viewer_can_manage_own_preferences(self, client, db):
        """Viewers should also be able to manage their own notification prefs."""
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        viewer = await create_user(db, role="viewer")

        resp = await client.patch(
            "/api/v1/users/me/notification-preferences",
            json={"email": {"todo_assigned": False}},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 200
        assert resp.json()["email"]["todo_assigned"] is False


# ---------------------------------------------------------------------------
# Server-driven type list
# ---------------------------------------------------------------------------


class TestTypeList:
    async def test_get_serves_the_rows_the_dialog_renders(self, client, db):
        """The dialog no longer hardcodes its rows, so the GET must carry them."""
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")

        resp = await client.get(
            "/api/v1/users/me/notification-preferences", headers=auth_headers(user)
        )
        assert resp.status_code == 200
        types = resp.json()["types"]
        keys = {t["key"] for t in types}

        # The four families that used to be emitted but unconfigurable.
        assert {
            "adr_sign_requested",
            "risk_assigned",
            "process_flow_approved",
            "soaw_rejected",
        } <= keys
        # Security alerts stay out of the dialog: there must be no switch to
        # mute a rescue-access record with.
        assert "ops_rescue_access" not in keys

    async def test_flags_travel_with_each_type(self, client, db):
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")

        resp = await client.get(
            "/api/v1/users/me/notification-preferences", headers=auth_headers(user)
        )
        by_key = {t["key"]: t for t in resp.json()["types"]}
        assert by_key["app_updated"]["in_app_only"] is True
        assert by_key["survey_request"]["email_locked"] is True
        assert by_key["card_updated"]["email_default"] is False
        assert by_key["todo_assigned"]["email_default"] is True


# ---------------------------------------------------------------------------
# Extension-delivered channels
# ---------------------------------------------------------------------------


class TestExtensionChannels:
    async def test_no_extensions_means_no_channels(self, client, db):
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")

        resp = await client.get(
            "/api/v1/users/me/notification-preferences", headers=auth_headers(user)
        )
        assert resp.json()["available_channels"] == []

    async def test_patch_merges_a_live_channel(self, client, db, monkeypatch):
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")
        monkeypatch.setattr(
            "app.services.extensions.notification_channels.registered_channel_keys",
            lambda: ["chat"],
        )

        resp = await client.patch(
            "/api/v1/users/me/notification-preferences",
            json={"channels": {"chat": {"todo_assigned": True}}},
            headers=auth_headers(user),
        )
        assert resp.status_code == 200
        assert resp.json()["channels"]["chat"]["todo_assigned"] is True

        # A second PATCH merges rather than replacing.
        resp = await client.patch(
            "/api/v1/users/me/notification-preferences",
            json={"channels": {"chat": {"comment_added": True}}},
            headers=auth_headers(user),
        )
        chat = resp.json()["channels"]["chat"]
        assert chat == {"todo_assigned": True, "comment_added": True}

    async def test_unknown_channel_is_ignored_not_rejected(self, client, db):
        """The dialog PATCHes the whole object; a de-registered channel between
        the GET and the PATCH must not block the user saving anything else."""
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")

        resp = await client.patch(
            "/api/v1/users/me/notification-preferences",
            json={
                "in_app": {"card_updated": False},
                "channels": {"gone-away": {"todo_assigned": True}},
            },
            headers=auth_headers(user),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["in_app"]["card_updated"] is False
        assert "gone-away" not in body.get("channels", {})

    async def test_lapse_preserves_stored_opt_ins(self, client, db, monkeypatch):
        """A license lapse pauses delivery; it must never lose the opt-in."""
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")
        monkeypatch.setattr(
            "app.services.extensions.notification_channels.registered_channel_keys",
            lambda: ["chat"],
        )
        await client.patch(
            "/api/v1/users/me/notification-preferences",
            json={"channels": {"chat": {"todo_assigned": True}}},
            headers=auth_headers(user),
        )

        # Channel de-registers (disabled / unlicensed / pending restart).
        monkeypatch.setattr(
            "app.services.extensions.notification_channels.registered_channel_keys",
            lambda: [],
        )
        monkeypatch.setattr(
            "app.services.extensions.notification_channels.channel_descriptors",
            lambda: [],
        )
        resp = await client.get(
            "/api/v1/users/me/notification-preferences", headers=auth_headers(user)
        )
        body = resp.json()
        assert body["available_channels"] == []
        assert body["channels"]["chat"]["todo_assigned"] is True

    async def test_unknown_type_inside_a_live_channel_is_dropped(self, client, db, monkeypatch):
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")
        monkeypatch.setattr(
            "app.services.extensions.notification_channels.registered_channel_keys",
            lambda: ["chat"],
        )

        resp = await client.patch(
            "/api/v1/users/me/notification-preferences",
            json={"channels": {"chat": {"todo_assigned": True, "made_up": True}}},
            headers=auth_headers(user),
        )
        assert resp.json()["channels"]["chat"] == {"todo_assigned": True}


class TestDefaultsAreNotShared:
    async def test_patching_one_user_does_not_edit_the_module_default(self, client, db):
        """The column default used to share its inner dicts with the constant."""
        from app.models.user import DEFAULT_NOTIFICATION_PREFERENCES

        before = DEFAULT_NOTIFICATION_PREFERENCES["in_app"]["card_updated"]
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")
        await client.patch(
            "/api/v1/users/me/notification-preferences",
            json={"in_app": {"card_updated": not before}},
            headers=auth_headers(user),
        )
        assert DEFAULT_NOTIFICATION_PREFERENCES["in_app"]["card_updated"] is before


# ---------------------------------------------------------------------------
# SDK 1.11 — rows an extension declares in its manifest
# ---------------------------------------------------------------------------

EXT = "sample-rules"
EXT_TYPE = "ext.sample-rules.notice"


def _load_extension(*, licensed: bool = True) -> None:
    from datetime import datetime, timedelta, timezone

    from app.services.extensions import notification_types as nt
    from app.services.extensions.license import Entitlement, LicenseDocument
    from app.services.extensions.registry import ExtensionInfo, extension_registry

    manifest = {
        "grants": ["core.notifications.send"],
        "notifications": {
            "types": [
                {
                    "key": EXT_TYPE,
                    "label": "Rule notices",
                    "translations": {"de": "Regelhinweise"},
                    "in_app_default": True,
                    "email_default": False,
                }
            ]
        },
    }
    extension_registry.clear()
    nt.reset_types()
    extension_registry.load_installed(
        [
            ExtensionInfo(
                key=EXT,
                name="Sample Rules",
                version="1.0.0",
                status="installed",
                enabled=True,
                manifest=manifest,
            )
        ]
    )
    if licensed:
        extension_registry.set_license(
            LicenseDocument(
                licensee="ACME",
                customer_id="cus_1",
                issued_at=datetime.now(timezone.utc) - timedelta(days=1),
                grace_days=30,
                entitlements=[Entitlement(extension_key=EXT, expires_at=None)],
            )
        )
    nt.register_manifest_types(EXT, manifest)


def _unload_extension() -> None:
    from app.services.extensions import notification_types as nt
    from app.services.extensions.registry import extension_registry

    extension_registry.clear()
    nt.reset_types()


class TestExtensionDeclaredTypes:
    async def test_extension_types_are_appended_with_label_and_owner(self, client, db):
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")
        _load_extension()
        try:
            resp = await client.get(
                "/api/v1/users/me/notification-preferences", headers=auth_headers(user)
            )
        finally:
            _unload_extension()
        assert resp.status_code == 200
        rows = resp.json()["types"]
        assert rows[-1] == {
            "key": EXT_TYPE,
            "in_app_default": True,
            "email_default": False,
            "in_app_only": False,
            "email_locked": False,
            "label": "Rule notices",
            "extension_key": EXT,
        }
        # Core's rows are untouched and still label-less (the frontend owns
        # their i18n); only the extension row carries a label.
        assert all("label" not in r for r in rows[:-1])
        assert any(r["key"] == "extension_notice" for r in rows[:-1])

    async def test_extension_type_label_follows_the_user_locale(self, client, db):
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")
        user.locale = "de"
        await db.flush()
        _load_extension()
        try:
            resp = await client.get(
                "/api/v1/users/me/notification-preferences", headers=auth_headers(user)
            )
        finally:
            _unload_extension()
        assert resp.json()["types"][-1]["label"] == "Regelhinweise"

    async def test_lapsed_extension_drops_the_row_but_keeps_the_stored_choice(self, client, db):
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")
        _load_extension()
        try:
            resp = await client.patch(
                "/api/v1/users/me/notification-preferences",
                json={"in_app": {EXT_TYPE: False}},
                headers=auth_headers(user),
            )
            assert resp.json()["in_app"][EXT_TYPE] is False
            _load_extension(licensed=False)
            resp = await client.get(
                "/api/v1/users/me/notification-preferences", headers=auth_headers(user)
            )
        finally:
            _unload_extension()
        data = resp.json()
        assert EXT_TYPE not in [r["key"] for r in data["types"]]
        assert data["in_app"][EXT_TYPE] is False

    async def test_extension_type_inside_a_live_channel_is_kept(self, client, db, monkeypatch):
        """Mirror of ``test_unknown_type_inside_a_live_channel_is_dropped``: a
        declared, live type is a known type for the channel matrix too."""
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")
        monkeypatch.setattr(
            "app.services.extensions.notification_channels.registered_channel_keys",
            lambda: ["chat"],
        )
        _load_extension()
        try:
            resp = await client.patch(
                "/api/v1/users/me/notification-preferences",
                json={"channels": {"chat": {EXT_TYPE: True, "ext.nobody.x": True}}},
                headers=auth_headers(user),
            )
        finally:
            _unload_extension()
        assert resp.status_code == 200
        assert resp.json()["channels"]["chat"] == {EXT_TYPE: True}
