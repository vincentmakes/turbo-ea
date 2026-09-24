"""Integration tests for the MCP server ASGI application."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest
from starlette.testclient import TestClient

from turbo_ea_mcp import server
from turbo_ea_mcp.server import create_app


@pytest.fixture
def app_client():
    app = create_app()
    return TestClient(app)


class TestMetadataEndpoints:
    def test_protected_resource_metadata(self, app_client):
        """Protected Resource Metadata (RFC 9728) returns correct structure."""
        resp = app_client.get("/.well-known/oauth-protected-resource")
        assert resp.status_code == 200
        data = resp.json()
        assert "resource" in data
        assert "authorization_servers" in data
        assert isinstance(data["authorization_servers"], list)
        assert len(data["authorization_servers"]) >= 1
        assert "mcp:read" in data.get("scopes_supported", [])
        assert "header" in data.get("bearer_methods_supported", [])

    def test_authorization_server_metadata(self, app_client):
        """Authorization Server Metadata (RFC 8414) returns correct structure."""
        resp = app_client.get("/.well-known/oauth-authorization-server")
        assert resp.status_code == 200
        data = resp.json()
        assert "issuer" in data
        assert "authorization_endpoint" in data
        assert "token_endpoint" in data
        assert "code" in data.get("response_types_supported", [])
        assert "authorization_code" in data.get("grant_types_supported", [])
        assert "refresh_token" in data.get("grant_types_supported", [])
        assert "S256" in data.get("code_challenge_methods_supported", [])

    def test_health_endpoint(self, app_client):
        """Health endpoint returns ok."""
        resp = app_client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "version" in data


class TestOAuthEndpoints:
    def test_authorize_requires_code_response_type(self, app_client):
        """Authorization endpoint rejects non-code response types."""
        resp = app_client.get(
            "/oauth/authorize",
            params={"response_type": "token", "client_id": "test"},
            follow_redirects=False,
        )
        assert resp.status_code == 400
        assert resp.json()["error"] == "unsupported_response_type"

    def test_authorize_requires_pkce(self, app_client):
        """Authorization endpoint rejects requests without PKCE S256."""
        resp = app_client.get(
            "/oauth/authorize",
            params={
                "response_type": "code",
                "client_id": "test",
                "redirect_uri": "http://localhost/callback",
            },
            follow_redirects=False,
        )
        assert resp.status_code == 400
        assert "PKCE" in resp.json().get("error_description", "")

    def test_token_rejects_unknown_grant(self, app_client):
        """Token endpoint rejects unknown grant types."""
        resp = app_client.post(
            "/oauth/token",
            data={"grant_type": "password", "username": "x", "password": "y"},
        )
        assert resp.status_code == 400
        assert resp.json()["error"] == "unsupported_grant_type"

    def test_token_rejects_unknown_code(self, app_client):
        """Token endpoint rejects unknown authorization codes."""
        resp = app_client.post(
            "/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": "nonexistent-code",
                "code_verifier": "verifier",
            },
        )
        assert resp.status_code == 400
        assert resp.json()["error"] == "invalid_grant"

    def test_token_rejects_unknown_refresh_token(self, app_client):
        """Token endpoint rejects unknown refresh tokens."""
        resp = app_client.post(
            "/oauth/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": "nonexistent-token",
            },
        )
        assert resp.status_code == 400
        assert resp.json()["error"] == "invalid_grant"

    def test_register_client(self, app_client):
        """Dynamic client registration creates a client."""
        resp = app_client.post(
            "/oauth/register",
            json={
                "client_name": "Test AI Tool",
                "redirect_uris": ["http://localhost:3000/callback"],
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "client_id" in data
        assert data["client_name"] == "Test AI Tool"
        assert data["token_endpoint_auth_method"] == "none"


# ────────────────────────────────────────────────────────────────────────────
# MCP tools — unit tests
#
# Each tool is a tiny shim over ``TurboEAClient.get`` so testing reduces to:
#   1. set ``_stdio_token`` to a fake value so ``_get_current_token`` passes.
#   2. mock ``TurboEAClient.get`` with an ``AsyncMock`` so no HTTP fires.
#   3. invoke the tool function directly and assert (a) the right path/params
#      were forwarded, (b) the JSON response flows back through ``_fmt``.
# ────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def fake_token(monkeypatch):
    """Pretend a user is logged in so tool auth checks pass."""
    monkeypatch.setattr(server, "_stdio_token", "test-token")
    yield "test-token"


def _patched_get(payload):
    """Patch ``TurboEAClient.get`` to return ``payload``. Returns the mock so
    tests can assert path/params."""
    mock = AsyncMock(return_value=payload)
    return patch.object(server.TurboEAClient, "get", mock), mock


def _assert_called_with(mock, path: str, params: dict | None = None):
    """Verify the mocked ``client.get`` saw the expected path and params."""
    mock.assert_awaited_once()
    args, kwargs = mock.call_args
    assert args[0] == path, f"expected path {path!r}, got {args[0]!r}"
    if params is not None:
        assert kwargs.get("params") == params, (
            f"expected params {params!r}, got {kwargs.get('params')!r}"
        )


def _parse(s: str) -> dict | list:
    """Tools return formatted JSON strings — round-trip back to a dict for asserts."""
    return json.loads(s)


class TestUnauthenticatedTools:
    """Every tool returns a friendly error string when no token is set."""

    def test_list_risks_requires_auth(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        import asyncio

        result = asyncio.run(server.list_risks())
        assert "Not authenticated" in result


class TestGrcTools:
    @pytest.mark.asyncio
    async def test_list_risks_strips_empty_filters(self, fake_token):
        patcher, mock = _patched_get(
            {"items": [], "total": 0, "page": 1, "page_size": 50}
        )
        with patcher:
            out = await server.list_risks(status="identified", page=1, page_size=10)
        _assert_called_with(
            mock,
            "/risks",
            params={"status": "identified", "page": 1, "page_size": 10},
        )
        assert _parse(out)["total"] == 0

    @pytest.mark.asyncio
    async def test_list_risks_passes_all_filters(self, fake_token):
        patcher, mock = _patched_get({"items": []})
        with patcher:
            await server.list_risks(
                status="identified",
                category="security",
                level="high",
                owner_id="u-1",
                card_id="c-1",
                source_type="manual",
                search="cve",
                overdue=True,
                page=2,
                page_size=25,
            )
        _assert_called_with(
            mock,
            "/risks",
            params={
                "status": "identified",
                "category": "security",
                "level": "high",
                "owner_id": "u-1",
                "card_id": "c-1",
                "source_type": "manual",
                "search": "cve",
                "overdue": "true",
                "page": 2,
                "page_size": 25,
            },
        )

    @pytest.mark.asyncio
    async def test_get_risk(self, fake_token):
        patcher, mock = _patched_get({"id": "r-1", "reference": "R-000001"})
        with patcher:
            out = await server.get_risk("r-1")
        _assert_called_with(mock, "/risks/r-1")
        assert _parse(out)["reference"] == "R-000001"

    @pytest.mark.asyncio
    async def test_get_risk_metrics(self, fake_token):
        patcher, mock = _patched_get(
            {"by_status": {}, "matrix_initial": [], "matrix_residual": []}
        )
        with patcher:
            out = await server.get_risk_metrics()
        _assert_called_with(mock, "/risks/metrics")
        assert "matrix_initial" in _parse(out)

    @pytest.mark.asyncio
    async def test_get_card_risks(self, fake_token):
        patcher, mock = _patched_get([])
        with patcher:
            await server.get_card_risks("c-1")
        _assert_called_with(mock, "/cards/c-1/risks")

    @pytest.mark.asyncio
    async def test_list_compliance_findings(self, fake_token):
        patcher, mock = _patched_get([])
        with patcher:
            await server.list_compliance_findings(
                regulation="gdpr", include_auto_resolved=True
            )
        _assert_called_with(
            mock,
            "/compliance/compliance",
            params={"regulation": "gdpr", "include_auto_resolved": "true"},
        )

    @pytest.mark.asyncio
    async def test_get_compliance_overview(self, fake_token):
        patcher, mock = _patched_get({"kpis": {}, "matrix": []})
        with patcher:
            await server.get_compliance_overview()
        _assert_called_with(mock, "/compliance/overview")


class TestGovernanceTools:
    @pytest.mark.asyncio
    async def test_list_principles(self, fake_token):
        patcher, mock = _patched_get([])
        with patcher:
            await server.list_principles()
        _assert_called_with(mock, "/metamodel/principles")

    @pytest.mark.asyncio
    async def test_list_adrs(self, fake_token):
        patcher, mock = _patched_get([])
        with patcher:
            await server.list_adrs(initiative_id="i-1", status="signed")
        _assert_called_with(
            mock,
            "/adr",
            params={"initiative_id": "i-1", "status": "signed"},
        )

    @pytest.mark.asyncio
    async def test_get_adr(self, fake_token):
        patcher, mock = _patched_get({"id": "a-1", "title": "Use PostgreSQL"})
        with patcher:
            out = await server.get_adr("a-1")
        _assert_called_with(mock, "/adr/a-1")
        assert _parse(out)["title"] == "Use PostgreSQL"

    @pytest.mark.asyncio
    async def test_list_soaws(self, fake_token):
        patcher, mock = _patched_get([])
        with patcher:
            await server.list_soaws(initiative_id="i-1")
        _assert_called_with(mock, "/soaw", params={"initiative_id": "i-1"})


class TestReportTools:
    @pytest.mark.asyncio
    async def test_get_portfolio_report_defaults(self, fake_token):
        patcher, mock = _patched_get({"points": []})
        with patcher:
            await server.get_portfolio_report()
        _assert_called_with(
            mock,
            "/reports/portfolio",
            params={
                "type": "Application",
                "x_axis": "functionalFit",
                "y_axis": "technicalFit",
                "size_field": "costTotalAnnual",
                "color_field": "businessCriticality",
            },
        )

    @pytest.mark.asyncio
    async def test_get_cost_treemap_with_group(self, fake_token):
        patcher, mock = _patched_get({"groups": []})
        with patcher:
            await server.get_cost_treemap(group_by="BusinessCapability")
        _assert_called_with(
            mock,
            "/reports/cost-treemap",
            params={
                "type": "Application",
                "cost_field": "costTotalAnnual",
                "group_by": "BusinessCapability",
            },
        )

    @pytest.mark.asyncio
    async def test_get_capability_heatmap(self, fake_token):
        patcher, mock = _patched_get({"tree": []})
        with patcher:
            await server.get_capability_heatmap(metric="cost")
        _assert_called_with(
            mock,
            "/reports/capability-heatmap",
            params={"metric": "cost"},
        )

    @pytest.mark.asyncio
    async def test_get_data_quality_report(self, fake_token):
        patcher, mock = _patched_get({"by_type": []})
        with patcher:
            await server.get_data_quality_report()
        _assert_called_with(mock, "/reports/data-quality")


class TestCardContextTools:
    @pytest.mark.asyncio
    async def test_get_card_stakeholders(self, fake_token):
        patcher, mock = _patched_get([])
        with patcher:
            await server.get_card_stakeholders("c-1")
        _assert_called_with(mock, "/cards/c-1/stakeholders")

    @pytest.mark.asyncio
    async def test_get_card_comments(self, fake_token):
        patcher, mock = _patched_get([])
        with patcher:
            await server.get_card_comments("c-1")
        _assert_called_with(mock, "/cards/c-1/comments")

    @pytest.mark.asyncio
    async def test_get_card_documents(self, fake_token):
        patcher, mock = _patched_get([])
        with patcher:
            await server.get_card_documents("c-1")
        _assert_called_with(mock, "/cards/c-1/documents")
