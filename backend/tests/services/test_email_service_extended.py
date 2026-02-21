"""Extended email service tests — HTML escaping, link construction, edge cases.

No database required. All tests mock smtplib and settings.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from app.services.email_service import send_email, send_notification_email

# ---------------------------------------------------------------------------
# HTML escaping (security)
# ---------------------------------------------------------------------------


class TestHtmlEscaping:
    async def test_title_with_script_tag_escaped(self):
        """XSS in title should be escaped."""
        captured = {}
        mock_smtp = MagicMock()
        mock_smtp.sendmail = lambda f, t, m: captured.update({"msg": m})

        with (
            patch("app.services.email_service.settings") as s,
            patch("app.services.email_service.smtplib.SMTP", return_value=mock_smtp),
        ):
            s.SMTP_HOST = "smtp.test"
            s.SMTP_PORT = 25
            s.SMTP_TLS = False
            s.SMTP_USER = ""
            s.SMTP_PASSWORD = ""
            s.SMTP_FROM = "test@test.com"

            await send_notification_email(
                to="user@test.com",
                title="<script>alert('xss')</script>",
                message="Safe message",
            )

        assert "<script>" not in captured["msg"]
        assert "&lt;script&gt;" in captured["msg"]

    async def test_message_with_html_injection_escaped(self):
        """HTML tags in message body should be escaped."""
        captured = {}
        mock_smtp = MagicMock()
        mock_smtp.sendmail = lambda f, t, m: captured.update({"msg": m})

        with (
            patch("app.services.email_service.settings") as s,
            patch("app.services.email_service.smtplib.SMTP", return_value=mock_smtp),
        ):
            s.SMTP_HOST = "smtp.test"
            s.SMTP_PORT = 25
            s.SMTP_TLS = False
            s.SMTP_USER = ""
            s.SMTP_PASSWORD = ""
            s.SMTP_FROM = "test@test.com"

            await send_notification_email(
                to="user@test.com",
                title="Normal Title",
                message='<img src=x onerror="steal()">',
            )

        assert "onerror" not in captured["msg"].split("&")[0] if "&" in captured["msg"] else True
        assert "&lt;img" in captured["msg"]


# ---------------------------------------------------------------------------
# Link construction
# ---------------------------------------------------------------------------


class TestLinkConstruction:
    async def test_link_uses_app_base_url(self):
        """When _app_base_url is set, link should use it."""
        captured = {}
        mock_smtp = MagicMock()
        mock_smtp.sendmail = lambda f, t, m: captured.update({"msg": m})

        with (
            patch("app.services.email_service.settings") as s,
            patch("app.services.email_service.smtplib.SMTP", return_value=mock_smtp),
        ):
            s.SMTP_HOST = "smtp.test"
            s.SMTP_PORT = 25
            s.SMTP_TLS = False
            s.SMTP_USER = ""
            s.SMTP_PASSWORD = ""
            s.SMTP_FROM = "test@test.com"
            s._app_base_url = "https://my-ea.company.com"

            await send_notification_email(
                to="user@test.com",
                title="Link Test",
                message="Check it",
                link="/cards/abc",
            )

        assert "https://my-ea.company.com/cards/abc" in captured["msg"]

    async def test_link_defaults_to_localhost(self):
        """Without _app_base_url, link should default to localhost:8920."""
        captured = {}
        mock_smtp = MagicMock()
        mock_smtp.sendmail = lambda f, t, m: captured.update({"msg": m})

        with (
            patch("app.services.email_service.settings") as s,
            patch("app.services.email_service.smtplib.SMTP", return_value=mock_smtp),
        ):
            s.SMTP_HOST = "smtp.test"
            s.SMTP_PORT = 25
            s.SMTP_TLS = False
            s.SMTP_USER = ""
            s.SMTP_PASSWORD = ""
            s.SMTP_FROM = "test@test.com"
            # Simulate missing _app_base_url attribute
            del s._app_base_url

            await send_notification_email(
                to="user@test.com",
                title="Default Link",
                message="Here",
                link="/cards/xyz",
            )

        assert "http://localhost:8920/cards/xyz" in captured["msg"]

    async def test_no_link_no_button(self):
        """When link is None, no View button HTML should appear."""
        captured = {}
        mock_smtp = MagicMock()
        mock_smtp.sendmail = lambda f, t, m: captured.update({"msg": m})

        with (
            patch("app.services.email_service.settings") as s,
            patch("app.services.email_service.smtplib.SMTP", return_value=mock_smtp),
        ):
            s.SMTP_HOST = "smtp.test"
            s.SMTP_PORT = 25
            s.SMTP_TLS = False
            s.SMTP_USER = ""
            s.SMTP_PASSWORD = ""
            s.SMTP_FROM = "test@test.com"

            await send_notification_email(
                to="user@test.com",
                title="No Link",
                message="Just text",
                link=None,
            )

        assert "View in Turbo EA" not in captured["msg"]


# ---------------------------------------------------------------------------
# send_email edge cases
# ---------------------------------------------------------------------------


class TestSendEmailEdgeCases:
    async def test_empty_body_text_uses_html_fallback(self):
        """When body_text is empty, body_html is used as plain text fallback."""
        captured = {}
        mock_smtp = MagicMock()
        mock_smtp.sendmail = lambda f, t, m: captured.update({"msg": m})

        with (
            patch("app.services.email_service.settings") as s,
            patch("app.services.email_service.smtplib.SMTP", return_value=mock_smtp),
        ):
            s.SMTP_HOST = "smtp.test"
            s.SMTP_PORT = 25
            s.SMTP_TLS = False
            s.SMTP_USER = ""
            s.SMTP_PASSWORD = ""
            s.SMTP_FROM = "test@test.com"

            result = await send_email(
                "user@test.com",
                "Subject",
                "<p>HTML body</p>",
                "",  # empty body_text
            )

        assert result is True
        # The fallback means the HTML body appears as plain text part too
        assert "<p>HTML body</p>" in captured["msg"]

    async def test_smtp_exception_does_not_raise(self):
        """SMTP connection failure should be logged, not raised."""
        with (
            patch("app.services.email_service.settings") as s,
            patch(
                "app.services.email_service.smtplib.SMTP",
                side_effect=ConnectionRefusedError("SMTP down"),
            ),
        ):
            s.SMTP_HOST = "smtp.test"
            s.SMTP_PORT = 25
            s.SMTP_TLS = False
            s.SMTP_USER = ""
            s.SMTP_PASSWORD = ""
            s.SMTP_FROM = "test@test.com"

            # Should not raise
            result = await send_email(
                "user@test.com",
                "Test",
                "<p>Test</p>",
                "Test",
            )

        # send_email returns True because it dispatches to thread; _send_sync catches
        assert result is True

    async def test_no_login_when_smtp_user_empty(self):
        """When SMTP_USER is empty, login should not be called."""
        mock_smtp = MagicMock()
        with (
            patch("app.services.email_service.settings") as s,
            patch("app.services.email_service.smtplib.SMTP", return_value=mock_smtp),
        ):
            s.SMTP_HOST = "smtp.test"
            s.SMTP_PORT = 25
            s.SMTP_TLS = True
            s.SMTP_USER = ""
            s.SMTP_PASSWORD = ""
            s.SMTP_FROM = "test@test.com"

            await send_email("user@test.com", "Test", "<p>Test</p>", "Test")

        mock_smtp.starttls.assert_called_once()
        mock_smtp.login.assert_not_called()
