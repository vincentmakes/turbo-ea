"""Unit tests for the SMTP email service.

These tests do NOT require a database — they mock smtplib and settings.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from app.services.email_service import send_email, send_notification_email

# ---------------------------------------------------------------------------
# send_email
# ---------------------------------------------------------------------------


class TestSendEmail:
    async def test_returns_false_when_not_configured(self):
        """When SMTP_HOST is empty, send_email should no-op."""
        with patch("app.services.email_service.settings") as mock_settings:
            mock_settings.SMTP_HOST = ""
            result = await send_email("user@example.com", "Subject", "<p>Body</p>")
        assert result is False

    async def test_calls_smtp_when_configured(self):
        """When SMTP is configured, _send_sync should be invoked."""
        mock_smtp_instance = MagicMock()
        with (
            patch("app.services.email_service.settings") as mock_settings,
            patch(
                "app.services.email_service.smtplib.SMTP",
                return_value=mock_smtp_instance,
            ) as mock_smtp_cls,
        ):
            mock_settings.SMTP_HOST = "smtp.example.com"
            mock_settings.SMTP_PORT = 587
            mock_settings.SMTP_TLS = True
            mock_settings.SMTP_USER = "user"
            mock_settings.SMTP_PASSWORD = "pass"
            mock_settings.SMTP_FROM = "noreply@example.com"

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

    async def test_no_tls_when_disabled(self):
        """When SMTP_TLS is False, starttls should not be called."""
        mock_smtp_instance = MagicMock()
        with (
            patch("app.services.email_service.settings") as mock_settings,
            patch(
                "app.services.email_service.smtplib.SMTP",
                return_value=mock_smtp_instance,
            ),
        ):
            mock_settings.SMTP_HOST = "smtp.example.com"
            mock_settings.SMTP_PORT = 25
            mock_settings.SMTP_TLS = False
            mock_settings.SMTP_USER = ""
            mock_settings.SMTP_PASSWORD = ""
            mock_settings.SMTP_FROM = "noreply@example.com"

            await send_email(
                "user@example.com",
                "Subject",
                "<p>Body</p>",
            )

        mock_smtp_instance.starttls.assert_not_called()
        mock_smtp_instance.login.assert_not_called()


# ---------------------------------------------------------------------------
# send_notification_email
# ---------------------------------------------------------------------------


class TestSendNotificationEmail:
    async def test_returns_false_when_not_configured(self):
        with patch("app.services.email_service.settings") as mock_settings:
            mock_settings.SMTP_HOST = ""
            result = await send_notification_email(
                to="user@example.com",
                title="Test Title",
                message="Test message",
            )
        assert result is False

    async def test_generates_html_with_title(self):
        """Verify the email body contains the title text."""
        captured_args = {}
        mock_smtp_instance = MagicMock()

        def capture_sendmail(from_addr, to_addrs, msg_str):
            captured_args["msg"] = msg_str

        mock_smtp_instance.sendmail = capture_sendmail

        with (
            patch("app.services.email_service.settings") as mock_settings,
            patch(
                "app.services.email_service.smtplib.SMTP",
                return_value=mock_smtp_instance,
            ),
        ):
            mock_settings.SMTP_HOST = "smtp.example.com"
            mock_settings.SMTP_PORT = 587
            mock_settings.SMTP_TLS = False
            mock_settings.SMTP_USER = ""
            mock_settings.SMTP_PASSWORD = ""
            mock_settings.SMTP_FROM = "noreply@example.com"

            result = await send_notification_email(
                to="user@example.com",
                title="Card Updated",
                message="Your card was changed.",
                link="/cards/123",
            )

        assert result is True
        assert "Card Updated" in captured_args["msg"]

    async def test_subject_has_prefix(self):
        """Subject line should start with [Turbo EA]."""
        captured_args = {}
        mock_smtp_instance = MagicMock()

        def capture_sendmail(from_addr, to_addrs, msg_str):
            captured_args["msg"] = msg_str

        mock_smtp_instance.sendmail = capture_sendmail

        with (
            patch("app.services.email_service.settings") as mock_settings,
            patch(
                "app.services.email_service.smtplib.SMTP",
                return_value=mock_smtp_instance,
            ),
        ):
            mock_settings.SMTP_HOST = "smtp.example.com"
            mock_settings.SMTP_PORT = 587
            mock_settings.SMTP_TLS = False
            mock_settings.SMTP_USER = ""
            mock_settings.SMTP_PASSWORD = ""
            mock_settings.SMTP_FROM = "noreply@example.com"

            await send_notification_email(
                to="user@example.com",
                title="Hello",
                message="Test",
            )

        assert "[Turbo EA] Hello" in captured_args["msg"]
