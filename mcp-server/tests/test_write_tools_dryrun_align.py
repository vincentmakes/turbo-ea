"""Regression tests for the dry-run alignment of three single-item write tools.

``transition_card_lifecycle``, ``add_card_comment`` and ``sign_adr`` used to
write immediately with no preview. They now default to ``dry_run=True`` and
must short-circuit before any backend call — mirroring ``create_risks`` /
``create_diagram`` — so an agent can show the user a preview first.
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


class TestTransitionCardLifecycleDryRun:
    @pytest.mark.asyncio
    async def test_dry_run_default_short_circuits(self, fake_token):
        post = AsyncMock()
        patch_ = AsyncMock()
        with (
            patch.object(server.TurboEAClient, "post", post),
            patch.object(server.TurboEAClient, "patch", patch_),
        ):
            out = await server.transition_card_lifecycle(card_id="c1", target="approve")
        post.assert_not_called()
        patch_.assert_not_called()
        data = _parse(out)
        assert data["dry_run"] is True
        assert data["would_transition"]["target"] == "approve"
        assert data["would_transition"]["family"] == "approval"

    @pytest.mark.asyncio
    async def test_invalid_target_reported_in_dry_run(self, fake_token):
        post = AsyncMock()
        with patch.object(server.TurboEAClient, "post", post):
            out = await server.transition_card_lifecycle(
                card_id="c1", target="nonsense"
            )
        post.assert_not_called()
        assert _parse(out)["error"] == "invalid_target"

    @pytest.mark.asyncio
    async def test_commit_calls_backend(self, fake_token):
        post = AsyncMock(return_value={"ok": True})
        with patch.object(server.TurboEAClient, "post", post):
            out = await server.transition_card_lifecycle(
                card_id="c1", target="approve", dry_run=False
            )
        post.assert_awaited_once()
        assert _parse(out) == {"ok": True}


class TestAddCardCommentDryRun:
    @pytest.mark.asyncio
    async def test_dry_run_default_short_circuits(self, fake_token):
        post = AsyncMock()
        with patch.object(server.TurboEAClient, "post", post):
            out = await server.add_card_comment(card_id="c1", body="hello")
        post.assert_not_called()
        data = _parse(out)
        assert data["dry_run"] is True
        # The preview shows the translated backend payload — the schema
        # field is `content`, not the tool's `body` parameter (#802 audit).
        assert data["would_comment"]["content"] == "hello"

    @pytest.mark.asyncio
    async def test_commit_posts_comment(self, fake_token):
        post = AsyncMock(return_value={"id": "cm1"})
        with patch.object(server.TurboEAClient, "post", post):
            out = await server.add_card_comment(card_id="c1", body="hi", dry_run=False)
        post.assert_awaited_once()
        assert _parse(out) == {"id": "cm1"}


class TestSignAdrDryRun:
    @pytest.mark.asyncio
    async def test_dry_run_default_short_circuits(self, fake_token):
        post = AsyncMock()
        with patch.object(server.TurboEAClient, "post", post):
            out = await server.sign_adr(adr_id="a1", comment="LGTM")
        post.assert_not_called()
        data = _parse(out)
        assert data["dry_run"] is True
        assert data["would_sign"]["adr_id"] == "a1"

    @pytest.mark.asyncio
    async def test_commit_signs(self, fake_token):
        post = AsyncMock(return_value={"signed": True})
        with patch.object(server.TurboEAClient, "post", post):
            out = await server.sign_adr(adr_id="a1", dry_run=False)
        post.assert_awaited_once()
        assert _parse(out) == {"signed": True}
