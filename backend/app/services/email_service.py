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
from app.services.app_identity import get_app_title
from app.services.email_backends import EmailConfig, get_backend

logger = logging.getLogger(__name__)


def _get_app_title() -> str:
    """Return the configured app title from the runtime config, or the default."""
    return get_app_title()


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


#: Rows rendered in full before the list is truncated. One notification can
#: now stand for every card a stakeholder owns, and a landscape owner can own
#: hundreds — past this the list stops being a summary and starts being a
#: mail-client scroll, so the rest is counted rather than listed.
MAX_EMAIL_ITEMS = 25


def _render_items(
    items: list[dict[str, str | None]] | None,
    items_title: str | None,
    base_url: str,
) -> tuple[str, str]:
    """Render an item list as ``(html, plain_text)``.

    A bordered table rather than a ``<ul>``: list styling is the first thing
    mail clients disagree about, and a one-cell-per-row table renders the same
    everywhere. Every label is escaped — these are card names, i.e. user input.
    """
    if not items:
        return "", ""

    shown = items[:MAX_EMAIL_ITEMS]
    hidden = len(items) - len(shown)

    rows_html: list[str] = []
    lines: list[str] = []
    base_cell = "padding:10px 14px;font-size:14px;color:#333"
    for index, item in enumerate(shown):
        # Separators between rows only — the table's own border closes the last
        # one, and doubling them there reads as a stray line.
        last = index == len(shown) - 1 and hidden <= 0
        cell = base_cell if last else f"{base_cell};border-bottom:1px solid #eee"
        label = str(item.get("label") or "")
        label_html = html.escape(label)
        target = item.get("link")
        full = f"{base_url}{target}" if target else ""
        inner = (
            f"<a href='{html.escape(full)}' style='color:#1976d2;text-decoration:none'>"
            f"{label_html}</a>"
            if full
            else label_html
        )
        rows_html.append(f'<tr><td style="{cell}">{inner}</td></tr>')
        lines.append(f"- {label}" + (f"\n  {full}" if full else ""))

    if hidden > 0:
        more = f"and {hidden} more"
        more_s = f"{base_cell};font-size:13px;color:#777;font-style:italic"
        rows_html.append(f'<tr><td style="{more_s}">{html.escape(more)}</td></tr>')
        lines.append(f"- {more}")

    heading_html = ""
    heading_text = ""
    if items_title:
        heading_html = (
            f'<p style="margin:16px 0 8px;color:#333;font-weight:600;font-size:14px">'
            f"{html.escape(items_title)}</p>"
        )
        heading_text = f"{items_title}\n"

    table_s = "width:100%;border-collapse:collapse;border:1px solid #e0e0e0"
    table = f'<table role="presentation" style="{table_s}">' + "".join(rows_html) + "</table>"
    return heading_html + table, heading_text + "\n".join(lines)


async def send_notification_email(
    to: str,
    title: str,
    message: str,
    link: str | None = None,
    items: list[dict[str, str | None]] | None = None,
    items_title: str | None = None,
) -> bool:
    """Send a notification email with a standard template.

    ``items`` renders an optional list under the message — each entry
    ``{"label": …, "link": …}``, the link relative to the app base URL and
    optional. It exists so one notification can name what it covers (the
    cards a survey is asking someone about) instead of making the recipient
    open the app to find out. ``items_title`` is the heading above that list.

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
    # Escape first, then honour the author's line breaks — a survey message is
    # written in a textarea, and its paragraphs collapsed into one run of text.
    message_html = html.escape(message).replace("\n", "<br>")
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

    items_html, items_text = _render_items(items, items_title, base_url)

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
        f"{items_html}"
        f"{link_html}</div>"
        '<p style="color:#999;font-size:12px;text-align:center">'
        f"You received this from {app_title_html}.</p></div>"
    )

    body_text = f"{title}\n\n{message}"
    if items_text:
        body_text += f"\n\n{items_text}"
    if full_link:
        body_text += f"\n\nView: {full_link}"

    subject = f"[{app_title}] {title}"
    return await send_email(to, subject, body_html, body_text)
