"""Simple SMTP email service for notification delivery.

If SMTP_HOST is not configured, emails are silently skipped.
"""
from __future__ import annotations

import asyncio
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import settings

logger = logging.getLogger(__name__)


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


async def send_email(to: str, subject: str, body_html: str, body_text: str = "") -> None:
    """Send an email asynchronously. No-op if SMTP is not configured."""
    if not _is_configured():
        return

    if not body_text:
        body_text = body_html  # Fallback plain text

    await asyncio.to_thread(_send_sync, to, subject, body_html, body_text)


async def send_notification_email(
    to: str,
    title: str,
    message: str,
    link: str | None = None,
) -> None:
    """Send a notification email with a standard template."""
    base_url = "http://localhost:8920"  # Configurable in future
    full_link = f"{base_url}{link}" if link else ""

    link_html = ""
    if full_link:
        link_html = (
            f"<a href='{full_link}' style='"
            "display: inline-block; margin-top: 12px; "
            "padding: 8px 16px; background: #1976d2; "
            "color: white; text-decoration: none; "
            "border-radius: 4px;'>View in Turbo EA</a>"
        )

    wrapper = "font-family: sans-serif; max-width: 600px; margin: 0 auto"
    header_s = "background: #1a1a2e; padding: 16px 24px"
    body_s = "padding: 24px; border: 1px solid #e0e0e0"
    body_html = (
        f'<div style="{wrapper}">'
        f'<div style="{header_s}">'
        '<h2 style="color:#64b5f6;margin:0">Turbo EA</h2></div>'
        f'<div style="{body_s}">'
        f'<h3 style="margin:0 0 8px;color:#333">{title}</h3>'
        f'<p style="color:#555">{message}</p>'
        f"{link_html}</div>"
        '<p style="color:#999;font-size:12px;text-align:center">'
        "You received this from Turbo EA.</p></div>"
    )

    body_text = f"{title}\n\n{message}"
    if full_link:
        body_text += f"\n\nView: {full_link}"

    subject = f"[Turbo EA] {title}"
    await send_email(to, subject, body_html, body_text)
