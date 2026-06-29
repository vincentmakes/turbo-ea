"""Email service facade for notification delivery.

Builds the message + standard template, then dispatches to the transport
backend selected by ``EMAIL_METHOD`` (``smtp_basic`` by default — see
``app.services.email_backends``). If the active backend is not configured,
emails are silently skipped, preserving the original contract.
"""

from __future__ import annotations

import html
import logging

from app.config import settings
from app.services.email_backends import EmailConfig, get_backend

logger = logging.getLogger(__name__)

DEFAULT_APP_TITLE = "Turbo EA"


def _get_app_title() -> str:
    """Return the configured app title from the runtime config, or the default."""
    title = (getattr(settings, "APP_TITLE", "") or "").strip()
    return title or DEFAULT_APP_TITLE


def _is_configured() -> bool:
    """True when the currently-selected email backend has enough config to send."""
    cfg = EmailConfig.from_runtime()
    return get_backend(cfg.method).is_configured(cfg)


async def send_email(to: str, subject: str, body_html: str, body_text: str = "") -> bool:
    """Send an email asynchronously via the active backend.

    No-op (returns False) if the selected backend is not configured.
    Returns True if the email was actually sent.
    """
    cfg = EmailConfig.from_runtime()
    backend = get_backend(cfg.method)
    if not backend.is_configured(cfg):
        return False

    if not body_text:
        body_text = body_html  # Fallback plain text

    await backend.send(
        to=to,
        subject=subject,
        body_html=body_html,
        body_text=body_text,
        from_addr=cfg.from_addr,
        cfg=cfg,
    )
    return True


async def send_notification_email(
    to: str,
    title: str,
    message: str,
    link: str | None = None,
) -> bool:
    """Send a notification email with a standard template.

    Returns True if the email was actually sent, False otherwise.
    """
    # Short-circuit when SMTP isn't configured so we don't open a DB session
    # (used for the app-title lookup) on every notification path.
    if not _is_configured():
        return False

    base_url = getattr(settings, "_app_base_url", "") or "http://localhost:8920"
    full_link = f"{base_url}{link}" if link else ""
    app_title = _get_app_title()

    # H7: Escape user-supplied content for the HTML body only — the subject
    # and plain-text body are not HTML, so escaping them produces visible
    # entities like "&#x27;" in mail clients.
    title_html = html.escape(title)
    message_html = html.escape(message)
    app_title_html = html.escape(app_title)

    link_html = ""
    if full_link:
        link_html = (
            f"<a href='{html.escape(full_link)}' style='"
            "display: inline-block; margin-top: 12px; "
            "padding: 8px 16px; background: #1976d2; "
            "color: white; text-decoration: none; "
            f"border-radius: 4px;'>View in {app_title_html}</a>"
        )

    wrapper = "font-family: sans-serif; max-width: 600px; margin: 0 auto"
    header_s = "background: #1a1a2e; padding: 16px 24px"
    body_s = "padding: 24px; border: 1px solid #e0e0e0"
    body_html = (
        f'<div style="{wrapper}">'
        f'<div style="{header_s}">'
        f'<h2 style="color:#64b5f6;margin:0">{app_title_html}</h2></div>'
        f'<div style="{body_s}">'
        f'<h3 style="margin:0 0 8px;color:#333">{title_html}</h3>'
        f'<p style="color:#555">{message_html}</p>'
        f"{link_html}</div>"
        '<p style="color:#999;font-size:12px;text-align:center">'
        f"You received this from {app_title_html}.</p></div>"
    )

    body_text = f"{title}\n\n{message}"
    if full_link:
        body_text += f"\n\nView: {full_link}"

    subject = f"[{app_title}] {title}"
    return await send_email(to, subject, body_html, body_text)
