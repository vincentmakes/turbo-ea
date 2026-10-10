"""What ``api_client`` puts on the wire, and what it makes of the answer.

Every backend call the MCP server makes goes through these few functions, so
the request each one builds — method, URL, headers, body, timeout — and the
way it reads the response are pinned here against an ``httpx.MockTransport``.
Nothing reaches a network.
"""

from __future__ import annotations

import json

import httpx
import pytest

from turbo_ea_mcp import api_client
from turbo_ea_mcp.api_client import (
    TurboEAClient,
    _raise_for_status_with_detail,
    chunked,
    exchange_sso_code,
    get_mcp_status,
    get_sso_config,
    login,
)
from turbo_ea_mcp.batches import BatchContext

BASE = "http://backend:8000"


class Wire:
    """Answers every request with ``reply`` and records what was asked."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.timeouts: list = []
        self.reply = lambda request: httpx.Response(200, json={"ok": True})

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.reply(request)

    @property
    def last(self) -> httpx.Request:
        return self.requests[-1]


@pytest.fixture
def wire(monkeypatch):
    w = Wire()
    real = httpx.AsyncClient

    def client(*args, timeout=None, **kwargs):
        w.timeouts.append(timeout)
        return real(*args, transport=httpx.MockTransport(w.handler), timeout=timeout, **kwargs)

    monkeypatch.setattr(api_client.httpx, "AsyncClient", client)
    monkeypatch.setattr(api_client, "TURBO_EA_URL", BASE + "/")
    return w


def body(request: httpx.Request):
    return json.loads(request.content) if request.content else None


class TestHeaders:
    @pytest.mark.asyncio
    async def test_bearer_origin_and_no_batch(self, wire):
        await TurboEAClient("tok").get("/x")
        headers = wire.last.headers
        assert headers["authorization"] == "Bearer tok"
        assert headers["x-turbo-ea-origin"] == "mcp"
        assert "x-turbo-ea-batch" not in headers

    @pytest.mark.asyncio
    async def test_the_batch_id_is_stamped_when_set(self, wire):
        await TurboEAClient("tok", batch_id="b-1").get("/x")
        assert wire.last.headers["x-turbo-ea-batch"] == "b-1"

    @pytest.mark.asyncio
    async def test_a_batch_context_client_carries_its_token_and_batch(self, wire):
        ctx = BatchContext(token="tok", batch_id="b-9", open_response={})
        await ctx.client().get("/x")
        assert wire.last.headers["authorization"] == "Bearer tok"
        assert wire.last.headers["x-turbo-ea-batch"] == "b-9"


class TestVerbs:
    @pytest.mark.asyncio
    async def test_get(self, wire):
        result = await TurboEAClient("t").get("/cards", params={"page": 2})
        assert result == {"ok": True}
        assert wire.last.method == "GET"
        assert str(wire.last.url) == f"{BASE}/api/v1/cards?page=2"
        assert wire.timeouts == [30.0]

    @pytest.mark.parametrize("verb", ["post", "put", "patch"])
    @pytest.mark.asyncio
    async def test_json_verbs(self, wire, verb):
        result = await getattr(TurboEAClient("t"), verb)("/things/1", json={"a": 1})
        assert result == {"ok": True}
        assert wire.last.method == verb.upper()
        assert str(wire.last.url) == f"{BASE}/api/v1/things/1"
        assert body(wire.last) == {"a": 1}
        assert wire.last.headers["authorization"] == "Bearer t"
        assert wire.timeouts == [30.0]

    @pytest.mark.asyncio
    async def test_delete(self, wire):
        assert await TurboEAClient("t").delete("/things/1") == {"ok": True}
        assert wire.last.method == "DELETE"
        assert str(wire.last.url) == f"{BASE}/api/v1/things/1"
        assert wire.last.headers["authorization"] == "Bearer t"
        assert wire.timeouts == [30.0]

    def test_only_trailing_slashes_come_off_the_base_url(self, monkeypatch):
        monkeypatch.setattr(api_client, "TURBO_EA_URL", "http://BACKENDX//")
        assert TurboEAClient("t")._base == "http://BACKENDX/api/v1"

    @pytest.mark.parametrize("verb", ["get", "post", "put", "patch", "delete"])
    @pytest.mark.asyncio
    async def test_204_is_an_empty_object(self, wire, verb):
        wire.reply = lambda request: httpx.Response(204)
        assert await getattr(TurboEAClient("t"), verb)("/x") == {}

    @pytest.mark.parametrize("verb", ["get", "post", "put", "patch", "delete"])
    @pytest.mark.asyncio
    async def test_an_error_carries_the_backend_detail(self, wire, verb):
        wire.reply = lambda request: httpx.Response(403, json={"detail": "nope"})
        with pytest.raises(httpx.HTTPStatusError) as exc:
            await getattr(TurboEAClient("t"), verb)("/x")
        assert "403" in str(exc.value)
        assert str(exc.value).endswith('\nBackend detail: "nope"')


class TestMultipart:
    @pytest.mark.asyncio
    async def test_a_file_and_fields(self, wire):
        result = await TurboEAClient("t", batch_id="b").post_multipart(
            "/cards/1/logo", data={"slug": "x"}, file=("a.png", b"PNG", "image/png"), field="img"
        )
        assert result == {"ok": True}
        request = wire.last
        assert request.method == "POST"
        assert str(request.url) == f"{BASE}/api/v1/cards/1/logo"
        assert request.headers["content-type"].startswith("multipart/form-data; boundary=")
        assert request.headers["x-turbo-ea-batch"] == "b"
        content = request.content
        assert b'name="img"; filename="a.png"' in content
        assert b"Content-Type: image/png" in content
        assert b'name="slug"' in content
        assert wire.timeouts == [30.0]

    @pytest.mark.asyncio
    async def test_fields_only(self, wire):
        await TurboEAClient("t").post_multipart("/x", data={"slug": "aws"})
        # No file: httpx sends a plain form body.
        assert wire.last.content == b"slug=aws"

    @pytest.mark.asyncio
    async def test_post_file_uses_the_default_field(self, wire):
        await TurboEAClient("t").post_file("/x", "a.png", b"PNG", "image/png")
        assert b'name="file"; filename="a.png"' in wire.last.content

    @pytest.mark.asyncio
    async def test_post_file_sends_to_its_path_under_its_field(self, wire):
        await TurboEAClient("t").post_file("/cards/1/logo", "a.png", b"PNG", "image/png", "logo")
        assert str(wire.last.url) == f"{BASE}/api/v1/cards/1/logo"
        assert b'name="logo"; filename="a.png"' in wire.last.content

    @pytest.mark.asyncio
    async def test_post_multipart_names_a_file_file_by_default(self, wire):
        await TurboEAClient("t").post_multipart("/x", file=("a.png", b"PNG", "image/png"))
        assert b'name="file"; filename="a.png"' in wire.last.content

    @pytest.mark.asyncio
    async def test_204_and_errors(self, wire):
        wire.reply = lambda request: httpx.Response(204)
        assert await TurboEAClient("t").post_multipart("/x", data={"a": "b"}) == {}
        wire.reply = lambda request: httpx.Response(413, json={"detail": "too big"})
        with pytest.raises(httpx.HTTPStatusError) as exc:
            await TurboEAClient("t").post_multipart("/x", data={"a": "b"})
        assert "too big" in str(exc.value)


class TestGetBytes:
    @pytest.mark.asyncio
    async def test_returns_content_and_bare_media_type(self, wire):
        wire.reply = lambda request: httpx.Response(
            200, content=b"\x89PNG", headers={"content-type": "image/png; charset=binary"}
        )
        data, mime = await TurboEAClient("t").get_bytes("/cards/1/logo", params={"v": 1})
        assert (data, mime) == (b"\x89PNG", "image/png")
        assert str(wire.last.url) == f"{BASE}/api/v1/cards/1/logo?v=1"
        assert wire.last.headers["authorization"] == "Bearer t"
        assert wire.timeouts == [30.0]

    @pytest.mark.asyncio
    async def test_no_content_type(self, wire):
        wire.reply = lambda request: httpx.Response(200, content=b"x")
        data, mime = await TurboEAClient("t").get_bytes("/x")
        assert data == b"x"
        assert mime == ""

    @pytest.mark.asyncio
    async def test_an_error(self, wire):
        wire.reply = lambda request: httpx.Response(404, json={"detail": "no logo"})
        with pytest.raises(httpx.HTTPStatusError):
            await TurboEAClient("t").get_bytes("/x")


class TestRefreshToken:
    @pytest.mark.asyncio
    async def test_a_new_token_replaces_the_old_one(self, wire):
        wire.reply = lambda request: httpx.Response(200, json={"access_token": "new"})
        client = TurboEAClient("old")
        assert await client.refresh_token() == "new"
        assert wire.last.method == "POST"
        assert str(wire.last.url) == f"{BASE}/api/v1/auth/refresh"
        assert wire.last.headers["authorization"] == "Bearer old"
        assert wire.timeouts == [10.0]
        await client.get("/x")
        assert wire.last.headers["authorization"] == "Bearer new"

    @pytest.mark.parametrize(
        "response",
        [
            httpx.Response(401, json={"detail": "expired"}),
            httpx.Response(201, json={"access_token": "new"}),
            httpx.Response(200, json={}),
            httpx.Response(200, json={"access_token": ""}),
        ],
    )
    @pytest.mark.asyncio
    async def test_anything_else_is_none(self, wire, response):
        wire.reply = lambda request: response
        client = TurboEAClient("old")
        assert await client.refresh_token() is None
        wire.reply = lambda request: httpx.Response(200, json={})
        await client.get("/x")
        assert wire.last.headers["authorization"] == "Bearer old"


class TestCardsByIds:
    @pytest.mark.asyncio
    async def test_dedupes_drops_blanks_and_chunks(self, wire, monkeypatch):
        monkeypatch.setattr(api_client, "CARD_IDS_CHUNK", 2)
        wire.reply = lambda request: httpx.Response(
            200,
            json={"items": [{"id": i} for i in request.url.params["ids"].split(",")]},
        )
        items = await TurboEAClient("t").get_cards_by_ids(["a", "", "b", "a", None, "c"])
        assert [i["id"] for i in items] == ["a", "b", "c"]
        params = [dict(r.url.params) for r in wire.requests]
        assert params == [{"ids": "a,b", "page_size": "2"}, {"ids": "c", "page_size": "1"}]

    @pytest.mark.asyncio
    async def test_no_ids_no_request(self, wire):
        assert await TurboEAClient("t").get_cards_by_ids([None, ""]) == []
        assert wire.requests == []

    @pytest.mark.asyncio
    async def test_a_page_without_items(self, wire):
        wire.reply = lambda request: httpx.Response(200, json={})
        assert await TurboEAClient("t").get_cards_by_ids(["a"]) == []

    @pytest.mark.asyncio
    async def test_a_list_page_is_ignored(self, wire):
        wire.reply = lambda request: httpx.Response(200, json=[{"id": "a"}])
        assert await TurboEAClient("t").get_cards_by_ids(["a"]) == []


class TestChunked:
    def test_sizes(self):
        assert chunked([1, 2, 3, 4, 5], 2) == [[1, 2], [3, 4], [5]]
        assert chunked([1, 2], 2) == [[1, 2]]
        assert chunked([1], 1) == [[1]]
        assert chunked([], 3) == []

    def test_a_size_below_one_is_refused(self):
        with pytest.raises(ValueError) as exc:
            chunked([1], 0)
        assert str(exc.value) == "chunk size must be >= 1"

    def test_chunks_are_lists(self):
        assert chunked((1, 2, 3), 2) == [[1, 2], [3]]


class TestRaiseForStatus:
    def _response(self, status, **kwargs):
        request = httpx.Request("GET", "http://x/y")
        return httpx.Response(status, request=request, **kwargs)

    def test_success_passes(self):
        _raise_for_status_with_detail(self._response(200))
        _raise_for_status_with_detail(self._response(204))

    def test_a_non_json_body_is_quoted_up_to_2000_chars(self):
        with pytest.raises(httpx.HTTPStatusError) as exc:
            _raise_for_status_with_detail(self._response(502, text="x" * 2500))
        assert str(exc.value).endswith("\nBackend detail: " + "x" * 2000)

    def test_the_original_exception_is_suppressed(self):
        with pytest.raises(httpx.HTTPStatusError) as exc:
            _raise_for_status_with_detail(self._response(400, json={"detail": [1]}))
        assert exc.value.__cause__ is None
        assert exc.value.__suppress_context__ is True
        assert exc.value.response.status_code == 400


class TestModuleCalls:
    @pytest.fixture(autouse=True)
    def _plain_url(self, wire, monkeypatch):
        monkeypatch.setattr(api_client, "TURBO_EA_URL", BASE)

    @pytest.mark.asyncio
    async def test_login(self, wire):
        wire.reply = lambda request: httpx.Response(200, json={"access_token": "jwt"})
        assert await login("a@b.c", "pw") == "jwt"
        assert str(wire.last.url) == f"{BASE}/api/v1/auth/login"
        assert body(wire.last) == {"email": "a@b.c", "password": "pw"}
        assert wire.timeouts == [10.0]

    @pytest.mark.asyncio
    async def test_login_without_a_token(self, wire):
        wire.reply = lambda request: httpx.Response(200, json={})
        with pytest.raises(ValueError) as exc:
            await login("a@b.c", "pw")
        assert str(exc.value) == "No access_token in login response"

    @pytest.mark.asyncio
    async def test_login_bad_credentials(self, wire):
        wire.reply = lambda request: httpx.Response(401)
        with pytest.raises(ValueError) as exc:
            await login("a@b.c", "pw")
        assert str(exc.value) == "Login failed: invalid email or password."

    @pytest.mark.asyncio
    async def test_login_other_status(self, wire):
        wire.reply = lambda request: httpx.Response(500)
        with pytest.raises(ValueError) as exc:
            await login("a@b.c", "pw")
        assert str(exc.value) == f"Login failed: HTTP 500 from {BASE}/api/v1/auth/login"

    @pytest.mark.asyncio
    async def test_login_unreachable(self, wire):
        def refuse(request):
            raise httpx.ConnectError("refused")

        wire.reply = refuse
        with pytest.raises(ConnectionError) as exc:
            await login("a@b.c", "pw")
        assert str(exc.value) == (
            f"Cannot connect to {BASE} — is the server running and reachable "
            "from this machine? (Detail: refused)"
        )

    @pytest.mark.asyncio
    async def test_login_timeout(self, wire):
        def slow(request):
            raise httpx.ReadTimeout("slow")

        wire.reply = slow
        with pytest.raises(ConnectionError) as exc:
            await login("a@b.c", "pw")
        assert str(exc.value) == (
            f"Connection to {BASE} timed out after 10s. Check the URL and network connectivity."
        )

    @pytest.mark.asyncio
    async def test_sso_config_and_mcp_status(self, wire):
        assert await get_sso_config() == {"ok": True}
        assert str(wire.last.url) == f"{BASE}/api/v1/auth/sso/config"
        assert await get_mcp_status() == {"ok": True}
        assert str(wire.last.url) == f"{BASE}/api/v1/settings/mcp/status"
        assert wire.timeouts == [10.0, 10.0]

    @pytest.mark.asyncio
    async def test_exchange_sso_code(self, wire):
        assert await exchange_sso_code("c", "https://mcp/cb") == {"ok": True}
        assert wire.last.method == "POST"
        assert str(wire.last.url) == f"{BASE}/api/v1/auth/sso/callback"
        assert body(wire.last) == {"code": "c", "redirect_uri": "https://mcp/cb"}
        assert wire.timeouts == [15.0]

    @pytest.mark.parametrize("call", ["sso", "status", "exchange"])
    @pytest.mark.asyncio
    async def test_public_calls_raise_on_error(self, wire, call):
        wire.reply = lambda request: httpx.Response(503)
        fn = {
            "sso": get_sso_config,
            "status": get_mcp_status,
            "exchange": lambda: exchange_sso_code("c", "u"),
        }[call]
        with pytest.raises(httpx.HTTPStatusError):
            await fn()
