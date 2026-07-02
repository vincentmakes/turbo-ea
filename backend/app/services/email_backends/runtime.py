"""Push stored email settings into the runtime config singleton.

Single source of truth for "load the ``app_settings.email_settings`` JSONB into
the ``settings`` singleton" — used by app startup, ``PATCH /settings/email``,
and the workspace-transfer importer. Keeping one implementation prevents the
three call sites from drifting (a stale startup copy once silently dropped the
OAuth fields on restart).
"""

from __future__ import annotations

from app.config import settings as app_config
from app.core.encryption import decrypt_value

# New-style fields are applied on key presence so an admin can clear a value
# (e.g. remove a custom scope or a rotated service-account key) without a
# restart. The legacy smtp_* fields keep their original truthy-only semantics.
_PRESENCE_FIELDS = {
    "oauth_provider": "EMAIL_OAUTH_PROVIDER",
    "oauth_tenant_id": "EMAIL_OAUTH_TENANT_ID",
    "oauth_client_id": "EMAIL_OAUTH_CLIENT_ID",
    "graph_sender": "EMAIL_GRAPH_SENDER",
    "oauth_scope": "EMAIL_OAUTH_SCOPE",
    "oauth_token_endpoint": "EMAIL_OAUTH_TOKEN_ENDPOINT",
}
_PRESENCE_SECRET_FIELDS = {
    "oauth_client_secret": "EMAIL_OAUTH_CLIENT_SECRET",
    "service_account_json": "EMAIL_SERVICE_ACCOUNT_JSON",
}


def apply_email_settings_to_runtime(email: dict) -> None:
    """Mirror a stored email-settings dict onto the runtime config singleton."""
    if email.get("method"):
        app_config.EMAIL_METHOD = email["method"]
    if email.get("smtp_host"):
        app_config.SMTP_HOST = email["smtp_host"]
    if email.get("smtp_port"):
        app_config.SMTP_PORT = int(email["smtp_port"])
    if email.get("smtp_user"):
        app_config.SMTP_USER = email["smtp_user"]
    if email.get("smtp_password"):
        app_config.SMTP_PASSWORD = decrypt_value(email["smtp_password"])
    if email.get("smtp_from"):
        app_config.SMTP_FROM = email["smtp_from"]
    if "smtp_tls" in email:
        app_config.SMTP_TLS = bool(email["smtp_tls"])
    if email.get("app_base_url"):
        app_config._app_base_url = email["app_base_url"]

    for key, attr in _PRESENCE_FIELDS.items():
        if key in email:
            setattr(app_config, attr, email[key] or "")
    for key, attr in _PRESENCE_SECRET_FIELDS.items():
        if key in email:
            setattr(app_config, attr, decrypt_value(email[key]) if email[key] else "")

    # Drop cached OAuth tokens so the next send picks up the new credentials.
    from app.services.email_backends import oauth

    oauth.reset_cache()
