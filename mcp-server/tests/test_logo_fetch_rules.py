"""Every rule ``logo_fetch`` enforces, at its edge.

``test_logo_fetch.py`` tells the story of each guard; this file pins the exact
shape of each one — the status a refusal carries, the byte that tips the cap,
the request the client is built to send, how many hops a redirect chain gets
and when a cached fetch goes stale — so a mutation of any of them fails.
"""

from __future__ import annotations

import socket
from typing import ClassVar

import httpx
import pytest

from turbo_ea_mcp import config, logo_fetch
from turbo_ea_mcp.logo_fetch import (
    FETCH_CACHE,
    FETCH_TIMEOUT_S,
    MAX_LOGO_BYTES,
    MAX_REDIRECTS,
    USER_AGENT,
    LogoFetchError,
    _check_addresses,
    _check_url,
    _FetchCache,
    _read_capped,
    allowed_hosts,
    fetch_logo,
    fetch_logo_cached,
)

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40
HOST = "raw.githubusercontent.com"
URL = f"https://{HOST}/logo.png"


def sniff_png(head: bytes) -> str | None:
    return "image/png" if head.startswith(b"\x89PNG") else None


@pytest.fixture(autouse=True)
def _defaults(monkeypatch):
    monkeypatch.setattr(logo_fetch, "MCP_LOGO_FETCH_ENABLED", True)
    monkeypatch.setattr(logo_fetch, "MCP_LOGO_FETCH_HOSTS", (HOST, "cdn.jsdelivr.net"))
    FETCH_CACHE.clear()
    yield
    FETCH_CACHE.clear()


def refusal(fn, *args) -> LogoFetchError:
    with pytest.raises(LogoFetchError) as exc:
        fn(*args)
    return exc.value


def test_constants():
    assert MAX_LOGO_BYTES == 1024 * 1024
    assert FETCH_TIMEOUT_S == 10.0
    assert MAX_REDIRECTS == 2
    assert USER_AGENT == f"TurboEA-MCP/{config.APP_VERSION} (+https://turbo-ea.org; card-logo)"


def test_the_error_carries_status_message_and_remedy():
    err = LogoFetchError("too_large", "big", remedy="shrink it")
    assert (err.status, err.message, err.remedy, str(err)) == (
        "too_large",
        "big",
        "shrink it",
        "big",
    )
    assert LogoFetchError("s", "m").remedy is None


def test_allowed_hosts_reads_the_configured_list():
    assert allowed_hosts() == (HOST, "cdn.jsdelivr.net")


class TestCheckUrl:
    def test_returns_the_lowercased_host(self):
        assert _check_url("https://RAW.GitHubUserContent.com:443/x.png") == HOST

    @pytest.mark.parametrize("url", [f"http://{HOST}/x.png", f"ftp://{HOST}/x", "x.png"])
    def test_only_https(self, url):
        err = refusal(_check_url, url)
        assert err.status == "image_url_invalid"
        assert err.message == (
            "Only https:// URLs are fetched. Plain http is refused because the "
            "bytes would be modifiable in transit."
        )

    @pytest.mark.parametrize("userinfo", ["user@", "user:pw@", ":pw@"])
    def test_credentials_are_refused(self, userinfo):
        err = refusal(_check_url, f"https://{userinfo}{HOST}/x.png")
        assert err.status == "image_url_invalid"
        assert err.message == "A URL carrying credentials is refused."

    def test_a_string_urlsplit_cannot_parse(self):
        err = refusal(_check_url, "https://[::1/x.png")
        assert (err.status, err.message) == ("image_url_invalid", "Not a URL: Invalid IPv6 URL")

    def test_a_url_without_a_host(self):
        err = refusal(_check_url, "https:///x.png")
        assert (err.status, err.message) == ("image_url_invalid", "The URL has no host.")

    def test_only_port_443(self):
        err = refusal(_check_url, f"https://{HOST}:8443/x.png")
        assert err.status == "image_url_invalid"
        assert err.message == "Only port 443 is fetched, not 8443."

    def test_a_host_off_the_list(self):
        err = refusal(_check_url, "https://evil.test/x.png")
        assert err.status == "image_url_not_allowed"
        assert err.message == "'evil.test' is not an allowed logo source."
        assert err.remedy == (
            f"Logos may be fetched from: {HOST}, cdn.jsdelivr.net. Point image_url at one "
            "of those, or fetch the image yourself and send it as image_base64 instead."
        )


def resolving_to(monkeypatch, *addresses: str) -> list[tuple]:
    calls: list[tuple] = []

    def fake(host, port, proto=None):
        calls.append((host, port, proto))
        return [(None, None, None, "", (a, 443)) for a in addresses]

    monkeypatch.setattr(socket, "getaddrinfo", fake)
    return calls


class FakeIp:
    """An address with exactly one property set — to test each test alone."""

    def __init__(self, flag: str | None) -> None:
        for name in (
            "is_private",
            "is_loopback",
            "is_link_local",
            "is_reserved",
            "is_multicast",
            "is_unspecified",
        ):
            setattr(self, name, name == flag)


class TestCheckAddresses:
    def test_a_public_address_passes_and_resolves_port_443_over_tcp(self, monkeypatch):
        calls = resolving_to(monkeypatch, "93.184.216.34", "2606:2800:220:1::1")
        _check_addresses(HOST)
        assert calls == [(HOST, 443, socket.IPPROTO_TCP)]

    @pytest.mark.parametrize(
        "address",
        ["10.0.0.1", "127.0.0.1", "169.254.169.254", "224.0.0.1", "0.0.0.0", "::1", "ff02::1"],
    )
    def test_non_public_addresses_are_refused(self, monkeypatch, address):
        resolving_to(monkeypatch, address)
        err = refusal(_check_addresses, HOST)
        assert err.status == "image_url_blocked"
        assert err.message == f"'{HOST}' resolves to {address}, which is not a public address."

    def test_one_private_answer_among_public_ones_is_enough(self, monkeypatch):
        resolving_to(monkeypatch, "93.184.216.34", "10.0.0.7")
        err = refusal(_check_addresses, HOST)
        assert "10.0.0.7" in err.message

    @pytest.mark.parametrize(
        "flag",
        [
            "is_private",
            "is_loopback",
            "is_link_local",
            "is_reserved",
            "is_multicast",
            "is_unspecified",
        ],
    )
    def test_each_property_refuses_on_its_own(self, monkeypatch, flag):
        resolving_to(monkeypatch, "203.0.113.9")
        monkeypatch.setattr(logo_fetch.ipaddress, "ip_address", lambda a: FakeIp(flag))
        assert refusal(_check_addresses, HOST).status == "image_url_blocked"

    def test_no_property_set_passes(self, monkeypatch):
        resolving_to(monkeypatch, "203.0.113.9")
        monkeypatch.setattr(logo_fetch.ipaddress, "ip_address", lambda a: FakeIp(None))
        _check_addresses(HOST)

    def test_an_unresolvable_host(self, monkeypatch):
        def fail(*a, **kw):
            raise socket.gaierror("Name or service not known")

        monkeypatch.setattr(socket, "getaddrinfo", fail)
        err = refusal(_check_addresses, HOST)
        assert err.status == "image_url_unreachable"
        assert err.message == f"Could not resolve '{HOST}': Name or service not known"


class Body:
    """A response whose body comes in the given chunks, failing if over-read."""

    def __init__(self, *chunks: bytes, then_fail: bool = False) -> None:
        self.chunks = chunks
        self.then_fail = then_fail
        self.pulled = 0

    async def aiter_bytes(self):
        for c in self.chunks:
            self.pulled += 1
            yield c
        if self.then_fail:
            raise AssertionError("read past the cap")


class TestReadCapped:
    @pytest.mark.asyncio
    async def test_joins_the_chunks_in_order(self):
        assert await _read_capped(Body(b"ab", b"", b"cd")) == b"abcd"

    @pytest.mark.asyncio
    async def test_exactly_the_cap_is_accepted(self):
        half = b"x" * (MAX_LOGO_BYTES // 2)
        assert len(await _read_capped(Body(half, half))) == MAX_LOGO_BYTES

    @pytest.mark.asyncio
    async def test_one_byte_over_stops_the_read(self):
        body = Body(b"x" * MAX_LOGO_BYTES, b"y", b"never", then_fail=True)
        with pytest.raises(LogoFetchError) as exc:
            await _read_capped(body)
        assert exc.value.status == "too_large"
        assert exc.value.message == (
            f"The image at this URL is larger than the {MAX_LOGO_BYTES} byte cap."
        )
        assert body.pulled == 2


class Response:
    def __init__(self, status=200, *, location=None, chunks=(PNG,)):
        self.status_code = status
        self.headers = {} if location is None else {"location": location}
        self._chunks = chunks

    @property
    def is_redirect(self):
        return self.status_code in (301, 302, 303, 307, 308)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def aiter_bytes(self):
        for c in self._chunks:
            yield c


@pytest.fixture
def web(monkeypatch):
    """Serve ``web.responses`` in order; record client kwargs, requests and DNS checks."""

    class Web:
        responses: ClassVar[list] = []
        clients: ClassVar[list[dict]] = []
        requests: ClassVar[list[tuple[str, str]]] = []
        resolved: ClassVar[list[str]] = []
        error: Exception | None = None

    Web.responses, Web.clients, Web.requests, Web.resolved = [], [], [], []

    class FakeClient:
        def __init__(self, **kwargs):
            Web.clients.append(kwargs)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        def stream(self, method, url):
            Web.requests.append((method, str(url)))
            if Web.error is not None:
                raise Web.error
            return Web.responses.pop(0)

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(logo_fetch, "_check_addresses", Web.resolved.append)
    return Web


async def fetch_refusal(url=URL, sniff=sniff_png) -> LogoFetchError:
    with pytest.raises(LogoFetchError) as exc:
        await fetch_logo(url, sniff)
    return exc.value


class TestFetchLogo:
    @pytest.mark.asyncio
    async def test_a_plain_fetch(self, web):
        web.responses = [Response()]
        seen: list[bytes] = []

        def sniff(head):
            seen.append(head)
            return "image/png"

        assert await fetch_logo(URL, sniff) == (PNG, "image/png")
        assert seen == [PNG[:16]]
        assert web.requests == [("GET", URL)]
        assert web.resolved == [HOST]
        assert web.clients == [
            {
                "timeout": 10.0,
                "follow_redirects": False,
                "headers": {"User-Agent": USER_AGENT, "Accept": "image/*"},
            }
        ]

    @pytest.mark.asyncio
    async def test_disabled(self, web, monkeypatch):
        monkeypatch.setattr(logo_fetch, "MCP_LOGO_FETCH_ENABLED", False)
        err = await fetch_refusal()
        assert err.status == "image_url_disabled"
        assert err.message == (
            "Fetching logos by URL is switched off on this instance (MCP_LOGO_FETCH_ENABLED=false)."
        )
        assert err.remedy == (
            "Send the image as image_base64, or use an icon_slug from the bundled packs."
        )
        assert web.requests == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", [204, 404, 500])
    async def test_anything_but_200_is_unreachable(self, web, status):
        web.responses = [Response(status)]
        err = await fetch_refusal()
        assert (err.status, err.message) == (
            "image_url_unreachable",
            f"The URL answered {status}.",
        )

    @pytest.mark.asyncio
    async def test_a_transport_error_is_unreachable(self, web):
        web.error = httpx.ConnectError("refused")
        err = await fetch_refusal()
        assert (err.status, err.message) == (
            "image_url_unreachable",
            "Could not fetch the URL: refused",
        )

    @pytest.mark.asyncio
    async def test_an_empty_body(self, web):
        web.responses = [Response(chunks=())]
        err = await fetch_refusal()
        assert (err.status, err.message) == ("empty_image", "The URL returned no bytes.")

    @pytest.mark.asyncio
    async def test_bytes_the_sniffer_does_not_recognise(self, web):
        web.responses = [Response(chunks=(b"<svg/>",))]
        err = await fetch_refusal()
        assert err.status == "missing_mime"
        assert err.message == (
            "What came back is not a PNG, JPEG, WebP or GIF — an SVG or an error page, most "
            "likely. Check the URL points straight at a raster image file."
        )

    @pytest.mark.asyncio
    async def test_a_body_over_the_cap(self, web):
        web.responses = [Response(chunks=(b"x" * (MAX_LOGO_BYTES + 1),))]
        assert (await fetch_refusal()).status == "too_large"

    @pytest.mark.asyncio
    async def test_two_redirects_are_followed_each_revalidated(self, web):
        web.responses = [
            Response(302, location="https://cdn.jsdelivr.net/a.png"),
            Response(301, location="/b.png"),
            Response(),
        ]
        assert await fetch_logo(URL, sniff_png) == (PNG, "image/png")
        assert [u for _, u in web.requests] == [
            URL,
            "https://cdn.jsdelivr.net/a.png",
            "https://cdn.jsdelivr.net/b.png",
        ]
        assert web.resolved == [HOST, "cdn.jsdelivr.net", "cdn.jsdelivr.net"]

    @pytest.mark.asyncio
    async def test_a_third_redirect_is_refused(self, web):
        web.responses = [
            Response(302, location="/1.png"),
            Response(302, location="/2.png"),
            Response(302, location="/3.png"),
        ]
        err = await fetch_refusal()
        assert (err.status, err.message) == (
            "image_url_unreachable",
            "Too many redirects, or a redirect with no target.",
        )
        assert len(web.requests) == 3

    @pytest.mark.asyncio
    async def test_a_redirect_without_a_location(self, web):
        web.responses = [Response(302)]
        err = await fetch_refusal()
        assert err.message == "Too many redirects, or a redirect with no target."
        assert len(web.requests) == 1

    @pytest.mark.asyncio
    async def test_a_redirect_to_a_refused_scheme_is_refused_before_a_request(self, web):
        web.responses = [Response(302, location=f"http://{HOST}/x.png")]
        err = await fetch_refusal()
        assert err.status == "image_url_invalid"
        assert len(web.requests) == 1


class TestFetchCache:
    def test_defaults(self):
        cache = _FetchCache()
        assert (cache._max, cache._ttl) == (64, 600.0)
        assert (FETCH_CACHE._max, FETCH_CACHE._ttl) == (64, 600.0)

    def test_miss_put_hit_clear(self):
        cache = _FetchCache()
        assert cache.get("u") is None
        cache.put("u", b"d", "image/png")
        assert cache.get("u") == (b"d", "image/png")
        cache.clear()
        assert cache.get("u") is None

    def test_an_entry_is_fresh_up_to_and_including_the_ttl(self, monkeypatch):
        clock = [1000.0]
        monkeypatch.setattr(logo_fetch.time, "monotonic", lambda: clock[0])
        cache = _FetchCache(ttl_s=10.0)
        cache.put("u", b"d", "m")
        clock[0] = 1010.0
        assert cache.get("u") == (b"d", "m")
        clock[0] = 1010.5
        assert cache.get("u") is None
        assert "u" not in cache._items

    def test_the_oldest_entry_makes_room(self):
        cache = _FetchCache(max_entries=2)
        cache.put("a", b"1", "m")
        cache.put("b", b"2", "m")
        cache.put("c", b"3", "m")
        assert list(cache._items) == ["b", "c"]
        assert cache.get("a") is None

    def test_a_cache_with_room_keeps_everything(self):
        cache = _FetchCache(max_entries=3)
        for key in "abc":
            cache.put(key, b"", "m")
        assert list(cache._items) == ["a", "b", "c"]


class TestFetchLogoCached:
    @pytest.mark.asyncio
    async def test_stores_the_fetch_and_serves_it_back(self, web):
        web.responses = [Response()]
        assert await fetch_logo_cached(URL, sniff_png) == (PNG, "image/png")
        assert FETCH_CACHE.get(URL) == (PNG, "image/png")
        assert await fetch_logo_cached(URL, sniff_png) == (PNG, "image/png")
        assert len(web.requests) == 1

    @pytest.mark.asyncio
    async def test_a_refusal_is_not_cached(self, web):
        web.responses = [Response(404)]
        with pytest.raises(LogoFetchError):
            await fetch_logo_cached(URL, sniff_png)
        assert FETCH_CACHE.get(URL) is None
