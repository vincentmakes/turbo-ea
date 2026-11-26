"""``ai_service.ai_config_from_settings`` / ``provider_usable``: the AI
provider configuration every AI caller reads (card suggestions, portfolio
insights, the custom-language translation job). A renamed key here silently
switches the feature off or calls the wrong provider, so every key is pinned.
No database.
"""

from __future__ import annotations

import pytest

from app.config import settings as app_config
from app.core.encryption import encrypt_value
from app.services.ai_service import (
    DEFAULT_AZURE_API_VERSION,
    ai_config_from_settings,
    provider_usable,
)


@pytest.fixture(autouse=True)
def no_env_fallback(monkeypatch):
    monkeypatch.setattr(app_config, "AI_PROVIDER_URL", "")
    monkeypatch.setattr(app_config, "AI_MODEL", "")


def test_every_setting_is_read_from_its_key():
    general = {
        "ai": {
            "enabled": True,
            "providerType": "azure_openai",
            "providerUrl": "https://llm.example",
            "apiKey": encrypt_value("sk-secret"),
            "model": "gpt-x",
            "apiVersion": "2030-01-01",
            "enabledTypes": ["Application"],
            "portfolioInsightsEnabled": True,
        }
    }
    assert ai_config_from_settings(general) == {
        "enabled": True,
        "provider_type": "azure_openai",
        "provider_url": "https://llm.example",
        "api_key": "sk-secret",
        "model": "gpt-x",
        "api_version": "2030-01-01",
        "search_provider": "duckduckgo",
        "search_url": "",
        "enabled_types": ["Application"],
        "portfolio_insights_enabled": True,
    }


@pytest.mark.parametrize("general", [{}, {"ai": {}}, {"ai": {"apiKey": None}}])
def test_every_default(general):
    assert ai_config_from_settings(general) == {
        "enabled": False,
        "provider_type": "ollama",
        "provider_url": "",
        "api_key": "",
        "model": "",
        "api_version": DEFAULT_AZURE_API_VERSION,
        "search_provider": "duckduckgo",
        "search_url": "",
        "enabled_types": [],
        "portfolio_insights_enabled": False,
    }


def test_url_and_model_fall_back_to_the_environment(monkeypatch):
    monkeypatch.setattr(app_config, "AI_PROVIDER_URL", "http://ollama:11434")
    monkeypatch.setattr(app_config, "AI_MODEL", "gemma3:4b")
    cfg = ai_config_from_settings({"ai": {"providerUrl": "", "model": None}})
    assert (cfg["provider_url"], cfg["model"]) == ("http://ollama:11434", "gemma3:4b")


def test_a_legacy_plaintext_key_is_used_as_is():
    assert ai_config_from_settings({"ai": {"apiKey": "plain"}})["api_key"] == "plain"


def _cfg(**kw):
    return {"provider_type": "ollama", "provider_url": "u", "model": "m", "api_key": "", **kw}


@pytest.mark.parametrize(
    ("cfg", "usable"),
    [
        (_cfg(), True),
        (_cfg(provider_url=""), False),
        (_cfg(model=""), False),
        (_cfg(provider_url="", model=""), False),
        (_cfg(provider_type="openai"), False),
        (_cfg(provider_type="azure_openai"), False),
        (_cfg(provider_type="anthropic"), False),
        (_cfg(provider_type="anthropic", api_key="k"), True),
        (_cfg(provider_type="bedrock"), True),
    ],
)
def test_provider_usable(cfg, usable):
    assert provider_usable(cfg) is usable
