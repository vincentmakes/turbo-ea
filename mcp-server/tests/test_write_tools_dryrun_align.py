"""Regression tests for the dry-run alignment of three single-item write tools.

``transition_card_lifecycle``, ``add_card_comment`` and ``sign_adr`` used to
write immediately with no preview. They default to ``dry_run=True`` and never
write on a preview — but, like every write tool, the preview is still a
mutation batch: a dry-run batch is opened and closed around it, so the call
lands in the audit log, and nothing else is posted.
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


def _parse(s: str) -> dict:
    return json.loads(s)


def _backend(write_response: object = None):
    """A POST router answering the batch open / close and one write; every
    call is recorded as ``(path, json)``."""
    calls: list[tuple[str, dict | None]] = []

    async def post(path, json=None):
        calls.append((path, json))
        if path == "/mutation-batches/B-1/commit":
            return {"id": "B-1", "committed_at": "now"}
        if path.startswith("/mutation-batches"):
            return {"id": "B-1", "dry_run": (json or {}).get("dry_run")}
        return write_response

    return AsyncMock(side_effect=post), calls


def _open(tool: str, dry_run: bool) -> tuple[str, dict]:
    return ("/mutation-batches?row_count=1", {"tool_name": tool, "dry_run": dry_run})


def _close(summary: dict) -> tuple[str, dict]:
    return ("/mutation-batches/B-1/commit", {"summary": summary})


class TestTransitionCardLifecycleDryRun:
    @pytest.mark.asyncio
    async def test_dry_run_default_writes_nothing_inside_a_dry_run_batch(self, fake_token):
        post, calls = _backend()
        patch_ = AsyncMock()
        with (
            patch.object(server.TurboEAClient, "post", post),
            patch.object(server.TurboEAClient, "patch", patch_),
        ):
            out = await server.transition_card_lifecycle(card_id="c1", target="approve")
        patch_.assert_not_called()
        assert calls == [
            _open("transition_card_lifecycle", True),
            _close({"card_id": "c1", "target": "approve", "status": "previewed"}),
        ]
        assert _parse(out) == {
            "dry_run": True,
            "would_transition": {
                "card_id": "c1",
                "target": "approve",
                "family": "approval",
                "effective_date": None,
            },
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_invalid_target_reported_before_any_batch(self, fake_token):
        post = AsyncMock()
        with patch.object(server.TurboEAClient, "post", post):
            out = await server.transition_card_lifecycle(
                card_id="c1", target="nonsense"
            )
        post.assert_not_called()
        assert _parse(out)["error"] == "invalid_target"

    @pytest.mark.asyncio
    async def test_commit_writes_inside_a_real_batch(self, fake_token):
        post, calls = _backend({"ok": True})
        with patch.object(server.TurboEAClient, "post", post):
            out = await server.transition_card_lifecycle(
                card_id="c1", target="approve", dry_run=False
            )
        assert calls == [
            _open("transition_card_lifecycle", False),
            ("/cards/c1/approval-status?action=approve", None),
            _close({"card_id": "c1", "target": "approve"}),
        ]
        assert _parse(out) == {"ok": True, "batch_id": "B-1"}

    @pytest.mark.asyncio
    async def test_a_denied_commit_is_pending_and_closes_its_batch(self, fake_token):
        async def post(path, json=None):
            if path.startswith("/mutation-batches"):
                return {"id": "B-1"}
            raise RuntimeError("HTTP 403 Forbidden")

        post_mock = AsyncMock(side_effect=post)
        with patch.object(server.TurboEAClient, "post", post_mock):
            out = await server.transition_card_lifecycle(
                card_id="c1", target="approve", dry_run=False
            )
        assert _parse(out) == {
            "status": "pending",
            "reason": "missing_permission",
            "deep_link": "/cards/c1?tab=approval",
            "target": "approve",
            "batch_id": "B-1",
        }
        assert post_mock.call_args_list[-1].args[0] == "/mutation-batches/B-1/commit"
        assert post_mock.call_args_list[-1].kwargs["json"] == {
            "summary": {"card_id": "c1", "target": "approve", "status": "pending"}
        }


class TestAddCardCommentDryRun:
    @pytest.mark.asyncio
    async def test_dry_run_default_posts_no_comment(self, fake_token):
        post, calls = _backend()
        with patch.object(server.TurboEAClient, "post", post):
            out = await server.add_card_comment(card_id="c1", body="hello")
        assert calls == [
            _open("add_card_comment", True),
            _close({"card_id": "c1", "status": "previewed"}),
        ]
        # The preview shows the translated backend payload — the schema
        # field is `content`, not the tool's `body` parameter (#802 audit).
        assert _parse(out) == {
            "dry_run": True,
            "would_comment": {"card_id": "c1", "content": "hello"},
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_commit_posts_comment_inside_a_real_batch(self, fake_token):
        post, calls = _backend({"id": "cm1"})
        with patch.object(server.TurboEAClient, "post", post):
            out = await server.add_card_comment(card_id="c1", body="hi", dry_run=False)
        assert calls == [
            _open("add_card_comment", False),
            ("/cards/c1/comments", {"content": "hi"}),
            _close({"card_id": "c1", "comment_id": "cm1"}),
        ]
        assert _parse(out) == {"id": "cm1", "batch_id": "B-1"}


class TestSignAdrDryRun:
    @pytest.mark.asyncio
    async def test_dry_run_default_signs_nothing(self, fake_token):
        post, calls = _backend()
        with patch.object(server.TurboEAClient, "post", post):
            out = await server.sign_adr(adr_id="a1", comment="LGTM")
        assert calls == [
            _open("sign_adr", True),
            _close({"adr_id": "a1", "status": "previewed"}),
        ]
        assert _parse(out) == {
            "dry_run": True,
            "would_sign": {"adr_id": "a1", "comment": "LGTM"},
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_commit_signs_inside_a_real_batch(self, fake_token):
        post, calls = _backend({"signed": True})
        with patch.object(server.TurboEAClient, "post", post):
            out = await server.sign_adr(adr_id="a1", dry_run=False)
        assert calls == [
            _open("sign_adr", False),
            ("/adr/a1/sign", {}),
            _close({"adr_id": "a1"}),
        ]
        assert _parse(out) == {"signed": True, "batch_id": "B-1"}
