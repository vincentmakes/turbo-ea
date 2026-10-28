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
- MCP tool annotations are set on every read and write tool.
"""

from __future__ import annotations

import base64
import json
import pathlib
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

import pytest

from turbo_ea_mcp import server
from turbo_ea_mcp.batches import BatchContext, mutation_batch


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
        open_calls: list = []
        commit_calls: list = []

        async def router(path, json=None):
            if path.startswith("/mutation-batches/") and path.endswith("/commit"):
                commit_calls.append(json)
                return {"id": "b2", "committed_at": "now"}
            if path.startswith("/mutation-batches"):
                open_calls.append(json)
                # A real batch's open response echoes the token it presented.
                return {"id": "b2", "dry_run": False, "confirm_token": "ECHOED-TOK"}
            write_calls.append((path, json))
            return {"results": [], "created": 3, "failed": 0, "dry_run": False}

        mock = AsyncMock(side_effect=router)
        with patch.object(server.TurboEAClient, "post", mock):
            out = await server.create_cards_bulk(
                cards=rows, dry_run=False, confirm_token="ECHOED-TOK"
            )
        assert len(write_calls) == 1
        # The token travels in the OPEN body — that is where the backend
        # checks it against the dry-run that issued it, before any write.
        assert open_calls == [
            {"tool_name": "create_cards_bulk", "dry_run": False, "confirm_token": "ECHOED-TOK"}
        ]
        # ...and is not repeated on the close of a real batch, nor reported
        # back as if it had been issued.
        assert "confirm_token" not in commit_calls[0]
        assert "confirm_token" not in _parse(out)


# ── The wrapper's half of the token cycle (#1302) ───────────────────────────


def _wrapper_router(open_response: object):
    calls: list[tuple[str, dict | None]] = []

    async def router(path, json=None):
        calls.append((path, json))
        if path.endswith("/commit"):
            return {"id": "b1", "committed_at": "now"}
        return open_response

    return router, calls


class TestMutationBatchWrapper:
    @pytest.mark.asyncio
    async def test_a_dry_run_is_closed_echoing_the_token_it_was_issued(self):
        router, calls = _wrapper_router({"id": "b1", "confirm_token": "TOK-ISSUED"})
        with patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=router)):
            async with mutation_batch(
                "t", tool_name="update_cards_bulk", row_count=52, dry_run=True
            ) as batch:
                assert batch.confirm_token_issued == "TOK-ISSUED"
                batch.summary = {"rows": 52}
        assert calls == [
            (
                "/mutation-batches?row_count=52",
                {"tool_name": "update_cards_bulk", "dry_run": True},
            ),
            (
                "/mutation-batches/b1/commit",
                {"summary": {"rows": 52}, "confirm_token": "TOK-ISSUED"},
            ),
        ]

    @pytest.mark.asyncio
    async def test_a_dry_run_without_a_token_closes_with_the_summary_alone(self):
        router, calls = _wrapper_router({"id": "b1", "confirm_token": None})
        with patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=router)):
            async with mutation_batch(
                "t", tool_name="create_risks", row_count=3, dry_run=True
            ) as batch:
                assert batch.confirm_token_issued is None
        assert calls[1] == ("/mutation-batches/b1/commit", {"summary": {"status": "ok"}})

    @pytest.mark.asyncio
    async def test_a_real_batch_presents_its_token_on_open_not_on_close(self):
        # The backend echoes a real batch's token in the open response; it
        # was not issued here, so it is neither reported nor repeated.
        router, calls = _wrapper_router({"id": "b1", "confirm_token": "TOK-ISSUED"})
        with patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=router)):
            async with mutation_batch(
                "t",
                tool_name="update_cards_bulk",
                row_count=52,
                dry_run=False,
                confirm_token="TOK-ISSUED",
            ) as batch:
                assert batch.confirm_token_issued is None
        assert calls[0][1] == {
            "tool_name": "update_cards_bulk",
            "dry_run": False,
            "confirm_token": "TOK-ISSUED",
        }
        assert calls[1][1] == {"summary": {"status": "ok"}}

    @pytest.mark.asyncio
    async def test_an_errored_batch_is_closed_without_a_token_and_re_raises(self):
        router, calls = _wrapper_router({"id": "b1", "confirm_token": "TOK-ISSUED"})
        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=router)),
            pytest.raises(RuntimeError, match="boom"),
        ):
            async with mutation_batch(
                "t", tool_name="create_risks", row_count=30, dry_run=True
            ):
                raise RuntimeError("boom")
        assert calls[1] == (
            "/mutation-batches/b1/commit",
            {"summary": {"status": "errored", "error": "boom"}},
        )

    @pytest.mark.asyncio
    async def test_a_non_dict_open_response_yields_no_id_and_no_token(self):
        router, _calls = _wrapper_router(["not", "a", "dict"])
        with patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=router)):
            async with mutation_batch(
                "t", tool_name="create_risks", row_count=30, dry_run=True
            ) as batch:
                assert batch.batch_id is None
                assert batch.open_response == {}
                assert batch.confirm_token_issued is None

    @pytest.mark.parametrize("value", ["", 123, None])
    def test_only_a_non_empty_string_counts_as_issued(self, value):
        ctx = BatchContext(token="t", batch_id="b", open_response={"confirm_token": value})
        assert ctx.confirm_token_issued is None

    def test_a_batch_defaults_to_dry_run_for_issued_tokens(self):
        ctx = BatchContext(token="t", batch_id="b", open_response={"confirm_token": "X"})
        assert ctx.confirm_token_issued == "X"
        real = BatchContext(
            token="t", batch_id="b", open_response={"confirm_token": "X"}, dry_run=False
        )
        assert real.confirm_token_issued is None


# ── The six tools whose preview now opens a batch (#1302) ───────────────────

_PNG_B64 = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32).decode()


def _tool_call(tool: str, n: int, **kw):
    """Call ``tool`` with ``n`` well-formed rows."""
    if tool == "upsert_relations_bulk":
        rows = [
            {"row_index": i, "type": "uses", "source": {"id": f"s{i}"}, "target": {"id": f"t{i}"}}
            for i in range(n)
        ]
        return server.upsert_relations_bulk(operations=rows, **kw)
    if tool == "assign_stakeholders":
        rows = [
            {"action": "assign", "card_id": f"c{i}", "user_id": "u1", "role": "responsible"}
            for i in range(n)
        ]
        return server.assign_stakeholders(operations=rows, **kw)
    if tool == "create_risks":
        return server.create_risks(risks=[{"title": f"r{i}"} for i in range(n)], **kw)
    if tool == "update_risks":
        rows = [{"risk_id": f"R-{i}", "title": "t"} for i in range(n)]
        return server.update_risks(updates=rows, **kw)
    if tool == "set_card_logos":
        rows = [
            {"card_id": f"c{i}", "image_base64": _PNG_B64, "mime": "image/png"}
            for i in range(n)
        ]
        return server.set_card_logos(items=rows, **kw)
    assert tool == "clear_card_logos"
    return server.clear_card_logos(card_ids=[f"c{i}" for i in range(n)], **kw)


# What each preview records on its dry-run batch for 3 rows (``_Backend``
# reports every card as carrying a logo, and relations as all-zero counts).
PREVIEW_SUMMARY = {
    "upsert_relations_bulk": {"rows": 3, "upserted": 0, "deleted": 0, "failed": 0},
    "assign_stakeholders": {"rows": 3, "status": "previewed"},
    "create_risks": {"rows": 3, "status": "previewed"},
    "update_risks": {"rows": 3, "status": "previewed"},
    "set_card_logos": {"rows": 3, "would_set": 3},
    "clear_card_logos": {"rows": 3, "would_clear": 3},
}

NEW_CYCLE_TOOLS = [
    "upsert_relations_bulk",
    "assign_stakeholders",
    "create_risks",
    "update_risks",
    "set_card_logos",
    "clear_card_logos",
]


class _Backend:
    """Records every call a tool makes. A dry-run open above the threshold
    (2 in these tests) is issued ``TOK-1``, as the backend would."""

    def __init__(self) -> None:
        self.posts: list[tuple[str, dict | None]] = []
        self.writes: list[tuple[str, str]] = []

    async def post(self, path, json=None):
        self.posts.append((path, json))
        if path.endswith("/commit"):
            return {"id": "B-1", "committed_at": "now"}
        if path.startswith("/mutation-batches"):
            rows = int(path.split("row_count=")[1])
            dry = (json or {}).get("dry_run")
            resp = {"id": "B-1", "dry_run": dry}
            if dry and rows > 2:
                resp["confirm_token"] = "TOK-1"
            return resp
        return {
            "results": [],
            "upserted": 0,
            "deleted": 0,
            "failed": 0,
            "id": "x",
            "dry_run": (json or {}).get("dry_run", False),
        }

    async def get(self, path, params=None):
        if path == "/cards":
            ids = (params or {}).get("ids", "").split(",")
            return {"items": [{"id": i, "type": "Application", "logo_updated_at": "x"} for i in ids]}
        if path == "/metamodel/types":
            return [{"key": "Application", "allow_card_logo": True}]
        return {}

    async def patch(self, path, json=None):
        self.writes.append(("patch", path))
        return {"id": path}

    async def delete(self, path):
        self.writes.append(("delete", path))
        return {}

    async def post_file(self, path, filename, content, mime, field="file"):
        self.writes.append(("post_file", path))
        return {"ok": True}

    def non_batch_posts(self) -> list[str]:
        return [p for p, _ in self.posts if not p.startswith("/mutation-batches")]

    def patched(self):
        return (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=self.post)),
            patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=self.get)),
            patch.object(server.TurboEAClient, "patch", AsyncMock(side_effect=self.patch)),
            patch.object(server.TurboEAClient, "delete", AsyncMock(side_effect=self.delete)),
            patch.object(
                server.TurboEAClient, "post_file", AsyncMock(side_effect=self.post_file)
            ),
        )


async def _run(backend: _Backend, coro_factory):
    p1, p2, p3, p4, p5 = backend.patched()
    with p1, p2, p3, p4, p5:
        return _parse(await coro_factory())


@pytest.fixture
def threshold_two(monkeypatch):
    monkeypatch.setattr(server, "MCP_BATCH_CONFIRMATION_THRESHOLD", 2)
    monkeypatch.setattr(server, "MCP_REQUIRE_DRYRUN_FIRST", True)


class TestEveryBulkToolFollowsTheCycle:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("tool", NEW_CYCLE_TOOLS)
    async def test_a_commit_above_the_threshold_without_a_token_is_refused(
        self, fake_token, threshold_two, tool
    ):
        backend = _Backend()
        data = await _run(backend, lambda: _tool_call(tool, 3, dry_run=False))
        assert data["error"] == "confirm_token_required"
        assert data["tool"] == tool
        assert data["received"] == 3
        assert backend.posts == []
        assert backend.writes == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("tool", NEW_CYCLE_TOOLS)
    async def test_a_dry_run_above_the_threshold_is_issued_a_token(
        self, fake_token, threshold_two, tool
    ):
        backend = _Backend()
        data = await _run(backend, lambda: _tool_call(tool, 3))
        assert data["dry_run"] is True
        assert data["confirm_token"] == "TOK-1"
        assert data["batch_id"] == "B-1"
        assert backend.posts[0] == (
            "/mutation-batches?row_count=3",
            {"tool_name": tool, "dry_run": True},
        )
        close_path, close_body = backend.posts[-1]
        assert close_path == "/mutation-batches/B-1/commit"
        assert close_body["confirm_token"] == "TOK-1"
        assert close_body["summary"] == PREVIEW_SUMMARY[tool]
        # A preview writes nothing: only relations ask the backend for one,
        # and that request is itself a dry run.
        assert backend.writes == []
        expected = ["/relations/bulk"] if tool == "upsert_relations_bulk" else []
        assert backend.non_batch_posts() == expected
        if expected:
            assert backend.posts[1][1]["dry_run"] is True

    @pytest.mark.asyncio
    @pytest.mark.parametrize("tool", NEW_CYCLE_TOOLS)
    async def test_a_dry_run_at_the_threshold_carries_no_token(
        self, fake_token, threshold_two, tool
    ):
        backend = _Backend()
        data = await _run(backend, lambda: _tool_call(tool, 2))
        assert "confirm_token" not in data
        assert data["batch_id"] == "B-1"
        assert backend.posts[-1][0] == "/mutation-batches/B-1/commit"
        assert "confirm_token" not in backend.posts[-1][1]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("tool", NEW_CYCLE_TOOLS)
    async def test_a_commit_with_the_token_presents_it_when_its_batch_opens(
        self, fake_token, threshold_two, tool
    ):
        backend = _Backend()
        data = await _run(
            backend, lambda: _tool_call(tool, 3, dry_run=False, confirm_token="TOK-1")
        )
        assert "error" not in data
        assert backend.posts[0] == (
            "/mutation-batches?row_count=3",
            {"tool_name": tool, "dry_run": False, "confirm_token": "TOK-1"},
        )
        assert backend.posts[-1][0] == "/mutation-batches/B-1/commit"
        assert "confirm_token" not in backend.posts[-1][1]
        assert "confirm_token" not in data
        assert backend.writes or backend.non_batch_posts()

    @pytest.mark.asyncio
    async def test_relations_run_open_write_close_with_the_batch_header(self, fake_token):
        seen: list[tuple[str, str | None]] = []

        async def router(self, path, json=None):
            seen.append((path, self._batch_id))
            if path.endswith("/commit"):
                return {"id": "B-7", "committed_at": "now"}
            if path.startswith("/mutation-batches"):
                return {"id": "B-7", "dry_run": False}
            return {"results": [], "upserted": 1, "deleted": 0, "failed": 0}

        with patch.object(server.TurboEAClient, "post", autospec=True, side_effect=router):
            out = await _tool_call("upsert_relations_bulk", 1, dry_run=False)
        assert seen == [
            ("/mutation-batches?row_count=1", None),
            ("/relations/bulk", "B-7"),
            ("/mutation-batches/B-7/commit", None),
        ]
        data = _parse(out)
        assert data["batch_id"] == "B-7"
        assert data["upserted"] == 1

    @pytest.mark.asyncio
    async def test_relations_record_their_counts_on_the_batch(self, fake_token):
        backend = _Backend()

        async def post(path, json=None):
            if path == "/relations/bulk":
                backend.posts.append((path, json))
                return {"results": [], "upserted": 4, "deleted": 1, "failed": 2}
            return await backend.post(path, json)

        with patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)):
            await _tool_call("upsert_relations_bulk", 1, dry_run=False)
        assert backend.posts[-1][1] == {
            "summary": {"rows": 1, "upserted": 4, "deleted": 1, "failed": 2}
        }

    @pytest.mark.asyncio
    async def test_clear_logos_lookup_failure_still_carries_the_token(
        self, fake_token, threshold_two
    ):
        backend = _Backend()

        async def failing_get(path, params=None):
            raise RuntimeError("backend down")

        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=backend.post)),
            patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=failing_get)),
        ):
            data = _parse(await _tool_call("clear_card_logos", 3))
        assert data["confirm_token"] == "TOK-1"
        assert data["batch_id"] == "B-1"
        assert data["would_clear"] == 3
        assert "backend down" in data["note"]
        assert backend.posts[-1][1]["summary"] == {"rows": 3, "would_clear": 3}

    @pytest.mark.asyncio
    async def test_set_logos_preview_counts_every_row_asked_for(
        self, fake_token, threshold_two
    ):
        # Two rows are dropped by the preview's type check; the batch still
        # opens with all three so the commit (which skips that check) is not
        # left without a token.
        backend = _Backend()

        async def get(path, params=None):
            if path == "/cards":
                ids = (params or {}).get("ids", "").split(",")
                return {"items": [{"id": i, "type": "Off" if i != "c0" else "On"} for i in ids]}
            return [{"key": "On", "allow_card_logo": True}, {"key": "Off"}]

        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=backend.post)),
            patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=get)),
        ):
            data = _parse(await _tool_call("set_card_logos", 3))
        assert data["would_set"] == 1
        assert data["confirm_token"] == "TOK-1"
        assert backend.posts[0][0] == "/mutation-batches?row_count=3"
        assert backend.posts[-1][1]["summary"] == {"rows": 3, "would_set": 1}


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


class TestDocumentedToolCounts:
    """`docs/admin/mcp.md` states tool counts in prose and nothing enforces
    them, so they drift. They have twice: a bump pass once left the Chinese
    page saying 47 where every other locale said 48, and the Arabic page
    spelling "seventeen" in words where no digit pattern could reach it.
    Guard the English source of truth — the translations are checked against
    it by the normal translation pass."""

    def _doc(self):
        import pytest

        doc = pathlib.Path(__file__).resolve().parents[2] / "docs" / "admin" / "mcp.md"
        if not doc.exists():
            pytest.skip("docs tree not present — mcp-server is installable on its own")
        return doc.read_text(encoding="utf-8")

    def _counts(self):
        tools = server.mcp._tool_manager._tools
        read = [n for n, t in tools.items() if t.annotations and t.annotations.readOnlyHint]
        destructive = [
            n for n, t in tools.items() if t.annotations and t.annotations.destructiveHint
        ]
        return len(tools), len(read), len(tools) - len(read), len(destructive)

    def test_the_prose_totals_match_the_registry(self):
        total, read, write, destructive = self._counts()
        doc = self._doc()
        assert f"**{total} tools**" in doc
        assert f"**{read} read tools**" in doc
        assert f"**{write} write tools**" in doc
        assert f"{destructive} destructive)" in doc

    def test_every_registered_tool_is_documented(self):
        doc = self._doc()
        missing = [name for name in server.mcp._tool_manager._tools if f"`{name}`" not in doc]
        assert not missing, f"tools missing from docs/admin/mcp.md: {missing}"



# ── The batch rule, on every write tool ─────────────────────────────────────
#
# Every write tool opens a mutation batch before its first backend write — on
# the preview as on the commit — sends every write inside it with the batch
# header, closes it last, and returns its id. Discovered from the registry's
# annotations, so a new write tool is covered (and must be given arguments
# below) without anyone remembering to add it.

_NOT_A_BATCH = {"rollback_batch": "the backend records a rollback as its own batch"}

_BATCH_TOOLS_EXPECTED = [
    "add_card_comment",
    "archive_cards",
    "assign_stakeholders",
    "clear_card_logos",
    "create_adr",
    "create_cards_bulk",
    "create_diagram",
    "create_risks",
    "create_soaw",
    "import_bpmn",
    "set_card_logos",
    "sign_adr",
    "transition_card_lifecycle",
    "update_adr",
    "update_cards_bulk",
    "update_diagram",
    "update_risks",
    "upsert_relations_bulk",
]


def _batch_write_tools() -> list[str]:
    write_annots = (server._WRITE_ADDITIVE_ANNOT, server._WRITE_DESTRUCTIVE_ANNOT)
    return sorted(
        name
        for name, tool in server.mcp._tool_manager._tools.items()
        if tool.annotations in write_annots and name not in _NOT_A_BATCH
    )


# One minimal, valid call per write tool, as ``(dry_run) -> coroutine``.
_BATCH_TOOL_CALLS = {
    **{
        tool: (lambda dry_run, tool=tool: _tool_call(tool, 1, dry_run=dry_run))
        for tool in NEW_CYCLE_TOOLS
    },
    "update_cards_bulk": lambda dry_run: server.update_cards_bulk(
        updates=[{"card_id": "c1", "name": "n"}], dry_run=dry_run
    ),
    "archive_cards": lambda dry_run: server.archive_cards(card_ids=["c1"], dry_run=dry_run),
    "create_cards_bulk": lambda dry_run: server.create_cards_bulk(
        cards=[{"row_index": 0, "type": "Application", "name": "A"}], dry_run=dry_run
    ),
    "create_diagram": lambda dry_run: server.create_diagram(
        name="D", drawio_xml="<mxGraphModel/>", dry_run=dry_run
    ),
    "update_diagram": lambda dry_run: server.update_diagram(
        diagram_id="D1", name="n", dry_run=dry_run
    ),
    "import_bpmn": lambda dry_run: server.import_bpmn(
        business_process_name="P", bpmn_xml="<bpmn:definitions/>", dry_run=dry_run
    ),
    "transition_card_lifecycle": lambda dry_run: server.transition_card_lifecycle(
        card_id="c1", target="approve", dry_run=dry_run
    ),
    "add_card_comment": lambda dry_run: server.add_card_comment(
        card_id="c1", body="hi", dry_run=dry_run
    ),
    "sign_adr": lambda dry_run: server.sign_adr(adr_id="a1", dry_run=dry_run),
    "create_adr": lambda dry_run: server.create_adr(
        title="t", sections=[{"heading": "Context", "body": "b"}], dry_run=dry_run
    ),
    "update_adr": lambda dry_run: server.update_adr(adr_id="a1", title="t", dry_run=dry_run),
    "create_soaw": lambda dry_run: server.create_soaw(
        initiative_id="i1",
        title="t",
        sections=[{"heading": "h", "body": "b"}],
        dry_run=dry_run,
    ),
}


class _BatchRecorder(_Backend):
    """``_Backend`` that also records, for every call of every method, the
    batch id of the client that made it (``autospec`` hands the client in)."""

    def __init__(self) -> None:
        super().__init__()
        self.calls: list[tuple[str, str, str | None]] = []

    async def get(self, path, params=None):
        if path == "/cards" and "search" in (params or {}):
            # import_bpmn's lookup of the BusinessProcess card by name.
            return {"items": [{"id": "bp-1", "name": params["search"], "parent_id": None}]}
        return await super().get(path, params)

    async def post_multipart(self, path, data=None, **kwargs):
        self.writes.append(("post_multipart", path))
        return {"ok": True}

    def patched(self):
        def wrap(method):
            inner = getattr(self, method)

            async def recorded(client, path, *args, **kwargs):
                self.calls.append((method, path, client._batch_id))
                return await inner(path, *args, **kwargs)

            return patch.object(
                server.TurboEAClient, method, autospec=True, side_effect=recorded
            )

        return [
            wrap(m) for m in ("post", "get", "patch", "delete", "post_file", "post_multipart")
        ]


class TestEveryWriteToolIsABatch:
    def test_the_registry_holds_the_known_batch_tools(self):
        """A new write tool fails here first: add it to the list above and
        to ``_BATCH_TOOL_CALLS``, and make it follow the rule."""
        assert _batch_write_tools() == _BATCH_TOOLS_EXPECTED

    def test_every_write_tool_has_an_argument_set(self):
        missing = [t for t in _batch_write_tools() if t not in _BATCH_TOOL_CALLS]
        assert not missing, (
            f"write tools with no argument set in _BATCH_TOOL_CALLS: {missing} — "
            "a new write tool must be added there"
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize("dry_run", [True, False], ids=["preview", "commit"])
    @pytest.mark.parametrize("tool", _batch_write_tools())
    async def test_the_call_opens_writes_in_and_closes_one_batch(
        self, fake_token, tool, dry_run
    ):
        if tool not in _BATCH_TOOL_CALLS:
            pytest.fail(f"{tool} has no argument set in _BATCH_TOOL_CALLS")
        rec = _BatchRecorder()
        with ExitStack() as stack:
            for p in rec.patched():
                stack.enter_context(p)
            data = _parse(await _BATCH_TOOL_CALLS[tool](dry_run))

        writes = [c for c in rec.calls if c[0] != "get"]
        # 1. The first write opens the batch (lookups may come before it).
        assert writes[0] == ("post", "/mutation-batches?row_count=1", None), rec.calls
        assert rec.posts[0] == (
            "/mutation-batches?row_count=1",
            {"tool_name": tool, "dry_run": dry_run},
        )
        # 3. The last call of any kind closes it.
        assert rec.calls[-1] == ("post", "/mutation-batches/B-1/commit", None), rec.calls
        assert writes[-1] == rec.calls[-1]
        # 2. Every write in between is stamped with the batch.
        inner = writes[1:-1]
        assert all(batch == "B-1" for _, _, batch in inner), inner
        if not dry_run:
            assert inner, f"{tool} committed without writing anything"
        # 4. The caller is handed the batch id.
        assert data["batch_id"] == "B-1", data
