"""The exact calls ``GraphApiBackend`` makes, aimed at surviving mutants.

Every collaborator is a recorder: the token request and the HTTP client are asserted on whole
(arguments, keyword names, header and body), not on the one field a test cared about. No network.
"""

from __future__ import annotations

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.config import DEFAULT_SMTP_FROM
from app.services.email_backends import EmailConfig, graph, oauth
from app.services.email_backends.graph import GraphApiBackend

URL = "https://graph.microsoft.com/v1.0/users/mailbox%40company.com/sendMail"


def _cfg(**over) -> EmailConfig:
    base = dict(
        oauth_tenant_id="tenant-1",
        oauth_client_id="client-1",
        oauth_client_secret="secret-1",
        graph_sender="mailbox@company.com",
        oauth_scope="",
        oauth_token_endpoint="",
    )
    base.update(over)
    return EmailConfig(**base)


def _response(status: int = 202, body=None) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status
    resp.json.return_value = body if body is not None else {}
    resp.text = "raw-text"
    return resp


async def _send(cfg=None, *, post=None, token="TOK", **over):
    """Run ``send`` against recorders; return ``(token_mock, post_mock)``."""
    post = post or AsyncMock(return_value=_response())
    client = MagicMock()
    client.post = post
    token_mock = AsyncMock(return_value=token)
    kwargs = dict(
        to="to@x.com",
        subject="Subj",
        body_html="<p>Body</p>",
        body_text="Body",
        from_addr="",
    )
    kwargs.update(over)
    with (
        patch.object(oauth, "get_client_credentials_token", token_mock),
        patch.object(graph, "_get_client", return_value=client),
    ):
        await GraphApiBackend().send(cfg=cfg or _cfg(), **kwargs)
    return token_mock, post


async def test_the_token_is_requested_once_with_exactly_the_five_config_values():
    token_mock, _ = await _send(_cfg(oauth_scope="my/.default", oauth_token_endpoint="https://t/e"))
    token_mock.assert_awaited_once_with(
        tenant_id="tenant-1",
        client_id="client-1",
        client_secret="secret-1",
        scope="my/.default",
        token_endpoint="https://t/e",
    )


async def test_an_empty_scope_falls_back_to_the_graph_default_and_nothing_else():
    token_mock, _ = await _send(_cfg(oauth_scope=""))
    assert token_mock.await_args.kwargs["scope"] == "https://graph.microsoft.com/.default"
    assert token_mock.await_args.kwargs["token_endpoint"] == ""
    assert token_mock.await_args.args == ()


async def test_the_post_is_one_call_with_the_url_alone_and_json_and_headers_by_keyword():
    _, post = await _send(from_addr="")
    post.assert_awaited_once()
    assert post.await_args.args == (URL,)
    assert set(post.await_args.kwargs) == {"json", "headers"}
    assert post.await_args.kwargs["headers"] == {"Authorization": "Bearer TOK"}
    assert post.await_args.kwargs["json"] == {
        "message": {
            "subject": "Subj",
            "body": {"contentType": "HTML", "content": "<p>Body</p>"},
            "toRecipients": [{"emailAddress": {"address": "to@x.com"}}],
        },
        "saveToSentItems": False,
    }


async def test_the_bearer_token_is_the_one_returned_by_the_token_request():
    _, post = await _send(token="another-token")
    assert post.await_args.kwargs["headers"] == {"Authorization": "Bearer another-token"}


async def test_the_plain_text_body_is_not_sent():
    _, post = await _send(body_text="PLAIN-ONLY-MARKER")
    assert "PLAIN-ONLY-MARKER" not in repr(post.await_args)


@pytest.mark.parametrize(
    ("from_addr", "explicit"),
    [
        ("", False),
        (DEFAULT_SMTP_FROM, False),
        ("mailbox@company.com", False),
        ("Mailbox@Company.COM", False),
        ("MAILBOX@COMPANY.COM", False),
        ("brand@x.com", True),
        ("brand@company.com", True),
    ],
)
async def test_an_explicit_from_only_when_it_differs_from_placeholder_and_sender(
    from_addr, explicit
):
    _, post = await _send(from_addr=from_addr)
    message = post.await_args.kwargs["json"]["message"]
    if explicit:
        assert message["from"] == {"emailAddress": {"address": from_addr}}
    else:
        assert "from" not in message
    assert set(message) == {"subject", "body", "toRecipients"} | ({"from"} if explicit else set())


async def test_a_mixed_case_sender_is_compared_in_lower_case_on_both_sides():
    cfg = _cfg(graph_sender="Mailbox@Company.COM")
    _, post = await _send(cfg, from_addr="MAILBOX@company.com")
    assert "from" not in post.await_args.kwargs["json"]["message"]
    assert post.await_args.args == (
        "https://graph.microsoft.com/v1.0/users/Mailbox%40Company.COM/sendMail",
    )


@pytest.mark.parametrize("status", [200, 202])
async def test_a_200_or_202_is_a_success_logged_at_info(status, caplog):
    with caplog.at_level(logging.DEBUG, logger=graph.logger.name):
        await _send(post=AsyncMock(return_value=_response(status)))
    records = [r for r in caplog.records if r.name == graph.logger.name]
    assert [(r.levelno, r.getMessage()) for r in records] == [
        (logging.INFO, "Email sent to to@x.com via graph_api: Subj")
    ]


@pytest.mark.parametrize("status", [199, 201, 203, 204, 301, 400, 401, 403, 404, 429, 500, 503])
async def test_any_other_status_logs_at_error_then_raises_the_same_text(status, caplog):
    response = _response(status, {"error": {"message": "mailbox not found"}})
    with caplog.at_level(logging.DEBUG, logger=graph.logger.name):
        with pytest.raises(RuntimeError) as exc:
            await _send(post=AsyncMock(return_value=response))
    expected = f"Graph sendMail failed ({status}): mailbox not found"
    assert str(exc.value) == expected
    records = [r for r in caplog.records if r.name == graph.logger.name]
    assert [(r.levelno, r.getMessage()) for r in records] == [(logging.ERROR, expected)]


async def test_the_error_detail_is_what_safe_error_extracts_from_the_response():
    response = _response(400, {"error_description": "AADSTS70011 invalid scope"})
    with pytest.raises(RuntimeError) as exc:
        await _send(post=AsyncMock(return_value=response))
    assert str(exc.value) == "Graph sendMail failed (400): AADSTS70011 invalid scope"


async def test_a_failing_token_request_means_no_http_call():
    post = AsyncMock(return_value=_response())
    client = MagicMock()
    client.post = post
    with (
        patch.object(
            oauth, "get_client_credentials_token", AsyncMock(side_effect=RuntimeError("tok"))
        ),
        patch.object(graph, "_get_client", return_value=client),
    ):
        with pytest.raises(RuntimeError, match="^tok$"):
            await GraphApiBackend().send(
                cfg=_cfg(), to="a@x", subject="s", body_html="h", body_text="t", from_addr=""
            )
    post.assert_not_awaited()


# ── the shared client ─────────────────────────────────────────────────────


async def test_the_real_client_is_built_once_with_a_30_second_timeout(monkeypatch):
    monkeypatch.setattr(graph, "_client", None)
    first = graph._get_client()
    try:
        assert isinstance(first, httpx.AsyncClient)
        assert first.timeout == httpx.Timeout(30.0)
        assert graph._get_client() is first
        assert graph._client is first
    finally:
        await first.aclose()


def test_an_existing_client_is_reused_and_never_rebuilt(monkeypatch):
    sentinel = object()
    monkeypatch.setattr(graph, "_client", sentinel)
    constructor = MagicMock(side_effect=AssertionError("must not rebuild"))
    monkeypatch.setattr(graph.httpx, "AsyncClient", constructor)
    assert graph._get_client() is sentinel
    constructor.assert_not_called()


def test_the_client_is_built_with_the_timeout_keyword_only(monkeypatch):
    monkeypatch.setattr(graph, "_client", None)
    built = MagicMock()
    constructor = MagicMock(return_value=built)
    monkeypatch.setattr(graph.httpx, "AsyncClient", constructor)
    assert graph._get_client() is built
    constructor.assert_called_once_with(timeout=30.0)
    assert graph._client is built


# ── is_configured ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("empty", ["", None])
@pytest.mark.parametrize(
    "field", ["oauth_tenant_id", "oauth_client_id", "oauth_client_secret", "graph_sender"]
)
def test_one_missing_field_is_enough_to_be_unconfigured(field, empty):
    assert GraphApiBackend().is_configured(_cfg(**{field: empty})) is False


def test_all_four_fields_make_it_configured_and_the_answer_is_a_real_bool():
    answer = GraphApiBackend().is_configured(_cfg())
    assert answer is True
    nothing = GraphApiBackend().is_configured(EmailConfig())
    assert nothing is False
