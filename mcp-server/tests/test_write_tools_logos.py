"""Tests for the ``set_card_logos`` bulk logo tool.

The tool validates every row locally before it opens a batch, so most of
these need no HTTP at all — which is the point: a dry-run must be able to
tell an agent that row 7 is a mislabelled SVG without a round trip.
"""

from __future__ import annotations

import base64
import hashlib
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
        """SVG bytes carry no recognised signature, so the format cannot be
        determined at all — `missing_mime` names that, where the old
        `content_mime_mismatch` pointed at the label instead."""
        out = await server.set_card_logos(
            items=[_row("c1"), _row("c2", SVG, "image/png")],
        )
        data = _parse(out)
        assert data["would_set"] == 1
        bad = next(r for r in data["results"] if r["card_id"] == "c2")
        assert bad["status"] == "missing_mime"
        assert bad["declared"] == "image/png"

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
        # Classified rather than lumped into "failed" — the status names the
        # condition the caller has to change. The raw error is kept either way.
        assert failed["status"] == "logos_disabled_for_type"
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


class TestSchema:
    """The failure that started this: the tool advertised
    `additionalProperties: true` and said nothing about required fields, so a
    caller could omit `mime` twice without anything catching it."""

    def _item_schema(self) -> dict:
        params = server.mcp._tool_manager._tools["set_card_logos"].parameters
        return params["$defs"]["CardLogoItem"]

    def test_card_id_is_the_only_required_field(self):
        assert self._item_schema()["required"] == ["card_id"]

    def test_items_is_a_typed_array_not_an_opaque_object(self):
        params = server.mcp._tool_manager._tools["set_card_logos"].parameters
        assert params["properties"]["items"]["items"]["$ref"].endswith("CardLogoItem")

    def test_mime_is_optional_and_enumerated(self):
        mime = self._item_schema()["properties"]["mime"]
        # Tolerate either a flat enum or the anyOf a `Literal | None` yields,
        # so a pydantic minor cannot break this.
        enum = mime.get("enum") or next(
            b["enum"] for b in mime.get("anyOf", []) if "enum" in b
        )
        assert set(enum) >= {"image/png", "image/jpeg", "image/webp", "image/gif"}
        assert "image/svg+xml" not in enum
        assert mime.get("default", "absent") is None

    def test_the_image_sources_are_advertised(self):
        props = self._item_schema()["properties"]
        assert "image_base64" in props
        assert "icon_slug" in props


class TestOptionalMime:
    @pytest.mark.asyncio
    async def test_omitting_mime_succeeds_and_reports_the_sniffed_value(self, fake_token):
        """The most common caller error becomes a non-event."""
        out = await server.set_card_logos(
            items=[{"card_id": "c1", "image_base64": base64.b64encode(PNG).decode()}],
        )
        data = _parse(out)
        assert data["would_set"] == 1
        assert data["results"][0]["mime"] == "image/png"

    @pytest.mark.asyncio
    async def test_a_declared_mime_that_disagrees_names_both(self, fake_token):
        out = await server.set_card_logos(items=[_row("c1", JPEG, "image/png")])
        row = _parse(out)["results"][0]
        assert row["status"] == "mime_mismatch"
        assert row["declared"] == "image/png"
        assert row["detected"] == "image/jpeg"

    @pytest.mark.asyncio
    async def test_unrecognisable_bytes_name_the_field(self, fake_token):
        out = await server.set_card_logos(
            items=[{"card_id": "c1", "image_base64": base64.b64encode(b"not an image").decode()}],
        )
        row = _parse(out)["results"][0]
        assert row["status"] == "missing_mime"
        assert "signature" in row["message"]


class TestDigest:
    @pytest.mark.asyncio
    async def test_dry_run_echoes_a_sha256_of_the_decoded_bytes(self, fake_token):
        out = await server.set_card_logos(items=[_row("c1")])
        row = _parse(out)["results"][0]
        assert row["sha256_received"] == hashlib.sha256(PNG).hexdigest()
        assert row["bytes_received"] == len(PNG)


class TestImageSource:
    @pytest.mark.asyncio
    async def test_neither_source_is_named_as_such(self, fake_token):
        out = await server.set_card_logos(items=[{"card_id": "c1"}])
        assert _parse(out)["results"][0]["status"] == "missing_image_source"

    @pytest.mark.asyncio
    async def test_both_sources_is_named_as_such(self, fake_token):
        out = await server.set_card_logos(
            items=[{**_row("c1"), "icon_slug": "sap"}],
        )
        assert _parse(out)["results"][0]["status"] == "conflicting_image_source"

    @pytest.mark.asyncio
    async def test_an_extra_key_does_not_fail_the_row(self, fake_token):
        out = await server.set_card_logos(items=[{**_row("c1"), "note": "hi"}])
        assert _parse(out)["would_set"] == 1

    @pytest.mark.asyncio
    async def test_a_dict_and_a_model_produce_the_same_result(self, fake_token):
        """The coercion shim: FastMCP passes models, in-process callers dicts."""
        from turbo_ea_mcp.models import CardLogoItem

        as_dict = await server.set_card_logos(items=[_row("c1")])
        as_model = await server.set_card_logos(items=[CardLogoItem(**_row("c1"))])
        assert _parse(as_dict) == _parse(as_model)

    @pytest.mark.asyncio
    async def test_an_icon_slug_row_needs_no_bytes(self, fake_token):
        out = await server.set_card_logos(items=[{"card_id": "c1", "icon_slug": "sap"}])
        data = _parse(out)
        assert data["would_set"] == 1
        row = data["results"][0]
        assert row["icon_slug"] == "sap"
        assert row["bytes_received"] is None


class TestDryRunTypeCheck:
    def _routers(self, *, allow: bool):
        async def get_router(path, params=None):
            if path == "/cards":
                return {"items": [{"id": "c1", "type": "Application"}]}
            if path == "/metamodel/types":
                return [{"key": "Application", "allow_card_logo": allow}]
            return {}

        return get_router

    @pytest.mark.asyncio
    async def test_a_logos_disabled_type_fails_in_the_preview(self, fake_token):
        post, post_file, uploads = _routers()
        with (
            patch.object(
                server.TurboEAClient, "get", AsyncMock(side_effect=self._routers(allow=False))
            ),
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
            patch.object(server.TurboEAClient, "post_file", AsyncMock(side_effect=post_file)),
        ):
            out = await server.set_card_logos(items=[_row("c1")])

        data = _parse(out)
        assert data["would_set"] == 0
        row = data["results"][0]
        assert row["status"] == "logos_disabled_for_type"
        assert row["type"] == "Application"
        assert uploads == [], "a preview must never upload"

    @pytest.mark.asyncio
    async def test_an_enabled_type_previews_normally(self, fake_token):
        with patch.object(
            server.TurboEAClient, "get", AsyncMock(side_effect=self._routers(allow=True))
        ):
            out = await server.set_card_logos(items=[_row("c1")])
        data = _parse(out)
        assert data["would_set"] == 1
        assert data["type_check"]["status"] == "ok"
        assert "permission" in data["note"]

    @pytest.mark.asyncio
    async def test_the_check_degrades_rather_than_failing(self, fake_token):
        """A caller without inventory.view still gets a usable preview."""

        async def boom(path, params=None):
            raise RuntimeError("403 Forbidden")

        with patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=boom)):
            out = await server.set_card_logos(items=[_row("c1")])
        data = _parse(out)
        assert data["would_set"] == 1
        assert data["type_check"]["status"] == "unavailable"
        assert "switch" in data["note"]


class TestClearCardLogos:
    @pytest.mark.asyncio
    async def test_is_annotated_destructive(self):
        annot = server.mcp._tool_manager._tools["clear_card_logos"].annotations
        assert annot.destructiveHint is True

    @pytest.mark.asyncio
    async def test_kill_switch_applies(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_WRITES_ENABLED", False)
        out = await server.clear_card_logos(card_ids=["c1"], dry_run=False)
        assert "disabled" in out.lower()

    @pytest.mark.asyncio
    async def test_dry_run_reports_which_cards_actually_carry_one(self, fake_token):
        async def get_router(path, params=None):
            return {
                "items": [
                    {"id": "c1", "logo_updated_at": "2026-08-28T10:00:00Z"},
                    {"id": "c2", "logo_updated_at": None},
                ]
            }

        deletes: list[str] = []

        async def delete_router(path):
            deletes.append(path)
            return {}

        with (
            patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=get_router)),
            patch.object(server.TurboEAClient, "delete", AsyncMock(side_effect=delete_router)),
        ):
            out = await server.clear_card_logos(card_ids=["c1", "c2"])

        data = _parse(out)
        assert data["would_clear"] == 1
        assert deletes == []
        assert {r["card_id"]: r["status"] for r in data["results"]} == {
            "c1": "would_clear",
            "c2": "no_logo",
        }

    @pytest.mark.asyncio
    async def test_one_failing_row_does_not_abandon_the_rest(self, fake_token):
        async def post_router(path, json=None):
            if path.startswith("/mutation-batches/") and path.endswith("/commit"):
                return {"id": "B-001", "committed_at": "now"}
            if path.startswith("/mutation-batches"):
                return {"id": "B-001"}
            return {}

        seen: list[str] = []

        async def delete_router(path):
            seen.append(path)
            if "c2" in path:
                raise RuntimeError("403 Not enough permissions")
            return {}

        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post_router)),
            patch.object(server.TurboEAClient, "delete", AsyncMock(side_effect=delete_router)),
        ):
            out = await server.clear_card_logos(
                card_ids=["c1", "c2", "c3"], dry_run=False, confirm_token="t"
            )

        data = _parse(out)
        assert data["cleared"] == 2
        assert len(seen) == 3
        failed = next(r for r in data["results"] if r["card_id"] == "c2")
        assert failed["status"] == "forbidden"


class TestGetCardLogo:
    @pytest.mark.asyncio
    async def test_is_annotated_read_only(self):
        annot = server.mcp._tool_manager._tools["get_card_logo"].annotations
        assert annot.readOnlyHint is True

    @pytest.mark.asyncio
    async def test_reads_the_card_first_so_rbac_applies(self, fake_token):
        """The raw image route is unauthenticated by design, so this tool must
        not be the one that reaches it without a permission check."""
        seen: list[str] = []

        async def get_router(path, params=None):
            seen.append(path)
            return {"id": "c1", "logo_updated_at": "2026-08-28T10:00:00Z"}

        async def bytes_router(path, params=None):
            seen.append(path)
            return PNG, "image/png"

        with (
            patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=get_router)),
            patch.object(server.TurboEAClient, "get_bytes", AsyncMock(side_effect=bytes_router)),
        ):
            out = await server.get_card_logo(card_id="c1")

        assert seen[0] == "/cards/c1"
        data = _parse(out)
        assert data["sha256"] == hashlib.sha256(PNG).hexdigest()
        assert "image_base64" not in data

    @pytest.mark.asyncio
    async def test_include_image_round_trips_the_bytes(self, fake_token):
        with (
            patch.object(
                server.TurboEAClient,
                "get",
                AsyncMock(return_value={"logo_updated_at": "2026-08-28T10:00:00Z"}),
            ),
            patch.object(
                server.TurboEAClient, "get_bytes", AsyncMock(return_value=(PNG, "image/png"))
            ),
        ):
            out = await server.get_card_logo(card_id="c1", include_image=True)
        assert base64.b64decode(_parse(out)["image_base64"]) == PNG

    @pytest.mark.asyncio
    async def test_a_card_with_no_logo_says_so(self, fake_token):
        with patch.object(
            server.TurboEAClient, "get", AsyncMock(return_value={"logo_updated_at": None})
        ):
            out = await server.get_card_logo(card_id="c1")
        assert _parse(out)["status"] == "no_logo"



class TestUnknownIconSlugIsActionable:
    """A slug the pack lacks must send the agent to fetch it, not stop it.

    The pack covers a few thousand well-known brands, not every product a
    customer runs, so a miss is an ordinary outcome. The server deliberately
    never fetches on the caller's behalf — that would be an outbound request
    from inside the customer's network, chosen by an LLM, and it would break
    every air-gapped install — so the remedy has to be handed back explicitly.
    """

    @staticmethod
    def _commit(error: Exception):
        async def post_router(path, json=None):
            if path.startswith("/mutation-batches/") and path.endswith("/commit"):
                return {"id": "B-001", "committed_at": "now"}
            if path.startswith("/mutation-batches"):
                return {"id": "B-001"}
            return {}

        async def multipart_router(path, *, data=None, file=None, field="file"):
            raise error

        return post_router, multipart_router

    async def _run_icon_row(self, error: Exception) -> dict:
        post, multipart = self._commit(error)
        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
            patch.object(
                server.TurboEAClient, "post_multipart", AsyncMock(side_effect=multipart)
            ),
        ):
            out = await server.set_card_logos(
                items=[{"card_id": "c1", "icon_slug": "acme-corp"}],
                dry_run=False,
            )
        return _parse(out)["results"][0]

    @pytest.mark.asyncio
    async def test_commit_reports_the_status_and_the_remedy(self, fake_token):
        row = await self._run_icon_row(RuntimeError("400: Unknown brand icon 'acme-corp'."))
        assert row["status"] == "unknown_icon_slug"
        # The next step, spelled out: the agent has web access, the server does not.
        assert "image_base64" in row["remedy"]
        assert "fetch" in row["remedy"].lower()
        # The raw error is preserved alongside it.
        assert "acme-corp" in row["error"]

    @pytest.mark.asyncio
    async def test_other_failures_carry_no_remedy(self, fake_token):
        # A remedy is only set where the next step is not obvious from the
        # status — otherwise it is noise on every row.
        row = await self._run_icon_row(RuntimeError("403: Not enough permissions"))
        assert row["status"] == "forbidden"
        assert "remedy" not in row

    @pytest.mark.asyncio
    async def test_the_preview_says_a_slug_miss_is_recoverable(self, fake_token):
        async def unreachable(path, params=None):
            raise RuntimeError("connection refused")

        with patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=unreachable)):
            out = _parse(
                await server.set_card_logos(items=[{"card_id": "c1", "icon_slug": "sap"}])
            )
        assert "image_base64" in out["note"]

    @pytest.mark.asyncio
    async def test_a_bytes_only_batch_is_not_told_about_slugs(self, fake_token):
        # The note describes what this preview could not settle. A batch with
        # no icon_slug row has no slug to miss, so the sentence would be noise.
        async def unreachable(path, params=None):
            raise RuntimeError("connection refused")

        with patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=unreachable)):
            out = _parse(await server.set_card_logos(items=[_row("c1")]))
        assert "image_base64" not in out["note"]
        assert "icon_slug" not in out["note"]


class TestDryRunIconSlugCheck:
    """The preview settles which slugs the packs carry.

    The point is not validation for its own sake: a miss reported at preview
    time is a gap the agent can still go and fill from the web before anything
    is written, which is the whole difference between "logo set" and "could not
    set a logo, the pack didn't have it".
    """

    def _get(self, *, known: dict, cards_allow: bool = True):
        async def get_router(path, params=None):
            if path == "/cards":
                return {
                    "items": [
                        {"id": "c1", "type": "Application"},
                        {"id": "c2", "type": "Application"},
                    ]
                }
            if path == "/metamodel/types":
                return [{"key": "Application", "allow_card_logo": cards_allow}]
            if path == "/card-logos/brand-icons/resolve":
                asked = (params or {}).get("refs", "").split(",")
                return {
                    "known": {k: v for k, v in known.items() if k in asked},
                    "unknown": [a for a in asked if a and a not in known],
                }
            return {}

        return get_router

    @pytest.mark.asyncio
    async def test_an_unknown_slug_is_reported_before_anything_is_written(self, fake_token):
        post_file = AsyncMock()
        with (
            patch.object(
                server.TurboEAClient,
                "get",
                AsyncMock(side_effect=self._get(known={"sap": "logos:sap"})),
            ),
            patch.object(server.TurboEAClient, "post_file", post_file),
        ):
            out = _parse(
                await server.set_card_logos(
                    items=[
                        {"card_id": "c1", "icon_slug": "sap"},
                        {"card_id": "c2", "icon_slug": "acme-corp"},
                    ]
                )
            )

        assert out["would_set"] == 1
        assert out["unknown_icon_slugs"] == ["acme-corp"]
        miss = next(r for r in out["results"] if r.get("status") == "unknown_icon_slug")
        assert miss["card_id"] == "c2"
        # The remedy is the same one the commit path gives, so the agent reads
        # the same instruction whichever side it hits.
        assert "image_base64" in miss["remedy"]
        assert "fetch" in miss["remedy"].lower()
        # And it says so without touching the network beyond the two reads.
        post_file.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_the_note_tells_the_agent_to_go_and_fetch_them(self, fake_token):
        with patch.object(
            server.TurboEAClient, "get", AsyncMock(side_effect=self._get(known={}))
        ):
            out = _parse(
                await server.set_card_logos(items=[{"card_id": "c1", "icon_slug": "acme"}])
            )
        assert "fetch" in out["note"].lower()
        assert "image_base64" in out["note"]

    @pytest.mark.asyncio
    async def test_known_slugs_leave_the_preview_clean(self, fake_token):
        with patch.object(
            server.TurboEAClient,
            "get",
            AsyncMock(side_effect=self._get(known={"sap": "logos:sap"})),
        ):
            out = _parse(
                await server.set_card_logos(items=[{"card_id": "c1", "icon_slug": "sap"}])
            )
        assert out["would_set"] == 1
        assert out["unknown_icon_slugs"] == []
        assert out["icon_check"]["resolved"] == {"sap": "logos:sap"}
        assert "unknown_icon_slugs" not in out["note"]

    @pytest.mark.asyncio
    async def test_a_bytes_row_never_asks_the_pack_anything(self, fake_token):
        seen: list[str] = []

        async def get_router(path, params=None):
            seen.append(path)
            if path == "/cards":
                return {"items": [{"id": "c1", "type": "Application"}]}
            if path == "/metamodel/types":
                return [{"key": "Application", "allow_card_logo": True}]
            return {}

        with patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=get_router)):
            out = _parse(await server.set_card_logos(items=[_row("c1")]))
        assert "/card-logos/brand-icons/resolve" not in seen
        assert out["icon_check"]["status"] == "skipped"

    @pytest.mark.asyncio
    async def test_the_check_degrades_rather_than_failing(self, fake_token):
        """An older backend, or a caller without inventory.view, still previews."""

        async def get_router(path, params=None):
            if path == "/cards":
                return {"items": [{"id": "c1", "type": "Application"}]}
            if path == "/metamodel/types":
                return [{"key": "Application", "allow_card_logo": True}]
            raise RuntimeError("404: Not Found")

        with patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=get_router)):
            out = _parse(
                await server.set_card_logos(items=[{"card_id": "c1", "icon_slug": "sap"}])
            )
        assert out["would_set"] == 1
        assert out["icon_check"]["status"] == "unavailable"
        assert "image_base64" in out["note"]

    @pytest.mark.asyncio
    async def test_a_slug_that_is_not_a_ref_at_all_lands_on_the_unknown_side(
        self, fake_token
    ):
        """Membership is read off `known`, not off `unknown`.

        The request joins refs with a comma, so a value carrying one would be
        split apart server-side and could never come back verbatim in
        `unknown`. Reading the positive side keeps it unknown regardless.
        """

        async def get_router(path, params=None):
            if path == "/cards":
                return {"items": [{"id": "c1", "type": "Application"}]}
            if path == "/metamodel/types":
                return [{"key": "Application", "allow_card_logo": True}]
            return {"known": {}, "unknown": ["sap", "oracle"]}

        with patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=get_router)):
            out = _parse(
                await server.set_card_logos(items=[{"card_id": "c1", "icon_slug": "sap,oracle"}])
            )
        assert out["would_set"] == 0
        assert out["results"][0]["status"] == "unknown_icon_slug"
