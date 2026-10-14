"""``core/request_context`` — the client address and agent the audit log records.

``X-Real-IP`` is the edge nginx's ``$remote_addr`` and is honoured only when the
deployment says nothing reaches the backend except through it
(``TRUST_PROXY_HEADERS``); every candidate must parse as an IP address, so a
forged header can never write arbitrary text into the audit log.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.config import settings
from app.core import request_context
from app.core.request_context import USER_AGENT_MAX_LENGTH, client_ip, user_agent


def _request(headers=None, host="10.0.0.5"):
    return SimpleNamespace(
        headers=dict(headers or {}),
        client=SimpleNamespace(host=host) if host is not None else None,
    )


@pytest.fixture
def trusted(monkeypatch):
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", True)


@pytest.fixture
def untrusted(monkeypatch):
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", False)


def test_the_module_reads_the_shared_settings_object():
    assert request_context.settings is settings


def test_x_real_ip_only_when_proxy_headers_trusted(monkeypatch):
    request = _request({"X-Real-IP": "203.0.113.9"})
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", False)
    assert client_ip(request) == "10.0.0.5"
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", True)
    assert client_ip(request) == "203.0.113.9"


def test_x_forwarded_for_is_never_read(trusted):
    request = _request({"X-Forwarded-For": "198.51.100.1"})
    assert client_ip(request) == "10.0.0.5"


def test_invalid_ip_header_is_dropped(trusted):
    for forged in ("not-an-ip", "<script>", "1.2.3.4, 5.6.7.8", "999.1.1.1", ""):
        assert client_ip(_request({"X-Real-IP": forged})) == "10.0.0.5", forged


def test_an_ipv6_header_is_normalised(trusted):
    assert client_ip(_request({"X-Real-IP": " 2001:DB8::0001 "})) == "2001:db8::1"


def test_the_socket_peer_must_parse_too(untrusted):
    assert client_ip(_request(host="testclient")) is None
    assert client_ip(_request(host=None)) is None
    assert client_ip(_request(host="")) is None


def test_neither_parses_is_none(trusted):
    assert client_ip(_request({"X-Real-IP": "nope"}, host="also-nope")) is None


def test_user_agent_truncated():
    assert USER_AGENT_MAX_LENGTH == 255
    long = "A" * 1000
    assert user_agent(_request({"User-Agent": long})) == "A" * 255
    assert user_agent(_request({"User-Agent": "curl/8.1"})) == "curl/8.1"
    assert user_agent(_request({"User-Agent": ""})) is None
    assert user_agent(_request()) is None


def test_the_contextvar_defaults_to_outside_a_request():
    assert request_context.request_client.get() is None


async def test_the_middleware_parks_the_client_for_the_request_and_resets_it(monkeypatch):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.main import capture_request_origin

    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", True)
    probe = FastAPI()
    probe.middleware("http")(capture_request_origin)

    @probe.get("/probe")
    async def _probe():
        return {"client": request_context.request_client.get()}

    async with AsyncClient(transport=ASGITransport(app=probe), base_url="http://t") as c:
        resp = await c.get("/probe", headers={"X-Real-IP": "203.0.113.4", "User-Agent": "ua/1"})
    assert resp.json() == {"client": ["203.0.113.4", "ua/1"]}
    assert request_context.request_client.get() is None
