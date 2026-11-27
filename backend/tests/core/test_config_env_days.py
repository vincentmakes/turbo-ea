"""The MCP connection lifetimes read from the environment (#1449)."""

from __future__ import annotations

from app.config import env_days, settings


def test_the_default_applies_when_unset(monkeypatch):
    monkeypatch.delenv("SOME_DAYS", raising=False)
    assert env_days("SOME_DAYS", 30, minimum=1) == 30


def test_a_set_value_is_read(monkeypatch):
    monkeypatch.setenv("SOME_DAYS", "7")
    assert env_days("SOME_DAYS", 30, minimum=1) == 7


def test_a_value_below_the_minimum_reads_as_the_minimum(monkeypatch):
    monkeypatch.setenv("SOME_DAYS", "0")
    assert env_days("SOME_DAYS", 30, minimum=1) == 1
    monkeypatch.setenv("SOME_DAYS", "-5")
    assert env_days("SOME_DAYS", 180, minimum=0) == 0


def test_the_minimum_itself_is_kept(monkeypatch):
    monkeypatch.setenv("SOME_DAYS", "1")
    assert env_days("SOME_DAYS", 30, minimum=1) == 1


def test_the_shipped_defaults():
    assert settings.MCP_SESSION_IDLE_DAYS == 30
    assert settings.MCP_SESSION_MAX_DAYS == 180
