"""Extended email service tests — HTML escaping, link construction, edge cases.

No database required. Tests mock smtplib and set attributes on the real
settings singleton (shared across the facade and the SMTP backend).
"""

from __future__ import annotations

from email import message_from_string
from unittest.mock import MagicMock, patch

import pytest

from app.config import settings as real_settings
from app.services.email_service import send_email, send_notification_email

SMTP_PATCH_TARGET = "app.services.email_backends.smtp.smtplib.SMTP"


def _configure(monkeypatch, **overrides):
    defaults = {
        "EMAIL_METHOD": "smtp_basic",
        "SMTP_HOST": "smtp.test",
        "SMTP_PORT": 25,
        "SMTP_TLS": False,
        "SMTP_USER": "",
        "SMTP_PASSWORD": "",
        "SMTP_FROM": "test@test.com",
        "APP_TITLE": "Turbo EA",
        "_app_base_url": "",
    }
    defaults.update(overrides)
    for key, value in defaults.items():
        monkeypatch.setattr(real_settings, key, value, raising=False)


def _capturing_smtp():
    captured = {}
    mock_smtp = MagicMock()
    mock_smtp.sendmail = lambda f, t, m: captured.update({"msg": m})
    return mock_smtp, captured


def _html_part(raw_msg: str) -> str:
    """Pull the text/html alternative out of a MIME-encoded message string."""
    msg = message_from_string(raw_msg)
    for part in msg.walk():
        if part.get_content_type() == "text/html":
            return part.get_payload(decode=True).decode()
    raise AssertionError("no text/html part found")


# ---------------------------------------------------------------------------
# HTML escaping (security)
# ---------------------------------------------------------------------------


class TestHtmlEscaping:
    async def test_title_with_script_tag_escaped(self, monkeypatch):
        """XSS in title should be escaped."""
        _configure(monkeypatch)
        mock_smtp, captured = _capturing_smtp()
        with patch(SMTP_PATCH_TARGET, return_value=mock_smtp):
            await send_notification_email(
                to="user@test.com",
                title="<script>alert('xss')</script>",
                message="Safe message",
            )

        html_body = _html_part(captured["msg"])
        assert "<script>" not in html_body
        assert "&lt;script&gt;" in html_body

    async def test_message_with_html_injection_escaped(self, monkeypatch):
        """HTML tags in message body should be escaped."""
        _configure(monkeypatch)
        mock_smtp, captured = _capturing_smtp()
        with patch(SMTP_PATCH_TARGET, return_value=mock_smtp):
            await send_notification_email(
                to="user@test.com",
                title="Normal Title",
                message='<img src=x onerror="steal()">',
            )

        html_body = _html_part(captured["msg"])
        assert "<img" not in html_body
        assert "&lt;img" in html_body


# ---------------------------------------------------------------------------
# Link construction
# ---------------------------------------------------------------------------


class TestLinkConstruction:
    async def test_link_uses_app_base_url(self, monkeypatch):
        """When _app_base_url is set, link should use it."""
        _configure(monkeypatch, _app_base_url="https://my-ea.company.com")
        mock_smtp, captured = _capturing_smtp()
        with patch(SMTP_PATCH_TARGET, return_value=mock_smtp):
            await send_notification_email(
                to="user@test.com",
                title="Link Test",
                message="Check it",
                link="/cards/abc",
            )

        assert "https://my-ea.company.com/cards/abc" in captured["msg"]

    async def test_link_defaults_to_localhost(self, monkeypatch):
        """Without _app_base_url, link should default to localhost:8920."""
        _configure(monkeypatch, _app_base_url="")
        mock_smtp, captured = _capturing_smtp()
        with patch(SMTP_PATCH_TARGET, return_value=mock_smtp):
            await send_notification_email(
                to="user@test.com",
                title="Default Link",
                message="Here",
                link="/cards/xyz",
            )

        assert "http://localhost:8920/cards/xyz" in captured["msg"]

    async def test_no_link_no_button(self, monkeypatch):
        """When link is None, no View button HTML should appear."""
        _configure(monkeypatch)
        mock_smtp, captured = _capturing_smtp()
        with patch(SMTP_PATCH_TARGET, return_value=mock_smtp):
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
    async def test_empty_body_text_uses_html_fallback(self, monkeypatch):
        """When body_text is empty, body_html is used as plain text fallback."""
        _configure(monkeypatch)
        mock_smtp, captured = _capturing_smtp()
        with patch(SMTP_PATCH_TARGET, return_value=mock_smtp):
            result = await send_email(
                "user@test.com",
                "Subject",
                "<p>HTML body</p>",
                "",  # empty body_text
            )

        assert result is True
        assert "<p>HTML body</p>" in captured["msg"]

    async def test_smtp_exception_propagates(self, monkeypatch):
        """SMTP connection failure must propagate so user-facing callers can
        surface the error (e.g. the user-invite endpoint, the SMTP test
        endpoint's 502 body)."""
        _configure(monkeypatch)
        with patch(SMTP_PATCH_TARGET, side_effect=ConnectionRefusedError("SMTP down")):
            with pytest.raises(ConnectionRefusedError, match="SMTP down"):
                await send_email(
                    "user@test.com",
                    "Test",
                    "<p>Test</p>",
                    "Test",
                )

    async def test_no_login_when_smtp_user_empty(self, monkeypatch):
        """When SMTP_USER is empty, login should not be called."""
        _configure(monkeypatch, SMTP_TLS=True)
        mock_smtp = MagicMock()
        with patch(SMTP_PATCH_TARGET, return_value=mock_smtp):
            await send_email("user@test.com", "Test", "<p>Test</p>", "Test")

        mock_smtp.starttls.assert_called_once()
        mock_smtp.login.assert_not_called()
