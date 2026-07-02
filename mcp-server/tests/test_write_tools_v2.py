"""Tests for Sprint-3/4/5 MCP write tools and Sprint-2 rollback.

These follow the same `_patched_post_batch_aware` / `AsyncMock` pattern
as the existing write-tool tests — open-batch / underlying-write /
commit-batch get routed by path so each test can assert on the
underlying-write call specifically.
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


def _route_writes_through_batch(
    *,
    write_responses: dict[str, object] | None = None,
    patch_responses: dict[str, object] | None = None,
    get_responses: dict[str, object] | None = None,
    batch_id: str = "B-001",
    confirm_token: str | None = None,
):
    """Build POST/GET/PATCH side-effect routers that handle the
    open / write / commit sequence and let tests stub responses by
    path prefix."""
    write_responses = write_responses or {}
    patch_responses = patch_responses or {}
    get_responses = get_responses or {}
    post_calls: list[tuple[str, dict | None]] = []
    patch_calls: list[tuple[str, dict | None]] = []
    get_calls: list[tuple[str, dict | None]] = []

    async def post_router(path, json=None):
        post_calls.append((path, json))
        if path.startswith("/mutation-batches/") and path.endswith("/commit"):
            return {"id": batch_id, "committed_at": "now"}
        if path.startswith("/mutation-batches"):
            resp = {"id": batch_id, "dry_run": (json or {}).get("dry_run", False)}
            if confirm_token:
                resp["confirm_token"] = confirm_token
            return resp
        for prefix, body in write_responses.items():
            if path.startswith(prefix):
                return body
        return {}

    async def patch_router(path, json=None):
        patch_calls.append((path, json))
        for prefix, body in patch_responses.items():
            if path.startswith(prefix):
                return body
        return {}

    async def get_router(path, params=None):
        get_calls.append((path, params))
        for prefix, body in get_responses.items():
            if path.startswith(prefix):
                return body
        return {}

    return (
        post_router,
        patch_router,
        get_router,
        {"post": post_calls, "patch": patch_calls, "get": get_calls},
    )


class TestUpdateCardsBulk:
    @pytest.mark.asyncio
    async def test_groups_by_patch_and_dispatches(self, fake_token):
        post, patch_, get, calls = _route_writes_through_batch(
            patch_responses={
                "/cards/bulk": {
                    "dry_run": True,
                    "results": [
                        {
                            "row_index": 0,
                            "card_id": "c1",
                            "status": "would_update",
                            "before": {"name": "Old"},
                            "after": {"name": "New"},
                        }
                    ],
                    "would_update": 1,
                }
            }
        )
        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
            patch.object(server.TurboEAClient, "patch", AsyncMock(side_effect=patch_)),
        ):
            out = await server.update_cards_bulk(
                updates=[
                    {"card_id": "c1", "name": "New"},
                    {"card_id": "c2", "name": "New"},  # same patch → same group
                    {"card_id": "c3", "description": "Hi"},  # different patch
                ]
            )
        data = _parse(out)
        assert data["dry_run"] is True
        assert data["batch_id"] == "B-001"
        # Two PATCH calls (two patch groups)
        assert len(calls["patch"]) == 2

    @pytest.mark.asyncio
    async def test_strict_attributes_propagated(self, fake_token):
        post, patch_, get, calls = _route_writes_through_batch(
            patch_responses={"/cards/bulk": {"dry_run": True, "results": []}}
        )
        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
            patch.object(server.TurboEAClient, "patch", AsyncMock(side_effect=patch_)),
        ):
            await server.update_cards_bulk(
                updates=[{"card_id": "c1", "attributes": {"k": "v"}}],
                strict_attributes=True,
            )
        # Find the PATCH call and confirm strict_attributes landed in the
        # patch payload (alongside the actual fields).
        path, body = calls["patch"][0]
        assert path == "/cards/bulk"
        assert body["updates"]["strict_attributes"] is True

    @pytest.mark.asyncio
    async def test_missing_card_id_rejected(self, fake_token):
        out = await server.update_cards_bulk(
            updates=[{"name": "missing card_id"}]
        )
        data = _parse(out)
        assert data["error"] == "missing_card_id"


class TestArchiveCards:
    @pytest.mark.asyncio
    async def test_dry_run_aggregates_impacts(self, fake_token):
        post, patch_, get, calls = _route_writes_through_batch(
            get_responses={
                "/cards/c1/archive-impact": {"child_count": 1, "children": [{"id": "kid"}]},
                "/cards/c2/archive-impact": {"child_count": 0},
            }
        )
        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
            patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=get)),
        ):
            out = await server.archive_cards(card_ids=["c1", "c2"])
        data = _parse(out)
        assert data["dry_run"] is True
        assert data["would_archive"] == 2
        ids = [r["card_id"] for r in data["results"]]
        assert ids == ["c1", "c2"]

    @pytest.mark.asyncio
    async def test_commit_calls_bulk_archive(self, fake_token):
        post, patch_, get, calls = _route_writes_through_batch(
            write_responses={
                "/cards/bulk-archive": {
                    "requested": 2,
                    "archived_card_ids": ["c1", "c2"],
                    "cascaded_card_ids": [],
                    "skipped": [],
                }
            }
        )
        with patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)):
            out = await server.archive_cards(
                card_ids=["c1", "c2"], dry_run=False, reason="test"
            )
        data = _parse(out)
        assert data["batch_id"] == "B-001"
        assert "archived_card_ids" in data
        # Look at the bulk-archive POST specifically.
        bulk_calls = [c for c in calls["post"] if c[0] == "/cards/bulk-archive"]
        assert len(bulk_calls) == 1
        assert bulk_calls[0][1]["card_ids"] == ["c1", "c2"]
        assert bulk_calls[0][1]["reason"] == "test"


class TestAdrTools:
    @pytest.mark.asyncio
    async def test_create_adr_dry_run(self, fake_token):
        post_mock = AsyncMock()  # must not be called
        with patch.object(server.TurboEAClient, "post", post_mock):
            out = await server.create_adr(
                title="Use Postgres", sections=[{"heading": "Context", "body": "x"}]
            )
        post_mock.assert_not_called()
        data = _parse(out)
        assert data["dry_run"] is True
        assert data["would_create"]["title"] == "Use Postgres"

    @pytest.mark.asyncio
    async def test_create_adr_commit(self, fake_token):
        post, patch_, get, calls = _route_writes_through_batch(
            write_responses={"/adr": {"id": "ADR-1", "title": "x"}}
        )
        with patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)):
            out = await server.create_adr(
                title="x", sections=[{"heading": "h", "body": "b"}], dry_run=False
            )
        data = _parse(out)
        assert data["id"] == "ADR-1"
        assert data["batch_id"] == "B-001"

    @pytest.mark.asyncio
    async def test_sign_adr_403_returns_pending_deep_link(self, fake_token):
        async def raising(*args, **kwargs):
            raise RuntimeError("HTTP 403 Forbidden: Not enough permissions")

        with patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=raising)):
            out = await server.sign_adr(adr_id="ADR-9", dry_run=False)
        data = _parse(out)
        assert data["status"] == "pending"
        assert data["deep_link"] == "/ea-delivery/adr/ADR-9?action=sign"


class TestTransitionLifecycle:
    @pytest.mark.asyncio
    async def test_approve_action_posts(self, fake_token):
        post_mock = AsyncMock(return_value={"approval_status": "APPROVED"})
        with patch.object(server.TurboEAClient, "post", post_mock):
            await server.transition_card_lifecycle(card_id="c1", target="approve", dry_run=False)
        path, body = post_mock.call_args[0][0], None
        assert "approval-status?action=approve" in path

    @pytest.mark.asyncio
    async def test_phase_target_patches_lifecycle(self, fake_token):
        patch_mock = AsyncMock(return_value={"id": "c1"})
        with patch.object(server.TurboEAClient, "patch", patch_mock):
            await server.transition_card_lifecycle(
                card_id="c1", target="phaseOut", effective_date="2026-12-31", dry_run=False
            )
        path = patch_mock.call_args[0][0]
        body = patch_mock.call_args[1]["json"]
        assert path == "/cards/c1"
        assert body["lifecycle"]["phase"] == "phaseOut"
        assert body["lifecycle"]["effective_date"] == "2026-12-31"

    @pytest.mark.asyncio
    async def test_invalid_target_rejected(self, fake_token):
        out = await server.transition_card_lifecycle(card_id="c1", target="bogus")
        data = _parse(out)
        assert data["error"] == "invalid_target"


class TestRollbackTool:
    @pytest.mark.asyncio
    async def test_dry_run_default(self, fake_token):
        post_mock = AsyncMock(return_value={"dry_run": True, "operations": []})
        with patch.object(server.TurboEAClient, "post", post_mock):
            await server.rollback_batch(batch_id="B-7")
        path, _ = post_mock.call_args[0][0], None
        body = post_mock.call_args[1]["json"]
        assert path == "/mutation-batches/B-7/rollback"
        assert body == {"dry_run": True, "force": False}

    @pytest.mark.asyncio
    async def test_force_flag_propagates(self, fake_token):
        post_mock = AsyncMock(return_value={"results": []})
        with patch.object(server.TurboEAClient, "post", post_mock):
            await server.rollback_batch(batch_id="B-7", dry_run=False, force=True)
        body = post_mock.call_args[1]["json"]
        assert body["dry_run"] is False
        assert body["force"] is True


class TestAnalyzeImpact:
    @pytest.mark.asyncio
    async def test_groups_nodes_by_depth(self, fake_token):
        get_mock = AsyncMock(
            return_value={
                "nodes": [
                    {"id": "centre", "type": "Application", "name": "C"},
                    {"id": "n1", "type": "Application", "name": "N1"},
                    {"id": "n2", "type": "DataObject", "name": "N2"},
                ],
                "edges": [
                    {"source": "centre", "target": "n1", "type": "uses"},
                    {"source": "n1", "target": "n2", "type": "uses"},
                ],
            }
        )
        with patch.object(server.TurboEAClient, "get", get_mock):
            out = await server.analyze_impact(card_id="centre", max_depth=2)
        data = _parse(out)
        # centre at depth 0, n1 at depth 1, n2 at depth 2 (via downstream)
        assert "0" in {str(k) for k in data["nodes_by_depth"].keys()}
        assert "1" in {str(k) for k in data["nodes_by_depth"].keys()}
        assert "2" in {str(k) for k in data["nodes_by_depth"].keys()}

    @pytest.mark.asyncio
    async def test_depth_clamped(self, fake_token):
        out = await server.analyze_impact(card_id="c", max_depth=99)
        data = _parse(out)
        assert data["error"] == "depth_out_of_range"

    @pytest.mark.asyncio
    async def test_card_type_filter(self, fake_token):
        get_mock = AsyncMock(
            return_value={
                "nodes": [
                    {"id": "centre", "type": "Application", "name": "C"},
                    {"id": "n1", "type": "ITComponent", "name": "ITC"},
                ],
                "edges": [{"source": "centre", "target": "n1", "type": "runs_on"}],
            }
        )
        with patch.object(server.TurboEAClient, "get", get_mock):
            out = await server.analyze_impact(
                card_id="centre", include_types=["Application"]
            )
        data = _parse(out)
        # ITComponent node should be dropped along with the edge that touches it
        all_node_ids = {n["id"] for nodes in data["nodes_by_depth"].values() for n in nodes}
        assert "n1" not in all_node_ids


class TestDiagramReadTools:
    @pytest.mark.asyncio
    async def test_list_diagrams_passes_card_filter(self, fake_token):
        get_mock = AsyncMock(return_value=[])
        with patch.object(server.TurboEAClient, "get", get_mock):
            await server.list_diagrams(card_id="c1")
        path, kwargs = get_mock.call_args[0][0], get_mock.call_args[1]
        assert path == "/diagrams"
        assert kwargs["params"] == {"card_id": "c1"}

    @pytest.mark.asyncio
    async def test_get_diagram(self, fake_token):
        get_mock = AsyncMock(return_value={"id": "D1", "name": "X"})
        with patch.object(server.TurboEAClient, "get", get_mock):
            await server.get_diagram(diagram_id="D1")
        assert get_mock.call_args[0][0] == "/diagrams/D1"


class TestAddCardComment:
    @pytest.mark.asyncio
    async def test_threaded_reply(self, fake_token):
        post_mock = AsyncMock(return_value={"id": "cmt-1"})
        with patch.object(server.TurboEAClient, "post", post_mock):
            await server.add_card_comment(
                card_id="c1", body="reply", parent_id="cmt-0", dry_run=False
            )
        path = post_mock.call_args[0][0]
        body = post_mock.call_args[1]["json"]
        assert path == "/cards/c1/comments"
        assert body["body"] == "reply"
        assert body["parent_id"] == "cmt-0"
