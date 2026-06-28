"""Unit tests for the artifact-import write tools.

These mirror the patterns in ``test_server.py`` — fake the auth token, mock
the ``TurboEAClient`` HTTP shim, invoke the tool function directly, and
assert (a) the right path and JSON body were forwarded and (b) the JSON
response flows back through ``_fmt``.
"""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, patch

import pytest

from turbo_ea_mcp import server


@pytest.fixture
def fake_token(monkeypatch):
    """Pretend a user is logged in so tool auth checks pass."""
    monkeypatch.setattr(server, "_stdio_token", "test-token")
    yield "test-token"


def _patched_post(payload):
    mock = AsyncMock(return_value=payload)
    return patch.object(server.TurboEAClient, "post", mock), mock


def _patched_post_batch_aware(write_payload: dict, batch_id: str = "batch-uuid-001"):
    """Patch ``TurboEAClient.post`` for write tools that flow through the
    mutation-batch wrapper. Routes calls based on path so the open /
    underlying-write / commit triplet each get the right payload.

    Returns ``(patcher, write_mock_assert)`` where ``write_mock_assert``
    is a helper that returns the single non-batch call args/kwargs (the
    actual write) so tests can keep their existing assertions roughly
    unchanged.
    """
    write_calls: list = []

    async def router(path: str, json: dict | None = None):
        if path.startswith("/mutation-batches/") and path.endswith("/commit"):
            return {"id": batch_id, "committed_at": "2026-05-23T12:00:00Z"}
        if path.startswith("/mutation-batches"):
            return {"id": batch_id, "dry_run": (json or {}).get("dry_run", False)}
        # The actual write call — capture for later assertion.
        write_calls.append((path, json))
        return write_payload

    mock = AsyncMock(side_effect=router)
    patcher = patch.object(server.TurboEAClient, "post", mock)

    def write_call() -> tuple:
        assert write_calls, "expected exactly one underlying-write call"
        path, body = write_calls[-1]
        return path, body

    return patcher, write_call


def _patched_put(payload):
    mock = AsyncMock(return_value=payload)
    return patch.object(server.TurboEAClient, "put", mock), mock


def _patched_get(payload):
    mock = AsyncMock(return_value=payload)
    return patch.object(server.TurboEAClient, "get", mock), mock


def _parse(s: str) -> dict | list:
    return json.loads(s)


# ── create_cards_bulk ──────────────────────────────────────────────────────


class TestCreateCardsBulk:
    @pytest.mark.asyncio
    async def test_dry_run_default(self, fake_token):
        patcher, write_call = _patched_post_batch_aware(
            {
                "results": [
                    {"row_index": 0, "status": "created", "id": "card-1"},
                ],
                "created": 1,
                "failed": 0,
                "dry_run": True,
            }
        )
        with patcher:
            out = await server.create_cards_bulk(
                cards=[{"row_index": 0, "type": "Application", "name": "Test App"}]
            )
        path, body = write_call()
        assert path == "/cards/bulk-create"
        assert body["dry_run"] is True
        parsed = _parse(out)
        assert parsed["dry_run"] is True
        assert parsed["batch_id"] == "batch-uuid-001"

    @pytest.mark.asyncio
    async def test_commit(self, fake_token):
        patcher, write_call = _patched_post_batch_aware(
            {"results": [], "created": 0, "failed": 0, "dry_run": False}
        )
        with patcher:
            await server.create_cards_bulk(
                cards=[{"row_index": 0, "type": "Application", "name": "X"}],
                dry_run=False,
            )
        path, body = write_call()
        assert body["dry_run"] is False
        assert body["cards"][0]["name"] == "X"

    @pytest.mark.asyncio
    async def test_single_row(self, fake_token):
        patcher, write_call = _patched_post_batch_aware(
            {"results": [], "created": 0, "failed": 0}
        )
        with patcher:
            await server.create_cards_bulk(
                cards=[
                    {
                        "row_index": 7,
                        "type": "Application",
                        "name": "Single",
                        "attributes": {"businessCriticality": "high"},
                    }
                ],
                dry_run=False,
            )
        path, body = write_call()
        cards = body["cards"]
        assert len(cards) == 1
        assert cards[0]["attributes"] == {"businessCriticality": "high"}

    @pytest.mark.asyncio
    async def test_backend_validation_error_surfaces(self, fake_token):
        # Backend reports per-row failure for unknown type — the tool just
        # passes the payload through.
        patcher, write_call = _patched_post_batch_aware(
            {
                "results": [
                    {
                        "row_index": 0,
                        "status": "failed",
                        "error": "Unknown card type: App",
                    }
                ],
                "created": 0,
                "failed": 1,
                "dry_run": True,
            }
        )
        with patcher:
            out = await server.create_cards_bulk(
                cards=[{"row_index": 0, "type": "App", "name": "Bad"}]
            )
        data = _parse(out)
        assert data["failed"] == 1
        assert "Unknown card type" in data["results"][0]["error"]


# ── resolve_card_refs ──────────────────────────────────────────────────────


class TestResolveCardRefs:
    @pytest.mark.asyncio
    async def test_pass_through(self, fake_token):
        patcher, mock = _patched_post(
            {
                "results": [
                    {
                        "row": 0,
                        "column": "parent",
                        "status": "resolved",
                        "id": "card-9",
                    }
                ]
            }
        )
        with patcher:
            out = await server.resolve_card_refs(
                refs=[
                    {
                        "row": 0,
                        "column": "parent",
                        "type": "BusinessCapability",
                        "ref": "Sales / CRM",
                    }
                ]
            )
        mock.assert_awaited_once()
        args, kwargs = mock.call_args
        assert args[0] == "/cards/resolve-refs"
        assert kwargs["json"]["refs"][0]["ref"] == "Sales / CRM"
        assert _parse(out)["results"][0]["id"] == "card-9"


# ── upsert_relations_bulk ──────────────────────────────────────────────────


class TestUpsertRelationsBulk:
    @pytest.mark.asyncio
    async def test_upsert_dry_run(self, fake_token):
        patcher, mock = _patched_post(
            {
                "results": [{"row_index": 0, "status": "upserted", "relation_id": "r1"}],
                "upserted": 1,
                "deleted": 0,
                "failed": 0,
                "dry_run": True,
            }
        )
        with patcher:
            out = await server.upsert_relations_bulk(
                operations=[
                    {
                        "row_index": 0,
                        "type": "uses",
                        "source": {"id": "src-uuid"},
                        "target": {"id": "tgt-uuid"},
                    }
                ]
            )
        _, kwargs = mock.call_args
        assert kwargs["json"]["dry_run"] is True
        assert _parse(out)["upserted"] == 1

    @pytest.mark.asyncio
    async def test_delete(self, fake_token, monkeypatch):
        # Delete is gated behind MCP_ALLOW_RELATION_DELETE; flip it on for
        # this happy-path forwarding test (the guardrail rejection path
        # has its own test).
        monkeypatch.setattr(server, "MCP_ALLOW_RELATION_DELETE", True)
        patcher, mock = _patched_post(
            {
                "results": [{"row_index": 0, "status": "deleted"}],
                "upserted": 0,
                "deleted": 1,
                "failed": 0,
                "dry_run": False,
            }
        )
        with patcher:
            await server.upsert_relations_bulk(
                operations=[
                    {
                        "row_index": 0,
                        "action": "delete",
                        "type": "uses",
                        "source": {"id": "s"},
                        "target": {"id": "t"},
                    }
                ],
                dry_run=False,
            )
        _, kwargs = mock.call_args
        assert kwargs["json"]["operations"][0]["action"] == "delete"

    @pytest.mark.asyncio
    async def test_type_mismatch_surfaces(self, fake_token):
        # Backend rejects per-row when source.type doesn't match the
        # relation type's expected source.
        patcher, mock = _patched_post(
            {
                "results": [
                    {
                        "row_index": 0,
                        "status": "failed",
                        "error": "Source type 'X' does not match relation type's expected source 'Application'",
                    }
                ],
                "upserted": 0,
                "deleted": 0,
                "failed": 1,
                "dry_run": True,
            }
        )
        with patcher:
            out = await server.upsert_relations_bulk(
                operations=[
                    {
                        "row_index": 0,
                        "type": "uses",
                        "source": {"type": "X", "name": "Bad", "parent_path": []},
                        "target": {"id": "t"},
                    }
                ]
            )
        assert "does not match" in _parse(out)["results"][0]["error"]


# ── create_diagram ─────────────────────────────────────────────────────────


class TestCreateDiagram:
    @pytest.mark.asyncio
    async def test_dry_run_short_circuits(self, fake_token):
        # Dry-run never calls the backend.
        patcher, mock = _patched_post({"id": "should-not-be-called"})
        xml = '<mxGraphModel><object cardId="11111111-2222-3333-4444-555555555555"/></mxGraphModel>'
        with patcher:
            out = await server.create_diagram(name="My Diag", drawio_xml=xml)
        mock.assert_not_called()
        data = _parse(out)
        assert data["dry_run"] is True
        assert data["would_create"]["extracted_card_refs_from_xml"] == [
            "11111111-2222-3333-4444-555555555555"
        ]

    @pytest.mark.asyncio
    async def test_commit_passes_xml(self, fake_token):
        patcher, mock = _patched_post({"id": "diag-1", "name": "My Diag"})
        xml = "<mxGraphModel/>"
        with patcher:
            await server.create_diagram(
                name="My Diag",
                drawio_xml=xml,
                description="…",
                linked_card_ids=["c1"],
                dry_run=False,
            )
        args, kwargs = mock.call_args
        assert args[0] == "/diagrams"
        assert kwargs["json"]["data"]["xml"] == xml
        assert kwargs["json"]["card_ids"] == ["c1"]
        assert "type" not in kwargs["json"]


# ── import_bpmn ────────────────────────────────────────────────────────────


class TestImportBpmn:
    @pytest.mark.asyncio
    async def test_find_existing_dry_run_does_not_hit_flow_endpoints(
        self, fake_token
    ):
        """Dry-run against an existing card: the tool returns a preview
        (estimated flow-node count + byte size) without calling any flow
        endpoint. No draft, no submit, no approve."""
        get_mock = AsyncMock(
            return_value={
                "items": [
                    {"id": "bp-1", "name": "Order to Cash", "parent_id": None}
                ],
                "total": 1,
            }
        )
        post_mock = AsyncMock()  # must not be called
        with (
            patch.object(server.TurboEAClient, "get", get_mock),
            patch.object(server.TurboEAClient, "post", post_mock),
        ):
            bpmn = (
                "<bpmn:definitions>"
                '<bpmn:process id="P"><bpmn:startEvent id="s"/>'
                '<bpmn:task id="t"/><bpmn:endEvent id="e"/></bpmn:process>'
                "</bpmn:definitions>"
            )
            out = await server.import_bpmn(
                business_process_name="Order to Cash", bpmn_xml=bpmn
            )
        post_mock.assert_not_called()
        data = _parse(out)
        assert data["dry_run"] is True
        assert data["committed"] is False
        assert data["business_process_id"] == "bp-1"
        assert data["diagram_preview"]["flow_nodes_estimated"] == 3

    @pytest.mark.asyncio
    async def test_missing_card_returns_card_not_found_with_next_action(
        self, fake_token
    ):
        """import_bpmn no longer auto-creates a BusinessProcess card —
        forcing the agent into the explicit two-step flow (create card
        with all metadata via create_cards_bulk, then import the BPMN).
        Tested both with and without an existing match."""
        get_mock = AsyncMock(return_value={"items": [], "total": 0})
        post_mock = AsyncMock()  # must not be called
        with (
            patch.object(server.TurboEAClient, "get", get_mock),
            patch.object(server.TurboEAClient, "post", post_mock),
        ):
            out = await server.import_bpmn(
                business_process_name="Brand New Process",
                bpmn_xml="<bpmn:definitions/>",
                dry_run=False,
            )
        post_mock.assert_not_called()
        data = _parse(out)
        assert data["error"] == "card_not_found"
        assert data["business_process_name"] == "Brand New Process"
        # Next-action must spell out the recovery path concretely so the
        # agent doesn't paper over it with a different attempt.
        assert "create_cards_bulk" in data["next_action"]
        assert "type='BusinessProcess'" in data["next_action"]

    @pytest.mark.asyncio
    async def test_dry_run_response_signals_not_committed(self, fake_token):
        get_mock = AsyncMock(
            return_value={
                "items": [{"id": "bp-1", "name": "X", "parent_id": None}],
                "total": 1,
            }
        )
        post_mock = AsyncMock()
        with (
            patch.object(server.TurboEAClient, "get", get_mock),
            patch.object(server.TurboEAClient, "post", post_mock),
        ):
            out = await server.import_bpmn(
                business_process_name="X", bpmn_xml="<bpmn:definitions/>"
            )
        post_mock.assert_not_called()
        data = _parse(out)
        assert data["committed"] is False
        assert "NOT" in data["next_action"]

    @pytest.mark.asyncio
    async def test_missing_card_returns_card_not_found_in_dry_run_too(
        self, fake_token
    ):
        # dry_run defaults to True — verify the same card_not_found
        # error path fires in dry-run so the agent gets the same signal.
        get_mock = AsyncMock(return_value={"items": [], "total": 0})
        post_mock = AsyncMock()
        with (
            patch.object(server.TurboEAClient, "get", get_mock),
            patch.object(server.TurboEAClient, "post", post_mock),
        ):
            out = await server.import_bpmn(
                business_process_name="Brand New Process",
                bpmn_xml="<bpmn:definitions/>",
            )
        post_mock.assert_not_called()
        data = _parse(out)
        assert data["error"] == "card_not_found"

    @pytest.mark.asyncio
    async def test_multi_match_refuses(self, fake_token):
        get_mock = AsyncMock(
            return_value={
                "items": [
                    {"id": "bp-a", "name": "Order to Cash", "parent_id": "p1"},
                    {"id": "bp-b", "name": "Order to Cash", "parent_id": "p2"},
                ],
                "total": 2,
            }
        )
        with patch.object(server.TurboEAClient, "get", get_mock):
            out = await server.import_bpmn(
                business_process_name="Order to Cash",
                bpmn_xml="<bpmn:definitions/>",
            )
        data = _parse(out)
        assert data["error"] == "ambiguous_business_process"
        assert len(data["candidates"]) == 2

    @pytest.mark.asyncio
    async def test_commit_walks_draft_submit_approve(self, fake_token):
        """Commit path against an existing card: POST /flow/drafts ->
        /submit -> /approve. The diagram has to be `published` to render
        in the Process Flow tab; landing only as a draft would explain
        «agent says success, editor shows blank»."""
        get_mock = AsyncMock(
            return_value={
                "items": [{"id": "bp-1", "name": "Order to Cash", "parent_id": None}],
                "total": 1,
            }
        )

        post_calls: list[tuple[str, dict]] = []

        async def _post(path, json=None):
            post_calls.append((path, json or {}))
            if path == "/bpm/processes/bp-1/flow/drafts":
                return {"id": "draft-1", "status": "draft", "revision": 1}
            if path.endswith("/submit"):
                return {"id": "draft-1", "status": "pending", "revision": 1}
            if path.endswith("/approve"):
                return {"id": "draft-1", "status": "published", "revision": 1}
            raise AssertionError(f"unexpected POST {path}")

        with (
            patch.object(server.TurboEAClient, "get", get_mock),
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=_post)),
        ):
            out = await server.import_bpmn(
                business_process_name="Order to Cash",
                bpmn_xml="<bpmn:definitions/>",
                dry_run=False,
            )
        paths = [p for p, _ in post_calls]
        assert paths == [
            "/bpm/processes/bp-1/flow/drafts",
            "/bpm/processes/bp-1/flow/versions/draft-1/submit",
            "/bpm/processes/bp-1/flow/versions/draft-1/approve",
        ]
        data = _parse(out)
        assert data["committed"] is True
        assert data["workflow_state"] == "published"
        assert data["draft_id"] == "draft-1"
        assert data["verify_urls"]["flow_published"] == (
            "/api/v1/bpm/processes/bp-1/flow/published"
        )

    @pytest.mark.asyncio
    async def test_commit_degrades_gracefully_when_approve_denied(self, fake_token):
        """If the user can create+submit but the approve step is denied
        (e.g. they're not a process owner), the tool returns a clear
        warning instead of silently leaving the diagram as a pending
        draft the user can't see in the published view."""
        get_mock = AsyncMock(
            return_value={
                "items": [{"id": "bp-1", "name": "P", "parent_id": None}],
                "total": 1,
            }
        )
        import httpx

        async def _post(path, json=None):
            if path.endswith("/flow/drafts"):
                return {"id": "draft-1", "status": "draft"}
            if path.endswith("/submit"):
                return {"id": "draft-1", "status": "pending"}
            if path.endswith("/approve"):
                req = httpx.Request("POST", "http://x" + path)
                resp = httpx.Response(403, request=req)
                raise httpx.HTTPStatusError("forbidden", request=req, response=resp)
            raise AssertionError(path)

        with (
            patch.object(server.TurboEAClient, "get", get_mock),
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=_post)),
        ):
            out = await server.import_bpmn(
                business_process_name="P",
                bpmn_xml="<bpmn:definitions/>",
                dry_run=False,
            )
        data = _parse(out)
        assert data["committed"] is True
        assert data["workflow_state"] == "pending"
        assert "warning" in data
        assert "process_owner" in data["warning"]


# ── Unauthenticated paths ──────────────────────────────────────────────────


class TestGuardrails:
    """Per-call caps, kill switch, delete rejection."""

    @pytest.mark.asyncio
    async def test_cards_batch_over_cap_rejected(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_MAX_CARDS_PER_CALL", 3)
        rows = [
            {"row_index": i, "type": "Application", "name": f"A{i}"} for i in range(4)
        ]
        post_mock = AsyncMock()  # must not be called
        with patch.object(server.TurboEAClient, "post", post_mock):
            out = await server.create_cards_bulk(cards=rows)
        post_mock.assert_not_called()
        data = _parse(out)
        assert data["error"] == "batch_too_large"
        assert data["cap"] == 3
        assert data["received"] == 4

    @pytest.mark.asyncio
    async def test_cards_batch_at_cap_passes(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_MAX_CARDS_PER_CALL", 3)
        # Disable the dry-run-first gate so this test can commit
        # without first running a dry-run (3 rows is below the
        # default 20-row threshold anyway, but be explicit).
        monkeypatch.setattr(server, "MCP_REQUIRE_DRYRUN_FIRST", False)
        rows = [
            {"row_index": i, "type": "Application", "name": f"A{i}"} for i in range(3)
        ]
        patcher, write_call = _patched_post_batch_aware(
            {"results": [], "created": 0, "failed": 0}
        )
        with patcher:
            await server.create_cards_bulk(cards=rows, dry_run=False)
        path, _ = write_call()
        assert path == "/cards/bulk-create"

    @pytest.mark.asyncio
    async def test_relations_batch_over_cap_rejected(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_MAX_RELATIONS_PER_CALL", 1)
        ops = [
            {
                "row_index": i,
                "type": "uses",
                "source": {"id": f"s{i}"},
                "target": {"id": f"t{i}"},
            }
            for i in range(2)
        ]
        post_mock = AsyncMock()
        with patch.object(server.TurboEAClient, "post", post_mock):
            out = await server.upsert_relations_bulk(operations=ops)
        post_mock.assert_not_called()
        data = _parse(out)
        assert data["error"] == "batch_too_large"

    @pytest.mark.asyncio
    async def test_relations_delete_action_rejected(self, fake_token, monkeypatch):
        # MCP_ALLOW_RELATION_DELETE defaults to False — verify rejection.
        monkeypatch.setattr(server, "MCP_ALLOW_RELATION_DELETE", False)
        ops = [
            {
                "row_index": 0,
                "type": "uses",
                "source": {"id": "s"},
                "target": {"id": "t"},
            },
            {
                "row_index": 1,
                "action": "delete",
                "type": "uses",
                "source": {"id": "s"},
                "target": {"id": "t"},
            },
        ]
        post_mock = AsyncMock()
        with patch.object(server.TurboEAClient, "post", post_mock):
            out = await server.upsert_relations_bulk(operations=ops)
        post_mock.assert_not_called()
        data = _parse(out)
        assert data["error"] == "delete_action_disabled"
        assert data["rejected_rows"] == [1]

    @pytest.mark.asyncio
    async def test_relations_delete_allowed_when_flag_on(
        self, fake_token, monkeypatch
    ):
        monkeypatch.setattr(server, "MCP_ALLOW_RELATION_DELETE", True)
        ops = [
            {
                "row_index": 0,
                "action": "delete",
                "type": "uses",
                "source": {"id": "s"},
                "target": {"id": "t"},
            }
        ]
        patcher, mock = _patched_post(
            {"results": [], "upserted": 0, "deleted": 1, "failed": 0}
        )
        with patcher:
            await server.upsert_relations_bulk(operations=ops, dry_run=False)
        mock.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_writes_disabled_blocks_all_write_tools(
        self, fake_token, monkeypatch
    ):
        monkeypatch.setattr(server, "MCP_WRITES_ENABLED", False)
        post_mock = AsyncMock()
        put_mock = AsyncMock()
        get_mock = AsyncMock()
        with (
            patch.object(server.TurboEAClient, "post", post_mock),
            patch.object(server.TurboEAClient, "put", put_mock),
            patch.object(server.TurboEAClient, "get", get_mock),
        ):
            for out in [
                await server.create_cards_bulk(cards=[]),
                await server.upsert_relations_bulk(operations=[]),
                await server.create_diagram(name="X", drawio_xml="<x/>"),
                await server.import_bpmn(
                    business_process_name="X", bpmn_xml="<bpmn:definitions/>"
                ),
            ]:
                assert _parse(out)["error"] == "writes_disabled"
        post_mock.assert_not_called()
        put_mock.assert_not_called()
        get_mock.assert_not_called()

    def test_origin_header_added_on_post(self):
        from turbo_ea_mcp.api_client import TurboEAClient

        client = TurboEAClient("test-token")
        headers = client._headers()
        assert headers["X-Turbo-EA-Origin"] == "mcp"
        assert headers["Authorization"] == "Bearer test-token"


class TestUnauthenticatedWrites:
    def test_create_cards_bulk_requires_auth(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        out = asyncio.run(
            server.create_cards_bulk(
                cards=[{"row_index": 0, "type": "Application", "name": "X"}]
            )
        )
        assert "Not authenticated" in out

    def test_resolve_card_refs_requires_auth(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        out = asyncio.run(server.resolve_card_refs(refs=[]))
        assert "Not authenticated" in out

    def test_upsert_relations_bulk_requires_auth(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        out = asyncio.run(
            server.upsert_relations_bulk(
                operations=[
                    {
                        "row_index": 0,
                        "type": "uses",
                        "source": {"id": "s"},
                        "target": {"id": "t"},
                    }
                ]
            )
        )
        assert "Not authenticated" in out

    def test_create_diagram_requires_auth(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        out = asyncio.run(server.create_diagram(name="X", drawio_xml="<x/>"))
        assert "Not authenticated" in out

    def test_import_bpmn_requires_auth(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        out = asyncio.run(
            server.import_bpmn(
                business_process_name="X",
                bpmn_xml="<bpmn:definitions/>",
            )
        )
        assert "Not authenticated" in out
