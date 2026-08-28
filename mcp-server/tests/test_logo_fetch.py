"""The one outbound path in the MCP server, and the guards on it.

Every test here is about a refusal. The happy path is one call; the value is in
proving that a URL nobody vetted cannot reach the customer's own network, cannot
exhaust this container's memory, and cannot smuggle a script past the image
check by wearing a redirect.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from turbo_ea_mcp import logo_fetch, server

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40


def _sniff(head: bytes) -> str | None:
    return "image/png" if head.startswith(b"\x89PNG") else None


class _FakeStream:
    """Stands in for `client.stream(...)`'s async context manager."""

    def __init__(self, *, status: int = 200, headers=None, chunks=(PNG,)):
        self.status_code = status
        self.headers = headers or {}
        self._chunks = chunks

    @property
    def is_redirect(self) -> bool:
        return self.status_code in (301, 302, 303, 307, 308)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def aiter_bytes(self):
        for c in self._chunks:
            yield c


def _client(stream: _FakeStream, seen: list[str] | None = None):
    """A patched httpx.AsyncClient whose `stream` records the URLs asked for."""

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        def stream(self, _method, url):
            if seen is not None:
                seen.append(str(url))
            return stream

    return FakeClient


@pytest.fixture(autouse=True)
def _clear_cache():
    logo_fetch.FETCH_CACHE.clear()
    yield
    logo_fetch.FETCH_CACHE.clear()


@pytest.fixture
def public_dns(monkeypatch):
    """Every host resolves to a public address unless a test says otherwise."""
    monkeypatch.setattr(logo_fetch, "_check_addresses", lambda host: None)


class TestTheAllowlist:
    @pytest.mark.asyncio
    async def test_a_host_off_the_list_is_refused_without_a_request(self, public_dns):
        # The refusal has to happen before any packet leaves: an allowlist that
        # is checked after connecting is not an allowlist.
        with patch.object(httpx, "AsyncClient", AsyncMock(side_effect=AssertionError)):
            with pytest.raises(logo_fetch.LogoFetchError) as err:
                await logo_fetch.fetch_logo("https://evil.test/logo.png", _sniff)
        assert err.value.status == "image_url_not_allowed"
        # And it names what would work, so the agent can retry rather than stop.
        assert "raw.githubusercontent.com" in (err.value.remedy or "")

    @pytest.mark.asyncio
    async def test_a_lookalike_suffix_does_not_pass(self, public_dns):
        # Exact host match, never `endswith`: this is the classic bypass.
        with pytest.raises(logo_fetch.LogoFetchError) as err:
            await logo_fetch.fetch_logo(
                "https://raw.githubusercontent.com.attacker.test/x.png", _sniff
            )
        assert err.value.status == "image_url_not_allowed"

    @pytest.mark.asyncio
    async def test_plain_http_is_refused(self, public_dns):
        with pytest.raises(logo_fetch.LogoFetchError) as err:
            await logo_fetch.fetch_logo("http://raw.githubusercontent.com/x.png", _sniff)
        assert err.value.status == "image_url_invalid"

    @pytest.mark.asyncio
    async def test_credentials_in_the_url_are_refused(self, public_dns):
        with pytest.raises(logo_fetch.LogoFetchError) as err:
            await logo_fetch.fetch_logo(
                "https://user:pw@raw.githubusercontent.com/x.png", _sniff
            )
        assert err.value.status == "image_url_invalid"

    @pytest.mark.asyncio
    async def test_the_allowlist_is_configurable(self, public_dns, monkeypatch):
        monkeypatch.setattr(logo_fetch, "MCP_LOGO_FETCH_HOSTS", ("icons.example.test",))
        seen: list[str] = []
        with patch.object(httpx, "AsyncClient", _client(_FakeStream(), seen)):
            data, mime = await logo_fetch.fetch_logo(
                "https://icons.example.test/logo.png", _sniff
            )
        assert (data, mime) == (PNG, "image/png")
        assert seen == ["https://icons.example.test/logo.png"]


class TestPrivateSpace:
    @pytest.mark.asyncio
    async def test_a_host_resolving_to_the_metadata_service_is_refused(self, monkeypatch):
        # The allowlist should already have stopped this; the address check is
        # what makes a poisoned DNS answer for an allowed host inert.
        monkeypatch.setattr(
            logo_fetch.socket,
            "getaddrinfo",
            lambda *a, **kw: [(2, 1, 6, "", ("169.254.169.254", 443))],
        )
        with pytest.raises(logo_fetch.LogoFetchError) as err:
            await logo_fetch.fetch_logo(
                "https://raw.githubusercontent.com/x.png", _sniff
            )
        assert err.value.status == "image_url_blocked"

    @pytest.mark.asyncio
    async def test_a_host_on_the_local_network_is_refused(self, monkeypatch):
        monkeypatch.setattr(
            logo_fetch.socket,
            "getaddrinfo",
            lambda *a, **kw: [(2, 1, 6, "", ("10.0.0.5", 443))],
        )
        with pytest.raises(logo_fetch.LogoFetchError) as err:
            await logo_fetch.fetch_logo(
                "https://raw.githubusercontent.com/x.png", _sniff
            )
        assert err.value.status == "image_url_blocked"


class TestTheResponse:
    @pytest.mark.asyncio
    async def test_a_body_past_the_cap_stops_mid_read(self, public_dns):
        # Streamed, so an endless body cannot be used to exhaust this
        # container: the read stops at the chunk that crosses the line.
        big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (logo_fetch.MAX_LOGO_BYTES // 2)
        with patch.object(httpx, "AsyncClient", _client(_FakeStream(chunks=(big, big, big)))):
            with pytest.raises(logo_fetch.LogoFetchError) as err:
                await logo_fetch.fetch_logo(
                    "https://raw.githubusercontent.com/x.png", _sniff
                )
        assert err.value.status == "too_large"

    @pytest.mark.asyncio
    async def test_something_that_is_not_a_raster_image_is_refused(self, public_dns):
        # An SVG or an HTML error page: the signature is the control, never the
        # URL's extension or the server's content type.
        svg = b"<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>"
        with patch.object(httpx, "AsyncClient", _client(_FakeStream(chunks=(svg,)))):
            with pytest.raises(logo_fetch.LogoFetchError) as err:
                await logo_fetch.fetch_logo(
                    "https://raw.githubusercontent.com/x.svg", _sniff
                )
        assert err.value.status == "missing_mime"

    @pytest.mark.asyncio
    async def test_an_error_status_is_reported_not_stored(self, public_dns):
        with patch.object(httpx, "AsyncClient", _client(_FakeStream(status=404, chunks=()))):
            with pytest.raises(logo_fetch.LogoFetchError) as err:
                await logo_fetch.fetch_logo(
                    "https://raw.githubusercontent.com/missing.png", _sniff
                )
        assert err.value.status == "image_url_unreachable"
        assert "404" in err.value.message


class TestRedirects:
    @pytest.mark.asyncio
    async def test_a_redirect_off_the_allowlist_is_refused(self, public_dns):
        # Following redirects blindly would make the allowlist decorative.
        redirect = _FakeStream(
            status=302, headers={"location": "https://evil.test/logo.png"}, chunks=()
        )
        with patch.object(httpx, "AsyncClient", _client(redirect)):
            with pytest.raises(logo_fetch.LogoFetchError) as err:
                await logo_fetch.fetch_logo(
                    "https://cdn.jsdelivr.net/x.png", _sniff
                )
        assert err.value.status == "image_url_not_allowed"

    @pytest.mark.asyncio
    async def test_a_redirect_within_the_allowlist_is_followed(self, public_dns):
        seen: list[str] = []
        states = [
            _FakeStream(
                status=302,
                headers={"location": "https://raw.githubusercontent.com/real.png"},
                chunks=(),
            ),
            _FakeStream(),
        ]

        class FakeClient:
            def __init__(self, *a, **kw):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            def stream(self, _m, url):
                seen.append(str(url))
                return states[len(seen) - 1]

        with patch.object(httpx, "AsyncClient", FakeClient):
            data, _ = await logo_fetch.fetch_logo(
                "https://cdn.jsdelivr.net/x.png", _sniff
            )
        assert data == PNG
        assert seen[-1] == "https://raw.githubusercontent.com/real.png"


class TestTheKillSwitch:
    @pytest.mark.asyncio
    async def test_disabled_refuses_before_opening_a_client(self, monkeypatch, public_dns):
        monkeypatch.setattr(logo_fetch, "MCP_LOGO_FETCH_ENABLED", False)
        with patch.object(httpx, "AsyncClient", AsyncMock(side_effect=AssertionError)):
            with pytest.raises(logo_fetch.LogoFetchError) as err:
                await logo_fetch.fetch_logo(
                    "https://raw.githubusercontent.com/x.png", _sniff
                )
        assert err.value.status == "image_url_disabled"
        assert "image_base64" in (err.value.remedy or "")


class TestTheCache:
    @pytest.mark.asyncio
    async def test_a_preview_and_the_commit_after_it_fetch_once(self, public_dns):
        seen: list[str] = []
        with patch.object(httpx, "AsyncClient", _client(_FakeStream(), seen)):
            first = await logo_fetch.fetch_logo_cached(
                "https://raw.githubusercontent.com/x.png", _sniff
            )
            second = await logo_fetch.fetch_logo_cached(
                "https://raw.githubusercontent.com/x.png", _sniff
            )
        assert first == second
        assert len(seen) == 1, "the commit re-downloaded what the preview already had"


class TestTheToolRow:
    """`set_card_logos` end to end over an `image_url` row."""

    @pytest.fixture
    def fake_token(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", "test-token")

    @pytest.mark.asyncio
    async def test_a_url_row_previews_with_the_bytes_it_would_upload(
        self, fake_token, public_dns
    ):
        async def get_router(path, params=None):
            if path == "/cards":
                return {"items": [{"id": "c1", "type": "Application"}]}
            if path == "/metamodel/types":
                return [{"key": "Application", "allow_card_logo": True}]
            return {}

        with (
            patch.object(httpx, "AsyncClient", _client(_FakeStream())),
            patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=get_router)),
        ):
            out = await server.set_card_logos(
                items=[
                    {
                        "card_id": "c1",
                        "image_url": "https://raw.githubusercontent.com/x.png",
                    }
                ]
            )
        data = server.json.loads(out)
        assert data["would_set"] == 1
        row = data["results"][0]
        assert row["mime"] == "image/png"
        assert row["bytes_received"] == len(PNG)
        # The digest is what lets the caller prove the bytes that landed are
        # the bytes it fetched — worth having on the URL path especially,
        # since it never saw them itself.
        assert row["sha256_received"]

    @pytest.mark.asyncio
    async def test_a_bad_url_costs_one_row_not_the_batch(self, fake_token, public_dns):
        async def get_router(path, params=None):
            if path == "/cards":
                return {
                    "items": [
                        {"id": "c1", "type": "Application"},
                        {"id": "c2", "type": "Application"},
                    ]
                }
            if path == "/metamodel/types":
                return [{"key": "Application", "allow_card_logo": True}]
            return {}

        with (
            patch.object(httpx, "AsyncClient", _client(_FakeStream())),
            patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=get_router)),
        ):
            out = await server.set_card_logos(
                items=[
                    {"card_id": "c1", "image_url": "https://evil.test/logo.png"},
                    {
                        "card_id": "c2",
                        "image_url": "https://raw.githubusercontent.com/x.png",
                    },
                ]
            )
        data = server.json.loads(out)
        assert data["would_set"] == 1
        bad = next(r for r in data["results"] if r["card_id"] == "c1")
        assert bad["status"] == "image_url_not_allowed"
        assert "image_base64" in bad["remedy"]

    @pytest.mark.asyncio
    async def test_two_sources_on_one_row_are_refused(self, fake_token, public_dns):
        out = await server.set_card_logos(
            items=[
                {
                    "card_id": "c1",
                    "icon_slug": "sap",
                    "image_url": "https://raw.githubusercontent.com/x.png",
                }
            ]
        )
        row = server.json.loads(out)["results"][0]
        assert row["status"] == "conflicting_image_source"
        assert "image_url" in row["message"]

    @pytest.mark.asyncio
    async def test_a_url_row_commits_as_an_ordinary_upload(self, fake_token, public_dns):
        # The whole point of fetching here rather than in the backend: what
        # lands is a normal multipart upload, so every backend gate still runs.
        uploads: list[tuple] = []

        async def post(path, json=None):
            return {"id": "batch-1"}

        async def post_file(path, filename, content, mime, field="file"):
            uploads.append((path, content, mime))
            return {"ok": True, "logo_updated_at": "2026-08-28T00:00:00Z"}

        with (
            patch.object(httpx, "AsyncClient", _client(_FakeStream())),
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
            patch.object(server.TurboEAClient, "post_file", AsyncMock(side_effect=post_file)),
        ):
            out = await server.set_card_logos(
                items=[
                    {
                        "card_id": "c1",
                        "image_url": "https://raw.githubusercontent.com/x.png",
                    }
                ],
                dry_run=False,
            )
        data = server.json.loads(out)
        assert data["set"] == 1
        assert uploads == [("/cards/c1/logo", PNG, "image/png")]
