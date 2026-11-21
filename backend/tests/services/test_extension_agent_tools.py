"""The agent-tools registry (SDK 1.18): which extension routes may be offered to
AI assistants through the MCP server.

Pure checks first, then collection against a real FastAPI router, then the
startup and liveness seams. Uses a fake extension key throughout.
"""

from __future__ import annotations

import logging
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.services.extensions import agent_tools as at
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.loader import LoadedExtension, LoadReport
from app.services.extensions.registry import ExtensionInfo, extension_registry
from app.services.extensions.sdk import AgentTool

KEY = "sample-ext"
KNOWN = {"ext.sample-ext.view", "ext.sample-ext.manage", "ext.sample-ext.admin", "inventory.view"}
KNOWN |= {"admin.metamodel", "ext.other-ext.view"}


class ItemIn(BaseModel):
    name: str
    size: int = 1


class Pair(BaseModel):
    left: ItemIn
    right: ItemIn


def _page(page: int = 1) -> int:
    return page


def build_router() -> APIRouter:
    router = APIRouter()

    @router.get("/items")
    async def list_items(limit: int = 10, search: str | None = None, page=Depends(_page)):
        return []

    @router.get("/items/{item_id}")
    async def get_item(item_id: str, full: bool = Query(False, alias="fullView")):
        return {}

    @router.post("/items")
    async def create_item(body: ItemIn, notify: bool = False, mode: str = Query(...)):
        return {}

    @router.post("/items/{item_id}/copy")
    async def copy_item(item_id: str, body: ItemIn):
        return {}

    @router.post("/pairs")
    async def make_pair(left: ItemIn, right: ItemIn):
        return {}

    @router.post("/raw")
    async def raw(body: dict):
        return {}

    @router.post("/plain")
    async def plain():
        return {}

    @router.delete("/items/{item_id}")
    async def delete_item(item_id: str, force: bool = False):
        return {}

    @router.delete("/bulk")
    async def bulk_delete(body: ItemIn):
        return {}

    @router.get("/settings")
    async def settings():
        return {}

    @router.get("/export.csv")
    async def export():
        return ""

    return router


def tool(**overrides) -> AgentTool:
    values = dict(
        name="list_items",
        title="List items",
        description="Lists the items.",
        method="GET",
        path="/items",
        permission="ext.sample-ext.view",
        kind="read",
    )
    values.update(overrides)
    return AgentTool(**values)


@pytest.fixture
def routes():
    return build_router().routes


def check(t: AgentTool, routes) -> AgentTool:
    return at.check_agent_tool(KEY, t, routes, KNOWN)


def refused(t: AgentTool, routes) -> str:
    with pytest.raises(at.AgentToolError) as exc:
        check(t, routes)
    return str(exc.value)


# ---------------------------------------------------------------------------
# Pure checks
# ---------------------------------------------------------------------------


class TestConfigSegment:
    @pytest.mark.parametrize(
        "path,segment",
        [
            ("/settings", "settings"),
            ("/config", "config"),
            ("/configuration/x", "configuration"),
            ("/demo", "demo"),
            ("/test-connection", "test-connection"),
            ("/test_connection", "test_connection"),
            ("/admin/users", "admin"),
            ("/secrets", "secrets"),
            ("/credentials/{id}", "credentials"),
            ("/connection-settings", "connection-settings"),
            ("/items/{item_id}/admin_notes", "admin_notes"),
            ("/Setting", "Setting"),
            ("/a/configs", "configs"),
            ("/secret", "secret"),
            ("/credential", "credential"),
        ],
    )
    def test_configuration_paths(self, path, segment):
        assert at.config_segment(path) == segment

    @pytest.mark.parametrize(
        "path",
        ["/items", "/items/{settings_id}", "/demonstrations", "/administered", "/", ""],
    )
    def test_ordinary_paths(self, path):
        # A path PARAMETER named like configuration is just a name.
        assert at.config_segment(path) is None


class TestFileDownload:
    @pytest.mark.parametrize(
        "path", ["/export.csv", "/export/{name}.xlsx", "/report.pdf/", "/a.B1"]
    )
    def test_file_paths(self, path):
        assert at.is_file_download(path)

    @pytest.mark.parametrize("path", ["/export", "/items/{item_id}", "/v1.2/items", "/"])
    def test_other_paths(self, path):
        assert not at.is_file_download(path)


def test_path_params_of():
    assert at.path_params_of("/a/{x}/b/{rest:path}") == ("x", "rest")
    assert at.path_params_of("/a") == ()


class TestPermissionProblem:
    def test_own_and_core_keys_pass(self):
        assert at.permission_problem(KEY, "ext.sample-ext.view", KNOWN) is None
        assert at.permission_problem(KEY, "inventory.view", KNOWN) is None

    @pytest.mark.parametrize(
        "perm,reason",
        [
            ("", "no permission"),
            ("ext.sample-ext.admin", "administration key"),
            ("ext.sample-ext.admin.write", "administration key"),
            ("ext.sample-ext.admin_settings", "administration key"),
            ("ext.other-ext.view", "another extension"),
            ("admin.metamodel", "administration key"),
            ("ext.sample-ext.unknown", "not a registered"),
            ("made.up", "not a registered"),
        ],
    )
    def test_refused(self, perm, reason):
        assert reason in at.permission_problem(KEY, perm, KNOWN)

    def test_administer_is_not_admin(self):
        known = KNOWN | {"ext.sample-ext.administer"}
        assert at.permission_problem(KEY, "ext.sample-ext.administer", known) is None


class TestKindProblem:
    @pytest.mark.parametrize(
        "kind,method",
        [
            ("read", "GET"),
            ("read", "POST"),
            ("write", "POST"),
            ("write", "PUT"),
            ("write", "PATCH"),
            ("destructive", "DELETE"),
            ("destructive", "POST"),
        ],
    )
    def test_allowed(self, kind, method):
        assert at.kind_problem(kind, method) is None

    def test_unknown_kind(self):
        assert "not one of" in at.kind_problem("delete", "DELETE")

    @pytest.mark.parametrize("method", ["PUT", "PATCH", "DELETE"])
    def test_read_must_be_get_or_post(self, method):
        assert "read tool must be GET or POST" in at.kind_problem("read", method)

    @pytest.mark.parametrize("kind", ["write", "destructive"])
    def test_writes_cannot_be_get(self, kind):
        assert "cannot be a GET" in at.kind_problem(kind, "GET")


class TestSchemaProblem:
    def test_valid(self):
        assert at.schema_problem({"type": "object"}) is None
        assert (
            at.schema_problem({"type": "object", "properties": {"a": {}}, "required": ["a"]})
            is None
        )

    @pytest.mark.parametrize(
        "schema,reason",
        [
            ([], "a dict"),
            (None, "a dict"),
            ({}, '"type": "object"'),
            ({"type": "array"}, '"type": "object"'),
            ({"type": "object", "properties": []}, "properties must be an object"),
            ({"type": "object", "required": "a"}, "required must be a list"),
            ({"type": "object", "required": [1]}, "required must be a list"),
            ({"type": "object", "default": {1, 2}}, "JSON-serialisable"),
        ],
    )
    def test_refused(self, schema, reason):
        assert reason in at.schema_problem(schema)


def test_with_path_params_adds_required_strings():
    schema = {"type": "object", "properties": {"a": {"type": "integer"}}, "required": ["a"]}
    out = at.with_path_params(schema, ("item_id",))
    assert out == {
        "type": "object",
        "properties": {"a": {"type": "integer"}, "item_id": {"type": "string"}},
        "required": ["a", "item_id"],
    }
    # The declared schema is not mutated, and a present property is kept.
    assert schema["required"] == ["a"]
    kept = at.with_path_params(
        {"type": "object", "properties": {"item_id": {"format": "uuid"}}, "required": ["item_id"]},
        ("item_id",),
    )
    assert kept["properties"]["item_id"] == {"format": "uuid"}
    assert kept["required"] == ["item_id"]
    assert at.with_path_params(schema, ()) is schema


# ---------------------------------------------------------------------------
# check_agent_tool against a real router
# ---------------------------------------------------------------------------


class TestCheckAgentTool:
    def test_get_schema_comes_from_every_query_parameter(self, routes):
        out = check(tool(), routes)
        assert out.method == "GET"
        assert out.input_schema == {
            "type": "object",
            "properties": {
                "limit": {"type": "integer"},
                "search": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                "page": {"type": "integer"},
            },
        }

    def test_method_is_normalised(self, routes):
        assert check(tool(method="get"), routes).method == "GET"

    def test_get_with_a_path_param_uses_the_wire_alias(self, routes):
        out = check(tool(name="get_item", path="/items/{item_id}", path_params=["item_id"]), routes)
        assert out.path_params == ("item_id",)
        assert out.input_schema == {
            "type": "object",
            "properties": {"fullView": {"type": "boolean"}, "item_id": {"type": "string"}},
            "required": ["item_id"],
        }

    def test_post_schema_is_the_body_model_plus_declared_query(self, routes):
        out = check(
            tool(
                name="create_item",
                method="POST",
                kind="write",
                query_params=("mode",),
                supports_dry_run=True,
            ),
            routes,
        )
        assert out.query_params == ("mode",)
        assert out.supports_dry_run is True
        assert out.input_schema == {
            "type": "object",
            "properties": {
                "name": {"title": "Name", "type": "string"},
                "size": {"default": 1, "title": "Size", "type": "integer"},
                "mode": {"type": "string"},
            },
            "required": ["name", "mode"],
        }

    def test_undeclared_query_params_stay_out_of_a_post_schema(self, routes):
        out = check(tool(name="create_item", method="POST", kind="write"), routes)
        assert set(out.input_schema["properties"]) == {"name", "size"}

    def test_several_body_params_keep_their_definitions(self, routes):
        out = check(tool(name="make_pair", method="POST", path="/pairs", kind="write"), routes)
        assert set(out.input_schema["properties"]) == {"left", "right"}
        assert out.input_schema["required"] == ["left", "right"]
        assert "ItemIn" in out.input_schema["$defs"]

    def test_a_post_without_body_gets_an_empty_schema(self, routes):
        out = check(tool(name="plain", method="POST", path="/plain", kind="write"), routes)
        assert out.input_schema == {"type": "object", "properties": {}}

    def test_post_with_path_params(self, routes):
        out = check(
            tool(
                name="copy_item",
                method="POST",
                path="/items/{item_id}/copy",
                kind="write",
                path_params=("item_id",),
            ),
            routes,
        )
        assert out.input_schema["required"] == ["name", "item_id"]

    def test_a_declared_schema_wins(self, routes):
        schema = {"type": "object", "properties": {"x": {"type": "string"}}}
        out = check(
            tool(name="raw", method="POST", path="/raw", kind="read", input_schema=schema),
            routes,
        )
        assert out.input_schema == schema
        assert out.input_schema is not schema

    def test_a_bare_dict_body_needs_a_schema(self, routes):
        assert "input_schema is required" in refused(
            tool(name="raw", method="POST", path="/raw", kind="write"), routes
        )

    def test_destructive_delete(self, routes):
        out = check(
            tool(
                name="delete_item",
                method="DELETE",
                path="/items/{item_id}",
                kind="destructive",
                path_params=["item_id"],
            ),
            routes,
        )
        assert out.kind == "destructive"
        # A DELETE carries its arguments in the query string, like a GET.
        assert out.input_schema == {
            "type": "object",
            "properties": {"force": {"type": "boolean"}, "item_id": {"type": "string"}},
            "required": ["item_id"],
        }

    def test_a_delete_with_a_body_is_refused(self, routes):
        message = refused(
            tool(name="bulk_delete", method="DELETE", path="/bulk", kind="destructive"), routes
        )
        assert message == "a DELETE route offered as a tool cannot take a body"

    def test_a_dry_run_delete_is_refused(self, routes):
        message = refused(
            tool(
                name="delete_item",
                method="DELETE",
                path="/items/{item_id}",
                kind="destructive",
                path_params=["item_id"],
                supports_dry_run=True,
            ),
            routes,
        )
        assert message == "a DELETE route cannot take dry_run in its body"

    @pytest.mark.parametrize(
        "overrides,reason",
        [
            ({"name": "List"}, "must match"),
            ({"name": "1abc"}, "must match"),
            ({"name": "a" * 64}, "must match"),
            ({"name": 3}, "must match"),
            ({"title": " "}, "title is empty"),
            ({"title": None}, "title is empty"),
            ({"title": "t" * 201}, "title is longer than 200"),
            ({"description": ""}, "description is empty"),
            ({"description": "d" * 4001}, "description is longer than 4000"),
            ({"method": "HEAD"}, "method"),
            ({"method": None}, "method"),
            ({"path": "items"}, "must start with /"),
            ({"path": "/settings"}, "configuration route"),
            ({"path": "/export.csv"}, "file download"),
            ({"permission": "ext.sample-ext.admin"}, "administration key"),
            ({"kind": "write"}, "cannot be a GET"),
            ({"path": "/nowhere"}, "no GET /nowhere route"),
            ({"method": "PUT", "kind": "write"}, "no PUT /items route"),
            ({"query_params": ("nope",)}, "not query parameters of the route"),
            ({"query_params": "limit"}, "query_params must be a list"),
            ({"query_params": ("",)}, "query_params must be a list"),
            ({"input_schema": {"type": "array"}}, '"type": "object"'),
        ],
    )
    def test_refused(self, routes, overrides, reason):
        assert reason in refused(tool(**overrides), routes)

    def test_a_dry_run_get_is_refused(self, routes):
        assert refused(tool(supports_dry_run=True), routes) == (
            "a GET route cannot take dry_run in its body"
        )

    def test_path_params_must_match_the_route(self, routes):
        get_item = dict(name="get_item", path="/items/{item_id}")
        assert "must equal the route's" in refused(tool(**get_item), routes)
        assert "must equal the route's" in refused(tool(**get_item, path_params=("other",)), routes)
        assert "must equal the route's" in refused(
            tool(**get_item, path_params=("item_id", "item_id")), routes
        )
        assert "must equal the route's" in refused(tool(path_params=("item_id",)), routes)

    def test_a_name_cannot_be_path_and_query(self):
        router = APIRouter()

        @router.get("/x/{q}")
        async def x(q: str, other: int = Query(0, alias="q")):
            return {}

        message = refused(
            tool(path="/x/{q}", path_params=("q",), query_params=("q",)), router.routes
        )
        assert "both a path and a query parameter" in message

    def test_not_an_agent_tool(self, routes):
        with pytest.raises(at.AgentToolError, match="not an AgentTool"):
            at.check_agent_tool(KEY, {"name": "x"}, routes, KNOWN)


# ---------------------------------------------------------------------------
# collect_tools / register / startup / liveness
# ---------------------------------------------------------------------------


class TestCollectTools:
    def test_keeps_valid_drops_invalid_and_duplicates(self, caplog):
        router = build_router()
        caplog.set_level(logging.WARNING, logger=at.__name__)
        accepted = at.collect_tools(
            KEY,
            [
                tool(),
                tool(title="Again"),  # duplicate name
                tool(name="settings", path="/settings"),
                tool(name="get_item", path="/items/{item_id}", path_params=["item_id"]),
            ],
            router,
            KNOWN,
        )
        assert [t.name for t in accepted] == ["list_items", "get_item"]
        assert accepted[0].title == "List items"
        assert "'list_items' skipped: the name is already used" in caplog.text
        assert "'settings' skipped: path '/settings' is a configuration route" in caplog.text

    def test_caps_the_number_of_tools(self, monkeypatch, caplog):
        monkeypatch.setattr(at, "MAX_TOOLS_PER_EXTENSION", 2)
        caplog.set_level(logging.WARNING, logger=at.__name__)
        tools = [tool(name=f"t{i}") for i in range(4)]
        accepted = at.collect_tools(KEY, tools, build_router(), KNOWN)
        assert [t.name for t in accepted] == ["t0", "t1"]
        assert "more than 2 agent tools — 't2' and the rest skipped" in caplog.text


class _Ext:
    def __init__(self, tools=None, fail=False):
        self._tools = tools or []
        self._fail = fail

    def get_agent_tools(self):
        if self._fail:
            raise RuntimeError("boom")
        return self._tools


GRANTED = {"grants": [at.GRANT]}


@pytest.fixture
def clean():
    at.reset_tools()
    extension_registry.clear()
    yield
    at.reset_tools()
    extension_registry.clear()


@pytest.fixture
def known(monkeypatch):
    from app.core import permissions as perm_registry

    monkeypatch.setattr(perm_registry, "ALL_APP_PERMISSION_KEYS", set(KNOWN))


class TestRegister:
    def test_registers_the_accepted_tools(self, clean, known):
        assert at.register_extension_tools(KEY, GRANTED, _Ext([tool()]), build_router()) == 1
        assert [t.name for t in at._tools[KEY]] == ["list_items"]

    def test_no_hook_registers_nothing(self, clean, known):
        assert at.register_extension_tools(KEY, GRANTED, object(), build_router()) == 0
        assert KEY not in at._tools

    def test_without_the_grant_nothing_registers(self, clean, known, caplog):
        caplog.set_level(logging.WARNING, logger=at.__name__)
        manifest = {"grants": ["core.cards.read"]}
        assert at.register_extension_tools(KEY, manifest, _Ext([tool()]), build_router()) == 0
        assert KEY not in at._tools
        assert "does not declare the core.agent.tools grant" in caplog.text
        assert at.register_extension_tools(KEY, {}, _Ext([tool()]), build_router()) == 0

    def test_without_a_router_nothing_registers(self, clean, known, caplog):
        caplog.set_level(logging.WARNING, logger=at.__name__)
        assert at.register_extension_tools(KEY, GRANTED, _Ext([tool()]), None) == 0
        assert "mounts no router" in caplog.text

    def test_a_raising_hook_is_logged_never_fatal(self, clean, known, caplog):
        assert at.register_extension_tools(KEY, GRANTED, _Ext(fail=True), build_router()) == 0
        assert "get_agent_tools() failed" in caplog.text
        assert KEY not in at._tools

    def test_a_hook_returning_none_or_only_invalid_registers_nothing(self, clean, known):
        ext = SimpleNamespace(get_agent_tools=lambda: None)
        assert at.register_extension_tools(KEY, GRANTED, ext, build_router()) == 0
        bad = _Ext([tool(path="/settings")])
        assert at.register_extension_tools(KEY, GRANTED, bad, build_router()) == 0
        assert KEY not in at._tools

    def test_re_registering_replaces(self, clean, known):
        at.register_extension_tools(KEY, GRANTED, _Ext([tool()]), build_router())
        at.register_extension_tools(KEY, GRANTED, object(), build_router())
        assert KEY not in at._tools


def _loaded(key, instance, router=None, manifest=None) -> LoadedExtension:
    return LoadedExtension(
        key=key,
        manifest=manifest if manifest is not None else dict(GRANTED),
        directory=Path("."),
        instance=instance,
        router=router,
    )


def test_start_agent_tools_uses_the_mounted_router(clean, known, caplog):
    router = build_router()
    other = "other-ext"
    report = LoadReport(
        loaded=[
            _loaded(KEY, _Ext([tool()]), router),
            _loaded("content-ext", None),
            _loaded(other, _Ext([tool(permission="ext.other-ext.view")]), build_router()),
            _loaded("broken-ext", SimpleNamespace(get_agent_tools=1), build_router()),
        ]
    )
    at._tools["stale-ext"] = [tool()]
    at.start_agent_tools(report)
    assert set(at._tools) == {KEY, other}
    assert "stale-ext" not in at._tools


def test_start_agent_tools_never_raises(clean, known, monkeypatch, caplog):
    def boom(*args):
        raise RuntimeError("bad")

    monkeypatch.setattr(at, "register_extension_tools", boom)
    at.start_agent_tools(LoadReport(loaded=[_loaded(KEY, _Ext([tool()]), build_router())]))
    assert "agent tools could not be registered" in caplog.text


def _install(*, enabled=True, status="installed", licensed=True, grants=(at.GRANT,)):
    extension_registry.load_installed(
        [
            ExtensionInfo(
                key=KEY,
                name="Sample",
                version="1.2.3",
                status=status,
                enabled=enabled,
                manifest={"grants": list(grants)},
            )
        ]
    )
    extension_registry.set_license(
        LicenseDocument(
            licensee="ACME",
            customer_id="c",
            issued_at=None,
            grace_days=30,
            entitlements=[Entitlement(extension_key=KEY, expires_at=None)] if licensed else [],
        )
    )


class TestLiveTools:
    def test_live_when_enabled_licensed_and_granted(self, clean):
        at._tools[KEY] = [tool()]
        _install()
        [(info, tools)] = at.live_tools()
        assert info.key == KEY
        assert [t.name for t in tools] == ["list_items"]

    @pytest.mark.parametrize(
        "kwargs",
        [
            {"enabled": False, "status": "disabled"},
            {"status": "failed"},
            {"status": "needs_restart"},
            {"licensed": False},
            {"grants": ("core.cards.read",)},
        ],
    )
    def test_hidden_otherwise(self, clean, kwargs):
        at._tools[KEY] = [tool()]
        _install(**kwargs)
        assert at.live_tools() == []

    def test_not_installed(self, clean):
        at._tools[KEY] = [tool()]
        assert at.live_tools() == []


def test_tool_payload_shape():
    t = replace(
        tool(),
        input_schema={"type": "object", "properties": {}},
        path_params=("a",),
        query_params=("b",),
    )
    assert at.tool_payload(t) == {
        "name": "list_items",
        "title": "List items",
        "description": "Lists the items.",
        "kind": "read",
        "method": "GET",
        "path": "/items",
        "path_params": ["a"],
        "query_params": ["b"],
        "input_schema": {"type": "object", "properties": {}},
        "supports_dry_run": False,
    }
    assert at.tool_payload(tool())["input_schema"] == {"type": "object", "properties": {}}


# ---------------------------------------------------------------------------
# Exact refusals, log lines and normalisation
# ---------------------------------------------------------------------------


def _messages(caplog, level=logging.WARNING) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.name == at.__name__ and r.levelno == level]


def test_a_path_parameter_is_removed_before_a_segment_is_judged():
    # "{name}admin" is the literal "admin" once the parameter is taken out.
    assert at.config_segment("/items/{name}admin") == "{name}admin"


def test_a_trailing_x_is_a_file_extension_not_a_separator():
    assert at.is_file_download("/export/report.X")


def test_no_permission_is_named_exactly():
    assert at.permission_problem(KEY, "", KNOWN) == "no permission declared"
    assert at.permission_problem(KEY, None, KNOWN) == "no permission declared"


@pytest.mark.parametrize(
    "schema,message",
    [
        (None, "input_schema must be a JSON-schema object (a dict)"),
        ({"type": "array"}, 'input_schema must have "type": "object"'),
        ({"type": "object", "properties": []}, "input_schema properties must be an object"),
        ({"type": "object", "required": [1]}, "input_schema required must be a list of strings"),
        ({"type": "object", "default": {1}}, "input_schema must be JSON-serialisable"),
    ],
)
def test_schema_refusals_are_exact(schema, message):
    assert at.schema_problem(schema) == message


class _CountingDependant:
    """A dependant whose query parameters count how often they are read."""

    def __init__(self, fields=(), dependencies=()):
        self._fields = [SimpleNamespace(alias=name) for name in fields]
        self.dependencies = list(dependencies)
        self.reads = 0

    @property
    def query_params(self):
        self.reads += 1
        return self._fields


def test_a_dependant_reached_twice_is_read_once_and_the_walk_goes_on():
    shared = _CountingDependant(["shared"])
    first = _CountingDependant(["first"], [shared])
    second = _CountingDependant(["second"], [shared])
    late = _CountingDependant(["late"])
    # The walk pops from the end: second, its shared child, first, the shared
    # child again (already seen), then late — which must still be visited.
    root = _CountingDependant(["root"], [late, first, second])
    fields = at._query_fields(SimpleNamespace(dependant=root))
    assert sorted(fields) == ["first", "late", "root", "second", "shared"]
    assert [d.reads for d in (root, first, second, shared, late)] == [1, 1, 1, 1, 1]


@pytest.mark.parametrize("value", [None, 5, {"a": 1}])
def test_a_non_list_of_names_is_refused_as_such(value):
    with pytest.raises(at.AgentToolError) as exc:
        at._string_tuple(value, "names")
    assert str(exc.value) == "names must be a list of names"


class TestCheckAgentToolExact:
    def test_not_an_agent_tool(self, routes):
        with pytest.raises(at.AgentToolError) as exc:
            at.check_agent_tool(KEY, {"name": "x"}, routes, KNOWN)
        assert str(exc.value) == "not an AgentTool"

    def test_a_title_of_exactly_the_limit_passes(self, routes):
        title = "t" * at.MAX_TITLE_LENGTH
        assert check(tool(title=title), routes).title == title

    def test_a_missing_path_is_named_as_empty(self, routes):
        assert refused(tool(path=None), routes) == "path '' must start with /"

    def test_bad_path_params_are_named(self, routes):
        assert refused(tool(name="get_item", path="/items/{item_id}"), routes) == (
            "path_params [] must equal the route's ['item_id']"
        )
        assert refused(tool(path_params="item_id"), routes) == (
            "path_params must be a list of names"
        )

    def test_a_name_in_both_places_is_refused_exactly(self):
        router = APIRouter()

        @router.get("/x/{q}")
        async def x(q: str, other: int = Query(0, alias="q")):
            return {}

        assert refused(
            tool(path="/x/{q}", path_params=("q",), query_params=("q",)), router.routes
        ) == ("a name cannot be both a path and a query parameter")

    def test_a_bare_dict_body_refusal_is_exact(self, routes):
        assert refused(tool(name="raw", method="POST", path="/raw", kind="write"), routes) == (
            "the route takes a bare dict body, so input_schema is required"
        )

    def test_the_lists_and_the_dry_run_flag_are_normalised(self, routes):
        out = check(
            tool(
                name="copy_item",
                method="POST",
                path="/items/{item_id}/copy",
                kind="write",
                path_params=["item_id"],
                query_params=[],
                supports_dry_run=1,
            ),
            routes,
        )
        assert out.path_params == ("item_id",)
        assert out.query_params == ()
        assert out.supports_dry_run is True
        listed = check(
            tool(name="create_item", method="POST", kind="write", query_params=["mode"]), routes
        )
        assert listed.query_params == ("mode",)


class TestCollectToolsExact:
    def test_a_refused_row_is_logged_with_its_extension_and_label(self, caplog):
        caplog.set_level(logging.WARNING, logger=at.__name__)
        accepted = at.collect_tools(
            KEY, [{"x": 1}, tool(path="/settings"), tool(), tool()], build_router(), KNOWN
        )
        assert [t.name for t in accepted] == ["list_items"]
        assert _messages(caplog) == [
            "Extension sample-ext agent tool \"{'x': 1}\" skipped: not an AgentTool",
            "Extension sample-ext agent tool 'list_items' skipped: "
            "path '/settings' is a configuration route ('settings')",
            "Extension sample-ext agent tool 'list_items' skipped: the name is already used",
        ]

    def test_the_cap_is_logged_exactly(self, monkeypatch, caplog):
        monkeypatch.setattr(at, "MAX_TOOLS_PER_EXTENSION", 1)
        caplog.set_level(logging.WARNING, logger=at.__name__)
        at.collect_tools(KEY, [tool(name="t0"), tool(name="t1")], build_router(), KNOWN)
        assert _messages(caplog) == [
            "Extension sample-ext declares more than 1 agent tools — 't1' and the rest skipped"
        ]


class TestRegisterExact:
    def test_a_missing_grant_is_logged_exactly(self, clean, known, caplog):
        caplog.set_level(logging.WARNING, logger=at.__name__)
        at.register_extension_tools(KEY, {}, _Ext([tool()]), build_router())
        assert _messages(caplog) == [
            "Extension sample-ext offers agent tools but does not declare the "
            "core.agent.tools grant — tools skipped"
        ]

    def test_a_missing_router_is_logged_exactly(self, clean, known, caplog):
        caplog.set_level(logging.WARNING, logger=at.__name__)
        at.register_extension_tools(KEY, GRANTED, _Ext([tool()]), None)
        assert _messages(caplog) == [
            "Extension sample-ext offers agent tools but mounts no router — skipped"
        ]

    def test_a_raising_hook_is_logged_exactly(self, clean, known, caplog):
        caplog.set_level(logging.WARNING, logger=at.__name__)
        at.register_extension_tools(KEY, GRANTED, _Ext(fail=True), build_router())
        assert _messages(caplog, logging.ERROR) == ["Extension sample-ext get_agent_tools() failed"]

    def test_a_registration_is_logged_exactly(self, clean, known, caplog):
        caplog.set_level(logging.INFO, logger=at.__name__)
        at.register_extension_tools(KEY, GRANTED, _Ext([tool()]), build_router())
        assert _messages(caplog, logging.INFO) == [
            "Registered 1 agent tool(s) for extension sample-ext"
        ]

    def test_a_failed_startup_registration_is_logged_exactly(
        self, clean, known, monkeypatch, caplog
    ):
        def boom(*args):
            raise RuntimeError("bad")

        monkeypatch.setattr(at, "register_extension_tools", boom)
        at.start_agent_tools(LoadReport(loaded=[_loaded(KEY, _Ext([tool()]), build_router())]))
        assert _messages(caplog, logging.ERROR) == [
            "Extension sample-ext agent tools could not be registered"
        ]


def test_an_extension_that_is_not_live_does_not_hide_the_next_one(clean):
    at._tools["a-ext"] = [tool()]  # sorts first, not installed
    at._tools[KEY] = [tool()]
    _install()
    assert [info.key for info, _ in at.live_tools()] == [KEY]
