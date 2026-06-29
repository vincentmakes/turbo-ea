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

    def test_xoauth2_microsoft_requires_oauth(self):
        backend = get_backend("smtp_oauth")
        assert not backend.is_configured(EmailConfig(method="smtp_oauth", smtp_host="h"))
        cfg = EmailConfig(
            method="smtp_oauth",
            smtp_host="smtp.office365.com",
            oauth_tenant_id="t",
            oauth_client_id="c",
            oauth_client_secret="s",
        )
        assert backend.is_configured(cfg)

    def test_xoauth2_google_requires_service_account(self):
        backend = get_backend("smtp_oauth")
        cfg = EmailConfig(
            method="smtp_oauth",
            smtp_host="smtp.gmail.com",
            oauth_provider="google",
            service_account_json='{"client_email":"x","private_key":"y"}',
        )
        assert backend.is_configured(cfg)


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


class TestGraphBackend:
    async def test_send_posts_to_graph(self, monkeypatch):
        _configure_graph(monkeypatch)
        send_resp = MagicMock()
        send_resp.status_code = 202
        post = AsyncMock(return_value=send_resp)
        client = MagicMock()
        client.post = post
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)

        with (
            patch(
                "app.services.email_backends.oauth.get_client_credentials_token",
                AsyncMock(return_value="GRAPH_TOKEN"),
            ),
            patch("app.services.email_backends.graph.httpx.AsyncClient", return_value=client),
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
        # From differs from sender mailbox -> from header set
        assert body["message"]["from"]["emailAddress"]["address"] == "brand@company.com"

    async def test_send_raises_on_failure(self, monkeypatch):
        _configure_graph(monkeypatch)
        send_resp = MagicMock()
        send_resp.status_code = 403
        send_resp.json.return_value = {"error": {"message": "forbidden"}}
        post = AsyncMock(return_value=send_resp)
        client = MagicMock()
        client.post = post
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)

        with (
            patch(
                "app.services.email_backends.oauth.get_client_credentials_token",
                AsyncMock(return_value="GRAPH_TOKEN"),
            ),
            patch("app.services.email_backends.graph.httpx.AsyncClient", return_value=client),
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
        mock_smtp.docmd.assert_called_once()
        cmd, arg = mock_smtp.docmd.call_args.args
        assert cmd == "AUTH"
        assert arg.startswith("XOAUTH2 ")
        decoded = base64.b64decode(arg.split(" ", 1)[1])
        assert b"auth=Bearer XO_TOKEN" in decoded
        assert b"user=mailbox@company.com" in decoded
        mock_smtp.login.assert_not_called()  # OAuth, never basic login
