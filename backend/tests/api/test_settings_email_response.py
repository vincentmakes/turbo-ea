"""``_email_settings_response``: the masked body GET and PATCH
``/settings/email`` both return, compared whole.

Every runtime fallback is patched to a distinct value so a key read from the
wrong setting, or a default that is not applied, shows up as a mismatch.
"""

from __future__ import annotations

import pytest

from app.api.v1 import settings as settings_api
from app.api.v1.settings import MASK, _email_settings_response

ENV = {
    "EMAIL_METHOD": "env-method",
    "SMTP_HOST": "env-host",
    "SMTP_PORT": 2525,
    "SMTP_USER": "env-user",
    "SMTP_PASSWORD": "env-pass",
    "SMTP_FROM": "env@from",
    "SMTP_TLS": False,
    "EMAIL_OAUTH_PROVIDER": "env-provider",
    "EMAIL_OAUTH_TENANT_ID": "env-tenant",
    "EMAIL_OAUTH_CLIENT_ID": "env-client",
    "EMAIL_OAUTH_CLIENT_SECRET": "env-secret",
    "EMAIL_GRAPH_SENDER": "env-sender",
    "EMAIL_OAUTH_SCOPE": "env-scope",
    "EMAIL_OAUTH_TOKEN_ENDPOINT": "env-endpoint",
    "EMAIL_SERVICE_ACCOUNT_JSON": "env-json",
}


@pytest.fixture
def env(monkeypatch):
    for key, value in ENV.items():
        monkeypatch.setattr(settings_api.app_config, key, value)
    seen: list[dict] = []

    def configured(stored):
        seen.append(stored)
        return "configured-verdict"

    monkeypatch.setattr(settings_api, "_email_configured", configured)
    return seen


def test_nothing_stored_reads_every_runtime_fallback(env):
    assert _email_settings_response({}) == {
        "method": "env-method",
        "smtp_host": "env-host",
        "smtp_port": 2525,
        "smtp_user": "env-user",
        "smtp_password": MASK,
        "smtp_from": "env@from",
        "smtp_tls": False,
        "app_base_url": "",
        "oauth_provider": "env-provider",
        "oauth_tenant_id": "env-tenant",
        "oauth_client_id": "env-client",
        "oauth_client_secret": MASK,
        "graph_sender": "env-sender",
        "oauth_scope": "env-scope",
        "oauth_token_endpoint": "env-endpoint",
        "service_account_json": MASK,
        "configured": "configured-verdict",
    }
    assert env == [{}]


def test_stored_values_win_and_secrets_stay_masked(env):
    stored = {
        "method": "graph",
        "smtp_host": "mail.example",
        "smtp_port": 465,
        "smtp_user": "me",
        "smtp_password": "enc:secret",
        "smtp_from": "ea@example",
        "smtp_tls": True,
        "app_base_url": "https://ea.example",
        "oauth_provider": "google",
        "oauth_tenant_id": "tenant",
        "oauth_client_id": "client",
        "oauth_client_secret": "enc:client-secret",
        "graph_sender": "sender@example",
        "oauth_scope": "scope",
        "oauth_token_endpoint": "https://token.example",
        "service_account_json": "enc:json",
    }
    got = _email_settings_response(stored)
    assert got == {
        **stored,
        "smtp_password": MASK,
        "oauth_client_secret": MASK,
        "service_account_json": MASK,
        "configured": "configured-verdict",
    }
    assert env == [stored]


@pytest.mark.parametrize(
    ("key", "env_key"),
    [
        ("smtp_password", "SMTP_PASSWORD"),
        ("oauth_client_secret", "EMAIL_OAUTH_CLIENT_SECRET"),
        ("service_account_json", "EMAIL_SERVICE_ACCOUNT_JSON"),
    ],
)
def test_a_secret_reads_empty_only_when_neither_side_has_one(env, monkeypatch, key, env_key):
    assert _email_settings_response({key: ""})[key] == MASK  # the runtime one is there
    monkeypatch.setattr(settings_api.app_config, env_key, "")
    assert _email_settings_response({key: ""})[key] == ""
    assert _email_settings_response({key: "enc:x"})[key] == MASK
