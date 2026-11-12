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
