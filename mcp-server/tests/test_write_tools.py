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
        patcher, write_call = _patched_post_batch_aware({"results": [], "created": 0, "failed": 0})
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
        patcher, write_call = _patched_post_batch_aware(
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
        path, body = write_call()
        assert path == "/relations/bulk"
        assert body["dry_run"] is True
        data = _parse(out)
        assert data["upserted"] == 1
        assert data["batch_id"] == "batch-uuid-001"

    @pytest.mark.asyncio
    async def test_delete(self, fake_token, monkeypatch):
        # Delete is gated behind MCP_ALLOW_RELATION_DELETE; flip it on for
        # this happy-path forwarding test (the guardrail rejection path
        # has its own test).
        monkeypatch.setattr(server, "MCP_ALLOW_RELATION_DELETE", True)
        patcher, write_call = _patched_post_batch_aware(
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
        path, body = write_call()
        assert path == "/relations/bulk"
        assert body["operations"][0]["action"] == "delete"
        assert body["dry_run"] is False

    @pytest.mark.asyncio
    async def test_type_mismatch_surfaces(self, fake_token):
        # Backend rejects per-row when source.type doesn't match the
        # relation type's expected source.
        patcher, _write_call = _patched_post_batch_aware(
            {
                "results": [
                    {
                        "row_index": 0,
                        "status": "failed",
                        "error": (
                            "Source type 'X' does not match relation type's "
                            "expected source 'Application'"
                        ),
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


_IGNORED_DRY_RUN_MESSAGE = (
    "The Turbo EA backend did not honour dry_run (it is older "
    "than 2.180.0), so this call WAS PERSISTED. Tell the user; "
    "upgrade the backend before using diagram previews."
)


class TestCreateDiagram:
    @pytest.mark.asyncio
    async def test_a_backend_that_ignored_dry_run_is_reported_as_persisted(self, fake_token):
        # A backend older than 2.180.0 drops the unknown `dry_run` flag and
        # creates the diagram: the tool must say so, not call it a preview.
        calls: list = []
        created = {"id": "D9", "name": "X", "card_ids": []}

        async def router(path, json=None):
            calls.append((path, json))
            if path.startswith("/mutation-batches"):
                return {"id": "B-1", "dry_run": True}
            return created

        with patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=router)):
            out = await server.create_diagram(name="X", drawio_xml="<mxGraphModel/>")
        data = _parse(out)
        assert data["error"] == "backend_ignored_dry_run"
        assert data["persisted"] == created
        assert data["batch_id"] == "B-1"
        assert data["message"] == _IGNORED_DRY_RUN_MESSAGE
        assert "would_create" not in data
        assert calls[-1] == (
            "/mutation-batches/B-1/commit",
            {"summary": {"status": "backend_ignored_dry_run"}},
        )

    @pytest.mark.asyncio
    async def test_dry_run_is_verified_by_the_backend_inside_a_dry_run_batch(self, fake_token):
        ref = "11111111-2222-3333-4444-555555555555"
        xml = f'<mxGraphModel><object cardId="{ref}"/></mxGraphModel>'
        calls: list = []

        async def router(path, json=None):
            calls.append((path, json))
            if path == "/mutation-batches/B-1/commit":
                return {"id": "B-1", "committed_at": "now"}
            if path.startswith("/mutation-batches"):
                return {"id": "B-1", "dry_run": True}
            # The backend's verified, rolled-back preview.
            return {
                "dry_run": True,
                "id": None,
                "name": "My Diag",
                "card_ids": ["c1"],
                "card_refs": [ref],
                "xml_chars": len(xml),
            }

        with patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=router)):
            out = await server.create_diagram(
                name="My Diag", drawio_xml=xml, linked_card_ids=["c1"]
            )
        assert calls == [
            ("/mutation-batches?row_count=1", {"tool_name": "create_diagram", "dry_run": True}),
            (
                "/diagrams",
                {
                    "name": "My Diag",
                    "description": None,
                    "data": {"xml": xml},
                    "card_ids": ["c1"],
                    "dry_run": True,
                },
            ),
            (
                "/mutation-batches/B-1/commit",
                {"summary": {"diagram_id": None, "status": "previewed"}},
            ),
        ]
        data = _parse(out)
        assert data == {
            "dry_run": True,
            "would_create": {
                "name": "My Diag",
                "card_ids": ["c1"],
                "card_refs": [ref],
                "xml_chars": len(xml),
                "description": "",
                "extracted_card_refs_from_xml": [ref],
            },
            "note": data["note"],
            "batch_id": "B-1",
        }
        assert "nothing was persisted" in data["note"]

    @pytest.mark.asyncio
    async def test_commit_passes_xml(self, fake_token):
        patcher, write_call = _patched_post_batch_aware(
            {"id": "diag-1", "name": "My Diag", "card_ids": ["c1"]}
        )
        xml = "<mxGraphModel/>"
        with patcher:
            out = await server.create_diagram(
                name="My Diag",
                drawio_xml=xml,
                description="…",
                linked_card_ids=["c1"],
                dry_run=False,
            )
        path, body = write_call()
        assert path == "/diagrams"
        assert body == {
            "name": "My Diag",
            "description": "…",
            "data": {"xml": xml},
            "card_ids": ["c1"],
            "dry_run": False,
        }
        assert _parse(out) == {
            "id": "diag-1",
            "name": "My Diag",
            "card_ids": ["c1"],
            "batch_id": "batch-uuid-001",
        }

    @pytest.mark.asyncio
    async def test_commit_closes_its_batch_with_the_diagram_id(self, fake_token):
        post = AsyncMock(
            side_effect=lambda path, json=None: (
                {"id": "B-2"} if path.startswith("/mutation-batches") else {"id": "diag-9"}
            )
        )
        with patch.object(server.TurboEAClient, "post", post):
            await server.create_diagram(name="D", drawio_xml="<x/>", dry_run=False)
        assert post.call_args_list[0].kwargs["json"] == {
            "tool_name": "create_diagram",
            "dry_run": False,
        }
        assert post.call_args_list[-1].args[0] == "/mutation-batches/B-2/commit"
        assert post.call_args_list[-1].kwargs["json"] == {"summary": {"diagram_id": "diag-9"}}


# ── import_bpmn ────────────────────────────────────────────────────────────


def _bpmn_batch_post():
    """POST router for ``import_bpmn``: answers the batch open / close and
    records every path, so a preview can prove it posted nothing else."""
    paths: list[str] = []

    async def router(path, json=None):
        paths.append(path)
        if path.startswith("/mutation-batches"):
            return {"id": "B-1", "dry_run": (json or {}).get("dry_run")}
        raise AssertionError(f"a preview must not POST {path}")

    return AsyncMock(side_effect=router), paths


PREVIEW_BATCH_PATHS = ["/mutation-batches?row_count=1", "/mutation-batches/B-1/commit"]
COMMIT_OPEN = "/mutation-batches?row_count=1"
COMMIT_CLOSE = "/mutation-batches/B-1/commit"
_CARD_SEARCH = {
    "items": [
        {"id": "00000000-0000-4000-8000-0000000000b1", "name": "Order to Cash", "parent_id": None}
    ],
    "total": 1,
}
_PUBLIC = "https://ea.example.com"


def _flow_http_error(status: int, detail: object = None, method: str = "POST", path: str = "/x"):
    import httpx

    req = httpx.Request(method, "http://backend" + path)
    body = {"detail": detail} if detail is not None else None
    resp = httpx.Response(status, json=body, request=req)
    return httpx.HTTPStatusError(f"{status}", request=req, response=resp)


class _FlowBackend:
    """A backend for the process-flow tools: answers the card search, the
    flow reads and the batch open / close, records every call in order, and
    answers each flow write from ``writes`` (a value, or an exception)."""

    def __init__(self, *, reads: dict | None = None, writes: dict | None = None):
        self.reads = reads or {}
        self.writes = writes or {}
        self.calls: list[tuple[str, str, object]] = []

    async def get(self, path, params=None):
        self.calls.append(("get", path, params))
        if path == "/cards":
            return _CARD_SEARCH
        answer = self.reads[path]
        if isinstance(answer, Exception):
            raise answer
        return answer

    async def _write(self, method, path, json):
        self.calls.append((method, path, json))
        if path == COMMIT_CLOSE:
            return {"id": "B-1", "committed_at": "now"}
        if path.startswith("/mutation-batches"):
            return {"id": "B-1", "dry_run": (json or {}).get("dry_run")}
        answer = self.writes[path]
        if isinstance(answer, Exception):
            raise answer
        return answer

    async def post(self, path, json=None):
        return await self._write("post", path, json)

    async def patch(self, path, json=None):
        return await self._write("patch", path, json)

    def patched(self):
        return (
            patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=self.get)),
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=self.post)),
            patch.object(server.TurboEAClient, "patch", AsyncMock(side_effect=self.patch)),
        )

    def paths(self, *methods: str) -> list[tuple[str, str]]:
        return [(m, p) for m, p, _ in self.calls if not methods or m in methods]

    def body(self, method: str, path: str):
        return next(b for m, p, b in self.calls if m == method and p == path)

    async def run(self, coro_fn):
        g, p, pa = self.patched()
        with g, p, pa:
            return _parse(await coro_fn())


_FLOW = "/bpm/processes/00000000-0000-4000-8000-0000000000b1/flow"
_DRAFT_URL = (
    _PUBLIC + "/bpm/processes/00000000-0000-4000-8000-0000000000b1/flow?versionId={}&returnSubTab=1"
)
_DRAFTS_TAB = _PUBLIC + "/cards/00000000-0000-4000-8000-0000000000b1?tab=processFlow&subtab=1"
_PUBLISHED_TAB = _PUBLIC + "/cards/00000000-0000-4000-8000-0000000000b1?tab=processFlow&subtab=0"


@pytest.fixture
def public_url(monkeypatch):
    monkeypatch.setattr(server, "TURBO_EA_PUBLIC_URL", _PUBLIC + "/")


class TestImportBpmn:
    @pytest.mark.asyncio
    async def test_find_existing_dry_run_does_not_hit_flow_endpoints(self, fake_token):
        """Dry-run against an existing card: the tool returns a preview
        (estimated flow-node count + byte size) without calling any flow
        write. No draft, no submit, no approve."""
        backend = _FlowBackend(
            reads={
                f"{_FLOW}/published": {
                    "id": "00000000-0000-4000-8000-0000000000a1",
                    "revision": 3,
                    "status": "published",
                }
            }
        )
        bpmn = (
            "<bpmn:definitions>"
            '<bpmn:process id="P"><bpmn:startEvent id="s"/>'
            '<bpmn:task id="t"/><bpmn:endEvent id="e"/></bpmn:process>'
            "</bpmn:definitions>"
        )
        data = await backend.run(
            lambda: server.import_bpmn(business_process_name="Order to Cash", bpmn_xml=bpmn)
        )
        # Only the preview's own dry-run batch — no draft, submit or approve.
        assert backend.paths("post", "patch") == [
            ("post", COMMIT_OPEN),
            ("post", COMMIT_CLOSE),
        ]
        assert backend.body("post", COMMIT_OPEN) == {"tool_name": "import_bpmn", "dry_run": True}
        assert backend.body("post", COMMIT_CLOSE) == {
            "summary": {"status": "previewed", "verified": False, "action": "create_draft"}
        }
        assert data == {
            "dry_run": True,
            "committed": False,
            "business_process_id": "00000000-0000-4000-8000-0000000000b1",
            "would": {
                "action": "create_draft",
                "based_on_version_id": "00000000-0000-4000-8000-0000000000a1",
                "based_on_revision": 3,
                "based_on_status": "published",
            },
            "diagram_preview": {
                "flow_nodes_estimated": 3,
                "message_flows_estimated": 0,
                "bpmn_xml_bytes": len(bpmn),
            },
            "next_action": data["next_action"],
            "verified": False,
            "batch_id": "B-1",
        }
        assert "NOTHING HAS BEEN SAVED" in data["next_action"]
        assert "never submits or publishes" in data["next_action"]

    @pytest.mark.asyncio
    async def test_dry_run_counts_unprefixed_bpmn(self, fake_token):
        """BPMN that declares the spec as the *default* namespace carries no
        `bpmn:` prefix. The backend parser handles it; the dry-run preview must
        not report zero flow nodes for a diagram it is about to import fine."""
        backend = _FlowBackend(reads={f"{_FLOW}/published": None})
        bpmn = (
            '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">'
            '<process id="P"><startEvent id="s"/>'
            '<userTask id="t"/><endEvent id="e"/></process>'
            "</definitions>"
        )
        data = await backend.run(
            lambda: server.import_bpmn(business_process_name="Order to Cash", bpmn_xml=bpmn)
        )
        assert data["diagram_preview"]["flow_nodes_estimated"] == 3
        assert data["diagram_preview"]["message_flows_estimated"] == 0
        # No published flow: a commit would start an unbased draft.
        assert data["would"] == {
            "action": "create_draft",
            "based_on_version_id": None,
            "based_on_revision": None,
            "based_on_status": None,
        }

    @pytest.mark.asyncio
    async def test_dry_run_counts_artefacts_and_message_flows(self, fake_token):
        """The backend extracts data objects / data stores as elements and the
        message flows into their own table; the preview mirrors both so a
        two-pool diagram is not under-reported."""
        backend = _FlowBackend(reads={f"{_FLOW}/published": None})
        bpmn = (
            "<bpmn:definitions>"
            '<bpmn:collaboration id="c">'
            '<bpmn:messageFlow id="mf1" sourceRef="t" targetRef="p2"/>'
            '<bpmn:messageFlow id="mf2" sourceRef="p2" targetRef="e"/>'
            "</bpmn:collaboration>"
            '<bpmn:process id="P"><bpmn:startEvent id="s"/>'
            '<bpmn:task id="t"/><bpmn:dataObjectReference id="d"/>'
            '<bpmn:dataStoreReference id="ds"/>'
            '<bpmn:endEvent id="e"/></bpmn:process>'
            "</bpmn:definitions>"
        )
        data = await backend.run(
            lambda: server.import_bpmn(business_process_name="Order to Cash", bpmn_xml=bpmn)
        )
        assert data["diagram_preview"]["flow_nodes_estimated"] == 5
        assert data["diagram_preview"]["message_flows_estimated"] == 2

    @pytest.mark.asyncio
    async def test_dry_run_of_a_draft_update_names_the_draft(self, fake_token):
        backend = _FlowBackend(
            reads={
                f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000d1": {
                    "id": "00000000-0000-4000-8000-0000000000d1",
                    "revision": 5,
                    "status": "draft",
                    "based_on_id": "00000000-0000-4000-8000-0000000000a1",
                }
            }
        )
        data = await backend.run(
            lambda: server.import_bpmn(
                business_process_name="Order to Cash",
                bpmn_xml="<bpmn:definitions/>",
                draft_version_id="00000000-0000-4000-8000-0000000000d1",
            )
        )
        assert data["would"] == {
            "action": "update_draft",
            "version_id": "00000000-0000-4000-8000-0000000000d1",
            "revision": 5,
            "based_on_version_id": "00000000-0000-4000-8000-0000000000a1",
        }
        assert backend.paths("get") == [
            ("get", "/cards"),
            ("get", f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000d1"),
        ]
        assert backend.paths("post", "patch") == [
            ("post", COMMIT_OPEN),
            ("post", COMMIT_CLOSE),
        ]
        assert backend.body("post", COMMIT_CLOSE) == {
            "summary": {"status": "previewed", "verified": False, "action": "update_draft"}
        }

    @pytest.mark.asyncio
    async def test_missing_card_returns_card_not_found_with_next_action(self, fake_token):
        """import_bpmn does not auto-create a BusinessProcess card —
        forcing the agent into the explicit two-step flow (create card
        with all metadata via create_cards_bulk, then import the BPMN)."""
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
        get_mock.assert_awaited_once()
        data = _parse(out)
        assert data["error"] == "card_not_found"
        assert data["business_process_name"] == "Brand New Process"
        # Next-action must spell out the recovery path concretely so the
        # agent doesn't paper over it with a different attempt.
        assert "create_cards_bulk" in data["next_action"]
        assert "type='BusinessProcess'" in data["next_action"]

    @pytest.mark.asyncio
    async def test_missing_card_returns_card_not_found_in_dry_run_too(self, fake_token):
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
        assert _parse(out)["error"] == "card_not_found"

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
        post_mock = AsyncMock()
        with (
            patch.object(server.TurboEAClient, "get", get_mock),
            patch.object(server.TurboEAClient, "post", post_mock),
        ):
            out = await server.import_bpmn(
                business_process_name="Order to Cash",
                bpmn_xml="<bpmn:definitions/>",
                dry_run=False,
            )
        post_mock.assert_not_called()
        data = _parse(out)
        assert data["error"] == "ambiguous_business_process"
        assert len(data["candidates"]) == 2

    @pytest.mark.asyncio
    async def test_commit_creates_a_draft_based_on_the_published_flow(self, fake_token, public_url):
        """The default commit saves a new draft based on the published flow,
        so its element links carry over — and stops there: no submit, no
        approve (discussion 1390)."""
        backend = _FlowBackend(
            reads={
                f"{_FLOW}/published": {
                    "id": "00000000-0000-4000-8000-0000000000a1",
                    "revision": 3,
                    "status": "published",
                }
            },
            writes={
                f"{_FLOW}/drafts": {
                    "id": "00000000-0000-4000-8000-0000000000d4",
                    "revision": 4,
                    "status": "draft",
                    "based_on_id": "00000000-0000-4000-8000-0000000000a1",
                }
            },
        )
        data = await backend.run(
            lambda: server.import_bpmn(
                business_process_name="Order to Cash",
                bpmn_xml="<bpmn:definitions/>",
                svg_thumbnail="<svg/>",
                dry_run=False,
            )
        )
        assert backend.paths() == [
            ("get", "/cards"),
            ("get", f"{_FLOW}/published"),
            ("post", COMMIT_OPEN),
            ("post", f"{_FLOW}/drafts"),
            ("post", COMMIT_CLOSE),
        ]
        assert not any(p.endswith(("/submit", "/approve")) for _, p in backend.paths())
        assert backend.body("post", COMMIT_OPEN) == {"tool_name": "import_bpmn", "dry_run": False}
        assert backend.body("post", f"{_FLOW}/drafts") == {
            "bpmn_xml": "<bpmn:definitions/>",
            "svg_thumbnail": "<svg/>",
            "based_on_id": "00000000-0000-4000-8000-0000000000a1",
        }
        assert backend.body("post", COMMIT_CLOSE) == {
            "summary": {
                "business_process_id": "00000000-0000-4000-8000-0000000000b1",
                "version_id": "00000000-0000-4000-8000-0000000000d4",
                "revision": 4,
                "action": "created",
            }
        }
        assert data == {
            "dry_run": False,
            "committed": True,
            "business_process_id": "00000000-0000-4000-8000-0000000000b1",
            "version_id": "00000000-0000-4000-8000-0000000000d4",
            "revision": 4,
            "status": "draft",
            "based_on_version_id": "00000000-0000-4000-8000-0000000000a1",
            "action": "created",
            "draft_url": _DRAFT_URL.format("00000000-0000-4000-8000-0000000000d4"),
            "drafts_tab_url": _DRAFTS_TAB,
            "next_action": data["next_action"],
            "batch_id": "B-1",
            "based_on_revision": 3,
        }
        assert data["next_action"] == (
            "The diagram is saved as a DRAFT; it is not submitted or "
            "published. Ask the user to review it at draft_url. To change "
            "it, call import_bpmn again with "
            "draft_version_id='00000000-0000-4000-8000-0000000000d4' "
            "(same revision); the links of steps whose ids it keeps stay. "
            "To link the steps to cards, call get_process_flow_elements "
            "for their ids, then link_process_flow_elements. When the user "
            "wants it approved, call submit_process_flow; "
            "approve_process_flow then publishes it, for someone allowed "
            "to approve."
        )

    @pytest.mark.asyncio
    async def test_commit_without_a_published_flow_creates_an_unbased_draft(
        self, fake_token, public_url
    ):
        backend = _FlowBackend(
            reads={f"{_FLOW}/published": None},
            writes={
                f"{_FLOW}/drafts": {
                    "id": "00000000-0000-4000-8000-0000000000d1",
                    "revision": 1,
                    "status": "draft",
                    "based_on_id": None,
                }
            },
        )
        data = await backend.run(
            lambda: server.import_bpmn(
                business_process_name="Order to Cash",
                bpmn_xml="<bpmn:definitions/>",
                dry_run=False,
            )
        )
        assert backend.body("post", f"{_FLOW}/drafts") == {
            "bpmn_xml": "<bpmn:definitions/>",
            "svg_thumbnail": None,
            "based_on_id": None,
        }
        assert data["based_on_version_id"] is None
        assert data["based_on_revision"] is None
        assert data["revision"] == 1
        assert data["action"] == "created"

    @pytest.mark.asyncio
    async def test_commit_based_on_a_named_version(self, fake_token, public_url):
        """``based_on_version_id`` starts the draft from that version, and the
        published flow is not even read."""
        backend = _FlowBackend(
            reads={
                f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000e2": {
                    "id": "00000000-0000-4000-8000-0000000000e2",
                    "revision": 2,
                    "status": "archived",
                }
            },
            writes={
                f"{_FLOW}/drafts": {
                    "id": "00000000-0000-4000-8000-0000000000d6",
                    "revision": 6,
                    "status": "draft",
                    "based_on_id": "00000000-0000-4000-8000-0000000000e2",
                }
            },
        )
        data = await backend.run(
            lambda: server.import_bpmn(
                business_process_name="Order to Cash",
                bpmn_xml="<x/>",
                based_on_version_id="00000000-0000-4000-8000-0000000000e2",
                dry_run=False,
            )
        )
        assert backend.paths("get") == [
            ("get", "/cards"),
            ("get", f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000e2"),
        ]
        assert backend.body("post", f"{_FLOW}/drafts") == {
            "bpmn_xml": "<x/>",
            "svg_thumbnail": None,
            "based_on_id": "00000000-0000-4000-8000-0000000000e2",
        }
        assert data["version_id"] == "00000000-0000-4000-8000-0000000000d6"
        assert data["based_on_version_id"] == "00000000-0000-4000-8000-0000000000e2"
        assert data["based_on_revision"] == 2

    @pytest.mark.asyncio
    async def test_commit_updates_an_existing_draft_in_place(self, fake_token, public_url):
        """``draft_version_id`` PATCHes that draft: same version, same
        revision, no new draft and no submit."""
        backend = _FlowBackend(
            reads={
                f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000d1": {
                    "id": "00000000-0000-4000-8000-0000000000d1",
                    "revision": 5,
                    "status": "draft",
                    "based_on_id": "00000000-0000-4000-8000-0000000000a1",
                }
            },
            writes={
                f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000d1": {
                    "id": "00000000-0000-4000-8000-0000000000d1",
                    "revision": 5,
                    "status": "draft",
                    "based_on_id": "00000000-0000-4000-8000-0000000000a1",
                }
            },
        )
        data = await backend.run(
            lambda: server.import_bpmn(
                business_process_name="Order to Cash",
                bpmn_xml="<new/>",
                draft_version_id="00000000-0000-4000-8000-0000000000d1",
                dry_run=False,
            )
        )
        assert backend.paths() == [
            ("get", "/cards"),
            ("get", f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000d1"),
            ("post", COMMIT_OPEN),
            ("patch", f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000d1"),
            ("post", COMMIT_CLOSE),
        ]
        # No thumbnail given: the stored one is left alone.
        assert backend.body("patch", f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000d1") == {
            "bpmn_xml": "<new/>"
        }
        assert backend.body("post", COMMIT_CLOSE) == {
            "summary": {
                "business_process_id": "00000000-0000-4000-8000-0000000000b1",
                "version_id": "00000000-0000-4000-8000-0000000000d1",
                "revision": 5,
                "action": "updated",
            }
        }
        assert data == {
            "dry_run": False,
            "committed": True,
            "business_process_id": "00000000-0000-4000-8000-0000000000b1",
            "version_id": "00000000-0000-4000-8000-0000000000d1",
            "revision": 5,
            "status": "draft",
            "based_on_version_id": "00000000-0000-4000-8000-0000000000a1",
            "action": "updated",
            "draft_url": _DRAFT_URL.format("00000000-0000-4000-8000-0000000000d1"),
            "drafts_tab_url": _DRAFTS_TAB,
            "next_action": data["next_action"],
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_a_draft_update_sends_a_given_thumbnail(self, fake_token, public_url):
        draft = {
            "id": "00000000-0000-4000-8000-0000000000d1",
            "revision": 5,
            "status": "draft",
            "based_on_id": None,
        }
        backend = _FlowBackend(
            reads={f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000d1": draft},
            writes={f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000d1": draft},
        )
        await backend.run(
            lambda: server.import_bpmn(
                business_process_name="Order to Cash",
                bpmn_xml="<new/>",
                draft_version_id="00000000-0000-4000-8000-0000000000d1",
                svg_thumbnail="<svg/>",
                dry_run=False,
            )
        )
        assert backend.body("patch", f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000d1") == {
            "bpmn_xml": "<new/>",
            "svg_thumbnail": "<svg/>",
        }

    @pytest.mark.asyncio
    @pytest.mark.parametrize("dry_run", [True, False])
    async def test_both_version_ids_are_refused_before_any_call(self, fake_token, dry_run):
        backend = _FlowBackend()
        data = await backend.run(
            lambda: server.import_bpmn(
                business_process_name="Order to Cash",
                bpmn_xml="<x/>",
                draft_version_id="00000000-0000-4000-8000-0000000000d1",
                based_on_version_id="00000000-0000-4000-8000-0000000000e2",
                dry_run=dry_run,
            )
        )
        assert backend.calls == []
        assert data["error"] == "conflicting_versions"
        assert "not both" in data["message"]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("dry_run", [True, False])
    @pytest.mark.parametrize("status", ["pending", "published", "archived"])
    async def test_a_target_that_is_not_a_draft_is_refused(
        self, fake_token, public_url, dry_run, status
    ):
        backend = _FlowBackend(
            reads={
                f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000e9": {
                    "id": "00000000-0000-4000-8000-0000000000e9",
                    "revision": 9,
                    "status": status,
                }
            }
        )
        data = await backend.run(
            lambda: server.import_bpmn(
                business_process_name="Order to Cash",
                bpmn_xml="<x/>",
                draft_version_id="00000000-0000-4000-8000-0000000000e9",
                dry_run=dry_run,
            )
        )
        # Refused before the batch opens: nothing is written.
        assert backend.paths("post", "patch") == []
        assert data == {
            "error": "wrong_status",
            "status": status,
            "expected_status": "draft",
            "business_process_id": "00000000-0000-4000-8000-0000000000b1",
            "version_id": "00000000-0000-4000-8000-0000000000e9",
            "revision": 9,
            "message": server._NOT_A_DRAFT_MESSAGE,
            "drafts_tab_url": _DRAFTS_TAB,
        }

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status_code", [403, 404])
    @pytest.mark.parametrize("arg", ["draft_version_id", "based_on_version_id"])
    async def test_an_unreadable_version_is_refused_with_the_backend_detail(
        self, fake_token, public_url, status_code, arg
    ):
        backend = _FlowBackend(
            reads={
                f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000e9": _flow_http_error(
                    status_code, "Version not found", "GET"
                )
            }
        )
        data = await backend.run(
            lambda: server.import_bpmn(
                business_process_name="Order to Cash",
                bpmn_xml="<x/>",
                dry_run=False,
                **{arg: "00000000-0000-4000-8000-0000000000e9"},
            )
        )
        assert backend.paths("post", "patch") == []
        assert data == {
            "error": "version_unavailable",
            "status_code": status_code,
            "detail": "Version not found",
            "business_process_id": "00000000-0000-4000-8000-0000000000b1",
            "version_id": "00000000-0000-4000-8000-0000000000e9",
            "drafts_tab_url": _DRAFTS_TAB,
        }

    @pytest.mark.asyncio
    async def test_an_unreadable_published_flow_is_refused(self, fake_token, public_url):
        backend = _FlowBackend(
            reads={f"{_FLOW}/published": _flow_http_error(403, "Not enough permissions", "GET")}
        )
        data = await backend.run(
            lambda: server.import_bpmn(
                business_process_name="Order to Cash", bpmn_xml="<x/>", dry_run=False
            )
        )
        assert backend.paths("post", "patch") == []
        assert data["error"] == "version_unavailable"
        assert data["status_code"] == 403
        assert data["detail"] == "Not enough permissions"
        assert data["version_id"] is None

    @pytest.mark.asyncio
    async def test_a_server_error_on_a_read_is_not_dressed_up_as_a_refusal(self, fake_token):
        import httpx

        backend = _FlowBackend(reads={f"{_FLOW}/published": _flow_http_error(500, "boom", "GET")})
        with pytest.raises(httpx.HTTPStatusError):
            await backend.run(
                lambda: server.import_bpmn(
                    business_process_name="Order to Cash", bpmn_xml="<x/>", dry_run=False
                )
            )
        assert backend.paths("post", "patch") == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status_code", [400, 403, 404])
    async def test_a_refused_save_closes_the_batch_and_carries_the_detail(
        self, fake_token, public_url, status_code
    ):
        backend = _FlowBackend(
            reads={f"{_FLOW}/published": None},
            writes={f"{_FLOW}/drafts": _flow_http_error(status_code, "Insufficient permissions")},
        )
        data = await backend.run(
            lambda: server.import_bpmn(
                business_process_name="Order to Cash", bpmn_xml="<x/>", dry_run=False
            )
        )
        assert backend.paths("post") == [
            ("post", COMMIT_OPEN),
            ("post", f"{_FLOW}/drafts"),
            ("post", COMMIT_CLOSE),
        ]
        assert backend.body("post", COMMIT_CLOSE) == {
            "summary": {
                "status": "refused",
                "business_process_id": "00000000-0000-4000-8000-0000000000b1",
                "error": "draft_save_refused",
            }
        }
        assert data == {
            "error": "draft_save_refused",
            "status_code": status_code,
            "detail": "Insufficient permissions",
            "business_process_id": "00000000-0000-4000-8000-0000000000b1",
            "version_id": None,
            "drafts_tab_url": _DRAFTS_TAB,
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_a_server_error_on_the_save_is_raised(self, fake_token):
        import httpx

        backend = _FlowBackend(
            reads={f"{_FLOW}/published": None},
            writes={f"{_FLOW}/drafts": _flow_http_error(500, "boom")},
        )
        with pytest.raises(httpx.HTTPStatusError):
            await backend.run(
                lambda: server.import_bpmn(
                    business_process_name="Order to Cash", bpmn_xml="<x/>", dry_run=False
                )
            )

    @pytest.mark.asyncio
    async def test_a_draft_that_was_not_saved_closes_the_batch_as_failed(self, fake_token):
        backend = _FlowBackend(
            reads={f"{_FLOW}/published": None},
            writes={f"{_FLOW}/drafts": {"detail": "nope"}},  # no draft id
        )
        data = await backend.run(
            lambda: server.import_bpmn(
                business_process_name="Order to Cash", bpmn_xml="<x/>", dry_run=False
            )
        )
        assert data == {
            "error": "draft_save_failed",
            "response": {"detail": "nope"},
            "batch_id": "B-1",
        }
        assert backend.paths("post") == [
            ("post", COMMIT_OPEN),
            ("post", f"{_FLOW}/drafts"),
            ("post", COMMIT_CLOSE),
        ]
        assert backend.body("post", COMMIT_CLOSE) == {
            "summary": {
                "status": "draft_save_failed",
                "business_process_id": "00000000-0000-4000-8000-0000000000b1",
            }
        }


# ── process-flow versions: list / get ──────────────────────────────────────


_PUBLISHED_ROW = {
    "id": "00000000-0000-4000-8000-0000000000a1",
    "process_id": "00000000-0000-4000-8000-0000000000b1",
    "revision": 3,
    "status": "published",
    "based_on_id": "00000000-0000-4000-8000-0000000000e2",
    "bpmn_xml": "<published/>",
    "svg_thumbnail": "<svg/>",
    "created_at": "c3",
    "created_by_name": "Ann",
    "submitted_at": "s3",
    "submitted_by_name": "Ann",
    "approved_at": "a3",
    "approved_by_name": "Bob",
    "draft_element_links": None,
}


def _summary(**fields):
    keys = server._FLOW_VERSION_SUMMARY_KEYS
    return {k: fields.get(k) for k in keys}


class TestAppUrl:
    def test_only_trailing_slashes_are_stripped(self, monkeypatch):
        """The public URL keeps every other character, even one it ends in
        before the slash."""
        monkeypatch.setattr(server, "TURBO_EA_PUBLIC_URL", "https://ea.example.com/X//")
        assert server._app_url("/cards/1") == "https://ea.example.com/X/cards/1"


class TestListProcessFlowVersions:
    @pytest.mark.asyncio
    async def test_lists_the_published_flow_and_the_drafts(self, fake_token, public_url):
        backend = _FlowBackend(
            reads={
                f"{_FLOW}/published": _PUBLISHED_ROW,
                f"{_FLOW}/drafts": [
                    {
                        "id": "00000000-0000-4000-8000-0000000000d5",
                        "revision": 5,
                        "status": "draft",
                        "based_on_id": "00000000-0000-4000-8000-0000000000a1",
                    },
                    {
                        "id": "00000000-0000-4000-8000-0000000000f4",
                        "revision": 4,
                        "status": "pending",
                        "submitted_at": "s4",
                    },
                ],
            }
        )
        data = await backend.run(
            lambda: server.list_process_flow_versions(
                business_process_id="00000000-0000-4000-8000-0000000000b1"
            )
        )
        assert backend.paths() == [("get", f"{_FLOW}/published"), ("get", f"{_FLOW}/drafts")]
        assert data == {
            "business_process_id": "00000000-0000-4000-8000-0000000000b1",
            "published": {
                **_summary(**_PUBLISHED_ROW),
                "url": _PUBLISHED_TAB,
            },
            "drafts": [
                {
                    **_summary(
                        id="00000000-0000-4000-8000-0000000000d5",
                        revision=5,
                        status="draft",
                        based_on_id="00000000-0000-4000-8000-0000000000a1",
                    ),
                    "draft_url": _DRAFT_URL.format("00000000-0000-4000-8000-0000000000d5"),
                },
                # A pending version is not edited, so it has no editor link.
                _summary(
                    id="00000000-0000-4000-8000-0000000000f4",
                    revision=4,
                    status="pending",
                    submitted_at="s4",
                ),
            ],
            "drafts_visible": True,
            "drafts_tab_url": _DRAFTS_TAB,
        }
        # No XML and no thumbnail in a listing.
        assert "bpmn_xml" not in data["published"]
        assert "svg_thumbnail" not in data["published"]

    @pytest.mark.asyncio
    async def test_no_published_flow_and_drafts_hidden_from_the_reader(
        self, fake_token, public_url
    ):
        backend = _FlowBackend(
            reads={
                f"{_FLOW}/published": None,
                f"{_FLOW}/drafts": _flow_http_error(403, "Insufficient permissions", "GET"),
            }
        )
        data = await backend.run(
            lambda: server.list_process_flow_versions(
                business_process_id="00000000-0000-4000-8000-0000000000b1"
            )
        )
        assert data == {
            "business_process_id": "00000000-0000-4000-8000-0000000000b1",
            "published": None,
            "drafts": [],
            "drafts_visible": False,
            "drafts_tab_url": _DRAFTS_TAB,
        }

    @pytest.mark.asyncio
    async def test_an_unknown_process_is_a_structured_refusal(self, fake_token, public_url):
        backend = _FlowBackend(
            reads={f"{_FLOW}/published": _flow_http_error(404, "Business process not found", "GET")}
        )
        data = await backend.run(
            lambda: server.list_process_flow_versions(
                business_process_id="00000000-0000-4000-8000-0000000000b1"
            )
        )
        assert backend.paths() == [("get", f"{_FLOW}/published")]
        assert data == {
            "error": "process_flow_unavailable",
            "status_code": 404,
            "detail": "Business process not found",
            "business_process_id": "00000000-0000-4000-8000-0000000000b1",
            "version_id": None,
            "drafts_tab_url": _DRAFTS_TAB,
        }

    @pytest.mark.asyncio
    @pytest.mark.parametrize("path", ["/published", "/drafts"])
    async def test_a_server_error_is_raised(self, fake_token, path):
        import httpx

        reads = {f"{_FLOW}/published": None, f"{_FLOW}/drafts": []}
        reads[f"{_FLOW}{path}"] = _flow_http_error(500, "boom", "GET")
        backend = _FlowBackend(reads=reads)
        with pytest.raises(httpx.HTTPStatusError):
            await backend.run(
                lambda: server.list_process_flow_versions(
                    business_process_id="00000000-0000-4000-8000-0000000000b1"
                )
            )


class TestGetProcessFlowVersion:
    @pytest.mark.asyncio
    async def test_an_answer_that_is_not_an_object_reads_as_empty(self, fake_token, public_url):
        backend = _FlowBackend(reads={f"{_FLOW}/versions/{_STEP_VERSION}": None})
        data = await backend.run(
            lambda: server.get_process_flow_version(
                business_process_id=_STEP_PROCESS, version_id=_STEP_VERSION
            )
        )
        assert data == {"drafts_tab_url": _DRAFTS_TAB}

    @pytest.mark.asyncio
    async def test_a_server_error_is_raised(self, fake_token):
        import httpx

        backend = _FlowBackend(
            reads={
                f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000d5": _flow_http_error(
                    500, "boom", "GET"
                )
            }
        )
        with pytest.raises(httpx.HTTPStatusError):
            await backend.run(
                lambda: server.get_process_flow_version(
                    business_process_id="00000000-0000-4000-8000-0000000000b1",
                    version_id="00000000-0000-4000-8000-0000000000d5",
                )
            )

    @pytest.mark.asyncio
    async def test_a_draft_carries_its_xml_and_editor_link(self, fake_token, public_url):
        row = {
            **_PUBLISHED_ROW,
            "id": "00000000-0000-4000-8000-0000000000d5",
            "status": "draft",
            "bpmn_xml": "<draft/>",
        }
        backend = _FlowBackend(
            reads={f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000d5": row}
        )
        data = await backend.run(
            lambda: server.get_process_flow_version(
                business_process_id="00000000-0000-4000-8000-0000000000b1",
                version_id="00000000-0000-4000-8000-0000000000d5",
            )
        )
        assert backend.paths() == [
            ("get", f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000d5")
        ]
        expected = {k: v for k, v in row.items() if k != "svg_thumbnail"}
        assert data == {
            **expected,
            "draft_url": _DRAFT_URL.format("00000000-0000-4000-8000-0000000000d5"),
            "drafts_tab_url": _DRAFTS_TAB,
        }

    @pytest.mark.asyncio
    async def test_a_published_version_has_no_editor_link(self, fake_token, public_url):
        backend = _FlowBackend(
            reads={f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000a1": _PUBLISHED_ROW}
        )
        data = await backend.run(
            lambda: server.get_process_flow_version(
                business_process_id="00000000-0000-4000-8000-0000000000b1",
                version_id="00000000-0000-4000-8000-0000000000a1",
            )
        )
        assert data["bpmn_xml"] == "<published/>"
        assert "draft_url" not in data
        assert "svg_thumbnail" not in data
        assert data["drafts_tab_url"] == _DRAFTS_TAB

    @pytest.mark.asyncio
    async def test_a_hidden_version_is_a_structured_refusal(self, fake_token, public_url):
        backend = _FlowBackend(
            reads={
                f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000d5": _flow_http_error(
                    403, "Insufficient permissions", "GET"
                )
            }
        )
        data = await backend.run(
            lambda: server.get_process_flow_version(
                business_process_id="00000000-0000-4000-8000-0000000000b1",
                version_id="00000000-0000-4000-8000-0000000000d5",
            )
        )
        assert data == {
            "error": "version_unavailable",
            "status_code": 403,
            "detail": "Insufficient permissions",
            "business_process_id": "00000000-0000-4000-8000-0000000000b1",
            "version_id": "00000000-0000-4000-8000-0000000000d5",
            "drafts_tab_url": _DRAFTS_TAB,
        }


# ── submit_process_flow / approve_process_flow ─────────────────────────────


_STEP_CASES = {
    "submit": ("submit_process_flow", "draft", "pending", "drafts_tab_url", _DRAFTS_TAB),
    "approve": ("approve_process_flow", "pending", "published", "published_url", _PUBLISHED_TAB),
}


_STEP_PROCESS = "00000000-0000-4000-8000-0000000000b1"
_STEP_VERSION = "00000000-0000-4000-8000-0000000000e1"


def _step_call(step, dry_run=True, version_id="00000000-0000-4000-8000-0000000000e1"):
    tool = getattr(server, _STEP_CASES[step][0])
    return lambda: tool(
        business_process_id="00000000-0000-4000-8000-0000000000b1",
        version_id=version_id,
        dry_run=dry_run,
    )


@pytest.mark.parametrize("step", ["submit", "approve"])
class TestProcessFlowSteps:
    @pytest.mark.asyncio
    async def test_commit_posts_the_step_inside_one_batch(self, fake_token, public_url, step):
        tool, _, to_status, url_key, url = _STEP_CASES[step]
        backend = _FlowBackend(
            writes={
                f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000e1/{step}": {
                    "id": "00000000-0000-4000-8000-0000000000e1",
                    "revision": 4,
                    "status": to_status,
                }
            }
        )
        data = await backend.run(_step_call(step, dry_run=False))
        # No read on a commit: the backend checks the status itself.
        assert backend.paths() == [
            ("post", COMMIT_OPEN),
            ("post", f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000e1/{step}"),
            ("post", COMMIT_CLOSE),
        ]
        assert backend.body("post", COMMIT_OPEN) == {"tool_name": tool, "dry_run": False}
        assert (
            backend.body("post", f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000e1/{step}")
            == {}
        )
        assert backend.body("post", COMMIT_CLOSE) == {
            "summary": {
                "business_process_id": "00000000-0000-4000-8000-0000000000b1",
                "version_id": "00000000-0000-4000-8000-0000000000e1",
                "status": to_status,
            }
        }
        assert data == {
            "business_process_id": "00000000-0000-4000-8000-0000000000b1",
            "version_id": "00000000-0000-4000-8000-0000000000e1",
            "revision": 4,
            "status": to_status,
            url_key: url,
            "next_action": server._FLOW_STEPS[step]["next_action"],
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_dry_run_reads_the_version_and_writes_nothing(self, fake_token, public_url, step):
        tool, from_status, to_status, _, _ = _STEP_CASES[step]
        backend = _FlowBackend(
            reads={
                f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000e1": {
                    "id": "00000000-0000-4000-8000-0000000000e1",
                    "revision": 4,
                    "status": from_status,
                }
            }
        )
        data = await backend.run(_step_call(step))
        assert backend.paths() == [
            ("get", f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000e1"),
            ("post", COMMIT_OPEN),
            ("post", COMMIT_CLOSE),
        ]
        assert backend.body("post", COMMIT_OPEN) == {"tool_name": tool, "dry_run": True}
        assert backend.body("post", COMMIT_CLOSE) == {
            "summary": {
                "status": "previewed",
                "business_process_id": "00000000-0000-4000-8000-0000000000b1",
                "version_id": "00000000-0000-4000-8000-0000000000e1",
            }
        }
        assert data == {
            "dry_run": True,
            f"would_{step}": {
                "business_process_id": "00000000-0000-4000-8000-0000000000b1",
                "version_id": "00000000-0000-4000-8000-0000000000e1",
                "revision": 4,
                "from_status": from_status,
                "to_status": to_status,
            },
            "note": data["note"],
            "batch_id": "B-1",
        }
        assert data["note"] == (
            "Preview built by the MCP server: the route has no dry run, so the "
            f"version was read and nothing was changed. Call again with "
            f"dry_run=False to {step} it."
        )

    @pytest.mark.asyncio
    async def test_every_call_carries_the_callers_token(self, fake_token, step):
        """The preview's version read and both batch calls are made as the
        caller — no call goes out without their token."""
        tokens: list = []
        backend = _FlowBackend(
            reads={
                f"{_FLOW}/versions/{_STEP_VERSION}": {
                    "id": _STEP_VERSION,
                    "revision": 4,
                    "status": _STEP_CASES[step][1],
                }
            }
        )

        async def get(client, path, params=None):
            tokens.append(client._token)
            return await backend.get(path, params)

        async def post(client, path, json=None):
            tokens.append(client._token)
            return await backend.post(path, json)

        with (
            patch.object(server.TurboEAClient, "get", autospec=True, side_effect=get),
            patch.object(server.TurboEAClient, "post", autospec=True, side_effect=post),
        ):
            await _step_call(step)()
        assert [p for _, p in backend.paths()] == [
            f"{_FLOW}/versions/{_STEP_VERSION}",
            COMMIT_OPEN,
            COMMIT_CLOSE,
        ]
        assert tokens == ["test-token", "test-token", "test-token"]

    @pytest.mark.asyncio
    async def test_dry_run_of_an_unreadable_shape_is_refused(self, fake_token, public_url, step):
        """A version read that is not an object is read as no version: the
        preview refuses it rather than failing on it."""
        backend = _FlowBackend(reads={f"{_FLOW}/versions/{_STEP_VERSION}": ["not", "a", "dict"]})
        data = await backend.run(_step_call(step))
        assert backend.paths("post") == []
        assert data["error"] == "wrong_status"
        assert data["status"] is None
        assert data["revision"] is None

    @pytest.mark.asyncio
    async def test_a_commit_answer_that_is_not_an_object(self, fake_token, public_url, step):
        _, _, _, url_key, url = _STEP_CASES[step]
        backend = _FlowBackend(writes={f"{_FLOW}/versions/{_STEP_VERSION}/{step}": ["odd"]})
        data = await backend.run(_step_call(step, dry_run=False))
        assert backend.body("post", COMMIT_CLOSE) == {
            "summary": {
                "business_process_id": _STEP_PROCESS,
                "version_id": _STEP_VERSION,
                "status": None,
            }
        }
        assert data == {
            "business_process_id": _STEP_PROCESS,
            "version_id": _STEP_VERSION,
            "revision": None,
            "status": None,
            url_key: url,
            "next_action": server._FLOW_STEPS[step]["next_action"],
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_dry_run_refuses_a_version_in_the_wrong_status(
        self, fake_token, public_url, step
    ):
        backend = _FlowBackend(
            reads={
                f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000e1": {
                    "id": "00000000-0000-4000-8000-0000000000e1",
                    "revision": 4,
                    "status": "published",
                }
            }
        )
        data = await backend.run(_step_call(step))
        assert backend.paths("post") == []
        assert data == {
            "error": "wrong_status",
            "status": "published",
            "expected_status": _STEP_CASES[step][1],
            "business_process_id": "00000000-0000-4000-8000-0000000000b1",
            "version_id": "00000000-0000-4000-8000-0000000000e1",
            "revision": 4,
            "message": server._FLOW_STEPS[step]["wrong_status"],
            "drafts_tab_url": _DRAFTS_TAB,
        }

    @pytest.mark.asyncio
    async def test_dry_run_refuses_a_version_it_cannot_read(self, fake_token, public_url, step):
        backend = _FlowBackend(
            reads={
                f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000e1": _flow_http_error(
                    404, "Version not found", "GET"
                )
            }
        )
        data = await backend.run(_step_call(step))
        assert backend.paths("post") == []
        assert data["error"] == "version_unavailable"
        assert data["detail"] == "Version not found"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("status_code", "detail"),
        [
            (403, "Only process owners, admins, or BPM admins can approve"),
            (400, "Only draft versions can be submitted for approval"),
            (404, "Version not found"),
        ],
    )
    async def test_a_refused_step_carries_the_backend_detail(
        self, fake_token, public_url, step, status_code, detail
    ):
        backend = _FlowBackend(
            writes={
                f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000e1/{step}": _flow_http_error(
                    status_code, detail
                )
            }
        )
        data = await backend.run(_step_call(step, dry_run=False))
        assert backend.paths() == [
            ("post", COMMIT_OPEN),
            ("post", f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000e1/{step}"),
            ("post", COMMIT_CLOSE),
        ]
        assert backend.body("post", COMMIT_CLOSE) == {
            "summary": {
                "status": "refused",
                "business_process_id": "00000000-0000-4000-8000-0000000000b1",
                "version_id": "00000000-0000-4000-8000-0000000000e1",
                "error": f"{step}_refused",
            }
        }
        assert data == {
            "error": f"{step}_refused",
            "status_code": status_code,
            "detail": detail,
            "business_process_id": "00000000-0000-4000-8000-0000000000b1",
            "version_id": "00000000-0000-4000-8000-0000000000e1",
            "drafts_tab_url": _DRAFTS_TAB,
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_a_server_error_is_raised(self, fake_token, step):
        import httpx

        backend = _FlowBackend(
            writes={
                f"{_FLOW}/versions/00000000-0000-4000-8000-0000000000e1/{step}": _flow_http_error(
                    500, "boom"
                )
            }
        )
        with pytest.raises(httpx.HTTPStatusError):
            await backend.run(_step_call(step, dry_run=False))

    @pytest.mark.asyncio
    @pytest.mark.parametrize("dry_run", [True, False])
    async def test_kill_switch(self, fake_token, monkeypatch, step, dry_run):
        monkeypatch.setattr(server, "MCP_WRITES_ENABLED", False)
        backend = _FlowBackend()
        data = await backend.run(_step_call(step, dry_run=dry_run))
        assert data["error"] == "writes_disabled"
        assert backend.calls == []

    def test_requires_auth(self, monkeypatch, step):
        monkeypatch.setattr(server, "_stdio_token", None)
        backend = _FlowBackend()
        g, p, pa = backend.patched()
        with g, p, pa:
            out = asyncio.run(_step_call(step, dry_run=False)())
        assert out == "Error: Not authenticated. Please reconnect."
        assert backend.calls == []


_GOOD = "00000000-0000-4000-8000-0000000000e1"
_BAD_IDS = ["not-a-uuid", "x/../../cards/00000000-0000-4000-8000-0000000000c1/archive?"]


def _flow_id_calls(dry_run):
    """Every flow tool, as ``parameter -> (bad id) -> coroutine factory``."""
    bp = "00000000-0000-4000-8000-0000000000b1"
    return {
        ("import_bpmn", "draft_version_id"): lambda bad: (
            lambda: server.import_bpmn(
                business_process_name="Order to Cash",
                bpmn_xml="<x/>",
                draft_version_id=bad,
                dry_run=dry_run,
            )
        ),
        ("import_bpmn", "based_on_version_id"): lambda bad: (
            lambda: server.import_bpmn(
                business_process_name="Order to Cash",
                bpmn_xml="<x/>",
                based_on_version_id=bad,
                dry_run=dry_run,
            )
        ),
        ("submit_process_flow", "business_process_id"): lambda bad: (
            lambda: server.submit_process_flow(
                business_process_id=bad, version_id=_GOOD, dry_run=dry_run
            )
        ),
        ("submit_process_flow", "version_id"): lambda bad: (
            lambda: server.submit_process_flow(
                business_process_id=bp, version_id=bad, dry_run=dry_run
            )
        ),
        ("approve_process_flow", "business_process_id"): lambda bad: (
            lambda: server.approve_process_flow(
                business_process_id=bad, version_id=_GOOD, dry_run=dry_run
            )
        ),
        ("approve_process_flow", "version_id"): lambda bad: (
            lambda: server.approve_process_flow(
                business_process_id=bp, version_id=bad, dry_run=dry_run
            )
        ),
        ("list_process_flow_versions", "business_process_id"): lambda bad: (
            lambda: server.list_process_flow_versions(business_process_id=bad)
        ),
        ("get_process_flow_version", "business_process_id"): lambda bad: (
            lambda: server.get_process_flow_version(business_process_id=bad, version_id=_GOOD)
        ),
        ("get_process_flow_version", "version_id"): lambda bad: (
            lambda: server.get_process_flow_version(business_process_id=bp, version_id=bad)
        ),
        ("get_process_flow_elements", "business_process_id"): lambda bad: (
            lambda: server.get_process_flow_elements(business_process_id=bad, version_id=_GOOD)
        ),
        ("get_process_flow_elements", "version_id"): lambda bad: (
            lambda: server.get_process_flow_elements(business_process_id=bp, version_id=bad)
        ),
        ("link_process_flow_elements", "business_process_id"): lambda bad: (
            lambda: server.link_process_flow_elements(
                business_process_id=bad, version_id=_GOOD, links=[], dry_run=dry_run
            )
        ),
        ("link_process_flow_elements", "version_id"): lambda bad: (
            lambda: server.link_process_flow_elements(
                business_process_id=bp, version_id=bad, links=[], dry_run=dry_run
            )
        ),
    }


class TestFlowIdsAreUuids:
    """An id goes into a backend path, so anything but a UUID is refused
    before any backend call — a path-shaped value would otherwise aim a
    batched write at another route."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("bad", _BAD_IDS)
    @pytest.mark.parametrize("dry_run", [True, False])
    @pytest.mark.parametrize("case", list(_flow_id_calls(True)))
    async def test_a_non_uuid_is_refused_with_no_backend_call(self, fake_token, case, dry_run, bad):
        backend = _FlowBackend()
        data = await backend.run(_flow_id_calls(dry_run)[case](bad))
        assert backend.calls == []
        assert data == {
            "error": "invalid_id",
            "parameter": case[1],
            "message": (
                f"{case[1]} must be a UUID; list_process_flow_versions lists a "
                "process's flow versions, and search_cards finds the "
                "BusinessProcess card."
            ),
        }

    @pytest.mark.asyncio
    async def test_a_valid_id_is_used_in_its_canonical_form(self, fake_token):
        bp = "00000000-0000-4000-8000-0000000000b1"
        backend = _FlowBackend(
            writes={
                f"/bpm/processes/{bp}/flow/versions/{_GOOD}/submit": {
                    "id": _GOOD,
                    "revision": 2,
                    "status": "pending",
                }
            }
        )
        data = await backend.run(
            lambda: server.submit_process_flow(
                business_process_id="{" + bp.upper() + "}",
                version_id=_GOOD.replace("-", "").upper(),
                dry_run=False,
            )
        )
        assert ("post", f"/bpm/processes/{bp}/flow/versions/{_GOOD}/submit") in backend.paths()
        assert data["business_process_id"] == bp
        assert data["version_id"] == _GOOD

    @pytest.mark.asyncio
    async def test_an_empty_optional_id_is_left_out(self, fake_token):
        """``""`` for an optional id means "not given", as it always has."""
        backend = _FlowBackend(reads={f"{_FLOW}/published": None})
        data = await backend.run(
            lambda: server.import_bpmn(
                business_process_name="Order to Cash",
                bpmn_xml="<x/>",
                draft_version_id="",
                based_on_version_id="",
            )
        )
        assert data["would"]["action"] == "create_draft"


class TestProcessFlowReadsRequireAuth:
    def test_list_requires_auth(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        out = asyncio.run(
            server.list_process_flow_versions(
                business_process_id="00000000-0000-4000-8000-0000000000b1"
            )
        )
        assert "Not authenticated" in out

    def test_get_requires_auth(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        out = asyncio.run(
            server.get_process_flow_version(
                business_process_id="00000000-0000-4000-8000-0000000000b1",
                version_id="00000000-0000-4000-8000-0000000000e1",
            )
        )
        assert "Not authenticated" in out


# ── Unauthenticated paths ──────────────────────────────────────────────────


class TestGuardrails:
    """Per-call caps, kill switch, delete rejection."""

    @pytest.mark.asyncio
    async def test_cards_batch_over_cap_rejected(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_MAX_CARDS_PER_CALL", 3)
        rows = [{"row_index": i, "type": "Application", "name": f"A{i}"} for i in range(4)]
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
        rows = [{"row_index": i, "type": "Application", "name": f"A{i}"} for i in range(3)]
        patcher, write_call = _patched_post_batch_aware({"results": [], "created": 0, "failed": 0})
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
    async def test_relations_delete_allowed_when_flag_on(self, fake_token, monkeypatch):
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
        patcher, write_call = _patched_post_batch_aware(
            {"results": [], "upserted": 0, "deleted": 1, "failed": 0}
        )
        with patcher:
            out = await server.upsert_relations_bulk(operations=ops, dry_run=False)
        path, body = write_call()
        assert path == "/relations/bulk"
        assert body["operations"] == ops
        assert _parse(out)["deleted"] == 1

    @pytest.mark.asyncio
    async def test_writes_disabled_blocks_all_write_tools(self, fake_token, monkeypatch):
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
                await server.import_bpmn(business_process_name="X", bpmn_xml="<bpmn:definitions/>"),
                await server.import_bpmn(
                    business_process_name="X",
                    bpmn_xml="<bpmn:definitions/>",
                    draft_version_id="d-1",
                    dry_run=False,
                ),
                await server.submit_process_flow(business_process_id="bp-1", version_id="v-1"),
                await server.approve_process_flow(business_process_id="bp-1", version_id="v-1"),
                await server.link_process_flow_elements(
                    business_process_id="bp-1", version_id="v-1", links=[], dry_run=False
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
            server.create_cards_bulk(cards=[{"row_index": 0, "type": "Application", "name": "X"}])
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


# ── save_inventory_view ────────────────────────────────────────────────────


_VIEW_QUERY = {
    "type": "Organization",
    "related": [
        {
            "relation": "relOrgToApp",
            "type": "Application",
            "where": {"lifecycle_phase": ["active"]},
        }
    ],
}
_VIEW_QUERY_JSON = json.dumps(_VIEW_QUERY, separators=(",", ":"))
_STACK_QUERY = {
    "any_of": [
        {
            "all_of": [
                {"type": "Application", "where": {"lifecycle_phase": ["active"]}},
                {
                    "type": "Application",
                    "related": [{"relation": "relInitiativeToApp", "type": "Initiative"}],
                },
            ]
        },
        _VIEW_QUERY,
    ]
}


class _ViewBackend:
    """Records every call, in order, as ``(method, path, body_or_params)``."""

    def __init__(
        self,
        cards: dict | None = None,
        error: Exception | None = None,
        views: list | None = None,
        patch_error: Exception | None = None,
    ) -> None:
        self.calls: list[tuple[str, str, dict | None]] = []
        self.cards = cards or {"items": [{"name": "Sales"}, {"name": "Ops"}], "total": 12}
        self.error = error
        # What ``GET /bookmarks`` lists: by default an editable ``v-7``.
        self.views = [{"id": "v-7", "can_edit": True}] if views is None else views
        self.patch_error = patch_error

    async def post(self, path, json=None):
        self.calls.append(("post", path, json))
        if path.endswith("/commit"):
            return {"id": "B-1", "committed_at": "now"}
        if path.startswith("/mutation-batches"):
            return {"id": "B-1", "dry_run": (json or {}).get("dry_run")}
        if self.error is not None:
            raise self.error
        return {"id": "view-9", "name": json["name"]}

    async def get(self, path, params=None):
        self.calls.append(("get", path, params))
        if path == "/bookmarks":
            return self.views
        if self.error is not None:
            raise self.error
        return self.cards

    async def patch(self, path, json=None):
        self.calls.append(("patch", path, json))
        if self.patch_error is not None:
            raise self.patch_error
        return {"id": path.rsplit("/", 1)[-1]}

    def patched(self):
        return (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=self.post)),
            patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=self.get)),
            patch.object(server.TurboEAClient, "patch", AsyncMock(side_effect=self.patch)),
        )

    async def run(self, **kwargs):
        p1, p2, p3 = self.patched()
        with p1, p2, p3:
            return _parse(await server.save_inventory_view(**kwargs))


def _http_error(status: int, detail) -> Exception:
    import httpx

    request = httpx.Request("GET", "http://backend/api/v1/cards")
    response = httpx.Response(status, json={"detail": detail}, request=request)
    return httpx.HTTPStatusError(f"{status} error", request=request, response=response)


def _http_400(detail) -> Exception:
    return _http_error(400, detail)


_VIEW_HINT = (
    "List the views with list_inventory_views; only one whose can_edit is true "
    "can be changed. Leave view_id empty to save a new view."
)


class TestSaveInventoryView:
    @pytest.mark.asyncio
    async def test_preview_runs_the_query_inside_a_dry_run_batch(self, fake_token):
        backend = _ViewBackend()
        out = await backend.run(name="Orgs", query=_VIEW_QUERY)
        assert backend.calls == [
            (
                "post",
                "/mutation-batches?row_count=1",
                {"tool_name": "save_inventory_view", "dry_run": True},
            ),
            ("get", "/cards", {"query": _VIEW_QUERY_JSON, "page_size": 5}),
            (
                "post",
                "/mutation-batches/B-1/commit",
                {"summary": {"status": "previewed", "view_id": None, "matches": 12}},
            ),
        ]
        assert not any(path.startswith("/bookmarks") for _, path, _ in backend.calls)
        assert out == {
            "dry_run": True,
            "would_create": {
                "name": "Orgs",
                "card_type": "Organization",
                "filters": {"types": ["Organization"]},
                "query": _VIEW_QUERY,
                "visibility": "private",
            },
            "matches": 12,
            "sample": ["Sales", "Ops"],
            "note": (
                "Preview built by the MCP server: the query was validated by running it "
                "(GET /cards?query=); nothing was saved. Call again with dry_run=False "
                "to save the view."
            ),
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_preview_of_an_update_says_would_update(self, fake_token):
        backend = _ViewBackend()
        out = await backend.run(name="Orgs", query=_VIEW_QUERY, view_id="v-7")
        assert "would_create" not in out
        assert out["would_update"]["name"] == "Orgs"
        # The view is checked first, then the query is run; nothing written.
        assert backend.calls[1:] == [
            ("get", "/bookmarks", None),
            ("get", "/cards", {"query": _VIEW_QUERY_JSON, "page_size": 5}),
            (
                "post",
                "/mutation-batches/B-1/commit",
                {"summary": {"status": "previewed", "view_id": "v-7", "matches": 12}},
            ),
        ]

    @pytest.mark.asyncio
    async def test_preview_accepts_a_view_the_caller_owns(self, fake_token):
        backend = _ViewBackend(views=[{"id": "v-7", "can_edit": False, "is_owner": True}])
        out = await backend.run(name="Orgs", query=_VIEW_QUERY, view_id="v-7")
        assert out["matches"] == 12

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("views", "code"),
        [
            ([{"id": "v-1", "can_edit": True}], "view_not_found"),
            ([], "view_not_found"),
            ([{"id": "v-7", "can_edit": False, "is_owner": False}], "view_not_editable"),
        ],
    )
    async def test_preview_refuses_a_view_the_caller_cannot_change(self, fake_token, views, code):
        backend = _ViewBackend(views=views)
        out = await backend.run(name="Orgs", query=_VIEW_QUERY, view_id="v-7")
        assert out == {"error": code, "hint": _VIEW_HINT, "batch_id": "B-1"}
        # The query is never run, and the batch records the refusal.
        assert backend.calls[1:] == [
            ("get", "/bookmarks", None),
            (
                "post",
                "/mutation-batches/B-1/commit",
                {"summary": {"status": "rejected", "error": code}},
            ),
        ]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("status", "code"), [(403, "view_not_editable"), (404, "view_not_found")]
    )
    async def test_commit_maps_a_refused_update(self, fake_token, status, code):
        backend = _ViewBackend(patch_error=_http_error(status, "nope"))
        out = await backend.run(name="Orgs", query=_VIEW_QUERY, view_id="v-7", dry_run=False)
        assert out == {"error": code, "hint": _VIEW_HINT, "batch_id": "B-1"}
        assert backend.calls[-1] == (
            "post",
            "/mutation-batches/B-1/commit",
            {"summary": {"status": "rejected", "error": code}},
        )

    @pytest.mark.asyncio
    async def test_commit_refused_for_visibility_names_the_argument(self, fake_token):
        backend = _ViewBackend(patch_error=_http_error(403, "Only the owner can change visibility"))
        out = await backend.run(
            name="Orgs", query=_VIEW_QUERY, view_id="v-7", visibility="public", dry_run=False
        )
        assert out == {
            "error": "visibility_not_allowed",
            "hint": server._VISIBILITY_HINT,
            "batch_id": "B-1",
        }
        assert backend.calls[-1] == (
            "post",
            "/mutation-batches/B-1/commit",
            {"summary": {"status": "rejected", "error": "visibility_not_allowed"}},
        )

    @pytest.mark.asyncio
    async def test_commit_404_with_visibility_is_still_view_not_found(self, fake_token):
        backend = _ViewBackend(patch_error=_http_error(404, "gone"))
        out = await backend.run(
            name="Orgs", query=_VIEW_QUERY, view_id="v-7", visibility="public", dry_run=False
        )
        assert out == {"error": "view_not_found", "hint": _VIEW_HINT, "batch_id": "B-1"}

    @pytest.mark.parametrize(
        ("status", "code"), [(403, "view_not_editable"), (404, "view_not_found")]
    )
    def test_view_rejection_without_visibility_names_the_view(self, status, code):
        # No ``visibility`` keyword: the default must mean "not asked for".
        assert server._view_rejection(_http_error(status, "nope")) == {
            "error": code,
            "hint": server._VIEW_HINT,
        }

    def test_view_rejection_ignores_other_statuses(self):
        assert server._view_rejection(_http_error(500, "boom")) is None

    @pytest.mark.parametrize("views", [None, {"id": "v-1"}, "v-1"])
    def test_view_problem_on_a_non_list_answer_is_view_not_found(self, views):
        # Only a list is iterated: None would raise, a dict yields its keys.
        assert server._view_problem(views, "v-1") == "view_not_found"

    @pytest.mark.asyncio
    async def test_a_refused_create_is_not_a_view_error(self, fake_token):
        import httpx

        backend = _ViewBackend(error=_http_error(403, "Forbidden"))
        with pytest.raises(httpx.HTTPStatusError):
            await backend.run(name="Orgs", query=_VIEW_QUERY, dry_run=False)

    @pytest.mark.asyncio
    async def test_commit_with_another_server_error_raises(self, fake_token):
        import httpx

        backend = _ViewBackend(patch_error=_http_error(500, "boom"))
        with pytest.raises(httpx.HTTPStatusError):
            await backend.run(name="Orgs", query=_VIEW_QUERY, view_id="v-7", dry_run=False)

    @pytest.mark.asyncio
    async def test_preview_of_a_rejected_query_returns_the_code(self, fake_token):
        backend = _ViewBackend(error=_http_400("unknown_card_type"))
        out = await backend.run(name="Orgs", query=_VIEW_QUERY)
        assert out == {
            "error": "unknown_card_type",
            "hint": "Check the keys with list_card_types and get_relation_types.",
            "batch_id": "B-1",
        }
        assert backend.calls[-1] == (
            "post",
            "/mutation-batches/B-1/commit",
            {"summary": {"status": "rejected", "error": "unknown_card_type"}},
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize("view_id", ["", "v-7"])
    async def test_saving_an_eol_view_without_the_permission_is_explained(
        self, fake_token, view_id
    ):
        """The backend refuses the save itself (``POST`` / ``PATCH
        /bookmarks``) with 403 ``eol_view_required``: answered with the same
        hint as a refused preview, not raised."""
        refusal = _http_error(403, "eol_view_required")
        backend = _ViewBackend(error=refusal, patch_error=refusal)
        out = await backend.run(name="Orgs", query=_VIEW_QUERY, view_id=view_id, dry_run=False)
        assert out == {
            "error": "eol_view_required",
            "hint": (
                "This query filters on end-of-life status (where.eol_status), which needs "
                "the EOL view permission (eol.view). Remove the eol_status condition, or "
                "ask an administrator for that permission."
            ),
            "batch_id": "B-1",
        }
        assert backend.calls[-1] == (
            "post",
            "/mutation-batches/B-1/commit",
            {"summary": {"status": "rejected", "error": "eol_view_required"}},
        )

    def test_the_eol_refusal_reads_the_same_in_the_docstring_and_the_manual(self):
        """``save_inventory_view`` and ``docs/admin/mcp.md`` state the same
        rule in the same words."""
        import pathlib
        import re

        sentence = "saving, previewing and opening a view that holds one are refused without it"
        doc = re.sub(r"\s+", " ", server.save_inventory_view.__doc__ or "")
        manual = pathlib.Path(__file__).resolve().parents[2] / "docs" / "admin" / "mcp.md"
        assert f"needs the EOL view permission: {sentence} (``eol_view_required``)" in doc
        assert f"needs the EOL view permission: {sentence} (`eol_view_required`)" in (
            manual.read_text(encoding="utf-8")
        )

    def test_matched_column_keys_are_documented_in_the_docstring_and_the_manual(self):
        """``save_inventory_view`` and ``docs/admin/mcp.md`` both explain the
        ``via:<line>:<hop path>`` column keys, say no tool reads them, and say
        a ``query`` update without ``columns`` keeps the stored keys."""
        import pathlib
        import re

        doc = re.sub(r"\s+", " ", server.save_inventory_view.__doc__ or "")
        manual = pathlib.Path(__file__).resolve().parents[2] / "docs" / "admin" / "mcp.md"
        text = manual.read_text(encoding="utf-8")
        assert "A key ``via:<line>:<hop path>`` adds a column" in doc
        assert "(``via:0:0`` the first hop's cards, ``via:0:0.1`` the second hop" in doc
        assert "Matches are shown in the web UI only; no tool reads them yet." in doc
        assert "**matched columns**, `via:<line>:<hop path>`" in text
        assert "`via:0:0` is the first hop of the first line" in text
        assert "no MCP tool reads them yet" in text
        keeps = (
            "Updating a view's {0}query{0} without sending {0}columns{0} keeps its stored "
            "{0}via:{0} keys as they are, so send {0}columns{0} when the steps change."
        )
        assert keeps.format("``") in doc
        assert keeps.format("`") in text

    @pytest.mark.asyncio
    async def test_commit_posts_the_exact_payload(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "TURBO_EA_PUBLIC_URL", "https://ea.example.com/")
        backend = _ViewBackend()
        out = await backend.run(
            name="Orgs",
            query=_VIEW_QUERY,
            visibility="public",
            columns=["name", "subtype"],
            dry_run=False,
        )
        assert backend.calls == [
            (
                "post",
                "/mutation-batches?row_count=1",
                {"tool_name": "save_inventory_view", "dry_run": False},
            ),
            (
                "post",
                "/bookmarks",
                {
                    "name": "Orgs",
                    "card_type": "Organization",
                    "filters": {"types": ["Organization"]},
                    "query": _VIEW_QUERY,
                    "visibility": "public",
                    "columns": ["name", "subtype"],
                },
            ),
            (
                "post",
                "/mutation-batches/B-1/commit",
                {"summary": {"view_id": "view-9", "updated": False}},
            ),
        ]
        assert out == {
            "view_id": "view-9",
            "batch_id": "B-1",
            "updated": False,
            "inventory_url": "https://ea.example.com/inventory?view=view-9",
        }

    @pytest.mark.asyncio
    async def test_commit_without_columns_omits_them(self, fake_token):
        backend = _ViewBackend()
        await backend.run(name="Orgs", query=_VIEW_QUERY, dry_run=False)
        body = backend.calls[1][2]
        assert "columns" not in body
        assert body["visibility"] == "private"

    @pytest.mark.asyncio
    async def test_commit_with_view_id_patches_that_view(self, fake_token):
        backend = _ViewBackend()
        out = await backend.run(name="Orgs", query=_VIEW_QUERY, view_id="v-7", dry_run=False)
        # Only name + query (and the card type they imply): no filters, so the
        # owner's stored grouping survives; no visibility, so sharing is kept.
        assert backend.calls[1] == (
            "patch",
            "/bookmarks/v-7",
            {"name": "Orgs", "card_type": "Organization", "query": _VIEW_QUERY},
        )
        assert not any(c[:2] == ("post", "/bookmarks") for c in backend.calls)
        assert out["updated"] is True
        assert out["view_id"] == "v-7"
        assert out["inventory_url"].endswith("/inventory?view=v-7")
        assert backend.calls[-1][2] == {"summary": {"view_id": "v-7", "updated": True}}

    @pytest.mark.asyncio
    async def test_update_includes_visibility_and_columns_only_when_passed(self, fake_token):
        backend = _ViewBackend()
        await backend.run(
            name="Orgs",
            query=_VIEW_QUERY,
            view_id="v-7",
            visibility="public",
            columns=["name"],
            dry_run=False,
        )
        assert backend.calls[1] == (
            "patch",
            "/bookmarks/v-7",
            {
                "name": "Orgs",
                "card_type": "Organization",
                "query": _VIEW_QUERY,
                "visibility": "public",
                "columns": ["name"],
            },
        )

    @pytest.mark.asyncio
    async def test_update_preview_shows_the_patch_body(self, fake_token):
        backend = _ViewBackend()
        out = await backend.run(name="Orgs", query=_VIEW_QUERY, view_id="v-7")
        assert out["would_update"] == {
            "name": "Orgs",
            "card_type": "Organization",
            "query": _VIEW_QUERY,
        }

    @pytest.mark.asyncio
    async def test_commit_rejected_by_the_backend_returns_the_code(self, fake_token):
        backend = _ViewBackend(error=_http_400({"code": "query_type_mismatch"}))
        out = await backend.run(name="Orgs", query=_VIEW_QUERY, dry_run=False)
        assert out["error"] == "query_type_mismatch"
        assert out["batch_id"] == "B-1"

    @pytest.mark.asyncio
    async def test_writes_disabled(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_WRITES_ENABLED", False)
        backend = _ViewBackend()
        out = await backend.run(name="Orgs", query=_VIEW_QUERY, dry_run=False)
        assert out["error"] == "writes_disabled"
        assert backend.calls == []

    @pytest.mark.asyncio
    async def test_bad_visibility_is_refused_before_any_call(self, fake_token):
        backend = _ViewBackend()
        out = await backend.run(name="Orgs", query=_VIEW_QUERY, visibility="everyone")
        assert out["error"] == "invalid_visibility"
        assert out["received"] == "everyone"
        assert backend.calls == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("query", [{}, {"type": 3}, {"related": []}])
    async def test_a_query_without_a_string_type_is_refused(self, fake_token, query):
        backend = _ViewBackend()
        out = await backend.run(name="Orgs", query=query)
        assert out["error"] == "invalid_query"
        assert backend.calls == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "query", [[], "x", {"all_of": "x"}, {"any_of": {"type": "A"}}, {"one_of": []}]
    )
    async def test_a_malformed_stack_is_refused(self, fake_token, query):
        backend = _ViewBackend()
        out = await backend.run(name="Orgs", query=query)
        assert out["error"] == "invalid_query"
        assert backend.calls == []

    @pytest.mark.asyncio
    async def test_preview_of_a_stack_needs_no_type(self, fake_token):
        backend = _ViewBackend()
        out = await backend.run(name="Mixed", query=_STACK_QUERY)
        assert backend.calls[1] == (
            "get",
            "/cards",
            {"query": json.dumps(_STACK_QUERY, separators=(",", ":")), "page_size": 5},
        )
        assert out["would_create"] == {
            "name": "Mixed",
            "query": _STACK_QUERY,
            "visibility": "private",
        }
        assert out["matches"] == 12

    @pytest.mark.asyncio
    async def test_commit_of_a_stack_sends_no_type_fields(self, fake_token):
        backend = _ViewBackend()
        await backend.run(name="Mixed", query=_STACK_QUERY, columns=["name"], dry_run=False)
        assert backend.calls[1] == (
            "post",
            "/bookmarks",
            {
                "name": "Mixed",
                "query": _STACK_QUERY,
                "visibility": "private",
                "columns": ["name"],
            },
        )

    @pytest.mark.asyncio
    async def test_update_to_an_all_of_sends_name_and_query(self, fake_token):
        backend = _ViewBackend()
        query = {"all_of": [_VIEW_QUERY, {"type": "Organization"}]}
        await backend.run(name="Orgs", query=query, view_id="v-7", dry_run=False)
        assert backend.calls[1] == ("patch", "/bookmarks/v-7", {"name": "Orgs", "query": query})

    @pytest.mark.asyncio
    async def test_a_rejected_stack_returns_the_code(self, fake_token):
        backend = _ViewBackend(error=_http_400("any_of_needs_two"))
        out = await backend.run(name="Mixed", query={"any_of": [_VIEW_QUERY]})
        assert out == {
            "error": "any_of_needs_two",
            "hint": "Check the keys with list_card_types and get_relation_types.",
            "batch_id": "B-1",
        }

    def test_requires_auth(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        out = asyncio.run(server.save_inventory_view(name="V", query={"type": "Application"}))
        assert "Not authenticated" in out
