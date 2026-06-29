"""SMTP transport backends — basic auth and SASL XOAUTH2."""

from __future__ import annotations

import asyncio
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.services.email_backends import oauth
from app.services.email_backends.base import (
    METHOD_SMTP_BASIC,
    METHOD_SMTP_OAUTH,
    EmailConfig,
)

logger = logging.getLogger(__name__)


def _build_message(to: str, subject: str, body_html: str, body_text: str, from_addr: str) -> str:
    msg = MIMEMultipart("alternative")
    msg["From"] = from_addr
    msg["To"] = to
    msg["Subject"] = subject
    msg.attach(MIMEText(body_text, "plain"))
    msg.attach(MIMEText(body_html, "html"))
    return msg.as_string()


def _connect(cfg: EmailConfig) -> smtplib.SMTP:
    server = smtplib.SMTP(cfg.smtp_host, cfg.smtp_port)
    if cfg.smtp_tls:
        server.starttls()
    return server


class SmtpBasicBackend:
    """Classic SMTP with optional username/password login (the legacy path)."""

    key = METHOD_SMTP_BASIC

    def is_configured(self, cfg: EmailConfig) -> bool:
        return bool(cfg.smtp_host)

    def _send_sync(
        self,
        to: str,
        subject: str,
        body_html: str,
        body_text: str,
        from_addr: str,
        cfg: EmailConfig,
    ) -> None:
        try:
            server = _connect(cfg)
            if cfg.smtp_user:
                server.login(cfg.smtp_user, cfg.smtp_password)
            server.sendmail(
                from_addr, [to], _build_message(to, subject, body_html, body_text, from_addr)
            )
            server.quit()
            logger.info("Email sent to %s via smtp_basic: %s", to, subject)
        except Exception:
            logger.exception("Failed to send email to %s via smtp_basic", to)
            raise

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
        await asyncio.to_thread(self._send_sync, to, subject, body_html, body_text, from_addr, cfg)


class SmtpXOAuth2Backend:
    """SMTP authenticated with an OAuth2 bearer token (SASL XOAUTH2)."""

    key = METHOD_SMTP_OAUTH

    def is_configured(self, cfg: EmailConfig) -> bool:
        if not cfg.smtp_host:
            return False
        if cfg.oauth_provider == "google":
            return bool(cfg.service_account_json)
        return bool(cfg.oauth_tenant_id and cfg.oauth_client_id and cfg.oauth_client_secret)

    def _auth_user(self, cfg: EmailConfig, from_addr: str) -> str:
        return cfg.smtp_user or cfg.graph_sender or from_addr

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

    def _send_sync(
        self,
        to: str,
        subject: str,
        body_html: str,
        body_text: str,
        from_addr: str,
        cfg: EmailConfig,
        auth_user: str,
        token: str,
    ) -> None:
        try:
            server = _connect(cfg)
            xoauth2 = oauth.build_xoauth2_string(auth_user, token)
            server.ehlo()
            server.docmd("AUTH", "XOAUTH2 " + xoauth2)
            server.sendmail(
                from_addr, [to], _build_message(to, subject, body_html, body_text, from_addr)
            )
            server.quit()
            logger.info("Email sent to %s via smtp_oauth: %s", to, subject)
        except Exception:
            logger.exception("Failed to send email to %s via smtp_oauth", to)
            raise

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
        auth_user = self._auth_user(cfg, from_addr)
        token = await self._acquire_token(cfg, auth_user)
        await asyncio.to_thread(
            self._send_sync,
            to,
            subject,
            body_html,
            body_text,
            from_addr,
            cfg,
            auth_user,
            token,
        )
