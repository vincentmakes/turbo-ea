"""The helpers ``set_card_logos`` builds its preview and its row statuses from.

``test_write_tools_logos.py`` drives the tool end to end; these call each
helper on its own, so every status, every degrade-don't-fail branch and every
note an agent reads is pinned where it is decided.
"""

from __future__ import annotations

import hashlib

import pytest
from pydantic import ValidationError

from turbo_ea_mcp import server
from turbo_ea_mcp.logo_fetch import LogoFetchError
from turbo_ea_mcp.models import CardLogoItem

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8
HOSTS = ["cdn.example", "icons.example"]
REMEDY = (
    "This slug is not in the bundled packs, which is ordinary — they do not "
    "cover every product. Do not give up on the logo. If you can name where the "
    "mark lives, retry this row with image_url and let the server fetch it "
    "(allowed hosts: cdn.example, icons.example); if you already hold the bytes, "
    "use image_base64 (PNG, JPEG, WebP or GIF under 1 MB). Call "
    "list_available_icons first if you only mistyped the name."
)


@pytest.fixture(autouse=True)
def _hosts(monkeypatch):
    monkeypatch.setattr(server, "allowed_hosts", lambda: HOSTS)


def _error(item) -> ValidationError:
    with pytest.raises(ValidationError) as caught:
        CardLogoItem.model_validate(item)
    return caught.value


class TestSniffLogoMime:
    @pytest.mark.parametrize(
        "head, mime",
        [
            (PNG, "image/png"),
            (b"\xff\xd8\xff\xe0", "image/jpeg"),
            (b"GIF87a...", "image/gif"),
            (b"GIF89a...", "image/gif"),
            (b"RIFF\x00\x00\x00\x00WEBPVP8 ", "image/webp"),
            (b"RIFF\x00\x00\x00\x00WAVEfmt ", None),
            (b"\x89PNG\r\n\x1a", None),  # one byte short of the signature
            (b"<svg xmlns=", None),
            (b"", None),
        ],
    )
    def test_the_leading_bytes_decide(self, head, mime):
        assert server._sniff_logo_mime(head) == mime


class TestLogoValidationProblem:
    def test_a_missing_card_id(self):
        item = {"image_url": "https://x"}
        assert server._logo_validation_problem(2, item, _error(item)) == {
            "row_index": 2,
            "status": "missing_card_id",
        }

    def test_an_unsupported_mime_names_what_is_accepted(self):
        item = {"card_id": "c1", "mime": "image/svg+xml"}
        assert server._logo_validation_problem(0, item, _error(item)) == {
            "row_index": 0,
            "card_id": "c1",
            "status": "unsupported_mime",
            "mime": "image/svg+xml",
            "accepted": ["image/gif", "image/jpeg", "image/png", "image/webp"],
        }

    def test_anything_else_lists_each_field_and_message(self):
        item = {"card_id": "c1", "image_url": 3, "icon_slug": 4}
        assert server._logo_validation_problem(5, item, _error(item)) == {
            "row_index": 5,
            "card_id": "c1",
            "status": "invalid_item",
            "errors": [
                {"field": "image_url", "message": "Input should be a valid string"},
                {"field": "icon_slug", "message": "Input should be a valid string"},
            ],
        }

    def test_a_row_that_is_not_a_dict(self):
        problem = server._logo_validation_problem(1, "sap", _error("sap"))
        assert problem["row_index"] == 1
        assert problem["card_id"] is None
        assert problem["status"] == "invalid_item"
        assert [e["field"] for e in problem["errors"]] == [""]

    def test_a_nested_field_is_named_by_its_dotted_path(self):
        from pydantic import BaseModel

        class Nested(BaseModel):
            sizes: list[int]

        with pytest.raises(ValidationError) as caught:
            Nested.model_validate({"sizes": [1, "big"]})
        problem = server._logo_validation_problem(0, {"card_id": "c"}, caught.value)
        assert [e["field"] for e in problem["errors"]] == ["sizes.1"]

    def test_a_wrong_card_id_type_is_not_reported_as_missing(self):
        item = {"card_id": 5}
        assert server._logo_validation_problem(0, item, _error(item))["status"] == "invalid_item"


def _client(monkeypatch, *, cards=None, types=None, resolve=None, fail=None):
    """A stand-in TurboEAClient: ``cards`` / ``types`` answer the type check,
    ``resolve`` maps each slug the packs know to its resolved ref."""
    calls: list[tuple] = []

    class Fake:
        def __init__(self, token):
            calls.append(("token", token))

        async def get_cards_by_ids(self, ids):
            calls.append(("cards", list(ids)))
            if fail:
                raise fail
            return cards or []

        async def get(self, path, params=None):
            calls.append(("get", path, params))
            if fail:
                raise fail
            if path == "/metamodel/types":
                return types
            refs = params["refs"].split(",")
            return {"known": {r: f"pack:{r}" for r in refs if r in (resolve or {})}}

    monkeypatch.setattr(server, "TurboEAClient", Fake)
    return calls


def _row(index, card_id, **extra):
    return {"row_index": index, "card_id": card_id, "icon_slug": None, **extra}


@pytest.mark.asyncio
class TestCheckLogoTypes:
    async def test_rows_are_kept_or_named_by_their_card_type(self, monkeypatch):
        calls = _client(
            monkeypatch,
            cards=[{"id": "a", "type": "Application"}, {"id": "p", "type": "Provider"}],
            types=[
                {"key": "Application", "allow_card_logo": True},
                {"key": "Provider", "allow_card_logo": False},
                {"key": "Objective"},
            ],
        )
        prepared = [_row(0, "a"), _row(1, "p"), _row(2, "gone")]
        check, kept, disabled = await server._check_logo_types("tok", prepared)
        assert check == {"status": "ok", "checked": 3}
        assert kept == [prepared[0]]
        assert disabled == [
            {
                "row_index": 1,
                "card_id": "p",
                "status": "logos_disabled_for_type",
                "type": "Provider",
                "message": (
                    "Custom logos are not enabled for card type 'Provider'. "
                    "An administrator can enable them under Admin → Meta Model."
                ),
            },
            {
                "row_index": 2,
                "card_id": "gone",
                "status": "unknown_card_id",
                "message": "No such card, or it is not visible to you.",
            },
        ]
        assert calls == [
            ("token", "tok"),
            ("cards", ["a", "p", "gone"]),
            ("get", "/metamodel/types", None),
        ]

    async def test_an_unknown_card_does_not_stop_the_rows_after_it(self, monkeypatch):
        _client(
            monkeypatch,
            cards=[{"id": "a", "type": "Application"}],
            types=[{"key": "Application", "allow_card_logo": True}],
        )
        prepared = [_row(0, "gone"), _row(1, "a")]
        _, kept, disabled = await server._check_logo_types("tok", prepared)
        assert kept == [prepared[1]]
        assert [d["card_id"] for d in disabled] == ["gone"]

    async def test_a_type_missing_from_the_metamodel_allows_nothing(self, monkeypatch):
        _client(monkeypatch, cards=[{"id": "a", "type": "Gone"}], types={"detail": "?"})
        _, kept, disabled = await server._check_logo_types("tok", [_row(0, "a")])
        assert kept == []
        assert disabled[0]["status"] == "logos_disabled_for_type"

    async def test_an_unavailable_read_keeps_every_row(self, monkeypatch):
        _client(monkeypatch, fail=RuntimeError("403 Not enough permissions"))
        prepared = [_row(0, "a")]
        assert await server._check_logo_types("tok", prepared) == (
            {"status": "unavailable", "reason": "403 Not enough permissions"},
            prepared,
            [],
        )


@pytest.mark.asyncio
class TestCheckLogoIconSlugs:
    async def test_no_slug_means_no_request(self, monkeypatch):
        calls = _client(monkeypatch)
        prepared = [_row(0, "a")]
        assert await server._check_logo_icon_slugs("tok", prepared) == (
            {"status": "skipped"},
            prepared,
            [],
        )
        assert calls == []

    async def test_known_slugs_are_kept_and_misses_carry_the_remedy(self, monkeypatch):
        calls = _client(monkeypatch, resolve={"sap"})
        prepared = [
            _row(0, "a", icon_slug="sap"),
            _row(1, "b", icon_slug="nope"),
            _row(2, "c"),
            _row(3, "d", icon_slug="sap"),
        ]
        check, kept, unknown = await server._check_logo_icon_slugs("tok", prepared)
        assert check == {
            "status": "ok",
            "checked": 2,
            "unknown": ["nope"],
            "resolved": {"sap": "pack:sap"},
        }
        assert kept == [prepared[0], prepared[2], prepared[3]]
        assert unknown == [
            {
                "row_index": 1,
                "card_id": "b",
                "status": "unknown_icon_slug",
                "icon_slug": "nope",
                "remedy": REMEDY,
            }
        ]
        # each slug asked for once, sorted
        assert calls == [
            ("token", "tok"),
            ("get", "/card-logos/brand-icons/resolve", {"refs": "nope,sap"}),
        ]

    async def test_slugs_are_asked_for_in_chunks(self, monkeypatch):
        calls = _client(monkeypatch, resolve={"s0", "s2"})
        monkeypatch.setattr(server, "CARD_IDS_CHUNK", 2)
        prepared = [_row(i, f"c{i}", icon_slug=f"s{i}") for i in range(3)]
        check, _, unknown = await server._check_logo_icon_slugs("tok", prepared)
        assert [c[2] for c in calls if c[0] == "get"] == [{"refs": "s0,s1"}, {"refs": "s2"}]
        assert check["resolved"] == {"s0": "pack:s0", "s2": "pack:s2"}
        assert [u["icon_slug"] for u in unknown] == ["s1"]

    async def test_a_non_dict_answer_resolves_nothing(self, monkeypatch):
        class Fake:
            def __init__(self, token):
                pass

            async def get(self, path, params=None):
                return ["unexpected"]

        monkeypatch.setattr(server, "TurboEAClient", Fake)
        check, kept, unknown = await server._check_logo_icon_slugs(
            "tok", [_row(0, "a", icon_slug="sap")]
        )
        assert check["unknown"] == ["sap"]
        assert kept == []
        assert len(unknown) == 1

    async def test_an_answer_with_no_known_list_resolves_nothing(self, monkeypatch):
        class Fake:
            def __init__(self, token):
                pass

            async def get(self, path, params=None):
                return {}

        monkeypatch.setattr(server, "TurboEAClient", Fake)
        check, kept, unknown = await server._check_logo_icon_slugs(
            "tok", [_row(0, "a", icon_slug="sap")]
        )
        assert check == {"status": "ok", "checked": 1, "unknown": ["sap"], "resolved": {}}
        assert kept == []
        assert [u["icon_slug"] for u in unknown] == ["sap"]

    async def test_an_unavailable_check_keeps_every_row(self, monkeypatch):
        _client(monkeypatch, fail=RuntimeError("boom"))
        prepared = [_row(0, "a", icon_slug="sap")]
        assert await server._check_logo_icon_slugs("tok", prepared) == (
            {"status": "unavailable", "reason": "boom"},
            prepared,
            [],
        )


@pytest.mark.asyncio
class TestResolveLogoUrls:
    @staticmethod
    def _fetch(monkeypatch, answers):
        seen = []

        async def fake(url, sniff):
            seen.append((url, sniff))
            answer = answers[url]
            if isinstance(answer, Exception):
                raise answer
            return answer

        monkeypatch.setattr(server, "fetch_logo_cached", fake)
        return seen

    async def test_a_fetched_image_becomes_a_bytes_row(self, monkeypatch):
        seen = self._fetch(monkeypatch, {"https://h/a.png": (PNG, "image/png")})
        plain = _row(0, "a")
        fetched = _row(1, "b", image_url="https://h/a.png")
        kept, problems = await server._resolve_logo_urls([plain, fetched])
        assert problems == []
        assert kept == [
            plain,
            {
                **fetched,
                "raw": PNG,
                "mime": "image/png",
                "sha256": hashlib.sha256(PNG).hexdigest(),
            },
        ]
        assert seen == [("https://h/a.png", server._sniff_logo_mime)]

    async def test_a_refusal_carries_its_status_message_and_remedy(self, monkeypatch):
        self._fetch(
            monkeypatch,
            {
                "https://h/a": LogoFetchError("host_not_allowed", "Not on the list.", "Use cdn."),
                "https://h/b": LogoFetchError("not_an_image", "That was HTML."),
            },
        )
        kept, problems = await server._resolve_logo_urls(
            [_row(0, "a", image_url="https://h/a"), _row(1, "b", image_url="https://h/b")]
        )
        assert kept == []
        assert problems == [
            {
                "row_index": 0,
                "card_id": "a",
                "status": "host_not_allowed",
                "image_url": "https://h/a",
                "message": "Not on the list.",
                "remedy": "Use cdn.",
            },
            {
                "row_index": 1,
                "card_id": "b",
                "status": "not_an_image",
                "image_url": "https://h/b",
                "message": "That was HTML.",
            },
        ]

    async def test_any_other_failure_is_one_unreachable_row(self, monkeypatch):
        self._fetch(
            monkeypatch,
            {"https://h/a": OSError("reset"), "https://h/b": (PNG, "image/png")},
        )
        kept, problems = await server._resolve_logo_urls(
            [_row(0, "a", image_url="https://h/a"), _row(1, "b", image_url="https://h/b")]
        )
        assert [k["card_id"] for k in kept] == ["b"]
        assert problems == [
            {
                "row_index": 0,
                "card_id": "a",
                "status": "image_url_unreachable",
                "image_url": "https://h/a",
                "message": "reset",
            }
        ]

    async def test_an_oversized_image_does_not_stop_the_rows_after_it(self, monkeypatch):
        big = PNG + b"\x00" * (1024 * 1024)
        self._fetch(
            monkeypatch, {"https://h/big": (big, "image/png"), "https://h/ok": (PNG, "image/png")}
        )
        kept, problems = await server._resolve_logo_urls(
            [_row(0, "a", image_url="https://h/big"), _row(1, "b", image_url="https://h/ok")]
        )
        assert [k["card_id"] for k in kept] == ["b"]
        assert [p["status"] for p in problems] == ["too_large"]

    @pytest.mark.parametrize("size, too_large", [(1024 * 1024, False), (1024 * 1024 + 1, True)])
    async def test_the_size_cap_is_one_megabyte(self, monkeypatch, size, too_large):
        raw = PNG + b"\x00" * (size - len(PNG))
        self._fetch(monkeypatch, {"https://h/a": (raw, "image/png")})
        kept, problems = await server._resolve_logo_urls([_row(0, "a", image_url="https://h/a")])
        if too_large:
            assert kept == []
            assert problems == [
                {
                    "row_index": 0,
                    "card_id": "a",
                    "status": "too_large",
                    "bytes": size,
                    "cap_bytes": 1024 * 1024,
                }
            ]
        else:
            assert problems == []
            assert len(kept[0]["raw"]) == size


class TestLogoPreviewNote:
    CHECKED = (
        "Card-edit permission is enforced server-side and is not checked by this "
        "preview; it is reported per row on commit."
    )
    UNCHECKED = (
        "Card-edit permission and the per-type 'custom logos' switch could not be "
        "checked by this preview; both are reported per row on commit."
    )
    MISSES = (
        " The packs do not carry every slug in this batch (see unknown_icon_slugs). "
        "That is an ordinary gap, not a dead end: re-send those rows with image_url "
        "and let the server fetch the mark, or with image_base64 if you hold the bytes."
    )
    SLUGS_UNCHECKED = (
        " Whether each icon_slug exists could not be checked by this preview, so an "
        "unknown slug surfaces only on commit — and it is not a dead end: retry the "
        "row with image_url or image_base64."
    )

    @pytest.mark.parametrize(
        "type_check, icon_check, note",
        [
            ({"status": "ok"}, None, CHECKED),
            ({"status": "unavailable"}, None, UNCHECKED),
            ({}, None, UNCHECKED),
            ({"status": "ok"}, {"status": "skipped"}, CHECKED),
            ({"status": "ok"}, {"status": "ok", "unknown": []}, CHECKED),
            ({"status": "ok"}, {"status": "ok", "unknown": ["x"]}, CHECKED + MISSES),
            ({"status": "unavailable"}, {"status": "ok", "unknown": ["x"]}, UNCHECKED + MISSES),
            ({"status": "ok"}, {"status": "unavailable"}, CHECKED + SLUGS_UNCHECKED),
            ({"status": "ok"}, {"unknown": ["x"]}, CHECKED),
        ],
    )
    def test_the_note_says_exactly_what_was_not_settled(self, type_check, icon_check, note):
        assert server._logo_preview_note(type_check, icon_check) == note


class TestUploadErrors:
    def test_the_remedy_names_the_allowed_hosts(self):
        assert server._icon_miss_remedy() == REMEDY

    @pytest.mark.parametrize(
        "message, status, remedy",
        [
            ("HTTP 403", "forbidden", None),
            ("Not enough permissions", "forbidden", None),
            (
                "Custom logos are not enabled for card type 'Provider'",
                "logos_disabled_for_type",
                None,
            ),
            ("Unknown brand icon 'nope'", "unknown_icon_slug", REMEDY),
            ("HTTP 500", "failed", None),
        ],
    )
    def test_a_commit_failure_is_named_by_its_condition(self, message, status, remedy):
        exc = RuntimeError(message)
        assert server._classify_logo_upload_error(exc) == (status, remedy)
        expected = {"status": status, **({"remedy": remedy} if remedy else {})}
        assert server._logo_failure_fields(exc) == expected
