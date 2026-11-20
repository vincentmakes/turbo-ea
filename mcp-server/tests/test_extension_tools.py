"""The extension tools: ``list_extension_tools``, ``call_extension_read`` and
``call_extension_write`` over the backend's ``GET /extensions/agent-tools``
catalogue (SDK 1.18), plus their plain checking and request-building helpers.

A fake extension key throughout; the backend is a recorder patched onto
``TurboEAClient``.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from turbo_ea_mcp import server

KEY = "sample-ext"


@pytest.fixture
def fake_token(monkeypatch):
    monkeypatch.setattr(server, "_stdio_token", "test-token")
    yield "test-token"


def _parse(s: str):
    return json.loads(s)


def _http_error(status: int, detail: object, method: str = "POST") -> httpx.HTTPStatusError:
    request = httpx.Request(method, "http://backend/api/v1/x")
    response = httpx.Response(status, json={"detail": detail}, request=request)
    return httpx.HTTPStatusError(f"{status} error", request=request, response=response)


def _tool(name, **overrides) -> dict:
    values = {
        "name": name,
        "title": name,
        "description": name,
        "kind": "read",
        "method": "GET",
        "path": "/items",
        "path_params": [],
        "query_params": [],
        "input_schema": {"type": "object", "properties": {}},
        "supports_dry_run": False,
    }
    values.update(overrides)
    return values


LIST_ITEMS = _tool(
    "list_items",
    input_schema={
        "type": "object",
        "properties": {"limit": {"type": "integer"}, "active": {"type": "boolean"}},
    },
)
GET_ITEM = _tool(
    "get_item",
    path="/items/{item_id}",
    path_params=["item_id"],
    input_schema={"type": "object", "properties": {"item_id": {"type": "string"}}},
)
VALIDATE = _tool(
    "validate_item",
    method="POST",
    path="/items/validate",
    input_schema={"type": "object", "properties": {"name": {"type": "string"}}},
)
CREATE = _tool(
    "create_item",
    kind="write",
    method="POST",
    path="/items",
    query_params=["mode"],
    supports_dry_run=True,
    input_schema={
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "mode": {"type": "string"},
            "dry_run": {"type": "boolean"},
        },
        "required": ["name"],
    },
)
RENAME = _tool(
    "rename_item",
    kind="write",
    method="PATCH",
    path="/items/{item_id}",
    path_params=["item_id"],
    input_schema={
        "type": "object",
        "properties": {"name": {"type": "string"}},
        "required": ["name"],
    },
)
REPLACE = _tool(
    "replace_item",
    kind="write",
    method="PUT",
    path="/items/{item_id}",
    path_params=["item_id"],
    input_schema={"type": "object", "properties": {"name": {"type": "string"}}},
)
DELETE = _tool(
    "delete_item",
    kind="destructive",
    method="DELETE",
    path="/items/{item_id}",
    path_params=["item_id"],
    input_schema={"type": "object", "properties": {"force": {"type": "boolean"}}},
)
WEIRD = _tool("weird", kind="other", method="POST")

CATALOGUE = {
    "extensions": [
        {
            "key": KEY,
            "name": "Sample",
            "version": "2.0.0",
            "tools": [LIST_ITEMS, GET_ITEM, VALIDATE, CREATE, RENAME, REPLACE, DELETE, WEIRD],
        },
        {"key": "other-ext", "name": "Other", "version": "1.0.0", "tools": []},
    ]
}


class _Backend:
    """Serves the catalogue and the batch open / close; ``answers`` maps an
    extension URL to a response or an exception. Records every call."""

    def __init__(self, answers=None, catalogue=CATALOGUE):
        self.answers = answers or {}
        self.catalogue = catalogue
        self.calls: list[tuple[str, str, object]] = []

    def _answer(self, method, path, body=None):
        self.calls.append((method, path, body))
        answer = self.answers.get((method, path), {"ok": method, "path": path})
        if isinstance(answer, Exception):
            raise answer
        return answer

    async def get(self, path, params=None):
        if path == "/extensions/agent-tools":
            if isinstance(self.catalogue, Exception):
                raise self.catalogue
            return self.catalogue
        return self._answer("GET", path)

    async def post(self, path, json=None):
        if path.endswith("/commit"):
            self.calls.append(("COMMIT", path, json))
            return {"id": "B-1"}
        if path.startswith("/mutation-batches"):
            self.calls.append(("OPEN", path, json))
            return {"id": "B-1", "dry_run": (json or {}).get("dry_run")}
        return self._answer("POST", path, json)

    async def put(self, path, json=None):
        return self._answer("PUT", path, json)

    async def patch(self, path, json=None):
        return self._answer("PATCH", path, json)

    async def delete(self, path):
        return self._answer("DELETE", path)

    def ext_calls(self):
        return [c for c in self.calls if c[0] not in ("OPEN", "COMMIT")]

    def summary(self):
        return [c for c in self.calls if c[0] == "COMMIT"][-1][2]["summary"]

    def opened(self):
        return [c for c in self.calls if c[0] == "OPEN"]


async def _run(backend: _Backend, coro_factory):
    patches = [
        patch.object(server.TurboEAClient, name, AsyncMock(side_effect=getattr(backend, name)))
        for name in ("get", "post", "put", "patch", "delete")
    ]
    for p in patches:
        p.start()
    try:
        return _parse(await coro_factory())
    finally:
        for p in patches:
            p.stop()


def _error(fn, *args):
    with pytest.raises(server.ExtensionCallError) as exc:
        fn(*args)
    return exc.value


# ── Plain helpers ────────────────────────────────────────────────────────────


class TestFindExtensionTool:
    def test_finds_the_pair(self):
        entry, found = server._find_extension_tool(CATALOGUE["extensions"], KEY, "get_item")
        assert entry["version"] == "2.0.0"
        assert found is GET_ITEM

    def test_unknown_extension_lists_the_available_keys(self):
        err = _error(server._find_extension_tool, CATALOGUE["extensions"], "nope", "x")
        assert err.payload() == {
            "error": "unknown_extension",
            "message": (
                "No installed, licensed extension 'nope' offers operations to you. "
                "Call list_extension_tools for the ones that do."
            ),
            "available": ["other-ext", KEY],
        }

    def test_unknown_tool_lists_the_extension_tools(self):
        err = _error(server._find_extension_tool, CATALOGUE["extensions"], KEY, "nope")
        assert err.error == "unknown_tool"
        assert err.message == "Extension 'sample-ext' offers no operation 'nope' to you."
        assert "get_item" in err.extra["available"]

    def test_tools_that_are_not_objects_are_ignored(self):
        cat = [{"key": KEY, "tools": ["junk", {"name": "a"}]}]
        assert server._find_extension_tool(cat, KEY, "a")[1] == {"name": "a"}
        err = _error(server._find_extension_tool, [{"key": KEY, "tools": None}], KEY, "a")
        assert err.extra["available"] == []


class TestArgumentNames:
    def test_schema_path_and_query_names(self):
        allowed, required = server._extension_argument_names(
            _tool(
                "t",
                path_params=["p"],
                query_params=["q"],
                input_schema={
                    "type": "object",
                    "properties": {"a": {}, "p": {}},
                    "required": ["a", "p", 3],
                },
            )
        )
        assert allowed == {"a", "p", "q"}
        assert required == ["a", "p"]

    def test_a_path_param_is_always_required(self):
        allowed, required = server._extension_argument_names(GET_ITEM)
        assert allowed == {"item_id"}
        assert required == ["item_id"]

    def test_a_missing_or_odd_schema_allows_only_path_and_query(self):
        allowed, required = server._extension_argument_names(
            {"name": "t", "input_schema": None, "path_params": ["p"], "query_params": ["q"]}
        )
        assert allowed == {"p", "q"}
        assert required == ["p"]
        allowed, _ = server._extension_argument_names(
            {"name": "t", "input_schema": {"properties": ["a"]}}
        )
        assert allowed == set()


class TestCheckArguments:
    def test_none_is_no_arguments(self):
        assert server._check_extension_arguments(LIST_ITEMS, None) == {}

    def test_valid_arguments_pass_through(self):
        args = {"limit": 3}
        assert server._check_extension_arguments(LIST_ITEMS, args) is args

    def test_not_an_object(self):
        err = _error(server._check_extension_arguments, LIST_ITEMS, ["a"])
        assert (err.error, err.message) == ("invalid_arguments", "arguments must be an object.")

    def test_unknown_arguments_are_refused(self):
        err = _error(server._check_extension_arguments, LIST_ITEMS, {"limit": 1, "zz": 2, "aa": 3})
        assert err.error == "unknown_arguments"
        assert err.message == "Operation 'list_items' does not take ['aa', 'zz']."
        assert err.extra == {"valid": ["active", "limit"]}

    def test_missing_required_is_refused(self):
        err = _error(server._check_extension_arguments, RENAME, {"name": "n"})
        assert err.error == "missing_arguments"
        assert err.message == "Operation 'rename_item' needs ['item_id']."
        assert err.extra == {"valid": ["item_id", "name"]}
        assert err.payload() == {
            "error": "missing_arguments",
            "message": "Operation 'rename_item' needs ['item_id'].",
            "valid": ["item_id", "name"],
        }

    def test_dry_run_is_the_tools_own_parameter(self):
        # A tool that supports a dry run takes the switch from the dry_run
        # parameter of call_extension_write, never from its arguments.
        err = _error(server._check_extension_arguments, CREATE, {"name": "n", "dry_run": False})
        assert err.error == "unknown_arguments"
        assert "dry_run" not in err.extra["valid"]
        required_dry = {
            **CREATE,
            "input_schema": {**CREATE["input_schema"], "required": ["dry_run"]},
        }
        assert server._check_extension_arguments(required_dry, {}) == {}

    def test_without_dry_run_support_dry_run_is_an_ordinary_argument(self):
        tool = _tool("t", input_schema={"type": "object", "properties": {"dry_run": {}}})
        assert server._check_extension_arguments(tool, {"dry_run": True}) == {"dry_run": True}

    @pytest.mark.parametrize("value", ["abc", 12, "a.b", "../x".replace("/", "")])
    def test_path_values_accepted(self, value):
        assert server._check_extension_arguments(GET_ITEM, {"item_id": value})

    @pytest.mark.parametrize(
        "value,message",
        [
            ("a/b", "item_id must be a non-empty value without '/'."),
            ("", "item_id must be a non-empty value without '/'."),
            (True, "item_id must be a string or an integer."),
            (None, "item_id must be a string or an integer."),
            (["x"], "item_id must be a string or an integer."),
            (1.5, "item_id must be a string or an integer."),
        ],
    )
    def test_path_values_refused(self, value, message):
        err = _error(server._check_extension_arguments, GET_ITEM, {"item_id": value})
        assert (err.error, err.message) == ("invalid_path_parameter", message)


class TestCallError:
    def test_the_message_is_the_exception_text(self):
        err = server.ExtensionCallError("e", "Something is off.", x=1)
        assert str(err) == "Something is off."
        assert err.args == ("Something is off.",)
        assert err.payload() == {"error": "e", "message": "Something is off.", "x": 1}


class TestSegment:
    @pytest.mark.parametrize(
        ("value", "segment"),
        [
            ("a/b", "a%2Fb"),
            ("../x", "%2E%2E%2Fx"),
            ("a b", "a%20b"),
            (7, "7"),
        ],
    )
    def test_a_value_is_one_encoded_segment(self, value, segment):
        # Defence in depth: the argument check refuses '/', and the segment
        # encodes it anyway.
        assert server._extension_segment(value) == segment


class TestBuildRequest:
    def test_the_extension_key_is_one_path_segment(self):
        req = server._build_extension_request("a/b", GET_ITEM, {"item_id": "i"})
        assert req["path"] == "/ext/a%2Fb/items/i"

    def test_a_tool_without_a_path_calls_the_extension_root(self):
        req = server._build_extension_request(KEY, {"name": "t"}, {})
        assert req == {"method": "GET", "path": "/ext/sample-ext", "query": {}, "body": None}
        req = server._build_extension_request(KEY, {"name": "t", "path": None}, {})
        assert req["path"] == "/ext/sample-ext"

    def test_get_sends_everything_but_path_params_as_query(self):
        req = server._build_extension_request(
            KEY, GET_ITEM, {"item_id": "a b", "full": True, "skip": None}
        )
        assert req == {
            "method": "GET",
            "path": "/ext/sample-ext/items/a%20b",
            "query": {"full": "true"},
            "body": None,
        }

    def test_path_values_are_one_segment(self):
        req = server._build_extension_request(KEY, GET_ITEM, {"item_id": ".."})
        assert req["path"] == "/ext/sample-ext/items/%2E%2E"
        req = server._build_extension_request(KEY, GET_ITEM, {"item_id": "x?y#z%"})
        assert req["path"] == "/ext/sample-ext/items/x%3Fy%23z%25"
        req = server._build_extension_request(KEY, GET_ITEM, {"item_id": 7})
        assert req["path"] == "/ext/sample-ext/items/7"

    def test_a_typed_path_param_is_replaced(self):
        tool = {**GET_ITEM, "path": "/files/{item_id:path}"}
        req = server._build_extension_request(KEY, tool, {"item_id": "x"})
        assert req["path"] == "/ext/sample-ext/files/x"

    def test_post_routes_query_params_to_the_query_and_the_rest_to_the_body(self):
        req = server._build_extension_request(
            KEY, CREATE, {"name": "n", "mode": "fast", "extra": False}
        )
        assert req == {
            "method": "POST",
            "path": "/ext/sample-ext/items",
            "query": {"mode": "fast"},
            "body": {"name": "n", "extra": False},
        }

    def test_delete_sends_its_arguments_as_query(self):
        req = server._build_extension_request(KEY, DELETE, {"item_id": "i", "force": False})
        assert req == {
            "method": "DELETE",
            "path": "/ext/sample-ext/items/i",
            "query": {"force": "false"},
            "body": None,
        }

    def test_method_is_upper_cased_and_defaults_to_get(self):
        assert (
            server._build_extension_request(KEY, {"method": "patch", "path": "/x"}, {})["method"]
            == "PATCH"
        )
        assert server._build_extension_request(KEY, {"path": "/x"}, {})["method"] == "GET"

    def test_request_url(self):
        assert server._request_url({"path": "/ext/a", "query": {}}) == "/ext/a"
        assert (
            server._request_url({"path": "/ext/a", "query": {"x": "a b", "ids": ["1", "2"]}})
            == "/ext/a?x=a+b&ids=1&ids=2"
        )


class TestWriteRefusal:
    def test_write_is_allowed(self):
        assert server._extension_write_refusal(CREATE) is None

    def test_read_is_refused(self):
        err = server._extension_write_refusal(LIST_ITEMS)
        assert err.error == "read_operation"
        assert err.message == "'list_items' only reads: call it with call_extension_read."

    def test_destructive_needs_the_opt_in(self, monkeypatch):
        monkeypatch.setattr(server, "MCP_ALLOW_EXTENSION_DESTRUCTIVE", False)
        err = server._extension_write_refusal(DELETE)
        assert err.error == "destructive_disabled"
        assert err.message == (
            "'delete_item' removes or overwrites records, which this deployment does "
            "not allow from an AI assistant. Do it in the web app, or ask the operator "
            "to set MCP_ALLOW_EXTENSION_DESTRUCTIVE=true."
        )
        monkeypatch.setattr(server, "MCP_ALLOW_EXTENSION_DESTRUCTIVE", True)
        assert server._extension_write_refusal(DELETE) is None

    def test_an_unknown_kind_is_refused(self):
        err = server._extension_write_refusal(WEIRD)
        assert (err.error, err.message) == ("unknown_kind", "Unknown operation kind 'other'.")


class TestCatalogue:
    @pytest.mark.asyncio
    async def test_a_backend_without_the_route_has_no_extensions(self):
        backend = _Backend(catalogue=_http_error(404, "Not Found", "GET"))
        with patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=backend.get)):
            assert await server._extension_catalogue(server.TurboEAClient("t")) == []

    @pytest.mark.asyncio
    async def test_other_errors_propagate(self):
        backend = _Backend(catalogue=_http_error(500, "boom", "GET"))
        with patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=backend.get)):
            with pytest.raises(httpx.HTTPStatusError):
                await server._extension_catalogue(server.TurboEAClient("t"))

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "payload,expected",
        [
            ([], []),
            ({"extensions": None}, []),
            ({"extensions": [{"key": "a"}, "junk"]}, [{"key": "a"}]),
        ],
    )
    async def test_odd_payloads(self, payload, expected):
        with patch.object(server.TurboEAClient, "get", AsyncMock(return_value=payload)):
            assert await server._extension_catalogue(server.TurboEAClient("t")) == expected


# ── list_extension_tools ─────────────────────────────────────────────────────


class TestListExtensionTools:
    @pytest.mark.asyncio
    async def test_returns_the_catalogue_and_the_switches(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_WRITES_ENABLED", True)
        monkeypatch.setattr(server, "MCP_ALLOW_EXTENSION_DESTRUCTIVE", False)
        out = await _run(_Backend(), lambda: server.list_extension_tools())
        assert out == {
            "extensions": CATALOGUE["extensions"],
            "writes_enabled": True,
            "destructive_enabled": False,
        }

    @pytest.mark.asyncio
    async def test_reflects_the_switches(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_WRITES_ENABLED", False)
        monkeypatch.setattr(server, "MCP_ALLOW_EXTENSION_DESTRUCTIVE", True)
        out = await _run(_Backend(), lambda: server.list_extension_tools())
        assert (out["writes_enabled"], out["destructive_enabled"]) == (False, True)

    @pytest.mark.asyncio
    async def test_needs_a_session(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        assert "Not authenticated" in await server.list_extension_tools()


# ── call_extension_read ──────────────────────────────────────────────────────


class TestCallExtensionRead:
    @pytest.mark.asyncio
    async def test_get_with_query(self, fake_token):
        backend = _Backend(answers={("GET", "/ext/sample-ext/items?limit=2"): [{"id": 1}]})
        out = await _run(
            backend,
            lambda: server.call_extension_read(KEY, "list_items", {"limit": 2}),
        )
        assert out == {"extension": KEY, "tool": "list_items", "response": [{"id": 1}]}
        assert backend.ext_calls() == [("GET", "/ext/sample-ext/items?limit=2", None)]
        assert backend.opened() == []  # a read opens no batch

    @pytest.mark.asyncio
    async def test_a_post_read(self, fake_token):
        backend = _Backend()
        out = await _run(
            backend, lambda: server.call_extension_read(KEY, "validate_item", {"name": "x"})
        )
        assert out["response"] == {"ok": "POST", "path": "/ext/sample-ext/items/validate"}
        assert backend.ext_calls() == [("POST", "/ext/sample-ext/items/validate", {"name": "x"})]

    @pytest.mark.asyncio
    async def test_a_write_kind_is_refused(self, fake_token):
        backend = _Backend()
        out = await _run(
            backend, lambda: server.call_extension_read(KEY, "create_item", {"name": "x"})
        )
        assert out == {
            "error": "not_a_read_operation",
            "message": (
                "'create_item' changes data: preview and run it with call_extension_write."
            ),
        }
        assert backend.ext_calls() == []

    @pytest.mark.asyncio
    async def test_unknown_arguments_never_reach_the_extension(self, fake_token):
        backend = _Backend()
        out = await _run(backend, lambda: server.call_extension_read(KEY, "list_items", {"x": 1}))
        assert out["error"] == "unknown_arguments"
        assert backend.ext_calls() == []

    @pytest.mark.asyncio
    async def test_an_unknown_extension(self, fake_token):
        out = await _run(_Backend(), lambda: server.call_extension_read("nope", "list_items"))
        assert out["error"] == "unknown_extension"

    @pytest.mark.asyncio
    async def test_a_refusal_comes_back_with_its_detail(self, fake_token):
        url = "/ext/sample-ext/items/i1"
        backend = _Backend(answers={("GET", url): _http_error(403, "Extension not licensed")})
        out = await _run(
            backend, lambda: server.call_extension_read(KEY, "get_item", {"item_id": "i1"})
        )
        assert out == {
            "error": "extension_refused",
            "status": 403,
            "detail": "Extension not licensed",
            "extension": KEY,
            "tool": "get_item",
        }

    @pytest.mark.asyncio
    async def test_a_non_json_answer_does_not_crash(self, fake_token):
        backend = _Backend(
            answers={("GET", "/ext/sample-ext/items"): json.JSONDecodeError("x", "doc", 0)}
        )
        out = await _run(backend, lambda: server.call_extension_read(KEY, "list_items"))
        assert out["response"] == {
            "note": "The extension answered successfully, but not with JSON."
        }

    @pytest.mark.asyncio
    async def test_needs_a_session(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        assert "Not authenticated" in await server.call_extension_read(KEY, "list_items")


# ── call_extension_write ─────────────────────────────────────────────────────


class TestCallExtensionWrite:
    @pytest.mark.asyncio
    async def test_preview_forwards_dry_run_when_supported(self, fake_token):
        backend = _Backend(
            answers={("POST", "/ext/sample-ext/items?mode=fast"): {"valid": True, "dry_run": True}}
        )
        out = await _run(
            backend,
            lambda: server.call_extension_write(KEY, "create_item", {"name": "n", "mode": "fast"}),
        )
        assert out == {
            "dry_run": True,
            "extension": KEY,
            "tool": "create_item",
            "kind": "write",
            "preview_source": "extension",
            "response": {"valid": True, "dry_run": True},
            "reversible": False,
            "batch_id": "B-1",
        }
        assert backend.opened() == [
            (
                "OPEN",
                "/mutation-batches?row_count=1",
                {"tool_name": "call_extension_write", "dry_run": True},
            )
        ]
        assert backend.ext_calls() == [
            ("POST", "/ext/sample-ext/items?mode=fast", {"name": "n", "dry_run": True})
        ]
        assert backend.summary() == {
            "extension": KEY,
            "tool": "create_item",
            "kind": "write",
            "status": "previewed",
            "preview_source": "extension",
        }

    @pytest.mark.asyncio
    async def test_preview_without_dry_run_support_sends_nothing(self, fake_token):
        backend = _Backend()
        out = await _run(
            backend,
            lambda: server.call_extension_write(KEY, "rename_item", {"item_id": "i", "name": "n"}),
        )
        assert out["preview_source"] == "mcp_server"
        assert out["dry_run"] is True
        assert out["would_send"] == {
            "method": "PATCH",
            "path": "/ext/sample-ext/items/i",
            "query": {},
            "body": {"name": "n"},
        }
        assert "nothing was sent" in out["note"]
        assert out["batch_id"] == "B-1"
        assert out["reversible"] is False
        assert backend.ext_calls() == []
        assert backend.summary()["preview_source"] == "mcp_server"
        assert backend.summary()["status"] == "previewed"

    @pytest.mark.asyncio
    async def test_commit_sends_the_call_inside_the_batch(self, fake_token):
        backend = _Backend(answers={("PUT", "/ext/sample-ext/items/i"): {"id": "i"}})
        seen_batch: list[str | None] = []

        async def put(client, path, json=None):
            seen_batch.append(client._batch_id)
            return await backend.put(path, json)

        p_put = patch.object(server.TurboEAClient, "put", autospec=True, side_effect=put)
        p_get = patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=backend.get))
        p_post = patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=backend.post))
        with p_put, p_get, p_post:
            out = _parse(
                await server.call_extension_write(
                    KEY, "replace_item", {"item_id": "i", "name": "n"}, dry_run=False
                )
            )
        assert seen_batch == ["B-1"]
        assert out == {
            "extension": KEY,
            "tool": "replace_item",
            "kind": "write",
            "version": "2.0.0",
            "response": {"id": "i"},
            "batch_id": "B-1",
            "reversible": False,
            "note": server._EXTENSION_NOT_REVERSIBLE,
        }
        assert "rollback_batch" in server._EXTENSION_NOT_REVERSIBLE
        assert backend.summary() == {
            "extension": KEY,
            "tool": "replace_item",
            "kind": "write",
            "status": "applied",
        }

    @pytest.mark.asyncio
    async def test_commit_sends_dry_run_false_when_supported(self, fake_token):
        backend = _Backend()
        await _run(
            backend,
            lambda: server.call_extension_write(KEY, "create_item", {"name": "n"}, dry_run=False),
        )
        assert backend.ext_calls() == [
            ("POST", "/ext/sample-ext/items", {"name": "n", "dry_run": False})
        ]
        assert backend.opened()[0][2] == {"tool_name": "call_extension_write", "dry_run": False}

    @pytest.mark.asyncio
    async def test_a_refusal_is_recorded_and_returned(self, fake_token):
        url = "/ext/sample-ext/items/i"
        backend = _Backend(answers={("PATCH", url): _http_error(422, [{"msg": "bad"}])})
        out = await _run(
            backend,
            lambda: server.call_extension_write(
                KEY, "rename_item", {"item_id": "i", "name": "n"}, dry_run=False
            ),
        )
        assert out == {
            "error": "extension_refused",
            "status": 422,
            "detail": [{"msg": "bad"}],
            "extension": KEY,
            "tool": "rename_item",
            "kind": "write",
            "batch_id": "B-1",
        }
        assert backend.summary() == {
            "extension": KEY,
            "tool": "rename_item",
            "kind": "write",
            "status": "refused",
            "http_status": 422,
        }

    @pytest.mark.asyncio
    async def test_destructive_is_refused_by_default(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_ALLOW_EXTENSION_DESTRUCTIVE", False)
        backend = _Backend()
        out = await _run(
            backend,
            lambda: server.call_extension_write(
                KEY, "delete_item", {"item_id": "i"}, dry_run=False
            ),
        )
        assert out == {
            "error": "destructive_disabled",
            "message": (
                "'delete_item' removes or overwrites records, which this deployment does "
                "not allow from an AI assistant. Do it in the web app, or ask the operator "
                "to set MCP_ALLOW_EXTENSION_DESTRUCTIVE=true."
            ),
        }
        assert backend.calls == []  # not even a batch

    @pytest.mark.asyncio
    async def test_destructive_runs_when_the_operator_opts_in(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_ALLOW_EXTENSION_DESTRUCTIVE", True)
        backend = _Backend()
        out = await _run(
            backend,
            lambda: server.call_extension_write(
                KEY, "delete_item", {"item_id": "i", "force": True}, dry_run=False
            ),
        )
        assert out["kind"] == "destructive"
        assert backend.ext_calls() == [("DELETE", "/ext/sample-ext/items/i?force=true", None)]

    @pytest.mark.asyncio
    async def test_a_read_kind_is_refused(self, fake_token):
        backend = _Backend()
        out = await _run(backend, lambda: server.call_extension_write(KEY, "list_items"))
        assert out["error"] == "read_operation"
        assert backend.calls == []

    @pytest.mark.asyncio
    async def test_the_kill_switch_comes_first(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_WRITES_ENABLED", False)
        backend = _Backend()
        out = await _run(
            backend, lambda: server.call_extension_write(KEY, "create_item", {"name": "n"})
        )
        assert out["error"] == "writes_disabled"
        assert backend.calls == []

    @pytest.mark.asyncio
    async def test_missing_arguments_never_open_a_batch(self, fake_token):
        backend = _Backend()
        out = await _run(backend, lambda: server.call_extension_write(KEY, "create_item", {}))
        assert out["error"] == "missing_arguments"
        assert backend.calls == []

    @pytest.mark.asyncio
    async def test_a_non_json_commit_answer_does_not_crash(self, fake_token):
        backend = _Backend(
            answers={("POST", "/ext/sample-ext/items"): json.JSONDecodeError("x", "doc", 0)}
        )
        out = await _run(
            backend,
            lambda: server.call_extension_write(KEY, "create_item", {"name": "n"}, dry_run=False),
        )
        assert out["response"] == {
            "note": "The extension answered successfully, but not with JSON."
        }
        assert out["batch_id"] == "B-1"

    @pytest.mark.asyncio
    async def test_needs_a_session(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        assert "Not authenticated" in await server.call_extension_write(KEY, "create_item")


def test_annotations():
    tools = server.mcp._tool_manager._tools
    assert tools["list_extension_tools"].annotations == server._READ_ANNOT
    assert tools["call_extension_read"].annotations == server._READ_ANNOT
    assert tools["call_extension_write"].annotations == server._WRITE_DESTRUCTIVE_ANNOT


def test_the_instructions_name_the_extension_tools():
    text = server.mcp.instructions
    assert "list_extension_tools first" in text
    assert "Extension configuration is not available here" in text
