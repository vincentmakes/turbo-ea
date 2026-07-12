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
        out = await server.update_cards_bulk(updates=[{"name": "missing card_id"}])
        data = _parse(out)
        assert data["error"] == "missing_card_id"


class TestArchiveCards:
    @pytest.mark.asyncio
    async def test_dry_run_aggregates_impacts(self, fake_token):
        post, patch_, get, calls = _route_writes_through_batch(
            get_responses={
                "/cards/c1/archive-impact": {
                    "child_count": 1,
                    "children": [{"id": "kid"}],
                },
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
    async def test_create_adr_dry_run_shows_translated_payload(self, fake_token):
        post_mock = AsyncMock()  # must not be called
        with patch.object(server.TurboEAClient, "post", post_mock):
            out = await server.create_adr(
                title="Use Postgres",
                sections=[
                    {"heading": "Context", "body": "We need a database."},
                    {"heading": "Alternatives Considered", "body": "MySQL."},
                ],
            )
        post_mock.assert_not_called()
        data = _parse(out)
        assert data["dry_run"] is True
        # The preview is the exact backend payload — sections are already
        # mapped onto the stored columns (#800).
        assert data["would_create"]["title"] == "Use Postgres"
        assert data["would_create"]["context"] == "We need a database."
        assert data["would_create"]["alternatives_considered"] == "MySQL."
        assert "sections" not in data["would_create"]

    @pytest.mark.asyncio
    async def test_create_adr_commit_sends_backend_fields(self, fake_token):
        post, patch_, get, calls = _route_writes_through_batch(
            write_responses={"/adr": {"id": "ADR-1", "title": "x"}}
        )
        with patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)):
            out = await server.create_adr(
                title="x",
                sections=[
                    {"heading": "context", "body": "ctx"},
                    {"heading": "Decision", "body": "dec"},
                ],
                linked_card_ids=["c1", "c2"],
                related_adr_ids=["ADR-000"],
                dry_run=False,
            )
        data = _parse(out)
        assert data["id"] == "ADR-1"
        assert data["batch_id"] == "B-001"
        adr_calls = [c for c in calls["post"] if c[0] == "/adr"]
        assert len(adr_calls) == 1
        body = adr_calls[0][1]
        assert body["context"] == "ctx"
        assert body["decision"] == "dec"
        assert body["linked_card_ids"] == ["c1", "c2"]
        assert body["related_decisions"] == ["ADR-000"]
        assert "sections" not in body
        assert "related_adr_ids" not in body

    @pytest.mark.asyncio
    async def test_create_adr_rejects_unknown_heading(self, fake_token):
        post_mock = AsyncMock()
        with patch.object(server.TurboEAClient, "post", post_mock):
            out = await server.create_adr(
                title="x",
                sections=[{"heading": "Rationale", "body": "b"}],
                dry_run=False,
            )
        post_mock.assert_not_called()
        data = _parse(out)
        assert data["error"] == "unknown_heading"
        assert data["heading"] == "Rationale"
        assert "Alternatives Considered" in data["supported_headings"]

    @pytest.mark.asyncio
    async def test_create_adr_rejects_workflow_status(self, fake_token):
        post_mock = AsyncMock()
        with patch.object(server.TurboEAClient, "post", post_mock):
            out = await server.create_adr(
                title="x",
                sections=[{"heading": "Context", "body": "b"}],
                status="in_review",
                dry_run=False,
            )
        post_mock.assert_not_called()
        data = _parse(out)
        assert data["error"] == "invalid_status"

    @pytest.mark.asyncio
    async def test_create_adr_concatenates_repeated_headings(self, fake_token):
        with patch.object(server.TurboEAClient, "post", AsyncMock()):
            out = await server.create_adr(
                title="x",
                sections=[
                    {"heading": "Context", "body": "First."},
                    {"heading": "context", "body": "Second."},
                ],
            )
        data = _parse(out)
        assert data["would_create"]["context"] == "First.\n\nSecond."

    @pytest.mark.asyncio
    async def test_update_adr_commit_sends_backend_fields(self, fake_token):
        post, patch_, get, calls = _route_writes_through_batch(
            patch_responses={"/adr/A-1": {"id": "A-1", "title": "x"}}
        )
        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
            patch.object(server.TurboEAClient, "patch", AsyncMock(side_effect=patch_)),
        ):
            out = await server.update_adr(
                adr_id="A-1",
                sections=[{"heading": "Consequences", "body": "cons"}],
                linked_card_ids=[],
                dry_run=False,
            )
        data = _parse(out)
        assert data["batch_id"] == "B-001"
        assert len(calls["patch"]) == 1
        body = calls["patch"][0][1]
        assert body["consequences"] == "cons"
        # Empty list means "remove all links" and must survive translation.
        assert body["linked_card_ids"] == []
        assert "sections" not in body

    @pytest.mark.asyncio
    async def test_update_adr_dry_run_shows_translated_payload(self, fake_token):
        patch_mock = AsyncMock()  # must not be called
        with patch.object(server.TurboEAClient, "patch", patch_mock):
            out = await server.update_adr(
                adr_id="A-1",
                sections=[{"heading": "alternatives_considered", "body": "alt"}],
            )
        patch_mock.assert_not_called()
        data = _parse(out)
        assert data["dry_run"] is True
        assert data["would_update"]["alternatives_considered"] == "alt"
        assert "sections" not in data["would_update"]

    @pytest.mark.asyncio
    async def test_update_adr_rejects_signed_status(self, fake_token):
        patch_mock = AsyncMock()
        with patch.object(server.TurboEAClient, "patch", patch_mock):
            out = await server.update_adr(adr_id="A-1", status="signed", dry_run=False)
        patch_mock.assert_not_called()
        data = _parse(out)
        assert data["error"] == "invalid_status"
        assert "sign_adr" in data["message"]

    @pytest.mark.asyncio
    async def test_update_adr_rejects_unknown_status(self, fake_token):
        patch_mock = AsyncMock()
        with patch.object(server.TurboEAClient, "patch", patch_mock):
            out = await server.update_adr(
                adr_id="A-1", status="accepted", dry_run=False
            )
        patch_mock.assert_not_called()
        data = _parse(out)
        assert data["error"] == "unknown_status"

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
            await server.transition_card_lifecycle(
                card_id="c1", target="approve", dry_run=False
            )
        path, body = post_mock.call_args[0][0], None
        assert "approval-status?action=approve" in path

    @pytest.mark.asyncio
    async def test_phase_target_merges_lifecycle(self, fake_token):
        # PATCH /cards/{id} replaces the whole lifecycle JSONB — the tool
        # must read-merge-write with the canonical phase→date keys, not
        # send a `{"phase": ...}` dict that wipes existing dates.
        get_mock = AsyncMock(
            return_value={
                "id": "c1",
                "lifecycle": {"plan": "2025-01-01", "active": "2025-06-01"},
            }
        )
        patch_mock = AsyncMock(return_value={"id": "c1"})
        with (
            patch.object(server.TurboEAClient, "get", get_mock),
            patch.object(server.TurboEAClient, "patch", patch_mock),
        ):
            await server.transition_card_lifecycle(
                card_id="c1",
                target="phaseOut",
                effective_date="2026-12-31",
                dry_run=False,
            )
        path = patch_mock.call_args[0][0]
        body = patch_mock.call_args[1]["json"]
        assert path == "/cards/c1"
        assert body["lifecycle"] == {
            "plan": "2025-01-01",
            "active": "2025-06-01",
            "phaseOut": "2026-12-31",
        }

    @pytest.mark.asyncio
    async def test_phase_target_defaults_effective_date_to_today(self, fake_token):
        get_mock = AsyncMock(return_value={"id": "c1", "lifecycle": {}})
        patch_mock = AsyncMock(return_value={"id": "c1"})
        with (
            patch.object(server.TurboEAClient, "get", get_mock),
            patch.object(server.TurboEAClient, "patch", patch_mock),
        ):
            await server.transition_card_lifecycle(
                card_id="c1", target="active", dry_run=False
            )
        body = patch_mock.call_args[1]["json"]
        # ISO date, not a phase marker
        assert len(body["lifecycle"]["active"]) == 10
        assert body["lifecycle"]["active"].count("-") == 2

    @pytest.mark.asyncio
    async def test_plan_is_a_valid_phase_target(self, fake_token):
        get_mock = AsyncMock(return_value={"id": "c1", "lifecycle": {}})
        patch_mock = AsyncMock(return_value={"id": "c1"})
        with (
            patch.object(server.TurboEAClient, "get", get_mock),
            patch.object(server.TurboEAClient, "patch", patch_mock),
        ):
            out = await server.transition_card_lifecycle(
                card_id="c1", target="plan", effective_date="2026-01-01", dry_run=False
            )
        data = _parse(out)
        assert "error" not in data
        assert patch_mock.call_args[1]["json"]["lifecycle"]["plan"] == "2026-01-01"

    @pytest.mark.asyncio
    async def test_phase_dry_run_shows_before_and_after(self, fake_token):
        get_mock = AsyncMock(
            return_value={"id": "c1", "lifecycle": {"plan": "2025-01-01"}}
        )
        patch_mock = AsyncMock()
        with (
            patch.object(server.TurboEAClient, "get", get_mock),
            patch.object(server.TurboEAClient, "patch", patch_mock),
        ):
            out = await server.transition_card_lifecycle(
                card_id="c1", target="active", effective_date="2026-03-01"
            )
        patch_mock.assert_not_called()
        data = _parse(out)
        assert data["dry_run"] is True
        wt = data["would_transition"]
        assert wt["lifecycle_before"] == {"plan": "2025-01-01"}
        assert wt["lifecycle_after"] == {"plan": "2025-01-01", "active": "2026-03-01"}

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
        all_node_ids = {
            n["id"] for nodes in data["nodes_by_depth"].values() for n in nodes
        }
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
        # Backend CommentCreate names the field `content` — sending `body`
        # was an unconditional 422 (#802 audit).
        assert body["content"] == "reply"
        assert "body" not in body
        assert body["parent_id"] == "cmt-0"


class TestCreateSoaw:
    SECTIONS = [
        {"heading": "Scope", "body": "Everything."},
        {"heading": "Constraints", "body": "Budget.", "insert_after": "1.1"},
    ]

    @pytest.mark.asyncio
    async def test_dry_run_shows_translated_payload(self, fake_token):
        post_mock = AsyncMock()  # must not be called
        with patch.object(server.TurboEAClient, "post", post_mock):
            out = await server.create_soaw(
                initiative_id="i1", title="SoAW for X", sections=self.SECTIONS
            )
        post_mock.assert_not_called()
        data = _parse(out)
        assert data["dry_run"] is True
        wc = data["would_create"]
        # Backend field is `name`, not `title` — sending `title` was the
        # unconditional 422 of #802.
        assert wc["name"] == "SoAW for X"
        assert "title" not in wc
        # Sections are a dict keyed by custom section id, not a list.
        assert wc["sections"] == {
            "custom_mcp_1": {
                "title": "Scope",
                "content": "Everything.",
                "hidden": False,
            },
            "custom_mcp_2": {
                "title": "Constraints",
                "content": "Budget.",
                "hidden": False,
                "insertAfter": "1.1",
            },
        }
        assert wc["initiative_id"] == "i1"
        assert wc["status"] == "draft"

    @pytest.mark.asyncio
    async def test_commit_posts_backend_fields_through_batch(self, fake_token):
        post, patch_, get, calls = _route_writes_through_batch(
            write_responses={"/soaw": {"id": "S-1", "name": "SoAW for X"}}
        )
        with patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)):
            out = await server.create_soaw(
                initiative_id="i1",
                title="SoAW for X",
                sections=self.SECTIONS,
                dry_run=False,
            )
        data = _parse(out)
        assert data["id"] == "S-1"
        assert data["batch_id"] == "B-001"
        soaw_calls = [c for c in calls["post"] if c[0] == "/soaw"]
        assert len(soaw_calls) == 1
        body = soaw_calls[0][1]
        assert body["name"] == "SoAW for X"
        assert isinstance(body["sections"], dict)
        assert "title" not in body

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", ["in_review", "approved", "signed", "accepted"])
    async def test_rejects_non_draft_status(self, fake_token, status):
        post_mock = AsyncMock()
        with patch.object(server.TurboEAClient, "post", post_mock):
            out = await server.create_soaw(
                initiative_id="i1",
                title="x",
                sections=[{"heading": "h", "body": "b"}],
                status=status,
                dry_run=False,
            )
        post_mock.assert_not_called()
        data = _parse(out)
        assert data["error"] in ("invalid_status", "unknown_status")

    @pytest.mark.asyncio
    async def test_rejects_malformed_sections(self, fake_token):
        post_mock = AsyncMock()
        with patch.object(server.TurboEAClient, "post", post_mock):
            out_no_heading = await server.create_soaw(
                initiative_id="i1", title="x", sections=[{"body": "b"}], dry_run=False
            )
            out_no_body = await server.create_soaw(
                initiative_id="i1",
                title="x",
                sections=[{"heading": "h"}],
                dry_run=False,
            )
            out_not_dict = await server.create_soaw(
                initiative_id="i1", title="x", sections=["nope"], dry_run=False
            )
        post_mock.assert_not_called()
        assert _parse(out_no_heading)["error"] == "missing_heading"
        assert _parse(out_no_body)["error"] == "missing_body"
        assert _parse(out_not_dict)["error"] == "invalid_section"


class TestUpdateDiagramDryRun:
    @pytest.mark.asyncio
    async def test_dry_run_never_patches(self, fake_token):
        # Regression: the old implementation forwarded `dry_run` in the
        # PATCH body; the backend has no such field and persisted anyway —
        # the default preview call silently overwrote the diagram.
        get_mock = AsyncMock(
            return_value={
                "id": "D1",
                "name": "Landscape",
                "description": "",
                "card_ids": ["c1"],
                "data": {"xml": "<mxGraphModel/>"},
            }
        )
        patch_mock = AsyncMock()
        post_mock = AsyncMock()
        with (
            patch.object(server.TurboEAClient, "get", get_mock),
            patch.object(server.TurboEAClient, "patch", patch_mock),
            patch.object(server.TurboEAClient, "post", post_mock),
        ):
            out = await server.update_diagram(
                diagram_id="D1",
                drawio_xml='<mxGraphModel><object cardId="11111111-2222-3333-4444-555555555555"/></mxGraphModel>',
                name="New name",
            )
        patch_mock.assert_not_called()
        post_mock.assert_not_called()  # no mutation batch opened either
        data = _parse(out)
        assert data["dry_run"] is True
        assert data["would_update"]["name"] == "New name"
        assert data["current"]["name"] == "Landscape"
        assert data["new_card_refs"] == ["11111111-2222-3333-4444-555555555555"]

    @pytest.mark.asyncio
    async def test_commit_body_has_no_dry_run_key(self, fake_token):
        post, patch_, get, calls = _route_writes_through_batch(
            patch_responses={"/diagrams/D1": {"id": "D1"}}
        )
        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
            patch.object(server.TurboEAClient, "patch", AsyncMock(side_effect=patch_)),
        ):
            out = await server.update_diagram(diagram_id="D1", name="n", dry_run=False)
        data = _parse(out)
        assert data["batch_id"] == "B-001"
        assert len(calls["patch"]) == 1
        body = calls["patch"][0][1]
        assert "dry_run" not in body
        assert body["name"] == "n"


class TestAssignStakeholders:
    @pytest.mark.asyncio
    async def test_assign_sends_json_body_not_query_string(self, fake_token):
        post, patch_, get, calls = _route_writes_through_batch(
            write_responses={"/cards/c1/stakeholders": {"id": "st-1"}}
        )
        with patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)):
            out = await server.assign_stakeholders(
                operations=[
                    {
                        "action": "assign",
                        "card_id": "c1",
                        "user_id": "u1",
                        "role": "responsible",
                    }
                ],
                dry_run=False,
            )
        data = _parse(out)
        assert data["batch_id"] == "B-001"
        st_calls = [c for c in calls["post"] if c[0].startswith("/cards/")]
        assert len(st_calls) == 1
        path, body = st_calls[0]
        assert path == "/cards/c1/stakeholders"  # no ?user_id=… query string
        assert body == {"user_id": "u1", "role": "responsible"}

    @pytest.mark.asyncio
    async def test_remove_uses_client_delete(self, fake_token):
        post, patch_, get, calls = _route_writes_through_batch()
        delete_mock = AsyncMock(return_value={})
        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
            patch.object(server.TurboEAClient, "delete", delete_mock),
        ):
            out = await server.assign_stakeholders(
                operations=[{"action": "remove", "stakeholder_id": "st-9"}],
                dry_run=False,
            )
        data = _parse(out)
        delete_mock.assert_awaited_once_with("/stakeholders/st-9")
        assert data["outcomes"][0]["result"] == {"status": "deleted"}

    @pytest.mark.asyncio
    async def test_malformed_op_rejected_in_dry_run(self, fake_token):
        post_mock = AsyncMock()
        with patch.object(server.TurboEAClient, "post", post_mock):
            out_missing = await server.assign_stakeholders(
                operations=[{"action": "assign", "card_id": "c1"}]
            )
            out_unknown = await server.assign_stakeholders(
                operations=[{"action": "promote", "card_id": "c1"}]
            )
        post_mock.assert_not_called()
        missing = _parse(out_missing)
        assert missing["error"] == "missing_fields"
        assert set(missing["missing"]) == {"user_id", "role"}
        assert _parse(out_unknown)["error"] == "unknown_action"


class TestCreateRisks:
    @pytest.mark.asyncio
    async def test_dry_run_shows_translated_payload(self, fake_token):
        post_mock = AsyncMock()
        with patch.object(server.TurboEAClient, "post", post_mock):
            out = await server.create_risks(
                risks=[
                    {
                        "title": "Key-person dependency",
                        "probability": "high",
                        "impact": "critical",
                        "linked_card_ids": ["c1"],
                    }
                ]
            )
        post_mock.assert_not_called()
        data = _parse(out)
        assert data["dry_run"] is True
        row = data["would_create"][0]
        # Aliases rewritten onto the real RiskCreate field names.
        assert row["initial_probability"] == "high"
        assert row["initial_impact"] == "critical"
        assert row["card_ids"] == ["c1"]
        assert "probability" not in row
        assert "linked_card_ids" not in row

    @pytest.mark.asyncio
    async def test_commit_single_post_with_card_ids(self, fake_token):
        post, patch_, get, calls = _route_writes_through_batch(
            write_responses={"/risks": {"id": "R-1", "reference": "R-000001"}}
        )
        with patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)):
            out = await server.create_risks(
                risks=[{"title": "t", "linked_card_ids": ["c1", "c2"]}],
                dry_run=False,
            )
        data = _parse(out)
        assert data["batch_id"] == "B-001"
        risk_calls = [c for c in calls["post"] if c[0].startswith("/risks")]
        # One POST /risks with card_ids inline — no follow-up /risks/{id}/cards.
        assert len(risk_calls) == 1
        assert risk_calls[0][0] == "/risks"
        assert risk_calls[0][1]["card_ids"] == ["c1", "c2"]

    @pytest.mark.asyncio
    async def test_numeric_probability_rejected(self, fake_token):
        post_mock = AsyncMock()
        with patch.object(server.TurboEAClient, "post", post_mock):
            out = await server.create_risks(
                risks=[{"title": "t", "probability": 3}], dry_run=False
            )
        post_mock.assert_not_called()
        data = _parse(out)
        assert data["error"] == "invalid_value"
        assert data["field"] == "initial_probability"
        assert data["allowed_values"] == ["very_high", "high", "medium", "low"]

    @pytest.mark.asyncio
    async def test_unknown_field_rejected_never_dropped(self, fake_token):
        post_mock = AsyncMock()
        with patch.object(server.TurboEAClient, "post", post_mock):
            out_status = await server.create_risks(
                risks=[{"title": "t", "status": "mitigated"}], dry_run=False
            )
            out_source = await server.create_risks(
                risks=[{"title": "t", "source_type": "manual"}], dry_run=False
            )
            out_other = await server.create_risks(
                risks=[{"title": "t", "severity": "high"}], dry_run=False
            )
        post_mock.assert_not_called()
        assert _parse(out_status)["error"] == "unknown_field"
        assert "update_risks" in _parse(out_status)["message"]
        assert _parse(out_source)["error"] == "unknown_field"
        other = _parse(out_other)
        assert other["error"] == "unknown_field"
        assert other["field"] == "severity"
        assert "title" in other["allowed_fields"]


class TestUpdateRisks:
    @pytest.mark.asyncio
    async def test_update_validates_literals_and_adds_links(self, fake_token):
        post, patch_, get, calls = _route_writes_through_batch(
            patch_responses={"/risks/R-1": {"id": "R-1"}}
        )
        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
            patch.object(server.TurboEAClient, "patch", AsyncMock(side_effect=patch_)),
        ):
            out = await server.update_risks(
                updates=[
                    {
                        "risk_id": "R-1",
                        "residual_probability": "low",
                        "status": "mitigated",
                        "linked_card_ids": ["c9"],
                    }
                ],
                dry_run=False,
            )
        data = _parse(out)
        assert data["batch_id"] == "B-001"
        body = calls["patch"][0][1]
        assert body == {"residual_probability": "low", "status": "mitigated"}
        link_calls = [c for c in calls["post"] if c[0] == "/risks/R-1/cards"]
        assert link_calls[0][1] == {"card_ids": ["c9"]}

    @pytest.mark.asyncio
    async def test_bad_status_rejected(self, fake_token):
        patch_mock = AsyncMock()
        with patch.object(server.TurboEAClient, "patch", patch_mock):
            out = await server.update_risks(
                updates=[{"risk_id": "R-1", "status": "resolved"}], dry_run=False
            )
        patch_mock.assert_not_called()
        data = _parse(out)
        assert data["error"] == "invalid_value"
        assert data["field"] == "status"

    @pytest.mark.asyncio
    async def test_missing_risk_id_rejected(self, fake_token):
        out = await server.update_risks(updates=[{"title": "t"}])
        assert _parse(out)["error"] == "missing_risk_id"


class TestSignAdrComment:
    @pytest.mark.asyncio
    async def test_commit_sends_comment_body(self, fake_token):
        post_mock = AsyncMock(return_value={"signed": True})
        with patch.object(server.TurboEAClient, "post", post_mock):
            await server.sign_adr(adr_id="A-1", comment="LGTM", dry_run=False)
        assert post_mock.call_args[1]["json"] == {"comment": "LGTM"}

    @pytest.mark.asyncio
    async def test_commit_without_comment_sends_empty_body(self, fake_token):
        post_mock = AsyncMock(return_value={"signed": True})
        with patch.object(server.TurboEAClient, "post", post_mock):
            await server.sign_adr(adr_id="A-1", dry_run=False)
        assert post_mock.call_args[1]["json"] == {}


class TestArchiveCardsValidation:
    @pytest.mark.asyncio
    async def test_invalid_child_strategy_rejected_up_front(self, fake_token):
        # The dry-run path calls a different endpoint than the commit, so
        # a bad enum used to pass preview and 422 on commit.
        post_mock = AsyncMock()
        get_mock = AsyncMock()
        with (
            patch.object(server.TurboEAClient, "post", post_mock),
            patch.object(server.TurboEAClient, "get", get_mock),
        ):
            out = await server.archive_cards(card_ids=["c1"], child_strategy="orphan")
        post_mock.assert_not_called()
        get_mock.assert_not_called()
        data = _parse(out)
        assert data["error"] == "invalid_child_strategy"
        assert data["allowed_values"] == ["cascade", "disconnect", "reparent"]

    @pytest.mark.asyncio
    async def test_dry_run_includes_would_send_payload(self, fake_token):
        post, patch_, get, calls = _route_writes_through_batch(
            get_responses={"/cards/c1/archive-impact": {"child_count": 0}}
        )
        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
            patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=get)),
        ):
            out = await server.archive_cards(
                card_ids=["c1"], reason="cleanup", child_strategy="cascade"
            )
        data = _parse(out)
        assert data["would_send"] == {
            "card_ids": ["c1"],
            "cascade_all_related": False,
            "child_strategy": "cascade",
            "reason": "cleanup",
        }
