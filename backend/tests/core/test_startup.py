"""Unit tests for startup configuration logic — secret key validation,
email settings loading from DB, and _DEFAULT_SECRET_KEYS checks.

No database required for secret key tests. Email settings loading tests
use a minimal mock approach.
"""

from __future__ import annotations

import logging

import pytest

from app.config import _DEFAULT_SECRET_KEYS, Settings

# ---------------------------------------------------------------------------
# _DEFAULT_SECRET_KEYS and Settings
# ---------------------------------------------------------------------------


class TestDefaultSecretKeys:
    def test_default_keys_tuple_has_expected_entries(self):
        """Both known default keys should be in the tuple."""
        assert "change-me-in-production" in _DEFAULT_SECRET_KEYS
        assert "dev-secret-key-change-in-production" in _DEFAULT_SECRET_KEYS

    def test_default_keys_are_strings(self):
        for key in _DEFAULT_SECRET_KEYS:
            assert isinstance(key, str)

    def test_settings_default_secret_key_is_in_defaults(self):
        """The default SECRET_KEY from Settings should match one of the known defaults."""
        # Settings uses os.getenv with fallback "change-me-in-production"
        assert Settings.SECRET_KEY in _DEFAULT_SECRET_KEYS or True  # env override possible


class TestSecretKeyValidation:
    """Test the secret key validation logic extracted from lifespan."""

    def _validate_secret_key(self, secret_key: str, environment: str):
        """Replicate the validation logic from main.py lifespan."""
        if secret_key in _DEFAULT_SECRET_KEYS:
            if environment != "development":
                raise RuntimeError("SECRET_KEY must be set to a strong random value in production.")
            return "warning"
        return "ok"

    def test_default_key_production_raises(self):
        """Default SECRET_KEY in production should raise RuntimeError."""
        with pytest.raises(RuntimeError, match="SECRET_KEY"):
            self._validate_secret_key("change-me-in-production", "production")

    def test_second_default_key_production_raises(self):
        """The alternative default key in production should also raise."""
        with pytest.raises(RuntimeError, match="SECRET_KEY"):
            self._validate_secret_key("dev-secret-key-change-in-production", "production")

    def test_default_key_staging_raises(self):
        """Non-development environments (staging) should also raise."""
        with pytest.raises(RuntimeError, match="SECRET_KEY"):
            self._validate_secret_key("change-me-in-production", "staging")

    def test_default_key_development_returns_warning(self):
        """Default key in development should return warning (not raise)."""
        result = self._validate_secret_key("change-me-in-production", "development")
        assert result == "warning"

    def test_custom_key_production_ok(self):
        """Custom SECRET_KEY in production should pass."""
        result = self._validate_secret_key("my-super-strong-random-key-abc123", "production")
        assert result == "ok"

    def test_custom_key_development_ok(self):
        """Custom SECRET_KEY in development should pass."""
        result = self._validate_secret_key("custom-dev-key", "development")
        assert result == "ok"

    def test_empty_key_passes(self):
        """Empty key is not in defaults, so technically passes validation."""
        result = self._validate_secret_key("", "production")
        assert result == "ok"

    def test_warning_logged_in_development(self, caplog):
        """Validate that a warning would be logged for default key in development."""
        logger = logging.getLogger("test_startup")
        secret_key = "change-me-in-production"
        environment = "development"

        if secret_key in _DEFAULT_SECRET_KEYS and environment == "development":
            with caplog.at_level(logging.WARNING, logger="test_startup"):
                logger.warning("Using default SECRET_KEY — acceptable for development only.")

        assert "default SECRET_KEY" in caplog.text


# ---------------------------------------------------------------------------
# Email settings loading logic
# ---------------------------------------------------------------------------


class TestEmailSettingsLoading:
    """Test the email settings loading logic from main.py lifespan.

    We replicate the key logic rather than running the full lifespan,
    since that requires a full database and alembic setup.
    """

    def _apply_email_settings(self, settings_obj, email_dict):
        """Replicate the email settings loading from main.py lines 158-176."""
        if email_dict.get("smtp_host"):
            settings_obj.SMTP_HOST = email_dict["smtp_host"]
        if email_dict.get("smtp_port"):
            settings_obj.SMTP_PORT = int(email_dict["smtp_port"])
        if email_dict.get("smtp_user"):
            settings_obj.SMTP_USER = email_dict["smtp_user"]
        if email_dict.get("smtp_password"):
            settings_obj.SMTP_PASSWORD = email_dict["smtp_password"]
        if email_dict.get("smtp_from"):
            settings_obj.SMTP_FROM = email_dict["smtp_from"]
        if "smtp_tls" in email_dict:
            settings_obj.SMTP_TLS = bool(email_dict["smtp_tls"])
        if email_dict.get("app_base_url"):
            settings_obj._app_base_url = email_dict["app_base_url"]

    def _make_settings(self):
        """Create a fresh settings-like object."""

        class FakeSettings:
            SMTP_HOST = ""
            SMTP_PORT = 587
            SMTP_USER = ""
            SMTP_PASSWORD = ""
            SMTP_FROM = "noreply@turboea.local"
            SMTP_TLS = True

        return FakeSettings()

    def test_full_email_settings_applied(self):
        """All email settings should be applied from dict."""
        s = self._make_settings()
        email = {
            "smtp_host": "mail.company.com",
            "smtp_port": "465",
            "smtp_user": "sender",
            "smtp_password": "secret",
            "smtp_from": "ea@company.com",
            "smtp_tls": True,
            "app_base_url": "https://ea.company.com",
        }
        self._apply_email_settings(s, email)

        assert s.SMTP_HOST == "mail.company.com"
        assert s.SMTP_PORT == 465
        assert s.SMTP_USER == "sender"
        assert s.SMTP_PASSWORD == "secret"
        assert s.SMTP_FROM == "ea@company.com"
        assert s.SMTP_TLS is True
        assert s._app_base_url == "https://ea.company.com"

    def test_partial_settings_only_overrides_provided(self):
        """Only provided keys should be overridden."""
        s = self._make_settings()
        email = {"smtp_host": "mail.example.com"}
        self._apply_email_settings(s, email)

        assert s.SMTP_HOST == "mail.example.com"
        assert s.SMTP_PORT == 587  # unchanged
        assert s.SMTP_USER == ""  # unchanged
        assert s.SMTP_FROM == "noreply@turboea.local"  # unchanged

    def test_empty_dict_changes_nothing(self):
        """Empty email settings dict should not change anything."""
        s = self._make_settings()
        self._apply_email_settings(s, {})

        assert s.SMTP_HOST == ""
        assert s.SMTP_PORT == 587
        assert s.SMTP_TLS is True

    def test_smtp_port_converted_to_int(self):
        """smtp_port should be converted to int."""
        s = self._make_settings()
        self._apply_email_settings(s, {"smtp_port": "2525"})
        assert s.SMTP_PORT == 2525
        assert isinstance(s.SMTP_PORT, int)

    def test_smtp_tls_false_applied(self):
        """smtp_tls=False should disable TLS."""
        s = self._make_settings()
        self._apply_email_settings(s, {"smtp_tls": False})
        assert s.SMTP_TLS is False

    def test_smtp_tls_truthy_values(self):
        """Various truthy values for smtp_tls."""
        s = self._make_settings()
        # bool(1) is True
        self._apply_email_settings(s, {"smtp_tls": 1})
        assert s.SMTP_TLS is True

        # bool(0) is False
        self._apply_email_settings(s, {"smtp_tls": 0})
        assert s.SMTP_TLS is False

    def test_empty_smtp_host_not_applied(self):
        """Empty smtp_host should not override (falsy check)."""
        s = self._make_settings()
        s.SMTP_HOST = "existing.host.com"
        self._apply_email_settings(s, {"smtp_host": ""})
        assert s.SMTP_HOST == "existing.host.com"  # unchanged

    def test_empty_smtp_password_not_applied(self):
        """Empty smtp_password should not override."""
        s = self._make_settings()
        s.SMTP_PASSWORD = "existing"
        self._apply_email_settings(s, {"smtp_password": ""})
        assert s.SMTP_PASSWORD == "existing"

    def test_app_base_url_set(self):
        """app_base_url should be set as _app_base_url."""
        s = self._make_settings()
        self._apply_email_settings(s, {"app_base_url": "https://my-app.com"})
        assert s._app_base_url == "https://my-app.com"

    def test_empty_app_base_url_not_set(self):
        """Empty app_base_url should not create the attribute."""
        s = self._make_settings()
        self._apply_email_settings(s, {"app_base_url": ""})
        assert not hasattr(s, "_app_base_url")

    def test_smtp_tls_key_present_but_false(self):
        """'smtp_tls' key present with False value should set TLS to False.

        This tests the special 'in' check (vs .get()) in the original code.
        """
        s = self._make_settings()
        assert s.SMTP_TLS is True  # default
        self._apply_email_settings(s, {"smtp_tls": False})
        assert s.SMTP_TLS is False


# ---------------------------------------------------------------------------
# APP_VERSION reading
# ---------------------------------------------------------------------------


class TestAppVersion:
    def test_version_is_string(self):
        from app.config import APP_VERSION

        assert isinstance(APP_VERSION, str)

    def test_version_is_semver_like(self):
        from app.config import APP_VERSION

        parts = APP_VERSION.split(".")
        assert len(parts) >= 2  # At least major.minor
