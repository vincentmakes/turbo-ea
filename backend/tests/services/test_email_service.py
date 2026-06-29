"""Unit tests for the email service facade + SMTP basic backend.

These tests do NOT require a database — they mock smtplib and set attributes on
the real settings singleton (shared across the facade and the backends).
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from app.config import settings as real_settings
from app.services.email_service import send_email, send_notification_email

# The smtplib reference the SMTP backends actually use.
SMTP_PATCH_TARGET = "app.services.email_backends.smtp.smtplib.SMTP"


def _configure_smtp_basic(monkeypatch, **overrides):
    """Point the runtime settings at an smtp_basic transport."""
    defaults = {
        "EMAIL_METHOD": "smtp_basic",
        "SMTP_HOST": "smtp.example.com",
        "SMTP_PORT": 587,
        "SMTP_TLS": True,
        "SMTP_USER": "user",
        "SMTP_PASSWORD": "pass",
        "SMTP_FROM": "noreply@example.com",
        "APP_TITLE": "Turbo EA",
    }
    defaults.update(overrides)
    for key, value in defaults.items():
        monkeypatch.setattr(real_settings, key, value, raising=False)


# ---------------------------------------------------------------------------
# send_email
# ---------------------------------------------------------------------------


class TestSendEmail:
    async def test_returns_false_when_not_configured(self, monkeypatch):
        """When the active backend is not configured, send_email should no-op."""
        _configure_smtp_basic(monkeypatch, SMTP_HOST="")
        result = await send_email("user@example.com", "Subject", "<p>Body</p>")
        assert result is False

    async def test_calls_smtp_when_configured(self, monkeypatch):
        """When SMTP is configured, the SMTP backend should be invoked."""
        _configure_smtp_basic(monkeypatch)
        mock_smtp_instance = MagicMock()
        with patch(SMTP_PATCH_TARGET, return_value=mock_smtp_instance) as mock_smtp_cls:
            result = await send_email(
                "user@example.com",
                "Test Subject",
                "<p>Body</p>",
                "Body",
            )

        assert result is True
        mock_smtp_cls.assert_called_once_with("smtp.example.com", 587)
        mock_smtp_instance.starttls.assert_called_once()
        mock_smtp_instance.login.assert_called_once_with("user", "pass")
        mock_smtp_instance.sendmail.assert_called_once()
        mock_smtp_instance.quit.assert_called_once()

    async def test_no_tls_when_disabled(self, monkeypatch):
        """When SMTP_TLS is False, starttls should not be called."""
        _configure_smtp_basic(
            monkeypatch, SMTP_PORT=25, SMTP_TLS=False, SMTP_USER="", SMTP_PASSWORD=""
        )
        mock_smtp_instance = MagicMock()
        with patch(SMTP_PATCH_TARGET, return_value=mock_smtp_instance):
            await send_email("user@example.com", "Subject", "<p>Body</p>")

        mock_smtp_instance.starttls.assert_not_called()
        mock_smtp_instance.login.assert_not_called()


# ---------------------------------------------------------------------------
# send_notification_email
# ---------------------------------------------------------------------------


class TestSendNotificationEmail:
    async def test_returns_false_when_not_configured(self, monkeypatch):
        _configure_smtp_basic(monkeypatch, SMTP_HOST="")
        result = await send_notification_email(
            to="user@example.com",
            title="Test Title",
            message="Test message",
        )
        assert result is False

    async def test_generates_html_with_title(self, monkeypatch):
        """Verify the email body contains the title text."""
        _configure_smtp_basic(
            monkeypatch, SMTP_PORT=587, SMTP_TLS=False, SMTP_USER="", SMTP_PASSWORD=""
        )
        captured_args = {}
        mock_smtp_instance = MagicMock()
        mock_smtp_instance.sendmail = lambda f, t, m: captured_args.update({"msg": m})

        with patch(SMTP_PATCH_TARGET, return_value=mock_smtp_instance):
            result = await send_notification_email(
                to="user@example.com",
                title="Card Updated",
                message="Your card was changed.",
                link="/cards/123",
            )

        assert result is True
        assert "Card Updated" in captured_args["msg"]

    async def test_subject_has_prefix(self, monkeypatch):
        """Subject line should start with [Turbo EA]."""
        _configure_smtp_basic(
            monkeypatch, SMTP_PORT=587, SMTP_TLS=False, SMTP_USER="", SMTP_PASSWORD=""
        )
        captured_args = {}
        mock_smtp_instance = MagicMock()
        mock_smtp_instance.sendmail = lambda f, t, m: captured_args.update({"msg": m})

        with patch(SMTP_PATCH_TARGET, return_value=mock_smtp_instance):
            await send_notification_email(
                to="user@example.com",
                title="Hello",
                message="Test",
            )

        assert "[Turbo EA] Hello" in captured_args["msg"]
