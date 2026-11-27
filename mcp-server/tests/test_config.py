"""The environment readers behind the MCP server's settings.

``_env_bool`` reads the write kill switch (``MCP_WRITES_ENABLED``) and the
other guardrail toggles, so which spellings count as "on" is a security
property, not a convenience: an operator who sets ``MCP_WRITES_ENABLED=off``
must get a read-only server.
"""

from __future__ import annotations

import pytest

from turbo_ea_mcp import config


@pytest.mark.parametrize(
    "raw", ["1", "true", "TRUE", "True", "yes", "YES", "on", "On", " true ", "\ton\n"]
)
def test_truthy_spellings_are_on(monkeypatch, raw):
    monkeypatch.setenv("MCP_TEST_FLAG", raw)
    assert config._env_bool("MCP_TEST_FLAG", False) is True


@pytest.mark.parametrize(
    "raw",
    ["0", "false", "no", "off", "", "  ", "2", "enabled", "y", "t", "truee", "on1"],
)
def test_anything_else_is_off_even_when_the_default_is_on(monkeypatch, raw):
    monkeypatch.setenv("MCP_TEST_FLAG", raw)
    assert config._env_bool("MCP_TEST_FLAG", True) is False


@pytest.mark.parametrize("default", [True, False])
def test_an_unset_variable_takes_the_default(monkeypatch, default):
    monkeypatch.delenv("MCP_TEST_FLAG", raising=False)
    assert config._env_bool("MCP_TEST_FLAG", default) is default


def test_the_variable_name_is_the_one_read(monkeypatch):
    monkeypatch.setenv("MCP_TEST_FLAG", "true")
    monkeypatch.delenv("MCP_OTHER_FLAG", raising=False)
    assert config._env_bool("MCP_OTHER_FLAG", False) is False


class TestReadVersion:
    def test_reads_the_file_beside_the_package(self, tmp_path, monkeypatch):
        package = tmp_path / "mcp-server" / "turbo_ea_mcp"
        package.mkdir(parents=True)
        (tmp_path / "mcp-server" / "VERSION").write_text("  9.8.7\n")
        monkeypatch.setattr(config, "__file__", str(package / "config.py"))
        monkeypatch.chdir(tmp_path)
        assert config._read_version() == "9.8.7"

    def test_falls_back_to_the_working_directory(self, tmp_path, monkeypatch):
        package = tmp_path / "pkg" / "turbo_ea_mcp"
        package.mkdir(parents=True)
        (tmp_path / "VERSION").write_text("1.2.3\n")
        monkeypatch.setattr(config, "__file__", str(package / "config.py"))
        monkeypatch.chdir(tmp_path)
        assert config._read_version() == "1.2.3"

    def test_the_package_file_wins_over_the_working_directory(self, tmp_path, monkeypatch):
        package = tmp_path / "mcp-server" / "turbo_ea_mcp"
        package.mkdir(parents=True)
        (tmp_path / "mcp-server" / "VERSION").write_text("2.0.0\n")
        (tmp_path / "VERSION").write_text("1.0.0\n")
        monkeypatch.setattr(config, "__file__", str(package / "config.py"))
        monkeypatch.chdir(tmp_path)
        assert config._read_version() == "2.0.0"

    def test_a_directory_named_version_is_not_a_file(self, tmp_path, monkeypatch):
        package = tmp_path / "mcp-server" / "turbo_ea_mcp"
        package.mkdir(parents=True)
        (tmp_path / "mcp-server" / "VERSION").mkdir()
        monkeypatch.setattr(config, "__file__", str(package / "config.py"))
        monkeypatch.chdir(tmp_path)
        assert config._read_version() == "0.0.0"

    def test_no_file_anywhere_is_zero(self, tmp_path, monkeypatch):
        package = tmp_path / "pkg" / "turbo_ea_mcp"
        package.mkdir(parents=True)
        monkeypatch.setattr(config, "__file__", str(package / "config.py"))
        monkeypatch.chdir(tmp_path)
        assert config._read_version() == "0.0.0"


class TestParseOrigins:
    def test_trims_and_drops_empty_entries(self):
        assert config.parse_origins(" https://a.example , ,https://b.example:8443/ ") == [
            "https://a.example",
            "https://b.example:8443",
        ]

    def test_only_the_trailing_slash_is_removed(self):
        # An origin can end in any host character; only "/" is stripped.
        assert config.parse_origins("https://BOX/,https://x.example:8X") == [
            "https://BOX",
            "https://x.example:8X",
        ]

    @pytest.mark.parametrize("raw", ["", " ", ",", " , "])
    def test_nothing_set_is_no_origin(self, raw):
        assert config.parse_origins(raw) == []


class TestParseHosts:
    def test_trims_lower_cases_and_drops_empty_entries(self):
        assert config.parse_hosts(
            " Route.Env.AzureContainerApps.io , ,proxy.internal:* ,box:8443/"
        ) == [
            "route.env.azurecontainerapps.io",
            "proxy.internal:*",
            "box:8443",
        ]

    def test_only_the_trailing_slash_is_removed(self):
        # A host can end in any character ("BOX"); only "/" is stripped. A
        # pasted URL keeps its scheme and path; the server warns about it.
        assert config.parse_hosts("BOX/,https://Box.example/mcp/") == [
            "box",
            "https://box.example/mcp",
        ]

    @pytest.mark.parametrize("raw", ["", " ", ",", " , ", "/", " / ,"])
    def test_nothing_set_is_no_host(self, raw):
        assert config.parse_hosts(raw) == []


class TestPublicAppUrl:
    """The base of every link a tool hands back. A localhost value is the last
    resort: a compose install reached over OAuth sets ``MCP_PUBLIC_URL`` to its
    public address, and either leaves ``TURBO_EA_PUBLIC_URL`` unset or keeps
    the ``http://localhost`` that ``.env.example`` ships."""

    @pytest.mark.parametrize(
        "mcp_url", [None, "", "https://mcp.example.com/mcp", "http://localhost:8920/mcp"]
    )
    def test_an_explicit_real_host_always_wins(self, mcp_url):
        assert (
            config.public_app_url("https://app.example.com/ea", mcp_url)
            == "https://app.example.com/ea"
        )

    @pytest.mark.parametrize(
        "explicit",
        [
            "http://localhost",
            "http://localhost:8920",
            "http://LOCALHOST:80/",
            "https://127.0.0.1:8443",
            "http://[::1]",
            "http://[::1]:8920",
        ],
    )
    def test_an_explicit_loopback_loses_to_a_real_mcp_host(self, explicit):
        assert (
            config.public_app_url(explicit, "https://ea.example.com:8443/mcp/x?y=1")
            == "https://ea.example.com:8443"
        )

    @pytest.mark.parametrize(
        "mcp_url",
        [
            "http://localhost:8920/mcp",
            "http://127.0.0.1/mcp",
            "http://[::1]:8001/mcp",
            None,
            "",
            "https:",
            "//ea.example.com/mcp",
        ],
    )
    def test_an_explicit_loopback_stands_when_mcp_names_no_real_host(self, mcp_url):
        assert config.public_app_url("http://localhost", mcp_url) == "http://localhost"

    @pytest.mark.parametrize(
        "explicit", ["http://127.0.0.2", "http://localhost.example.com", "http://[::2]"]
    )
    def test_only_the_three_loopback_names_count_as_loopback(self, explicit):
        assert config.public_app_url(explicit, "https://ea.example.com/mcp") == explicit

    @pytest.mark.parametrize("explicit", [None, ""])
    @pytest.mark.parametrize(
        ("mcp_url", "expected"),
        [
            ("https://ea.example.com:8443/mcp/x?y=1", "https://ea.example.com:8443"),
            ("http://localhost:8920/mcp", "http://localhost:8920"),
            ("http://[::1]:9000/mcp", "http://[::1]:9000"),
        ],
    )
    def test_unset_falls_back_to_the_origin_of_the_mcp_url(self, explicit, mcp_url, expected):
        assert config.public_app_url(explicit, mcp_url) == expected

    @pytest.mark.parametrize("explicit", [None, ""])
    @pytest.mark.parametrize("mcp_url", [None, "", "https:", "//ea.example.com/mcp", "ea/mcp"])
    def test_with_nothing_usable_it_is_the_localhost_default(self, explicit, mcp_url):
        assert config.public_app_url(explicit, mcp_url) == "http://localhost:8920"

    def test_the_module_reads_the_raw_variables(self, monkeypatch):
        import importlib

        monkeypatch.delenv("TURBO_EA_PUBLIC_URL", raising=False)
        monkeypatch.delenv("MCP_PORT", raising=False)
        monkeypatch.setenv("MCP_PUBLIC_URL", "https://ea.example.com/mcp")
        try:
            assert importlib.reload(config).TURBO_EA_PUBLIC_URL == "https://ea.example.com"
            # The value .env.example ships gives way to the real MCP host.
            monkeypatch.setenv("TURBO_EA_PUBLIC_URL", "http://localhost")
            assert importlib.reload(config).TURBO_EA_PUBLIC_URL == "https://ea.example.com"
            monkeypatch.setenv("TURBO_EA_PUBLIC_URL", "")
            monkeypatch.delenv("MCP_PUBLIC_URL")
            # MCP_PUBLIC_URL's own code default is this server's port, never a link base.
            reloaded = importlib.reload(config)
            assert reloaded.TURBO_EA_PUBLIC_URL == "http://localhost:8920"
            assert reloaded.MCP_PUBLIC_URL == "http://localhost:8001"
        finally:
            monkeypatch.undo()
            importlib.reload(config)


def test_extension_destructive_is_opt_in(monkeypatch):
    """``call_extension_write`` refuses an extension's destructive operations
    unless the operator sets ``MCP_ALLOW_EXTENSION_DESTRUCTIVE``."""
    import importlib

    monkeypatch.delenv("MCP_ALLOW_EXTENSION_DESTRUCTIVE", raising=False)
    monkeypatch.delenv("MCP_ALLOW_RELATION_DELETE", raising=False)
    try:
        assert importlib.reload(config).MCP_ALLOW_EXTENSION_DESTRUCTIVE is False
        monkeypatch.setenv("MCP_ALLOW_EXTENSION_DESTRUCTIVE", "true")
        assert importlib.reload(config).MCP_ALLOW_EXTENSION_DESTRUCTIVE is True
        # The relation-delete opt-in is a different switch.
        assert config.MCP_ALLOW_RELATION_DELETE is False
    finally:
        monkeypatch.undo()
        importlib.reload(config)


def test_the_translation_cap_defaults_to_2000_and_reads_its_variable(monkeypatch):
    """``submit_translations`` refuses more strings than this in one call."""
    import importlib

    monkeypatch.delenv("MCP_MAX_TRANSLATIONS_PER_CALL", raising=False)
    monkeypatch.delenv("MCP_MAX_LOGOS_PER_CALL", raising=False)
    try:
        assert importlib.reload(config).MCP_MAX_TRANSLATIONS_PER_CALL == 2000
        monkeypatch.setenv("MCP_MAX_TRANSLATIONS_PER_CALL", "35")
        assert importlib.reload(config).MCP_MAX_TRANSLATIONS_PER_CALL == 35
        # The logo cap is a different variable.
        assert config.MCP_MAX_LOGOS_PER_CALL == 50
    finally:
        monkeypatch.undo()
        importlib.reload(config)


class TestDerivedKeys:
    """Every key the MCP server uses comes from SECRET_KEY, each under its own
    context string, so no two purposes share a key and the raw secret signs
    nothing (#1449)."""

    def test_the_service_key_matches_the_backends_known_answer(self):
        # The same vector is pinned in backend/tests/core/test_security.py
        # (TestDeriveKey): the two packages share no code, so this is what
        # keeps the service proof's key from drifting between them.
        assert config.service_auth_key("known-answer-secret").hex() == (
            "25688bcbaf929bb9a9dd67c18cdadec4b5fecdd2a2e231f7be82a931ec463250"
        )

    def test_the_refresh_token_key_matches_the_backends_known_answer(self):
        # HMAC-SHA256(SECRET_KEY, REFRESH_KEY_CONTEXT) as the backend's
        # mcp_session_service.py derives it to sign refresh tokens: this server
        # verifies with the same key, so the two must never drift.
        assert config.refresh_token_key("known-answer-secret").hex() == (
            "27dea087b1524bafdac338ded70c2fb2df9676fb3aa74a2eb3adcda3b3e2461c"
        )

    def test_each_key_is_bound_to_its_own_context(self):
        import hashlib
        import hmac

        def derive(context: bytes) -> bytes:
            return hmac.new(b"s", context, hashlib.sha256).digest()

        assert config.oauth_client_key("s") == derive(b"turbo-ea-mcp/oauth-client-id/v1")
        assert config.service_auth_key("s") == derive(b"turbo-ea-mcp/service-auth/v1")
        assert config.oauth_token_key("s") == derive(b"turbo-ea-mcp/oauth-access-token/v1")
        assert config.refresh_token_key("s") == derive(b"turbo-ea/mcp-refresh-token/v1")

    def test_the_four_keys_differ(self):
        keys = {
            config.oauth_client_key("s"),
            config.service_auth_key("s"),
            config.oauth_token_key("s"),
            config.refresh_token_key("s"),
        }
        assert len(keys) == 4

    @pytest.mark.parametrize(
        "derive",
        [
            config.oauth_client_key,
            config.service_auth_key,
            config.oauth_token_key,
            config.refresh_token_key,
        ],
    )
    def test_no_secret_gives_no_key(self, derive):
        assert derive("") is None

    def test_the_module_derives_all_four_from_secret_key(self, monkeypatch):
        import importlib

        monkeypatch.setenv("SECRET_KEY", "known-answer-secret")
        try:
            reloaded = importlib.reload(config)
            assert reloaded.MCP_OAUTH_CLIENT_KEY == config.oauth_client_key("known-answer-secret")
            assert reloaded.MCP_SERVICE_AUTH_KEY.hex().startswith("25688bcb")
            assert reloaded.MCP_OAUTH_TOKEN_KEY == config.oauth_token_key("known-answer-secret")
            assert reloaded.MCP_REFRESH_TOKEN_KEY.hex().startswith("27dea087")
            monkeypatch.delenv("SECRET_KEY")
            reloaded = importlib.reload(config)
            assert reloaded.MCP_OAUTH_CLIENT_KEY is None
            assert reloaded.MCP_SERVICE_AUTH_KEY is None
            assert reloaded.MCP_OAUTH_TOKEN_KEY is None
            assert reloaded.MCP_REFRESH_TOKEN_KEY is None
        finally:
            monkeypatch.undo()
            importlib.reload(config)
