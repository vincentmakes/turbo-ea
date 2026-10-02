"""``/ai/status``, ``/ai/suggest`` and ``/ai/portfolio-insights``.

The LLM pipeline itself (``ai_service``) is replaced at the route's
import seam — ``suggest_metadata``, ``generate_portfolio_insights`` and
``fetch_running_models`` are module globals of ``app.api.v1.ai_suggest``
— so these tests pin the configuration gating, the permission gating and
the error mapping, not the prompts.
"""

from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest

import app.api.v1.ai_suggest as ai_api
from app.config import settings as app_config
from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.ea_principle import EAPrinciple
from tests.conftest import auth_headers, create_card_type, create_role, create_user
from tests.seams import ai_settings

SUGGEST = {"type_key": "Application", "name": "Salesforce", "context": "CRM"}


@pytest.fixture
async def env(db, monkeypatch):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    await create_card_type(db, key="Application", label="Application")
    # No env-var fallback: what the settings row says is what the route sees.
    monkeypatch.setattr(app_config, "AI_PROVIDER_URL", "")
    monkeypatch.setattr(app_config, "AI_MODEL", "")
    return {"admin": admin, "member": member, "viewer": viewer}


@pytest.fixture
def fakes(monkeypatch):
    """Recording stand-ins for the three ai_service calls."""
    state = SimpleNamespace(
        suggest_calls=[],
        insight_calls=[],
        models=[{"name": "llama3"}],
        suggest_error=None,
        insight_error=None,
        suggestion={
            "suggestions": {"description": {"value": "A CRM.", "confidence": 0.9}},
            "sources": [{"url": "https://example.com", "title": "Example"}],
            "model": "test-model",
            "search_provider": "duckduckgo",
        },
        insight={"insights": [{"title": "T", "observation": "O", "recommendation": "R"}]},
    )

    async def suggest_metadata(**kwargs):
        state.suggest_calls.append(kwargs)
        if state.suggest_error is not None:
            raise state.suggest_error
        return state.suggestion

    async def generate_portfolio_insights(**kwargs):
        state.insight_calls.append(kwargs)
        if state.insight_error is not None:
            raise state.insight_error
        return state.insight

    async def fetch_running_models(provider_url):
        return state.models

    monkeypatch.setattr(ai_api, "suggest_metadata", suggest_metadata)
    monkeypatch.setattr(ai_api, "generate_portfolio_insights", generate_portfolio_insights)
    monkeypatch.setattr(ai_api, "fetch_running_models", fetch_running_models)
    return state


class TestStatus:
    async def test_unconfigured_instance(self, client, db, env, fakes):
        resp = await client.get("/api/v1/ai/status", headers=auth_headers(env["member"]))
        assert resp.status_code == 200
        assert resp.json() == {
            "enabled": False,
            "configured": False,
            "provider_type": "ollama",
            "enabled_types": [],
            "running_models": [],
            "model": None,
            "portfolio_insights_enabled": False,
        }

    async def test_ollama_lists_its_running_models(self, client, db, env, fakes):
        await ai_settings(
            db, provider_type="ollama", api_key=None, enabledTypes=["Application"], model="llama3"
        )
        resp = await client.get("/api/v1/ai/status", headers=auth_headers(env["member"]))
        out = resp.json()
        assert out["enabled"] and out["configured"]
        assert out["running_models"] == ["llama3"] and out["model"] == "llama3"
        assert out["enabled_types"] == ["Application"]

    async def test_commercial_provider_has_no_running_models(self, client, db, env, fakes):
        await ai_settings(db, provider_type="openai")
        out = (await client.get("/api/v1/ai/status", headers=auth_headers(env["admin"]))).json()
        assert out["enabled"] and out["configured"]
        assert out["running_models"] == [] and out["provider_type"] == "openai"

    async def test_viewer_without_the_permission_sees_it_disabled(self, client, db, env, fakes):
        await ai_settings(db, provider_type="ollama", api_key=None, enabledTypes=["Application"])
        out = (await client.get("/api/v1/ai/status", headers=auth_headers(env["viewer"]))).json()
        assert out["enabled"] is False and out["model"] is None
        assert out["configured"] is True
        # The enabled-types list reflects the setting, not the caller.
        assert out["enabled_types"] == ["Application"]

    async def test_portfolio_insights_needs_flag_permission_and_configuration(
        self, client, db, env, fakes
    ):
        await ai_settings(db, portfolioInsightsEnabled=True)
        assert (await client.get("/api/v1/ai/status", headers=auth_headers(env["admin"]))).json()[
            "portfolio_insights_enabled"
        ] is True
        assert (await client.get("/api/v1/ai/status", headers=auth_headers(env["viewer"]))).json()[
            "portfolio_insights_enabled"
        ] is False
        await ai_settings(db, portfolioInsightsEnabled=True, model="")
        assert (await client.get("/api/v1/ai/status", headers=auth_headers(env["admin"]))).json()[
            "portfolio_insights_enabled"
        ] is False


class TestSuggest:
    async def _post(self, client, user, body=SUGGEST):
        return await client.post("/api/v1/ai/suggest", json=body, headers=auth_headers(user))

    async def test_viewer_is_refused(self, client, db, env, fakes):
        await ai_settings(db)
        assert (await self._post(client, env["viewer"])).status_code == 403

    async def test_disabled_is_400(self, client, db, env, fakes):
        await ai_settings(db, enabled=False)
        resp = await self._post(client, env["member"])
        assert resp.status_code == 400 and "not enabled" in resp.json()["detail"]

    async def test_no_row_at_all_is_400(self, client, db, env, fakes):
        resp = await self._post(client, env["member"])
        assert resp.status_code == 400 and "not enabled" in resp.json()["detail"]

    async def test_missing_provider_url_or_model_is_400(self, client, db, env, fakes):
        await ai_settings(db, provider_url="")
        resp = await self._post(client, env["member"])
        assert resp.status_code == 400 and "provider URL and model" in resp.json()["detail"]
        await ai_settings(db, model="")
        resp = await self._post(client, env["member"])
        assert resp.status_code == 400 and "provider URL and model" in resp.json()["detail"]

    @pytest.mark.parametrize("provider", ["openai", "azure_openai", "anthropic"])
    async def test_commercial_provider_without_key_is_400(self, client, db, env, fakes, provider):
        await ai_settings(db, provider_type=provider, api_key=None)
        resp = await self._post(client, env["member"])
        assert resp.status_code == 400 and "API key is required" in resp.json()["detail"]

    async def test_type_not_enabled_is_400(self, client, db, env, fakes):
        await ai_settings(db, enabledTypes=["ITComponent"])
        resp = await self._post(client, env["member"])
        assert resp.status_code == 400
        assert "not enabled for card type 'Application'" in resp.json()["detail"]

    async def test_unknown_card_type_is_404(self, client, db, env, fakes):
        await ai_settings(db)
        resp = await self._post(client, env["member"], {**SUGGEST, "type_key": "Nope"})
        assert resp.status_code == 404

    async def test_unreachable_provider_is_502(self, client, db, env, fakes):
        await ai_settings(db)
        fakes.suggest_error = httpx.ConnectError("refused")
        resp = await self._post(client, env["member"])
        assert resp.status_code == 502 and "Could not reach" in resp.json()["detail"]

    async def test_any_other_failure_is_502(self, client, db, env, fakes):
        await ai_settings(db)
        fakes.suggest_error = RuntimeError("model crashed")
        resp = await self._post(client, env["member"])
        assert resp.status_code == 502 and "Check server logs" in resp.json()["detail"]

    async def test_happy_path_passes_the_configuration_through(self, client, db, env, fakes):
        await ai_settings(
            db, provider_type="anthropic", api_key="sk-live", enabledTypes=["Application"]
        )
        resp = await self._post(client, env["member"], {**SUGGEST, "subtype": "microservice"})
        assert resp.status_code == 200
        out = resp.json()
        assert out["suggestions"]["description"]["value"] == "A CRM."
        assert out["sources"][0]["url"] == "https://example.com"
        assert out["model"] == "test-model"
        (call,) = fakes.suggest_calls
        assert call["name"] == "Salesforce" and call["type_label"] == "Application"
        assert call["subtype"] == "microservice" and call["context"] == "CRM"
        assert call["provider_type"] == "anthropic" and call["api_key"] == "sk-live"
        assert call["provider_url"] == "https://llm.test" and call["model"] == "test-model"
        assert call["fields_schema"] == []


class TestPortfolioInsights:
    async def _post(self, client, user):
        body = {
            "total_apps": 3,
            "group_by": "hostingType",
            "groups": [{"name": "cloud", "count": 3}],
        }
        return await client.post(
            "/api/v1/ai/portfolio-insights", json=body, headers=auth_headers(user)
        )

    async def test_viewer_is_refused(self, client, db, env, fakes):
        await ai_settings(db, portfolioInsightsEnabled=True)
        assert (await self._post(client, env["viewer"])).status_code == 403

    async def test_not_enabled_is_400(self, client, db, env, fakes):
        await ai_settings(db)
        resp = await self._post(client, env["admin"])
        assert resp.status_code == 400 and "not enabled" in resp.json()["detail"]

    async def test_configuration_gates_match_suggest(self, client, db, env, fakes):
        await ai_settings(db, portfolioInsightsEnabled=True, provider_url="")
        assert (await self._post(client, env["admin"])).status_code == 400
        await ai_settings(db, portfolioInsightsEnabled=True, provider_type="openai", api_key=None)
        assert (await self._post(client, env["admin"])).status_code == 400

    async def test_active_principles_are_handed_to_the_model(self, client, db, env, fakes):
        await ai_settings(db, portfolioInsightsEnabled=True)
        db.add(EAPrinciple(title="Cloud first", description="d", rationale="r", sort_order=2))
        db.add(EAPrinciple(title="Buy before build", sort_order=1))
        db.add(EAPrinciple(title="Retired", is_active=False, sort_order=0))
        await db.flush()

        resp = await self._post(client, env["admin"])
        assert resp.status_code == 200
        assert resp.json()["insights"][0]["title"] == "T"
        (call,) = fakes.insight_calls
        assert [p["title"] for p in call["principles"]] == ["Buy before build", "Cloud first"]
        assert call["principles"][1] == {
            "title": "Cloud first",
            "description": "d",
            "rationale": "r",
            "implications": "",
        }
        assert call["summary"]["total_apps"] == 3 and call["summary"]["group_by"] == "hostingType"

    async def test_provider_errors_map_to_502(self, client, db, env, fakes):
        await ai_settings(db, portfolioInsightsEnabled=True)
        fakes.insight_error = httpx.ReadTimeout("slow")
        resp = await self._post(client, env["admin"])
        assert resp.status_code == 502 and "Could not reach" in resp.json()["detail"]
        fakes.insight_error = ValueError("bad json")
        resp = await self._post(client, env["admin"])
        assert resp.status_code == 502 and "Check server logs" in resp.json()["detail"]
