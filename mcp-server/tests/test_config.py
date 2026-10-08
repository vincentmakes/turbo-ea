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

    def test_the_package_file_wins_over_the_working_directory(
        self, tmp_path, monkeypatch
    ):
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
