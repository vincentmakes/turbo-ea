"""Tests for the Sprint-1 MCP-server safeguards (S1 / S2 / S6).

Covers:

- The confirmation-token gate (S2 + S3): a commit above
  ``MCP_BATCH_CONFIRMATION_THRESHOLD`` without a ``confirm_token``
  must be rejected by the wrapper *before* any backend call happens.
- The mutation-batch lifecycle (S1 + S6): ``create_cards_bulk`` opens
  a batch, performs the underlying write, then commits the batch —
  three POSTs in order; the underlying write carries the batch id via
  ``X-Turbo-EA-Batch``.
- The ``get_change_history`` tool: routes to ``/mutation-batches`` for
  the list endpoint and ``/mutation-batches/{id}/events`` for a
  specific batch.
- The actor-decoder helper: pulls the JWT ``sub`` claim without
  signature verification, returns ``None`` on garbage input.
- MCP tool annotations are set on every read and write tool.
"""

from __future__ import annotations

import base64
import json
from unittest.mock import AsyncMock, patch

import pytest

from turbo_ea_mcp import server
from turbo_ea_mcp.identity import get_actor_user_id


@pytest.fixture
def fake_token(monkeypatch):
    monkeypatch.setattr(server, "_stdio_token", "test-token")
    yield "test-token"


def _parse(s: str) -> dict | list:
    return json.loads(s)


# ── Confirmation-token gate (S2 + S3) ───────────────────────────────────────


class TestConfirmationGate:
    @pytest.mark.asyncio
    async def test_commit_above_threshold_without_token_rejected(
        self, fake_token, monkeypatch
    ):
        monkeypatch.setattr(server, "MCP_BATCH_CONFIRMATION_THRESHOLD", 2)
        monkeypatch.setattr(server, "MCP_REQUIRE_DRYRUN_FIRST", True)
        rows = [
            {"row_index": i, "type": "Application", "name": f"A{i}"} for i in range(3)
        ]
        post_mock = AsyncMock()  # must not be called
        with patch.object(server.TurboEAClient, "post", post_mock):
            out = await server.create_cards_bulk(cards=rows, dry_run=False)
        post_mock.assert_not_called()
        data = _parse(out)
        assert data["error"] == "confirm_token_required"
        assert data["threshold"] == 2
        assert data["received"] == 3
        assert data["tool"] == "create_cards_bulk"

    @pytest.mark.asyncio
    async def test_dry_run_above_threshold_allowed(self, fake_token, monkeypatch):
        # Dry-run is *exactly* how the agent obtains the token, so it
        # must never be rejected by the gate.
        monkeypatch.setattr(server, "MCP_BATCH_CONFIRMATION_THRESHOLD", 2)
        rows = [
            {"row_index": i, "type": "Application", "name": f"A{i}"} for i in range(5)
        ]
        write_calls: list = []

        async def router(path, json=None):
            if path.startswith("/mutation-batches/") and path.endswith("/commit"):
                return {"id": "b1", "committed_at": "now"}
            if path.startswith("/mutation-batches"):
                return {"id": "b1", "confirm_token": "TOK-DRYRUN", "dry_run": True}
            write_calls.append((path, json))
            return {"results": [], "created": 0, "failed": 0, "dry_run": True}

        mock = AsyncMock(side_effect=router)
        with patch.object(server.TurboEAClient, "post", mock):
            out = await server.create_cards_bulk(cards=rows, dry_run=True)
        data = _parse(out)
        # Token from the batch open is propagated to the agent.
        assert data["confirm_token"] == "TOK-DRYRUN"
        assert data["batch_id"] == "b1"
        assert len(write_calls) == 1

    @pytest.mark.asyncio
    async def test_commit_above_threshold_with_token_passes(
        self, fake_token, monkeypatch
    ):
        monkeypatch.setattr(server, "MCP_BATCH_CONFIRMATION_THRESHOLD", 2)
        rows = [
            {"row_index": i, "type": "Application", "name": f"A{i}"} for i in range(3)
        ]
        write_calls: list = []
        commit_calls: list = []

        async def router(path, json=None):
            if path.startswith("/mutation-batches/") and path.endswith("/commit"):
                commit_calls.append(json)
                return {"id": "b2", "committed_at": "now"}
            if path.startswith("/mutation-batches"):
                return {"id": "b2", "dry_run": False}
            write_calls.append((path, json))
            return {"results": [], "created": 3, "failed": 0, "dry_run": False}

        mock = AsyncMock(side_effect=router)
        with patch.object(server.TurboEAClient, "post", mock):
            await server.create_cards_bulk(
                cards=rows, dry_run=False, confirm_token="ECHOED-TOK"
            )
        assert len(write_calls) == 1
        # Token is echoed back on the commit call so the backend can
        # match it against the batch row.
        assert commit_calls[0]["confirm_token"] == "ECHOED-TOK"


# ── Mutation-batch lifecycle (S1 + S6) ──────────────────────────────────────


class TestBatchLifecycle:
    @pytest.mark.asyncio
    async def test_create_cards_bulk_opens_writes_commits(self, fake_token):
        """One create_cards_bulk call = three POSTs in this order: open
        batch, underlying write, commit batch. The underlying write is
        the only one whose path is /cards/bulk-create."""
        call_order: list[str] = []

        async def router(path, json=None):
            call_order.append(path)
            if path.startswith("/mutation-batches/") and path.endswith("/commit"):
                return {"id": "b9", "committed_at": "now"}
            if path.startswith("/mutation-batches"):
                return {"id": "b9", "dry_run": True}
            return {"results": [], "created": 1, "failed": 0, "dry_run": True}

        mock = AsyncMock(side_effect=router)
        with patch.object(server.TurboEAClient, "post", mock):
            await server.create_cards_bulk(
                cards=[{"row_index": 0, "type": "Application", "name": "X"}]
            )

        # Order: open → write → commit
        assert call_order[0].startswith("/mutation-batches?row_count=")
        assert call_order[1] == "/cards/bulk-create"
        assert call_order[2] == "/mutation-batches/b9/commit"


# ── get_change_history (S6) ─────────────────────────────────────────────────


class TestGetChangeHistory:
    @pytest.mark.asyncio
    async def test_routes_to_events_endpoint_when_batch_id_set(self, fake_token):
        get_mock = AsyncMock(return_value={"batch": {}, "events": []})
        with patch.object(server.TurboEAClient, "get", get_mock):
            await server.get_change_history(batch_id="b-123")
        get_mock.assert_awaited_once()
        args, kwargs = get_mock.call_args
        assert args[0] == "/mutation-batches/b-123/events"

    @pytest.mark.asyncio
    async def test_routes_to_list_endpoint_otherwise(self, fake_token):
        get_mock = AsyncMock(return_value=[])
        with patch.object(server.TurboEAClient, "get", get_mock):
            await server.get_change_history(actor_user_id="u1", tool_name="t", limit=10)
        get_mock.assert_awaited_once()
        args, kwargs = get_mock.call_args
        assert args[0] == "/mutation-batches"
        params = kwargs["params"]
        assert params["actor_user_id"] == "u1"
        assert params["tool_name"] == "t"
        assert params["limit"] == 10

    @pytest.mark.asyncio
    async def test_limit_clamped(self, fake_token):
        get_mock = AsyncMock(return_value=[])
        with patch.object(server.TurboEAClient, "get", get_mock):
            await server.get_change_history(limit=10_000)
        _, kwargs = get_mock.call_args
        assert kwargs["params"]["limit"] == 200


# ── Identity decoder ────────────────────────────────────────────────────────


def _make_jwt(claims: dict) -> str:
    """Build a syntactically-valid (unsigned) JWT for tests."""
    header = base64.urlsafe_b64encode(b'{"alg":"none"}').rstrip(b"=").decode()
    payload = (
        base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    )
    return f"{header}.{payload}.signature"


class TestIdentityDecoder:
    def test_extracts_sub_claim(self):
        token = _make_jwt({"sub": "user-uuid-123", "role": "admin"})
        assert get_actor_user_id(token) == "user-uuid-123"

    def test_handles_garbage(self):
        assert get_actor_user_id("not-a-jwt") is None
        assert get_actor_user_id("") is None
        assert get_actor_user_id(None) is None

    def test_handles_missing_sub(self):
        token = _make_jwt({"role": "admin"})
        assert get_actor_user_id(token) is None


# ── MCP tool annotations ────────────────────────────────────────────────────


class TestToolAnnotations:
    def test_every_tool_has_annotations(self):
        """Every registered tool must carry MCP annotations so clients
        can surface destructiveness in the UI."""
        registry = server.mcp._tool_manager._tools
        bare: list[str] = []
        for name, tool in registry.items():
            ann = getattr(tool, "annotations", None)
            if ann is None:
                bare.append(name)
        assert not bare, f"tools without annotations: {bare}"

    def test_search_cards_is_read_only(self):
        tool = server.mcp._tool_manager._tools["search_cards"]
        assert tool.annotations is not None
        assert tool.annotations.readOnlyHint is True

    def test_create_cards_bulk_is_not_read_only(self):
        tool = server.mcp._tool_manager._tools["create_cards_bulk"]
        assert tool.annotations is not None
        assert tool.annotations.readOnlyHint is False
        assert tool.annotations.idempotentHint is True

    def test_upsert_relations_bulk_is_destructive(self):
        tool = server.mcp._tool_manager._tools["upsert_relations_bulk"]
        assert tool.annotations is not None
        assert tool.annotations.destructiveHint is True
