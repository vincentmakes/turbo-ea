"""What ``test_email_backends_mutants.py`` leaves open in ``GraphApiBackend``: the exact log
level and record count, the status boundaries, the bearer, the plain-text body, ``None`` fields
and the real client. No network."""

from __future__ import annotations

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services.email_backends import EmailConfig, graph, oauth
from app.services.email_backends.graph import GraphApiBackend


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


async def test_the_bearer_token_is_the_one_returned_by_the_token_request():
    _, post = await _send(token="another-token")
    assert post.await_args.kwargs["headers"] == {"Authorization": "Bearer another-token"}


async def test_the_plain_text_body_is_not_sent():
    _, post = await _send(body_text="PLAIN-ONLY-MARKER")
    assert "PLAIN-ONLY-MARKER" not in repr(post.await_args)


@pytest.mark.parametrize("status", [200, 202])
async def test_a_200_or_202_is_one_info_record(status, caplog):
    with caplog.at_level(logging.INFO, logger=graph.logger.name):
        await _send(post=AsyncMock(return_value=_response(status)))
    records = [
        r for r in caplog.records if r.name == graph.logger.name and r.levelno >= logging.INFO
    ]
    assert [(r.levelno, r.getMessage()) for r in records] == [
        (logging.INFO, "Email sent to to@x.com via graph_api: Subj")
    ]


@pytest.mark.parametrize("status", [199, 203, 301])
async def test_a_status_next_to_a_success_is_one_error_record_then_the_same_text(status, caplog):
    response = _response(status, {"error": {"message": "mailbox not found"}})
    with caplog.at_level(logging.INFO, logger=graph.logger.name):
        with pytest.raises(RuntimeError) as exc:
            await _send(post=AsyncMock(return_value=response))
    expected = f"Graph sendMail failed ({status}): mailbox not found"
    assert str(exc.value) == expected
    records = [
        r for r in caplog.records if r.name == graph.logger.name and r.levelno >= logging.INFO
    ]
    assert [(r.levelno, r.getMessage()) for r in records] == [(logging.ERROR, expected)]


async def test_the_real_client_is_built_once_and_closed(monkeypatch):
    monkeypatch.setattr(graph, "_client", None)
    first = graph._get_client()
    try:
        assert isinstance(first, httpx.AsyncClient)
        assert first.timeout == httpx.Timeout(30.0)
        assert graph._get_client() is first
    finally:
        await first.aclose()


@pytest.mark.parametrize(
    "field", ["oauth_tenant_id", "oauth_client_id", "oauth_client_secret", "graph_sender"]
)
def test_a_none_field_is_unconfigured(field):
    assert GraphApiBackend().is_configured(_cfg(**{field: None})) is False
