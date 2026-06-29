"""Tests for the Custom Report MCP tools.

Mirrors the batch-aware routing pattern in test_write_tools_v2.py: the
open-batch / underlying-write / commit-batch POSTs are routed by path so each
test can assert on the underlying write specifically.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from turbo_ea_mcp import server


@pytest.fixture
def fake_token(monkeypatch):
    monkeypatch.setattr(server, "_stdio_token", "test-token")
    yield "test-token"


def _parse(s: str) -> dict | list:
    return json.loads(s)


SPEC = {
    "title": "Apps by criticality",
    "source": {"card_type": "Application"},
    "dimensions": [{"kind": "attribute", "key": "businessCriticality"}],
    "measures": [{"agg": "count"}],
    "visualization": {"kind": "pie"},
}

PREVIEW = {
    "columns": [{"key": "d0", "label": "Crit", "kind": "dimension", "type": "string"}],
    "rows": [{"d0": "High", "m0": 2}],
    "meta": {"card_type": "Application", "group_count": 1, "truncated": False},
}


class TestGetReportBuilderSchema:
    @pytest.mark.asyncio
    async def test_returns_dsl_and_metamodel(self, fake_token):
        async def get_router(path, params=None):
            if path == "/metamodel/types":
                return [
                    {
                        "key": "Application",
                        "label": "Application",
                        "is_hidden": False,
                        "subtypes": [{"key": "Microservice"}],
                        "fields_schema": [
                            {
                                "fields": [
                                    {
                                        "key": "costTotalAnnual",
                                        "label": "Cost",
                                        "type": "cost",
                                    },
                                    {
                                        "key": "businessCriticality",
                                        "type": "single_select",
                                    },
                                ]
                            }
                        ],
                    },
                    {"key": "Hidden", "is_hidden": True, "fields_schema": []},
                ]
            if path == "/metamodel/relation-types":
                return [
                    {
                        "key": "app_to_itc",
                        "source_type_key": "Application",
                        "target_type_key": "ITComponent",
                    }
                ]
            if path == "/tag-groups":
                return [{"id": "g1", "name": "Domain"}]
            return []

        with patch.object(
            server.TurboEAClient, "get", AsyncMock(side_effect=get_router)
        ):
            out = _parse(await server.get_report_builder_schema())

        assert "dsl" in out
        keys = {ct["key"] for ct in out["card_types"]}
        assert keys == {"Application"}  # hidden type excluded
        app = out["card_types"][0]
        cost = next(f for f in app["fields"] if f["key"] == "costTotalAnnual")
        assert cost["cost"] is True and cost["numeric"] is True
        assert out["relation_types"][0]["key"] == "app_to_itc"
        assert out["tag_groups"][0]["name"] == "Domain"


class TestPreviewCustomReport:
    @pytest.mark.asyncio
    async def test_posts_to_reports_custom(self, fake_token):
        calls: list[tuple[str, dict | None]] = []

        async def post_router(path, json=None):
            calls.append((path, json))
            return PREVIEW

        with patch.object(
            server.TurboEAClient, "post", AsyncMock(side_effect=post_router)
        ):
            out = _parse(await server.preview_custom_report(SPEC))

        assert calls == [("/reports/custom", SPEC)]
        assert out["rows"][0]["d0"] == "High"


class TestCreateSavedReport:
    @pytest.mark.asyncio
    async def test_dry_run_previews_without_saving(self, fake_token):
        posts: list[tuple[str, dict | None]] = []

        async def post_router(path, json=None):
            posts.append((path, json))
            if path.startswith("/mutation-batches"):
                return {"id": "B-1", "dry_run": (json or {}).get("dry_run", False)}
            if path == "/reports/custom":
                return PREVIEW
            return {}

        with patch.object(
            server.TurboEAClient, "post", AsyncMock(side_effect=post_router)
        ):
            out = _parse(
                await server.create_saved_report(name="R", config=SPEC, dry_run=True)
            )

        paths = [p for p, _ in posts]
        assert "/reports/custom" in paths
        assert "/saved-reports" not in paths  # dry-run must not persist
        assert out["dry_run"] is True
        assert out["preview_meta"]["card_type"] == "Application"
        assert out["batch_id"] == "B-1"

    @pytest.mark.asyncio
    async def test_commit_saves_report(self, fake_token):
        posts: list[tuple[str, dict | None]] = []

        async def post_router(path, json=None):
            posts.append((path, json))
            if path.startswith("/mutation-batches/") and path.endswith("/commit"):
                return {"id": "B-1", "committed_at": "now"}
            if path.startswith("/mutation-batches"):
                return {"id": "B-1", "dry_run": (json or {}).get("dry_run", False)}
            if path == "/saved-reports":
                return {"id": "SR-1", "report_type": "custom", "name": "R"}
            return {}

        with patch.object(
            server.TurboEAClient, "post", AsyncMock(side_effect=post_router)
        ):
            out = _parse(
                await server.create_saved_report(
                    name="R", config=SPEC, visibility="public", dry_run=False
                )
            )

        save_call = next((j for p, j in posts if p == "/saved-reports"), None)
        assert save_call is not None
        assert save_call["report_type"] == "custom"
        assert save_call["visibility"] == "public"
        assert out["id"] == "SR-1"
        assert out["batch_id"] == "B-1"

    @pytest.mark.asyncio
    async def test_writes_disabled_blocks(self, fake_token, monkeypatch):
        monkeypatch.setattr(
            server,
            "_writes_disabled_message",
            lambda: server._fmt({"error": "writes_disabled"}),
        )
        out = _parse(
            await server.create_saved_report(name="R", config=SPEC, dry_run=False)
        )
        assert out["error"] == "writes_disabled"


class TestListSavedReports:
    @pytest.mark.asyncio
    async def test_passes_filter(self, fake_token):
        calls: list[tuple[str, dict | None]] = []

        async def get_router(path, params=None):
            calls.append((path, params))
            return [{"id": "SR-1", "report_type": "custom"}]

        with patch.object(
            server.TurboEAClient, "get", AsyncMock(side_effect=get_router)
        ):
            out = _parse(await server.list_saved_reports(filter="my"))

        assert calls[0][0] == "/saved-reports"
        assert calls[0][1] == {"filter": "my"}
        assert out[0]["id"] == "SR-1"
