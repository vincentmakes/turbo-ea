"""Microsoft Graph ``sendMail`` backend (app-only / client credentials).

No SMTP at all — sends via ``POST /v1.0/users/{sender}/sendMail`` with an
application token carrying the ``Mail.Send`` application permission. This is the
recommended Microsoft 365 path and is immune to SMTP-AUTH deprecation.
"""

from __future__ import annotations

import logging
from urllib.parse import quote

import httpx

from app.config import DEFAULT_SMTP_FROM
from app.services.email_backends import oauth
from app.services.email_backends.base import METHOD_GRAPH_API, EmailConfig

logger = logging.getLogger(__name__)

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
_GRAPH_SCOPE = "https://graph.microsoft.com/.default"
_HTTP_TIMEOUT = 30.0

# Shared client so per-email sends reuse pooled connections instead of paying
# a TCP+TLS handshake each time (same pattern as ai_service / eol).
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=_HTTP_TIMEOUT)
    return _client


class GraphApiBackend:
    key = METHOD_GRAPH_API

    def is_configured(self, cfg: EmailConfig) -> bool:
        return bool(
            cfg.oauth_tenant_id
            and cfg.oauth_client_id
            and cfg.oauth_client_secret
            and cfg.graph_sender
        )

    async def send(
        self,
        *,
        to: str,
        subject: str,
        body_html: str,
        body_text: str,
        from_addr: str,
        cfg: EmailConfig,
    ) -> None:
        token = await oauth.get_client_credentials_token(
            tenant_id=cfg.oauth_tenant_id,
            client_id=cfg.oauth_client_id,
            client_secret=cfg.oauth_client_secret,
            scope=cfg.oauth_scope or _GRAPH_SCOPE,
            token_endpoint=cfg.oauth_token_endpoint,
        )

        message = {
            "subject": subject,
            "body": {"contentType": "HTML", "content": body_html},
            "toRecipients": [{"emailAddress": {"address": to}}],
        }
        # Only set an explicit From when the admin deliberately configured a
        # brand address that differs from the sender mailbox (requires a
        # Send-As grant on that address). The placeholder default would make
        # every send fail with ErrorSendAsDenied, so it is treated as unset
        # and Graph derives the From from the sender mailbox.
        if (
            from_addr
            and from_addr != DEFAULT_SMTP_FROM
            and from_addr.lower() != cfg.graph_sender.lower()
        ):
            message["from"] = {"emailAddress": {"address": from_addr}}

        url = f"{_GRAPH_BASE}/users/{quote(cfg.graph_sender)}/sendMail"
        payload = {"message": message, "saveToSentItems": False}

        resp = await _get_client().post(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        # Graph sendMail returns 202 Accepted on success.
        if resp.status_code not in (200, 202):
            detail = oauth.safe_error(resp)
            logger.error("Graph sendMail failed (%s): %s", resp.status_code, detail)
            raise RuntimeError(f"Graph sendMail failed ({resp.status_code}): {detail}")
        logger.info("Email sent to %s via graph_api: %s", to, subject)
