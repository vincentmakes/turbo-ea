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

    async def test_a_provider_refusal_is_502_with_its_reason(self, client, db, env, fakes):
        """#1358: a refused request was reported as an unreachable provider."""
        await ai_settings(db, provider_type="anthropic", api_key="sk-live")
        fakes.suggest_error = _status_error(
            400, {"error": {"message": "`temperature` is deprecated for this model."}}
        )
        resp = await self._post(client, env["member"])
        assert resp.status_code == 502
        assert resp.json()["detail"] == (
            "The AI provider rejected the request (400): "
            "`temperature` is deprecated for this model."
        )

    async def test_eol_product_description_uses_the_product_context(self, client, db, env, fakes):
        """A custom EOL product is not a card type: the per-type switch does
        not apply, the lifecycle search context does, and the vendor link
        rides along as context."""
        await ai_settings(db, enabledTypes=["ITComponent"])
        resp = await client.post(
            "/api/v1/ai/suggest-eol-product",
            json={"name": "Acme ERP", "link": "https://acme.example/lifecycle"},
            headers=auth_headers(env["member"]),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["suggestions"]["description"]["value"] == "A CRM."
        [call] = fakes.suggest_calls
        assert call["name"] == "Acme ERP"
        assert call["type_key"] == "__eol_product__"
        assert call["fields_schema"] is None
        assert call["context"] == "Vendor or release policy page: https://acme.example/lifecycle"

    async def test_eol_product_description_without_a_link(self, client, db, env, fakes):
        await ai_settings(db)
        resp = await client.post(
            "/api/v1/ai/suggest-eol-product",
            json={"name": "Acme ERP"},
            headers=auth_headers(env["member"]),
        )
        assert resp.status_code == 200
        assert fakes.suggest_calls[0]["context"] is None

    async def test_eol_product_description_is_gated_like_suggest(self, client, db, env, fakes):
        body = {"name": "Acme ERP"}
        path = "/api/v1/ai/suggest-eol-product"
        await ai_settings(db)
        viewer = await client.post(path, json=body, headers=auth_headers(env["viewer"]))
        assert viewer.status_code == 403
        await ai_settings(db, enabled=False)
        off = await client.post(path, json=body, headers=auth_headers(env["member"]))
        assert off.status_code == 400 and "not enabled" in off.json()["detail"]
        await ai_settings(db, model="")
        bare = await client.post(path, json=body, headers=auth_headers(env["member"]))
        assert bare.status_code == 400 and "provider URL and model" in bare.json()["detail"]
        await ai_settings(db)
        fakes.suggest_error = httpx.ConnectError("refused")
        down = await client.post(path, json=body, headers=auth_headers(env["member"]))
        assert down.status_code == 502 and "Could not reach" in down.json()["detail"]
        empty = await client.post(path, json={"name": ""}, headers=auth_headers(env["member"]))
        assert empty.status_code == 422

    async def test_an_auth_refusal_does_not_echo_the_provider(self, client, db, env, fakes):
        await ai_settings(db, provider_type="openai", api_key="sk-live")
        fakes.suggest_error = _status_error(
            401, {"error": {"message": "Incorrect API key provided: sk-li***live"}}
        )
        resp = await self._post(client, env["member"])
        assert resp.status_code == 502
        assert "sk-li" not in resp.json()["detail"]
        assert resp.json()["detail"].startswith("The AI provider rejected the request (401)")

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
        fakes.insight_error = _status_error(404, {"error": {"message": "model: nope"}})
        resp = await self._post(client, env["admin"])
        assert resp.status_code == 502
        assert resp.json()["detail"] == "The AI provider rejected the request (404): model: nope"


def _status_error(code: int, body: dict | None = None) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://llm.test/v1/messages")
    response = httpx.Response(code, json=body or {}, request=request)
    return httpx.HTTPStatusError(str(code), request=request, response=response)


class TestProviderFailureDetail:
    """The message mapping on its own — the route handlers that call it are
    decorated, so mutmut does not mutate them."""

    def test_a_transport_failure_is_unreachable(self):
        assert ai_api.provider_failure_detail(httpx.ConnectError("x")) == (
            "Could not reach the AI provider. Check that it is running and accessible."
        )

    @pytest.mark.parametrize("status", [401, 403])
    def test_an_auth_refusal_names_the_key_not_the_provider_text(self, status):
        exc = _status_error(status, {"error": {"message": "key sk-abc***xyz"}})
        assert ai_api.provider_failure_detail(exc) == (
            f"The AI provider rejected the request ({status}): check the API key "
            "and that it may use the configured model."
        )

    @pytest.mark.parametrize("status", [402, 429])
    def test_a_quota_refusal_says_so(self, status):
        exc = _status_error(status, {"error": {"message": "slow down"}})
        assert ai_api.provider_failure_detail(exc) == (
            f"The AI provider rejected the request ({status}): rate limit or quota "
            "exceeded. Try again later."
        )

    @pytest.mark.parametrize("status", [400, 404, 500, 529])
    def test_any_other_refusal_carries_the_providers_reason(self, status):
        exc = _status_error(status, {"error": {"message": "the reason"}})
        assert ai_api.provider_failure_detail(exc) == (
            f"The AI provider rejected the request ({status}): the reason"
        )

    def test_the_log_names_the_status_and_reason(self, caplog):
        with caplog.at_level("WARNING", logger="turboea.ai"):
            ai_api._log_provider_failure(
                "AI suggestion", _status_error(400, {"error": {"message": "nope"}})
            )
            ai_api._log_provider_failure("AI suggestion", httpx.ConnectError("refused"))
        assert "AI suggestion failed: provider answered 400 — nope" in caplog.text
        assert "AI suggestion failed: refused" in caplog.text
