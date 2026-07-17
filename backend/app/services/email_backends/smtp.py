"""SMTP transport backends — basic auth and SASL XOAUTH2."""

from __future__ import annotations

import asyncio
import logging
import smtplib
from collections.abc import Callable
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.services.email_backends import oauth
from app.services.email_backends.base import (
    METHOD_SMTP_BASIC,
    METHOD_SMTP_OAUTH,
    EmailConfig,
)

logger = logging.getLogger(__name__)

# SMTPS: servers on this port expect the TLS handshake immediately (implicit
# TLS), so a plain connection is dropped before the banner (issue #847).
IMPLICIT_TLS_PORT = 465


def _build_message(to: str, subject: str, body_html: str, body_text: str, from_addr: str) -> str:
    msg = MIMEMultipart("alternative")
    msg["From"] = from_addr
    msg["To"] = to
    msg["Subject"] = subject
    msg.attach(MIMEText(body_text, "plain"))
    msg.attach(MIMEText(body_html, "html"))
    return msg.as_string()


def _send_sync(
    *,
    to: str,
    subject: str,
    body_html: str,
    body_text: str,
    from_addr: str,
    cfg: EmailConfig,
    key: str,
    authenticate: Callable[[smtplib.SMTP], None],
) -> None:
    """Shared SMTP send: connect → (starttls) → ehlo → authenticate → send.

    Runs in a thread. The two backends differ only in the ``authenticate``
    step, so transport-level fixes land in one place.
    """
    try:
        if cfg.smtp_port == IMPLICIT_TLS_PORT:
            # Already encrypted from the first byte — starttls() would fail,
            # and the smtp_tls flag only governs the STARTTLS upgrade path.
            server: smtplib.SMTP = smtplib.SMTP_SSL(cfg.smtp_host, cfg.smtp_port)
        else:
            server = smtplib.SMTP(cfg.smtp_host, cfg.smtp_port)
            if cfg.smtp_tls:
                server.starttls()
        # starttls() resets the EHLO state; re-EHLO so AUTH is accepted. On the
        # non-TLS path this is the first EHLO. Harmless before login(), which
        # skips its own EHLO when one already succeeded.
        server.ehlo()
        authenticate(server)
        server.sendmail(
            from_addr, [to], _build_message(to, subject, body_html, body_text, from_addr)
        )
        server.quit()
        logger.info("Email sent to %s via %s: %s", to, key, subject)
    except Exception:
        logger.exception("Failed to send email to %s via %s", to, key)
        raise


class SmtpBasicBackend:
    """Classic SMTP with optional username/password login (the legacy path)."""

    key = METHOD_SMTP_BASIC

    def is_configured(self, cfg: EmailConfig) -> bool:
        return bool(cfg.smtp_host)

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
        def authenticate(server: smtplib.SMTP) -> None:
            if cfg.smtp_user:
                server.login(cfg.smtp_user, cfg.smtp_password)

        await asyncio.to_thread(
            _send_sync,
            to=to,
            subject=subject,
            body_html=body_html,
            body_text=body_text,
            from_addr=from_addr,
            cfg=cfg,
            key=self.key,
            authenticate=authenticate,
        )


class SmtpXOAuth2Backend:
    """SMTP authenticated with an OAuth2 bearer token (SASL XOAUTH2).

    ``smtp_user`` is the sender mailbox the token authenticates as (and, for
    Google, the mailbox the service account impersonates) — required.
    """

    key = METHOD_SMTP_OAUTH

    def is_configured(self, cfg: EmailConfig) -> bool:
        if not cfg.smtp_host or not cfg.smtp_user:
            return False
        if cfg.oauth_provider == "google":
            return bool(cfg.service_account_json)
        return bool(cfg.oauth_tenant_id and cfg.oauth_client_id and cfg.oauth_client_secret)

    async def _acquire_token(self, cfg: EmailConfig, auth_user: str) -> str:
        if cfg.oauth_provider == "google":
            scope = cfg.oauth_scope or "https://mail.google.com/"
            return await oauth.get_service_account_token(
                service_account_json=cfg.service_account_json,
                subject=auth_user,
                scope=scope,
            )
        scope = cfg.oauth_scope or "https://outlook.office365.com/.default"
        return await oauth.get_client_credentials_token(
            tenant_id=cfg.oauth_tenant_id,
            client_id=cfg.oauth_client_id,
            client_secret=cfg.oauth_client_secret,
            scope=scope,
            token_endpoint=cfg.oauth_token_endpoint,
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
        auth_user = cfg.smtp_user
        token = await self._acquire_token(cfg, auth_user)

        def authenticate(server: smtplib.SMTP) -> None:
            # smtplib base64-encodes the authobject's return value itself and
            # raises SMTPAuthenticationError on a non-235 reply — docmd() would
            # silently ignore a rejected token.
            server.auth(
                "XOAUTH2",
                lambda challenge=None: oauth.build_xoauth2_raw(auth_user, token),
            )

        await asyncio.to_thread(
            _send_sync,
            to=to,
            subject=subject,
            body_html=body_html,
            body_text=body_text,
            from_addr=from_addr,
            cfg=cfg,
            key=self.key,
            authenticate=authenticate,
        )
