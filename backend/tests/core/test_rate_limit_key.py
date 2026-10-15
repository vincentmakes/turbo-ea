"""``core/rate_limit`` — one rate-limit bucket per client, not per proxy.

Behind the bundled edge nginx every socket peer is nginx, so a limiter keyed on
the peer alone counted every user in one shared bucket. The key is the client
address the audit log records (``client_ip``): ``X-Real-IP`` when
``TRUST_PROXY_HEADERS`` is on and the header parses, else the socket peer.
"""

from __future__ import annotations

import inspect
from types import SimpleNamespace

import pytest
from starlette.requests import Request

from app.config import settings
from app.core.rate_limit import limiter, rate_limit_key


def _request(headers=None, host="10.0.0.5"):
    return SimpleNamespace(
        headers=dict(headers or {}),
        client=SimpleNamespace(host=host) if host is not None else None,
    )


def _starlette_request(headers: dict[str, str], host: str = "10.0.0.5") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/auth/login",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
            "client": (host, 51234),
        }
    )


@pytest.fixture
def trusted(monkeypatch):
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", True)


@pytest.fixture
def untrusted(monkeypatch):
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", False)


def test_trusted_proxy_keys_on_x_real_ip(trusted):
    assert rate_limit_key(_request({"X-Real-IP": "203.0.113.9"})) == "203.0.113.9"


def test_two_clients_behind_one_proxy_get_two_buckets(trusted):
    a = rate_limit_key(_request({"X-Real-IP": "203.0.113.9"}, host="172.18.0.4"))
    b = rate_limit_key(_request({"X-Real-IP": "198.51.100.7"}, host="172.18.0.4"))
    assert a != b


def test_untrusted_proxy_keys_on_the_socket_peer(untrusted):
    assert rate_limit_key(_request({"X-Real-IP": "203.0.113.9"})) == "10.0.0.5"


def test_invalid_header_falls_back_to_the_socket_peer(trusted):
    for forged in ("not-an-ip", "1.2.3.4, 5.6.7.8", "999.1.1.1", ""):
        assert rate_limit_key(_request({"X-Real-IP": forged})) == "10.0.0.5", forged


def test_x_forwarded_for_is_never_a_key(trusted):
    assert rate_limit_key(_request({"X-Forwarded-For": "198.51.100.1"})) == "10.0.0.5"


def test_a_peer_that_is_not_an_ip_still_gets_a_key(untrusted):
    # Starlette's TestClient reports its peer as "testclient": ``client_ip``
    # drops it, and slowapi's own ``get_remote_address`` keeps it.
    assert rate_limit_key(_request(host="testclient")) == "testclient"


def test_no_peer_at_all_falls_back_to_slowapi_default(untrusted):
    assert rate_limit_key(_request(host=None)) == "127.0.0.1"


def test_a_real_starlette_request(trusted):
    request = _starlette_request({"X-Real-IP": "2001:DB8::1"}, host="172.18.0.4")
    assert rate_limit_key(request) == "2001:db8::1"


def test_the_limiter_uses_the_per_client_key():
    assert limiter._key_func is rate_limit_key
    # slowapi passes the request only to a key function whose parameter is
    # named ``request`` (``inspect.signature`` in ``Limiter._evaluate_limits``);
    # any other name would make it call the function with no argument.
    assert "request" in inspect.signature(rate_limit_key).parameters
