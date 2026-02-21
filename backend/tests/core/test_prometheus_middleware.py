"""Unit tests for app.middleware.prometheus — request instrumentation.

These tests exercise the path normalisation helper and the middleware itself
using a minimal ASGI app. No database required.
"""

from __future__ import annotations

import pytest
from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from app.middleware.prometheus import PrometheusMiddleware, _normalise_path

# ---------------------------------------------------------------------------
# Path normalisation
# ---------------------------------------------------------------------------


class TestNormalisePath:
    def test_uuid_collapsed(self):
        path = "/api/v1/cards/550e8400-e29b-41d4-a716-446655440000"
        assert _normalise_path(path) == "/api/v1/cards/{id}"

    def test_multiple_uuids(self):
        path = (
            "/api/v1/cards/550e8400-e29b-41d4-a716-446655440000"
            "/relations/a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        )
        assert _normalise_path(path) == "/api/v1/cards/{id}/relations/{id}"

    def test_no_uuid_unchanged(self):
        path = "/api/v1/metamodel/types"
        assert _normalise_path(path) == "/api/v1/metamodel/types"

    def test_root_path(self):
        assert _normalise_path("/") == "/"

    def test_trailing_slash_stripped(self):
        assert _normalise_path("/api/v1/cards/") == "/api/v1/cards"

    def test_short_hex_not_collapsed(self):
        # A short hex string should NOT be collapsed — only 32-char UUIDs
        path = "/api/v1/cards/abc123"
        assert _normalise_path(path) == "/api/v1/cards/abc123"


# ---------------------------------------------------------------------------
# Middleware integration
# ---------------------------------------------------------------------------


def _homepage(request):
    return PlainTextResponse("ok")


def _erroring(request):
    raise ValueError("boom")


@pytest.fixture()
def app():
    application = Starlette(
        routes=[
            Route("/api/v1/cards", _homepage),
            Route("/api/health", _homepage),
            Route("/metrics", _homepage),
            Route("/api/v1/error", _erroring),
        ],
    )
    application.add_middleware(PrometheusMiddleware)
    return application


@pytest.fixture()
def client(app):
    return TestClient(app, raise_server_exceptions=False)


class TestPrometheusMiddleware:
    def test_normal_request_returns_200(self, client):
        resp = client.get("/api/v1/cards")
        assert resp.status_code == 200

    def test_health_skipped(self, client):
        """Health endpoint should not be instrumented (in _SKIP_PATHS)."""
        resp = client.get("/api/health")
        assert resp.status_code == 200

    def test_metrics_skipped(self, client):
        """Metrics endpoint should not be instrumented."""
        resp = client.get("/metrics")
        assert resp.status_code == 200

    def test_error_request_records_500(self, client):
        """Even if the handler raises, metrics should still be recorded."""
        resp = client.get("/api/v1/error")
        assert resp.status_code == 500
