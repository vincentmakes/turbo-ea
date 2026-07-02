"""Email backend contract + config snapshot + registry resolver.

Each backend implements a single ``send`` coroutine plus an ``is_configured``
check. ``EmailConfig`` is a flat, source-neutral snapshot of the relevant
runtime settings so backends never read the global ``settings`` singleton
directly (keeps them unit-testable).
"""

from __future__ import annotations

from dataclasses import dataclass, fields
from typing import Protocol

from app.config import settings

# Method keys (also the values stored in app_settings.email_settings["method"]).
METHOD_SMTP_BASIC = "smtp_basic"
METHOD_SMTP_OAUTH = "smtp_oauth"
METHOD_GRAPH_API = "graph_api"

ALLOWED_METHODS = (METHOD_SMTP_BASIC, METHOD_SMTP_OAUTH, METHOD_GRAPH_API)

# EmailConfig field name -> stored email_settings key (identical except the
# From address, which the settings dict calls smtp_from).
_STORED_KEYS = {
    "method": "method",
    "from_addr": "smtp_from",
    "smtp_host": "smtp_host",
    "smtp_port": "smtp_port",
    "smtp_user": "smtp_user",
    "smtp_password": "smtp_password",
    "smtp_tls": "smtp_tls",
    "oauth_provider": "oauth_provider",
    "oauth_tenant_id": "oauth_tenant_id",
    "oauth_client_id": "oauth_client_id",
    "oauth_client_secret": "oauth_client_secret",
    "oauth_scope": "oauth_scope",
    "oauth_token_endpoint": "oauth_token_endpoint",
    "service_account_json": "service_account_json",
    "graph_sender": "graph_sender",
}


@dataclass
class EmailConfig:
    """Flat snapshot of the email settings a backend may need."""

    method: str = METHOD_SMTP_BASIC
    from_addr: str = ""

    # SMTP transport (basic + xoauth2 share these)
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_tls: bool = True

    # OAuth (dedicated email app registration — decrypted plaintext here)
    oauth_provider: str = "microsoft"  # microsoft | google
    oauth_tenant_id: str = ""
    oauth_client_id: str = ""
    oauth_client_secret: str = ""
    oauth_scope: str = ""  # optional override
    oauth_token_endpoint: str = ""  # optional override
    service_account_json: str = ""  # Google service-account key (JSON string)

    # Sender mailbox: Graph sends from it; SMTP XOAUTH2 authenticates as
    # smtp_user (its own sender-mailbox field).
    graph_sender: str = ""

    @classmethod
    def from_runtime(cls) -> EmailConfig:
        """Build a config snapshot from the runtime ``settings`` singleton."""
        return cls(
            method=getattr(settings, "EMAIL_METHOD", METHOD_SMTP_BASIC) or METHOD_SMTP_BASIC,
            from_addr=settings.SMTP_FROM,
            smtp_host=settings.SMTP_HOST,
            smtp_port=settings.SMTP_PORT,
            smtp_user=settings.SMTP_USER,
            smtp_password=settings.SMTP_PASSWORD,
            smtp_tls=settings.SMTP_TLS,
            oauth_provider=getattr(settings, "EMAIL_OAUTH_PROVIDER", "microsoft") or "microsoft",
            oauth_tenant_id=getattr(settings, "EMAIL_OAUTH_TENANT_ID", ""),
            oauth_client_id=getattr(settings, "EMAIL_OAUTH_CLIENT_ID", ""),
            oauth_client_secret=getattr(settings, "EMAIL_OAUTH_CLIENT_SECRET", ""),
            oauth_scope=getattr(settings, "EMAIL_OAUTH_SCOPE", ""),
            oauth_token_endpoint=getattr(settings, "EMAIL_OAUTH_TOKEN_ENDPOINT", ""),
            service_account_json=getattr(settings, "EMAIL_SERVICE_ACCOUNT_JSON", ""),
            graph_sender=getattr(settings, "EMAIL_GRAPH_SENDER", ""),
        )

    @classmethod
    def from_stored(cls, stored: dict) -> EmailConfig:
        """Layer a stored ``email_settings`` dict over the runtime snapshot.

        Used by the settings API to answer "is this configuration complete?"
        with the exact same per-backend ``is_configured`` logic the send path
        uses. Secrets stay encrypted — ``is_configured`` only checks presence.
        Falsy stored values fall back to the runtime/env value, mirroring the
        endpoint's long-standing ``stored or env`` semantics.
        """
        cfg = cls.from_runtime()
        for field in fields(cls):
            value = stored.get(_STORED_KEYS[field.name])
            if field.name == "smtp_tls":
                if "smtp_tls" in stored:
                    cfg.smtp_tls = bool(stored["smtp_tls"])
            elif field.name == "smtp_port":
                if value:
                    cfg.smtp_port = int(value)
            elif value:
                setattr(cfg, field.name, value)
        return cfg


class EmailBackend(Protocol):
    """Transport strategy. Implementations live in this package."""

    key: str

    def is_configured(self, cfg: EmailConfig) -> bool: ...

    async def send(
        self,
        *,
        to: str,
        subject: str,
        body_html: str,
        body_text: str,
        from_addr: str,
        cfg: EmailConfig,
    ) -> None: ...


_registry: dict[str, EmailBackend] | None = None


def get_backend(method: str | None) -> EmailBackend:
    """Resolve the backend for ``method`` (defaults to smtp_basic)."""
    global _registry
    if _registry is None:
        # Imported lazily to avoid a circular import at module load; the
        # stateless backends are built once and reused.
        from app.services.email_backends.graph import GraphApiBackend
        from app.services.email_backends.smtp import SmtpBasicBackend, SmtpXOAuth2Backend

        _registry = {
            METHOD_SMTP_BASIC: SmtpBasicBackend(),
            METHOD_SMTP_OAUTH: SmtpXOAuth2Backend(),
            METHOD_GRAPH_API: GraphApiBackend(),
        }
    return _registry.get(method or METHOD_SMTP_BASIC, _registry[METHOD_SMTP_BASIC])
