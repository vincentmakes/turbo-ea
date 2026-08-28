"""Tests for the ``set_card_logos`` bulk logo tool.

The tool validates every row locally before it opens a batch, so most of
these need no HTTP at all — which is the point: a dry-run must be able to
tell an agent that row 7 is a mislabelled SVG without a round trip.
"""

from __future__ import annotations

import base64
import json
from unittest.mock import AsyncMock, patch

import pytest

from turbo_ea_mcp import server

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
GIF = b"GIF89a" + b"\x00" * 32
WEBP = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 32
SVG = b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"


@pytest.fixture
def fake_token(monkeypatch):
    monkeypatch.setattr(server, "_stdio_token", "test-token")
    yield "test-token"


def _parse(s: str) -> dict:
    return json.loads(s)


def _row(card_id: str, content: bytes = PNG, mime: str = "image/png") -> dict:
    return {
        "card_id": card_id,
        "image_base64": base64.b64encode(content).decode(),
        "mime": mime,
    }


def _routers(*, upload_error: Exception | None = None, batch_id: str = "B-001"):
    """Route the open / upload / commit sequence, recording uploads."""
    uploads: list[tuple[str, str, bytes, str]] = []

    async def post_router(path, json=None):
        if path.startswith("/mutation-batches/") and path.endswith("/commit"):
            return {"id": batch_id, "committed_at": "now"}
        if path.startswith("/mutation-batches"):
            return {"id": batch_id, "dry_run": (json or {}).get("dry_run", False)}
        return {}

    async def post_file_router(path, filename, content, mime, field="file"):
        uploads.append((path, filename, content, mime))
        if upload_error is not None:
            raise upload_error
        return {"ok": True, "logo_updated_at": "2026-08-28T12:00:00Z"}

    return post_router, post_file_router, uploads


class TestGuardrails:
    @pytest.mark.asyncio
    async def test_kill_switch_blocks_the_tool(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_WRITES_ENABLED", False)
        out = await server.set_card_logos(items=[_row("c1")], dry_run=False)
        assert "disabled" in out.lower()

    @pytest.mark.asyncio
    async def test_rejects_a_batch_over_the_cap(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_MAX_LOGOS_PER_CALL", 2)
        out = await server.set_card_logos(
            items=[_row("c1"), _row("c2"), _row("c3")],
        )
        data = _parse(out)
        assert data["error"] == "batch_too_large"
        assert data["cap"] == 2
        assert data["received"] == 3

    @pytest.mark.asyncio
    async def test_requires_authentication(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        with patch.object(server, "_get_current_token", AsyncMock(return_value=None)):
            out = await server.set_card_logos(items=[_row("c1")])
        assert "Not authenticated" in out


class TestDryRunValidation:
    @pytest.mark.asyncio
    async def test_previews_without_uploading_anything(self, fake_token):
        post, post_file, uploads = _routers()
        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
            patch.object(server.TurboEAClient, "post_file", AsyncMock(side_effect=post_file)),
        ):
            out = await server.set_card_logos(items=[_row("c1"), _row("c2")])

        data = _parse(out)
        assert data["dry_run"] is True
        assert data["would_set"] == 2
        assert uploads == [], "a dry-run must not upload"
        # The preview says what it cannot check, so the agent does not promise
        # the user more certainty than it has.
        assert "switch" in data["note"]

    @pytest.mark.asyncio
    async def test_reports_a_mislabelled_svg_per_row(self, fake_token):
        out = await server.set_card_logos(
            items=[_row("c1"), _row("c2", SVG, "image/png")],
        )
        data = _parse(out)
        assert data["would_set"] == 1
        bad = next(r for r in data["results"] if r["card_id"] == "c2")
        assert bad["status"] == "content_mime_mismatch"
        assert bad["detected"] is None

    @pytest.mark.asyncio
    async def test_refuses_svg_outright(self, fake_token):
        out = await server.set_card_logos(
            items=[_row("c1", SVG, "image/svg+xml")],
        )
        data = _parse(out)
        assert data["would_set"] == 0
        assert data["results"][0]["status"] == "unsupported_mime"

    @pytest.mark.asyncio
    async def test_reports_invalid_base64(self, fake_token):
        out = await server.set_card_logos(
            items=[{"card_id": "c1", "image_base64": "not base64!!", "mime": "image/png"}],
        )
        assert _parse(out)["results"][0]["status"] == "invalid_base64"

    @pytest.mark.asyncio
    async def test_reports_an_oversize_image(self, fake_token):
        big = PNG + b"\x00" * (1 * 1024 * 1024)
        out = await server.set_card_logos(items=[_row("c1", big)])
        row = _parse(out)["results"][0]
        assert row["status"] == "too_large"
        assert row["bytes"] > row["cap_bytes"]

    @pytest.mark.asyncio
    async def test_reports_a_missing_card_id(self, fake_token):
        out = await server.set_card_logos(
            items=[{"image_base64": base64.b64encode(PNG).decode(), "mime": "image/png"}],
        )
        assert _parse(out)["results"][0]["status"] == "missing_card_id"

    @pytest.mark.parametrize(
        "content,mime",
        [(PNG, "image/png"), (JPEG, "image/jpeg"), (GIF, "image/gif"), (WEBP, "image/webp")],
    )
    @pytest.mark.asyncio
    async def test_accepts_every_supported_format(self, fake_token, content, mime):
        out = await server.set_card_logos(items=[_row("c1", content, mime)])
        assert _parse(out)["would_set"] == 1


class TestCommit:
    @pytest.mark.asyncio
    async def test_uploads_each_row_inside_one_batch(self, fake_token):
        post, post_file, uploads = _routers()
        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
            patch.object(server.TurboEAClient, "post_file", AsyncMock(side_effect=post_file)),
        ):
            out = await server.set_card_logos(
                items=[_row("c1"), _row("c2", JPEG, "image/jpeg")],
                dry_run=False,
            )

        data = _parse(out)
        assert data["set"] == 2
        assert data["batch_id"] == "B-001"
        assert [u[0] for u in uploads] == ["/cards/c1/logo", "/cards/c2/logo"]
        assert uploads[1][3] == "image/jpeg"

    @pytest.mark.asyncio
    async def test_one_rejected_row_does_not_abandon_the_rest(self, fake_token):
        """A card whose type has logos switched off 400s — the others still land."""
        calls: list[str] = []

        async def post_router(path, json=None):
            if path.startswith("/mutation-batches/") and path.endswith("/commit"):
                return {"id": "B-001", "committed_at": "now"}
            if path.startswith("/mutation-batches"):
                return {"id": "B-001"}
            return {}

        async def post_file_router(path, filename, content, mime, field="file"):
            calls.append(path)
            if path == "/cards/c2/logo":
                raise RuntimeError("400: Custom logos are not enabled for card type")
            return {"ok": True, "logo_updated_at": "2026-08-28T12:00:00Z"}

        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post_router)),
            patch.object(
                server.TurboEAClient, "post_file", AsyncMock(side_effect=post_file_router)
            ),
        ):
            out = await server.set_card_logos(
                items=[_row("c1"), _row("c2"), _row("c3")], dry_run=False
            )

        data = _parse(out)
        assert data["set"] == 2
        assert len(calls) == 3, "a rejected row must not stop the loop"
        failed = next(r for r in data["results"] if r["card_id"] == "c2")
        assert failed["status"] == "failed"
        assert "not enabled" in failed["error"]

    @pytest.mark.asyncio
    async def test_commit_with_no_valid_rows_opens_no_batch(self, fake_token):
        post, post_file, uploads = _routers()
        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
            patch.object(server.TurboEAClient, "post_file", AsyncMock(side_effect=post_file)),
        ):
            out = await server.set_card_logos(
                items=[_row("c1", SVG, "image/svg+xml")], dry_run=False
            )

        data = _parse(out)
        assert data["set"] == 0
        assert uploads == []


class TestAnnotations:
    def test_is_annotated_as_an_additive_write(self):
        """Not destructive: it adds or replaces, and exposes no delete."""
        annot = server._WRITE_ADDITIVE_ANNOT
        assert annot.readOnlyHint is False
        assert annot.destructiveHint is False
