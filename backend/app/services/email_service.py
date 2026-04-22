"""Simple SMTP email service for notification delivery.

If SMTP_HOST is not configured, emails are silently skipped.
"""

from __future__ import annotations

import asyncio
import html
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import settings

logger = logging.getLogger(__name__)

DEFAULT_APP_TITLE = "Turbo EA"


def _get_app_title() -> str:
    """Return the configured app title from the runtime config, or the default."""
    title = (getattr(settings, "APP_TITLE", "") or "").strip()
    return title or DEFAULT_APP_TITLE


def _is_configured() -> bool:
    return bool(settings.SMTP_HOST)


def _send_sync(to: str, subject: str, body_html: str, body_text: str) -> None:
    """Send an email synchronously (called from a thread)."""
    msg = MIMEMultipart("alternative")
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to
    msg["Subject"] = subject

    msg.attach(MIMEText(body_text, "plain"))
    msg.attach(MIMEText(body_html, "html"))

    try:
        if settings.SMTP_TLS:
            server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT)
            server.starttls()
        else:
            server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT)

        if settings.SMTP_USER:
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)

        server.sendmail(settings.SMTP_FROM, [to], msg.as_string())
        server.quit()
        logger.info("Email sent to %s: %s", to, subject)
    except Exception:
        logger.exception("Failed to send email to %s", to)


async def send_email(to: str, subject: str, body_html: str, body_text: str = "") -> bool:
    """Send an email asynchronously. No-op if SMTP is not configured.

    Returns True if the email was actually sent, False otherwise.
    """
    if not _is_configured():
        return False

    if not body_text:
        body_text = body_html  # Fallback plain text

    await asyncio.to_thread(_send_sync, to, subject, body_html, body_text)
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

    # H7: Escape user-supplied content to prevent HTML injection
    title = html.escape(title)
    message = html.escape(message)

    base_url = getattr(settings, "_app_base_url", "") or "http://localhost:8920"
    full_link = f"{base_url}{link}" if link else ""

    app_title = html.escape(_get_app_title())

    link_html = ""
    if full_link:
        link_html = (
            f"<a href='{html.escape(full_link)}' style='"
            "display: inline-block; margin-top: 12px; "
            "padding: 8px 16px; background: #1976d2; "
            "color: white; text-decoration: none; "
            f"border-radius: 4px;'>View in {app_title}</a>"
        )

    wrapper = "font-family: sans-serif; max-width: 600px; margin: 0 auto"
    header_s = "background: #1a1a2e; padding: 16px 24px"
    body_s = "padding: 24px; border: 1px solid #e0e0e0"
    body_html = (
        f'<div style="{wrapper}">'
        f'<div style="{header_s}">'
        f'<h2 style="color:#64b5f6;margin:0">{app_title}</h2></div>'
        f'<div style="{body_s}">'
        f'<h3 style="margin:0 0 8px;color:#333">{title}</h3>'
        f'<p style="color:#555">{message}</p>'
        f"{link_html}</div>"
        '<p style="color:#999;font-size:12px;text-align:center">'
        f"You received this from {app_title}.</p></div>"
    )

    body_text = f"{title}\n\n{message}"
    if full_link:
        body_text += f"\n\nView: {full_link}"

    subject = f"[{app_title}] {title}"
    return await send_email(to, subject, body_html, body_text)
