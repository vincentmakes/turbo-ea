"""Integration test for the /metrics endpoint on the FastAPI app.

Uses a lightweight TestClient against the real app — no database needed
because the /metrics endpoint just returns prometheus_client output.
"""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    return TestClient(app, raise_server_exceptions=False)


class TestMetricsEndpoint:
    def test_returns_200(self, client):
        resp = client.get("/metrics")
        assert resp.status_code == 200

    def test_content_type(self, client):
        resp = client.get("/metrics")
        assert "text/plain" in resp.headers["content-type"]

    def test_contains_standard_metrics(self, client):
        resp = client.get("/metrics")
        body = resp.text
        # prometheus_client always includes process metrics
        assert "process_cpu_seconds_total" in body

    def test_contains_app_info(self, client):
        resp = client.get("/metrics")
        body = resp.text
        assert "turboea_info" in body

    def test_contains_http_metrics(self, client):
        # Make a request to generate data, then check /metrics
        client.get("/api/health")
        resp = client.get("/metrics")
        body = resp.text
        assert "http_requests_total" in body
        assert "http_request_duration_seconds" in body
