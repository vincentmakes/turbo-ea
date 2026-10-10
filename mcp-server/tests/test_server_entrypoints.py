"""How the server starts and how a tool call finds its caller's token.

The HTTP app's routes, the DNS-rebinding allowlist, the per-call token lookup,
and the stdio mode (log in, keep the JWT fresh, run the transport) are all
plain functions; these tests call them with the network, the event loop and
the process entry stubbed out.
"""

from __future__ import annotations

import asyncio
import logging
import sys
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from starlette.testclient import TestClient

from turbo_ea_mcp import api_client, config, oauth, server


class TestTransportSecurity:
    def test_both_public_urls_are_allowed_by_name_and_origin(self, monkeypatch):
        monkeypatch.setattr(server, "MCP_PUBLIC_URL", "https://mcp.example.com:8443/base")
        monkeypatch.setattr(server, "TURBO_EA_PUBLIC_URL", "http://ea.example.com")
        settings = server._build_transport_security()
        assert settings.allowed_hosts == [
            "127.0.0.1",
            "ea.example.com",
            "localhost",
            "mcp.example.com",
            "mcp.example.com:8443",
        ]
        assert settings.allowed_origins == [
            "http://ea.example.com",
            "https://mcp.example.com:8443",
        ]

    def test_a_url_without_a_host_adds_nothing(self, monkeypatch):
        monkeypatch.setattr(server, "MCP_PUBLIC_URL", "")
        monkeypatch.setattr(server, "TURBO_EA_PUBLIC_URL", "ea.example.com/path")
        settings = server._build_transport_security()
        assert settings.allowed_hosts == ["127.0.0.1", "localhost"]
        assert settings.allowed_origins == []

    def test_a_scheme_alone_is_no_origin(self, monkeypatch):
        monkeypatch.setattr(server, "MCP_PUBLIC_URL", "https:")
        monkeypatch.setattr(server, "TURBO_EA_PUBLIC_URL", "//bare.example")
        settings = server._build_transport_security()
        assert settings.allowed_hosts == ["127.0.0.1", "bare.example", "localhost"]
        assert settings.allowed_origins == []


@pytest.mark.asyncio
class TestGetCurrentToken:
    @pytest.fixture(autouse=True)
    def _http_mode(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        self.resolve = AsyncMock(return_value="turbo-jwt")
        monkeypatch.setattr(oauth, "resolve_token", self.resolve)

    @staticmethod
    def _with_request(headers):
        request = SimpleNamespace(headers=headers) if headers is not None else None
        return server._mcp_request_ctx.set(SimpleNamespace(request=request))

    async def test_stdio_mode_uses_the_login_token(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", "stdio-jwt")
        assert await server._get_current_token() == "stdio-jwt"
        self.resolve.assert_not_awaited()

    async def test_no_request_context_means_no_token(self):
        assert await server._get_current_token() is None

    async def test_a_context_with_no_request_attribute_means_no_token(self):
        reset = server._mcp_request_ctx.set(SimpleNamespace())
        try:
            assert await server._get_current_token() is None
        finally:
            server._mcp_request_ctx.reset(reset)

    async def test_a_context_without_a_request_means_no_token(self):
        reset = self._with_request(None)
        try:
            assert await server._get_current_token() is None
        finally:
            server._mcp_request_ctx.reset(reset)

    @pytest.mark.parametrize("headers", [{}, {"authorization": "Basic abc"}, {"authorization": ""}])
    async def test_anything_but_a_bearer_header_means_no_token(self, headers):
        reset = self._with_request(headers)
        try:
            assert await server._get_current_token() is None
        finally:
            server._mcp_request_ctx.reset(reset)
        self.resolve.assert_not_awaited()

    @pytest.mark.parametrize("scheme", ["Bearer", "bearer", "BEARER"])
    async def test_the_bearer_token_is_resolved_to_the_turbo_jwt(self, scheme):
        reset = self._with_request({"authorization": f"{scheme} mcp-access-token"})
        try:
            assert await server._get_current_token() == "turbo-jwt"
        finally:
            server._mcp_request_ctx.reset(reset)
        self.resolve.assert_awaited_once_with("mcp-access-token")


class TestCreateApp:
    @pytest.fixture
    def client(self, monkeypatch):
        monkeypatch.setattr(server, "MCP_PUBLIC_URL", "https://mcp.example/")
        return TestClient(server.create_app())

    def test_each_route_answers_only_its_method(self, client):
        paths = [r.path for r in client.app.router.routes]
        for path in (
            "/.well-known/oauth-protected-resource",
            "/.well-known/oauth-authorization-server",
            "/.well-known/openid-configuration",
            "/oauth/authorize",
            "/oauth/callback",
            "/health",
        ):
            assert path in paths
            assert client.post(path).status_code == 405, path
        for path in ("/oauth/token", "/oauth/register"):
            assert path in paths
            assert client.get(path).status_code == 405, path

    def test_the_oidc_alias_serves_the_authorization_server_metadata(self, client):
        alias = client.get("/.well-known/openid-configuration")
        assert alias.status_code == 200
        assert alias.json() == client.get("/.well-known/oauth-authorization-server").json()

    def test_health_reports_the_version(self, client):
        assert client.get("/health").json() == {"status": "ok", "version": config.APP_VERSION}

    def test_only_trailing_slashes_come_off_the_public_url(self, monkeypatch):
        monkeypatch.setattr(server, "MCP_PUBLIC_URL", "https://mcpX//")
        response = TestClient(server.create_app()).post("/mcp", json={})
        assert response.headers["www-authenticate"] == (
            'Bearer resource_metadata="https://mcpX/.well-known/oauth-protected-resource"'
        )

    def test_the_bearer_gate_points_at_the_resource_metadata(self, client):
        response = client.post("/mcp", json={})
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == (
            'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"'
        )


class _Stop(Exception):
    """Ends the otherwise endless refresh loop after its scripted turns."""


@pytest.mark.asyncio
class TestRefreshLoop:
    @pytest.fixture
    def turns(self, monkeypatch):
        """Let the loop sleep ``n`` times, recording each interval."""
        slept: list[float] = []

        def run(n):
            async def sleep(seconds):
                if len(slept) == n:
                    raise _Stop
                slept.append(seconds)

            monkeypatch.setattr(server.asyncio, "sleep", sleep)
            return slept

        return run

    @staticmethod
    def _client(monkeypatch, refresh):
        seen = []

        class Fake:
            def __init__(self, token):
                seen.append(token)

            refresh_token = refresh

        monkeypatch.setattr(server, "TurboEAClient", Fake)
        return seen

    async def test_it_waits_ten_minutes_and_skips_without_a_token(self, monkeypatch, turns):
        slept = turns(2)
        monkeypatch.setattr(server, "_stdio_token", None)
        seen = self._client(monkeypatch, AsyncMock())
        with pytest.raises(_Stop):
            await server._refresh_loop()
        assert slept == [600, 600]
        assert seen == []

    async def test_a_new_token_replaces_the_old_one(self, monkeypatch, turns, caplog):
        slept = turns(2)
        monkeypatch.setattr(server, "_stdio_token", "old")
        tokens = iter(["new", "newer"])
        seen = self._client(monkeypatch, AsyncMock(side_effect=lambda: next(tokens)))
        with caplog.at_level(logging.INFO, logger="turbo_ea_mcp"), pytest.raises(_Stop):
            await server._refresh_loop(interval=5)
        assert slept == [5, 5]
        assert seen == ["old", "new"]
        assert server._stdio_token == "newer"
        assert [r.getMessage() for r in caplog.records] == ["JWT refreshed successfully"] * 2

    async def test_no_token_back_keeps_the_old_one(self, monkeypatch, turns, caplog):
        turns(1)
        monkeypatch.setattr(server, "_stdio_token", "old")
        self._client(monkeypatch, AsyncMock(return_value=None))
        with caplog.at_level(logging.INFO, logger="turbo_ea_mcp"), pytest.raises(_Stop):
            await server._refresh_loop()
        assert server._stdio_token == "old"
        assert [(r.levelname, r.getMessage()) for r in caplog.records] == [
            ("WARNING", "JWT refresh returned no token")
        ]

    async def test_a_failure_is_logged_and_the_loop_goes_on(self, monkeypatch, turns, caplog):
        slept = turns(2)
        monkeypatch.setattr(server, "_stdio_token", "old")
        self._client(monkeypatch, AsyncMock(side_effect=OSError("down")))
        with caplog.at_level(logging.INFO, logger="turbo_ea_mcp"), pytest.raises(_Stop):
            await server._refresh_loop()
        assert len(slept) == 2
        assert server._stdio_token == "old"
        assert [(r.levelname, r.getMessage()) for r in caplog.records] == [
            ("ERROR", "JWT refresh failed")
        ] * 2
        assert all(r.exc_info for r in caplog.records)


def test_the_refresh_thread_runs_the_loop_on_a_daemon(monkeypatch):
    ran = threading.Event()

    async def loop():
        ran.set()

    monkeypatch.setattr(server, "_refresh_loop", loop)
    thread = server._start_refresh_thread()
    thread.join(timeout=5)
    assert thread.daemon
    assert ran.is_set()


class TestRunStdio:
    @pytest.fixture(autouse=True)
    def _stubs(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        monkeypatch.setattr(config, "TURBO_EA_URL", "http://ea.internal")
        for name in ("TURBO_EA_EMAIL", "TURBO_EA_USERNAME", "TURBO_EA_PASSWORD"):
            monkeypatch.delenv(name, raising=False)
        self.calls: list = []
        monkeypatch.setattr(
            server, "_start_refresh_thread", lambda: self.calls.append("refresh thread")
        )
        monkeypatch.setattr(server.mcp, "run", lambda **kwargs: self.calls.append(("run", kwargs)))
        self.logins: list = []

        async def login(email, password):
            self.logins.append((email, password))
            return "jwt"

        monkeypatch.setattr(api_client, "login", login)

    @pytest.mark.parametrize("env", [{}, {"TURBO_EA_EMAIL": "a@b.c"}, {"TURBO_EA_PASSWORD": "pw"}])
    def test_both_credentials_are_required(self, monkeypatch, caplog, env):
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        with caplog.at_level(logging.INFO, logger="turbo_ea_mcp"):
            with pytest.raises(SystemExit) as exited:
                server.run_stdio()
        assert exited.value.code == 1
        assert [(r.levelname, r.getMessage()) for r in caplog.records] == [
            ("ERROR", "TURBO_EA_EMAIL and TURBO_EA_PASSWORD must be set for stdio mode")
        ]
        assert self.logins == []
        assert self.calls == []

    @pytest.mark.parametrize(
        "env, email",
        [
            ({"TURBO_EA_EMAIL": "a@b.c", "TURBO_EA_USERNAME": "u@b.c"}, "a@b.c"),
            ({"TURBO_EA_USERNAME": "u@b.c"}, "u@b.c"),
        ],
    )
    def test_it_logs_in_then_starts_the_refresh_and_the_transport(
        self, monkeypatch, caplog, env, email
    ):
        for key, value in {**env, "TURBO_EA_PASSWORD": "pw"}.items():
            monkeypatch.setenv(key, value)
        with caplog.at_level(logging.INFO, logger="turbo_ea_mcp"):
            server.run_stdio()
        assert self.logins == [(email, "pw")]
        assert server._stdio_token == "jwt"
        assert self.calls == ["refresh thread", ("run", {"transport": "stdio"})]
        assert [r.getMessage() for r in caplog.records] == [
            f"Logging in to http://ea.internal as {email} …",
            "Logged in — starting MCP stdio transport",
        ]

    def test_a_failed_login_stops_before_the_transport(self, monkeypatch, caplog):
        monkeypatch.setenv("TURBO_EA_EMAIL", "a@b.c")
        monkeypatch.setenv("TURBO_EA_PASSWORD", "pw")
        failure = RuntimeError("bad credentials")

        async def login(email, password):
            raise failure

        monkeypatch.setattr(api_client, "login", login)
        with caplog.at_level(logging.INFO, logger="turbo_ea_mcp"):
            with pytest.raises(SystemExit) as exited:
                server.run_stdio()
        assert exited.value.code == 1
        assert exited.value.__cause__ is failure
        assert server._stdio_token is None
        assert self.calls == []
        assert [(r.levelname, r.getMessage()) for r in caplog.records][-1] == (
            "ERROR",
            "Login failed: bad credentials",
        )


class TestMain:
    @pytest.fixture(autouse=True)
    def _stubs(self, monkeypatch):
        self.calls: list = []
        monkeypatch.setattr(server, "run_stdio", lambda: self.calls.append("stdio"))
        monkeypatch.setattr(server, "create_app", lambda: "the-app")
        fake_uvicorn = SimpleNamespace(
            run=lambda app, **kwargs: self.calls.append(("uvicorn", app, kwargs))
        )
        monkeypatch.setitem(sys.modules, "uvicorn", fake_uvicorn)
        monkeypatch.setattr(server, "MCP_PORT", 8001)

    def test_http_on_every_interface_and_the_configured_port(self, monkeypatch, caplog):
        monkeypatch.setattr(sys, "argv", ["turbo-ea-mcp"])
        with caplog.at_level(logging.INFO, logger="turbo_ea_mcp"):
            server.main()
        assert self.calls == [
            ("uvicorn", "the-app", {"host": "0.0.0.0", "port": 8001, "log_level": "info"})
        ]
        assert [r.getMessage() for r in caplog.records] == [
            f"Starting Turbo EA MCP Server v{config.APP_VERSION} on 0.0.0.0:8001"
        ]

    def test_host_and_port_are_taken_from_the_command_line(self, monkeypatch):
        monkeypatch.setattr(sys, "argv", ["turbo-ea-mcp", "--host", "127.0.0.1", "--port", "9"])
        server.main()
        assert self.calls == [
            ("uvicorn", "the-app", {"host": "127.0.0.1", "port": 9, "log_level": "info"})
        ]

    def test_stdio_runs_the_stdio_transport_instead(self, monkeypatch):
        monkeypatch.setattr(sys, "argv", ["turbo-ea-mcp", "--stdio"])
        server.main()
        assert self.calls == ["stdio"]

    def test_the_command_line_as_documented(self, monkeypatch):
        monkeypatch.setattr(server, "MCP_PORT", 8001)
        parser = server._build_parser()
        assert parser.description == "Turbo EA MCP Server"
        helps = {a.dest: (a.default, a.help) for a in parser._actions if a.dest != "help"}
        assert helps == {
            "host": ("0.0.0.0", "Bind host"),
            "port": (8001, "Bind port"),
            "stdio": (
                False,
                "Run in stdio mode (for Claude Desktop). "
                "Requires TURBO_EA_EMAIL and TURBO_EA_PASSWORD env vars.",
            ),
        }
        assert parser.parse_args(["--port", "9"]).port == 9


def test_the_refresh_loop_runs_on_its_own_event_loop(monkeypatch):
    """``asyncio.run`` in the thread, never the caller's loop."""
    loops = []

    async def loop():
        loops.append(asyncio.get_running_loop())

    monkeypatch.setattr(server, "_refresh_loop", loop)

    async def main():
        server._start_refresh_thread().join(timeout=5)
        return asyncio.get_running_loop()

    outer = asyncio.run(main())
    assert loops and loops[0] is not outer
