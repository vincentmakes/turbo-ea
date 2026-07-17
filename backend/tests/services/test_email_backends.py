"""Unit tests for the modern email backends — Graph API, SMTP XOAUTH2, and the
OAuth token cache. No database required; httpx and smtplib are mocked.
"""

from __future__ import annotations

import base64
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.config import settings as real_settings
from app.services.email_backends import EmailConfig, get_backend, oauth
from app.services.email_service import send_email

SMTP_PATCH_TARGET = "app.services.email_backends.smtp.smtplib.SMTP"
SMTP_SSL_PATCH_TARGET = "app.services.email_backends.smtp.smtplib.SMTP_SSL"


@pytest.fixture(autouse=True)
def _clear_token_cache():
    oauth.reset_cache()
    yield
    oauth.reset_cache()


# ---------------------------------------------------------------------------
# Backend resolution
# ---------------------------------------------------------------------------


class TestBackendResolution:
    def test_unknown_method_falls_back_to_basic(self):
        assert get_backend("nonsense").key == "smtp_basic"
        assert get_backend(None).key == "smtp_basic"

    def test_each_method_resolves(self):
        assert get_backend("smtp_basic").key == "smtp_basic"
        assert get_backend("smtp_oauth").key == "smtp_oauth"
        assert get_backend("graph_api").key == "graph_api"


# ---------------------------------------------------------------------------
# is_configured per backend
# ---------------------------------------------------------------------------


class TestIsConfigured:
    def test_graph_requires_all_oauth_fields(self):
        backend = get_backend("graph_api")
        assert not backend.is_configured(EmailConfig(method="graph_api"))
        cfg = EmailConfig(
            method="graph_api",
            oauth_tenant_id="t",
            oauth_client_id="c",
            oauth_client_secret="s",
            graph_sender="sender@x.com",
        )
        assert backend.is_configured(cfg)

    def test_xoauth2_microsoft_requires_oauth_and_sender(self):
        backend = get_backend("smtp_oauth")
        assert not backend.is_configured(EmailConfig(method="smtp_oauth", smtp_host="h"))
        cfg = EmailConfig(
            method="smtp_oauth",
            smtp_host="smtp.office365.com",
            smtp_user="mailbox@x.com",
            oauth_tenant_id="t",
            oauth_client_id="c",
            oauth_client_secret="s",
        )
        assert backend.is_configured(cfg)
        # The sender mailbox is what the token authenticates as — required.
        cfg.smtp_user = ""
        assert not backend.is_configured(cfg)

    def test_xoauth2_google_requires_service_account_and_sender(self):
        backend = get_backend("smtp_oauth")
        cfg = EmailConfig(
            method="smtp_oauth",
            smtp_host="smtp.gmail.com",
            smtp_user="mailbox@x.com",
            oauth_provider="google",
            service_account_json='{"client_email":"x","private_key":"y"}',
        )
        assert backend.is_configured(cfg)
        # Without the impersonation subject the delegation grant cannot work.
        cfg.smtp_user = ""
        assert not backend.is_configured(cfg)


# ---------------------------------------------------------------------------
# OAuth token cache
# ---------------------------------------------------------------------------


def _token_response(token: str, expires_in: int = 3600):
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = {"access_token": token, "expires_in": expires_in}
    return resp


class TestTokenCache:
    async def test_caches_token_until_expiry(self):
        post = AsyncMock(return_value=_token_response("TOK1"))
        client = MagicMock()
        client.post = post
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)

        with patch("app.services.email_backends.oauth.httpx.AsyncClient", return_value=client):
            t1 = await oauth.get_client_credentials_token(
                tenant_id="t", client_id="c", client_secret="s", scope="scope/.default"
            )
            t2 = await oauth.get_client_credentials_token(
                tenant_id="t", client_id="c", client_secret="s", scope="scope/.default"
            )

        assert t1 == t2 == "TOK1"
        post.assert_awaited_once()  # second call served from cache

    async def test_refetches_after_expiry(self):
        responses = [_token_response("TOK1", expires_in=10), _token_response("TOK2", expires_in=10)]
        post = AsyncMock(side_effect=responses)
        client = MagicMock()
        client.post = post
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)

        with patch("app.services.email_backends.oauth.httpx.AsyncClient", return_value=client):
            t1 = await oauth.get_client_credentials_token(
                tenant_id="t", client_id="c", client_secret="s", scope="sc"
            )
            # Fast-forward past the cached expiry (expires_in 10 - 60 skew => 0 ttl,
            # so it is already expired and the next call refetches).
            t2 = await oauth.get_client_credentials_token(
                tenant_id="t", client_id="c", client_secret="s", scope="sc"
            )

        assert t1 == "TOK1"
        assert t2 == "TOK2"
        assert post.await_count == 2

    async def test_raises_on_error_status(self):
        resp = MagicMock()
        resp.status_code = 401
        resp.json.return_value = {"error_description": "bad secret"}
        post = AsyncMock(return_value=resp)
        client = MagicMock()
        client.post = post
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)

        with patch("app.services.email_backends.oauth.httpx.AsyncClient", return_value=client):
            with pytest.raises(RuntimeError, match="bad secret"):
                await oauth.get_client_credentials_token(
                    tenant_id="t", client_id="c", client_secret="s", scope="sc"
                )

    async def test_cache_is_tenant_scoped(self):
        """Correcting the tenant must not reuse the token minted for the old one."""
        responses = [_token_response("TOK_A"), _token_response("TOK_B")]
        post = AsyncMock(side_effect=responses)
        client = MagicMock()
        client.post = post
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)

        with patch("app.services.email_backends.oauth.httpx.AsyncClient", return_value=client):
            t1 = await oauth.get_client_credentials_token(
                tenant_id="tenant-a", client_id="c", client_secret="s", scope="sc"
            )
            t2 = await oauth.get_client_credentials_token(
                tenant_id="tenant-b", client_id="c", client_secret="s", scope="sc"
            )

        assert (t1, t2) == ("TOK_A", "TOK_B")
        assert post.await_count == 2


# ---------------------------------------------------------------------------
# XOAUTH2 SASL string
# ---------------------------------------------------------------------------


class TestXOAuth2String:
    def test_format(self):
        s = oauth.build_xoauth2_string("user@x.com", "TOKEN")
        assert base64.b64decode(s) == b"user=user@x.com\x01auth=Bearer TOKEN\x01\x01"


# ---------------------------------------------------------------------------
# Graph backend send (via the facade)
# ---------------------------------------------------------------------------


def _configure_graph(monkeypatch):
    overrides = {
        "EMAIL_METHOD": "graph_api",
        "SMTP_FROM": "brand@company.com",
        "EMAIL_OAUTH_PROVIDER": "microsoft",
        "EMAIL_OAUTH_TENANT_ID": "tenant-123",
        "EMAIL_OAUTH_CLIENT_ID": "client-123",
        "EMAIL_OAUTH_CLIENT_SECRET": "secret-123",
        "EMAIL_OAUTH_SCOPE": "",
        "EMAIL_OAUTH_TOKEN_ENDPOINT": "",
        "EMAIL_GRAPH_SENDER": "mailbox@company.com",
        "EMAIL_SERVICE_ACCOUNT_JSON": "",
    }
    for key, value in overrides.items():
        monkeypatch.setattr(real_settings, key, value, raising=False)


def _mock_graph_client(monkeypatch, post):
    """Install a mock shared httpx client on the graph module."""
    from app.services.email_backends import graph

    client = MagicMock()
    client.post = post
    monkeypatch.setattr(graph, "_client", client)
    return client


class TestGraphBackend:
    async def test_send_posts_to_graph(self, monkeypatch):
        _configure_graph(monkeypatch)
        send_resp = MagicMock()
        send_resp.status_code = 202
        post = AsyncMock(return_value=send_resp)
        _mock_graph_client(monkeypatch, post)

        with patch(
            "app.services.email_backends.oauth.get_client_credentials_token",
            AsyncMock(return_value="GRAPH_TOKEN"),
        ):
            result = await send_email("to@x.com", "Subj", "<p>Body</p>", "Body")

        assert result is True
        post.assert_awaited_once()
        url = post.await_args.args[0]
        # The sender mailbox is percent-encoded into the path.
        assert url == ("https://graph.microsoft.com/v1.0/users/mailbox%40company.com/sendMail")
        kwargs = post.await_args.kwargs
        assert kwargs["headers"]["Authorization"] == "Bearer GRAPH_TOKEN"
        body = kwargs["json"]
        assert body["message"]["subject"] == "Subj"
        assert body["message"]["toRecipients"][0]["emailAddress"]["address"] == "to@x.com"
        # An explicitly configured brand From differing from the sender mailbox
        # is passed through (requires a Send-As grant).
        assert body["message"]["from"]["emailAddress"]["address"] == "brand@company.com"

    async def test_default_from_is_not_forced(self, monkeypatch):
        """The placeholder default From must not become an explicit Graph from
        header — that would fail every send with ErrorSendAsDenied."""
        _configure_graph(monkeypatch)
        monkeypatch.setattr(real_settings, "SMTP_FROM", "noreply@turboea.local")
        send_resp = MagicMock()
        send_resp.status_code = 202
        post = AsyncMock(return_value=send_resp)
        _mock_graph_client(monkeypatch, post)

        with patch(
            "app.services.email_backends.oauth.get_client_credentials_token",
            AsyncMock(return_value="GRAPH_TOKEN"),
        ):
            result = await send_email("to@x.com", "Subj", "<p>Body</p>", "Body")

        assert result is True
        body = post.await_args.kwargs["json"]
        assert "from" not in body["message"]

    async def test_send_raises_on_failure(self, monkeypatch):
        _configure_graph(monkeypatch)
        send_resp = MagicMock()
        send_resp.status_code = 403
        send_resp.json.return_value = {"error": {"message": "forbidden"}}
        post = AsyncMock(return_value=send_resp)
        _mock_graph_client(monkeypatch, post)

        with patch(
            "app.services.email_backends.oauth.get_client_credentials_token",
            AsyncMock(return_value="GRAPH_TOKEN"),
        ):
            with pytest.raises(RuntimeError, match="forbidden"):
                await send_email("to@x.com", "Subj", "<p>Body</p>", "Body")


# ---------------------------------------------------------------------------
# SMTP XOAUTH2 backend send (via the facade)
# ---------------------------------------------------------------------------


class TestXOAuth2Backend:
    async def test_send_authenticates_with_bearer(self, monkeypatch):
        overrides = {
            "EMAIL_METHOD": "smtp_oauth",
            "SMTP_HOST": "smtp.office365.com",
            "SMTP_PORT": 587,
            "SMTP_TLS": True,
            "SMTP_USER": "mailbox@company.com",
            "SMTP_FROM": "mailbox@company.com",
            "EMAIL_OAUTH_PROVIDER": "microsoft",
            "EMAIL_OAUTH_TENANT_ID": "t",
            "EMAIL_OAUTH_CLIENT_ID": "c",
            "EMAIL_OAUTH_CLIENT_SECRET": "s",
            "EMAIL_OAUTH_SCOPE": "",
            "EMAIL_GRAPH_SENDER": "",
            "EMAIL_SERVICE_ACCOUNT_JSON": "",
        }
        for key, value in overrides.items():
            monkeypatch.setattr(real_settings, key, value, raising=False)

        mock_smtp = MagicMock()
        with (
            patch(
                "app.services.email_backends.oauth.get_client_credentials_token",
                AsyncMock(return_value="XO_TOKEN"),
            ),
            patch(SMTP_PATCH_TARGET, return_value=mock_smtp),
        ):
            result = await send_email("to@x.com", "Subj", "<p>Body</p>", "Body")

        assert result is True
        mock_smtp.starttls.assert_called_once()
        # server.auth raises SMTPAuthenticationError on a rejected token; docmd
        # would swallow it. The authobject returns the raw SASL string —
        # smtplib base64-encodes it itself.
        mock_smtp.auth.assert_called_once()
        mechanism, authobject = mock_smtp.auth.call_args.args
        assert mechanism == "XOAUTH2"
        raw = authobject()
        assert raw == "user=mailbox@company.com\x01auth=Bearer XO_TOKEN\x01\x01"
        mock_smtp.login.assert_not_called()  # OAuth, never basic login

    async def test_auth_failure_propagates(self, monkeypatch):
        """A rejected token must surface as an SMTPAuthenticationError, not fall
        through to sendmail."""
        import smtplib

        overrides = {
            "EMAIL_METHOD": "smtp_oauth",
            "SMTP_HOST": "smtp.office365.com",
            "SMTP_PORT": 587,
            "SMTP_TLS": True,
            "SMTP_USER": "mailbox@company.com",
            "SMTP_FROM": "mailbox@company.com",
            "EMAIL_OAUTH_PROVIDER": "microsoft",
            "EMAIL_OAUTH_TENANT_ID": "t",
            "EMAIL_OAUTH_CLIENT_ID": "c",
            "EMAIL_OAUTH_CLIENT_SECRET": "s",
            "EMAIL_OAUTH_SCOPE": "",
            "EMAIL_GRAPH_SENDER": "",
            "EMAIL_SERVICE_ACCOUNT_JSON": "",
        }
        for key, value in overrides.items():
            monkeypatch.setattr(real_settings, key, value, raising=False)

        mock_smtp = MagicMock()
        mock_smtp.auth.side_effect = smtplib.SMTPAuthenticationError(535, b"bad token")
        with (
            patch(
                "app.services.email_backends.oauth.get_client_credentials_token",
                AsyncMock(return_value="XO_TOKEN"),
            ),
            patch(SMTP_PATCH_TARGET, return_value=mock_smtp),
        ):
            with pytest.raises(smtplib.SMTPAuthenticationError):
                await send_email("to@x.com", "Subj", "<p>Body</p>", "Body")

        mock_smtp.sendmail.assert_not_called()


# ---------------------------------------------------------------------------
# Implicit TLS (port 465) transport selection — issue #847
# ---------------------------------------------------------------------------


def _configure_smtp_basic(monkeypatch, port: int, tls: bool = True):
    overrides = {
        "EMAIL_METHOD": "smtp_basic",
        "SMTP_HOST": "mail.company.com",
        "SMTP_PORT": port,
        "SMTP_TLS": tls,
        "SMTP_USER": "user@company.com",
        "SMTP_PASSWORD": "pw",
        "SMTP_FROM": "noreply@company.com",
    }
    for key, value in overrides.items():
        monkeypatch.setattr(real_settings, key, value, raising=False)


class TestImplicitTls:
    async def test_port_465_uses_smtp_ssl_and_skips_starttls(self, monkeypatch):
        """Port 465 expects the TLS handshake immediately — a plain connection
        is dropped before the banner, and starttls() on an already-encrypted
        connection would fail."""
        _configure_smtp_basic(monkeypatch, port=465)
        mock_ssl = MagicMock()
        with (
            patch(SMTP_SSL_PATCH_TARGET, return_value=mock_ssl) as ssl_ctor,
            patch(SMTP_PATCH_TARGET) as plain_ctor,
        ):
            result = await send_email("to@x.com", "Subj", "<p>Body</p>", "Body")

        assert result is True
        ssl_ctor.assert_called_once_with("mail.company.com", 465)
        plain_ctor.assert_not_called()
        mock_ssl.starttls.assert_not_called()
        mock_ssl.login.assert_called_once_with("user@company.com", "pw")
        mock_ssl.sendmail.assert_called_once()

    async def test_port_587_keeps_starttls_path(self, monkeypatch):
        """Regression guard: other ports keep the plain-connect + STARTTLS flow."""
        _configure_smtp_basic(monkeypatch, port=587)
        mock_smtp = MagicMock()
        with (
            patch(SMTP_PATCH_TARGET, return_value=mock_smtp) as plain_ctor,
            patch(SMTP_SSL_PATCH_TARGET) as ssl_ctor,
        ):
            result = await send_email("to@x.com", "Subj", "<p>Body</p>", "Body")

        assert result is True
        plain_ctor.assert_called_once_with("mail.company.com", 587)
        ssl_ctor.assert_not_called()
        mock_smtp.starttls.assert_called_once()
        mock_smtp.login.assert_called_once_with("user@company.com", "pw")

    async def test_xoauth2_on_port_465_uses_smtp_ssl(self, monkeypatch):
        """Both SMTP backends share _send_sync — implicit TLS covers XOAUTH2 too."""
        overrides = {
            "EMAIL_METHOD": "smtp_oauth",
            "SMTP_HOST": "smtp.office365.com",
            "SMTP_PORT": 465,
            "SMTP_TLS": True,
            "SMTP_USER": "mailbox@company.com",
            "SMTP_FROM": "mailbox@company.com",
            "EMAIL_OAUTH_PROVIDER": "microsoft",
            "EMAIL_OAUTH_TENANT_ID": "t",
            "EMAIL_OAUTH_CLIENT_ID": "c",
            "EMAIL_OAUTH_CLIENT_SECRET": "s",
            "EMAIL_OAUTH_SCOPE": "",
            "EMAIL_GRAPH_SENDER": "",
            "EMAIL_SERVICE_ACCOUNT_JSON": "",
        }
        for key, value in overrides.items():
            monkeypatch.setattr(real_settings, key, value, raising=False)

        mock_ssl = MagicMock()
        with (
            patch(
                "app.services.email_backends.oauth.get_client_credentials_token",
                AsyncMock(return_value="XO_TOKEN"),
            ),
            patch(SMTP_SSL_PATCH_TARGET, return_value=mock_ssl) as ssl_ctor,
            patch(SMTP_PATCH_TARGET) as plain_ctor,
        ):
            result = await send_email("to@x.com", "Subj", "<p>Body</p>", "Body")

        assert result is True
        ssl_ctor.assert_called_once_with("smtp.office365.com", 465)
        plain_ctor.assert_not_called()
        mock_ssl.starttls.assert_not_called()
        mock_ssl.auth.assert_called_once()


# ---------------------------------------------------------------------------
# EmailConfig.from_stored + runtime apply
# ---------------------------------------------------------------------------


class TestFromStored:
    def test_stored_values_layer_over_runtime(self, monkeypatch):
        monkeypatch.setattr(real_settings, "EMAIL_METHOD", "smtp_basic", raising=False)
        monkeypatch.setattr(real_settings, "SMTP_HOST", "env-host", raising=False)
        monkeypatch.setattr(real_settings, "EMAIL_GRAPH_SENDER", "", raising=False)
        stored = {
            "method": "graph_api",
            "graph_sender": "m@x.com",
            "oauth_tenant_id": "t",
            "oauth_client_id": "c",
            "oauth_client_secret": "enc:SECRET",  # stays encrypted — truthiness only
        }
        cfg = EmailConfig.from_stored(stored)
        assert cfg.method == "graph_api"
        assert cfg.graph_sender == "m@x.com"
        assert cfg.smtp_host == "env-host"  # runtime fallback for unset keys
        assert get_backend(cfg.method).is_configured(cfg)

    def test_matches_send_path_requirements(self, monkeypatch):
        """from_stored + backend.is_configured is the single source of truth the
        settings API delegates to — a graph config missing the sender is
        incomplete on both paths."""
        monkeypatch.setattr(real_settings, "EMAIL_GRAPH_SENDER", "", raising=False)
        monkeypatch.setattr(real_settings, "EMAIL_OAUTH_TENANT_ID", "", raising=False)
        monkeypatch.setattr(real_settings, "EMAIL_OAUTH_CLIENT_ID", "", raising=False)
        monkeypatch.setattr(real_settings, "EMAIL_OAUTH_CLIENT_SECRET", "", raising=False)
        stored = {"method": "graph_api", "oauth_tenant_id": "t", "oauth_client_id": "c"}
        cfg = EmailConfig.from_stored(stored)
        assert not get_backend(cfg.method).is_configured(cfg)


class TestApplyToRuntime:
    def test_applies_method_and_oauth_fields(self, monkeypatch):
        from app.services.email_backends.runtime import apply_email_settings_to_runtime

        for attr in (
            "EMAIL_METHOD",
            "EMAIL_OAUTH_PROVIDER",
            "EMAIL_OAUTH_TENANT_ID",
            "EMAIL_OAUTH_CLIENT_ID",
            "EMAIL_OAUTH_SCOPE",
            "EMAIL_GRAPH_SENDER",
        ):
            monkeypatch.setattr(real_settings, attr, "", raising=False)

        apply_email_settings_to_runtime(
            {
                "method": "graph_api",
                "oauth_provider": "microsoft",
                "oauth_tenant_id": "tenant-1",
                "oauth_client_id": "client-1",
                "graph_sender": "m@x.com",
                "oauth_scope": "custom/.default",
            }
        )
        assert real_settings.EMAIL_METHOD == "graph_api"
        assert real_settings.EMAIL_OAUTH_TENANT_ID == "tenant-1"
        assert real_settings.EMAIL_GRAPH_SENDER == "m@x.com"
        assert real_settings.EMAIL_OAUTH_SCOPE == "custom/.default"

    def test_clearing_a_field_clears_runtime(self, monkeypatch):
        """Presence-based fields can be cleared without a restart — a rotated
        service-account key or stale scope must not stay live in memory."""
        from app.services.email_backends.runtime import apply_email_settings_to_runtime

        monkeypatch.setattr(real_settings, "EMAIL_OAUTH_SCOPE", "old-scope", raising=False)
        monkeypatch.setattr(real_settings, "EMAIL_SERVICE_ACCOUNT_JSON", "old-key", raising=False)
        apply_email_settings_to_runtime({"oauth_scope": "", "service_account_json": ""})
        assert real_settings.EMAIL_OAUTH_SCOPE == ""
        assert real_settings.EMAIL_SERVICE_ACCOUNT_JSON == ""
