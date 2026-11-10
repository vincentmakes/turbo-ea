"""The decision register in the MCP tools: standing and revision filters on
the list tools, typed links / people / dates on ``create_adr`` and
``update_adr``, the edit lock answered by ``update_adr`` and the new
``revise_adr`` write tool (preview read from the decision, commit through a
mutation batch, every refusal of ``POST /adr/{id}/revise`` mapped)."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from turbo_ea_mcp import server

ADR_ID = "11111111-1111-1111-1111-111111111111"
REV2_ID = "22222222-2222-2222-2222-222222222222"
REV3_ID = "33333333-3333-3333-3333-333333333333"


@pytest.fixture
def fake_token(monkeypatch):
    monkeypatch.setattr(server, "_stdio_token", "test-token")
    yield "test-token"


def _parse(s: str):
    return json.loads(s)


def _http_error(status: int, detail: object) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "http://backend/api/v1/adr")
    response = httpx.Response(status, json={"detail": detail}, request=request)
    return httpx.HTTPStatusError(f"{status} error", request=request, response=response)


def _backend(*, write=None, raises: Exception | None = None, get=None):
    """POST / PATCH / GET mocks answering the batch open / close; the one
    write answers ``write`` or raises ``raises``. Calls are recorded."""
    calls: dict[str, list] = {"post": [], "patch": [], "get": []}

    async def post(path, json=None):
        calls["post"].append((path, json))
        if path == "/mutation-batches/B-1/commit":
            return {"id": "B-1", "committed_at": "now"}
        if path.startswith("/mutation-batches"):
            return {"id": "B-1", "dry_run": (json or {}).get("dry_run")}
        if raises is not None:
            raise raises
        return write

    async def patch_(path, json=None):
        calls["patch"].append((path, json))
        if raises is not None:
            raise raises
        return write

    async def get_(path, params=None):
        calls["get"].append((path, params))
        return get

    mocks = (
        patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
        patch.object(server.TurboEAClient, "patch", AsyncMock(side_effect=patch_)),
        patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=get_)),
    )
    return mocks, calls


def _open(tool: str, dry_run: bool) -> tuple[str, dict]:
    return ("/mutation-batches?row_count=1", {"tool_name": tool, "dry_run": dry_run})


def _close(summary: dict) -> tuple[str, dict]:
    return ("/mutation-batches/B-1/commit", {"summary": summary})


# ── list tools ──────────────────────────────────────────────────────────────


class TestListAdrs:
    @pytest.mark.asyncio
    async def test_hides_earlier_revisions_by_default(self, fake_token):
        mocks, calls = _backend(get=[])
        with mocks[2]:
            await server.list_adrs()
        assert calls["get"] == [("/adr", {"include_earlier": "false"})]

    @pytest.mark.asyncio
    async def test_passes_standing_and_include_earlier(self, fake_token):
        mocks, calls = _backend(get=[{"id": "a"}])
        with mocks[2]:
            out = await server.list_adrs(
                card_id="c-1", standing=" in_force , amended,", include_earlier=True
            )
        assert calls["get"] == [
            (
                "/adr",
                {"card_id": "c-1", "standing": "in_force,amended", "include_earlier": "true"},
            )
        ]
        assert _parse(out) == [{"id": "a"}]

    @pytest.mark.asyncio
    async def test_unknown_standing_is_refused_before_any_request(self, fake_token):
        mocks, calls = _backend(get=[])
        with mocks[2]:
            out = await server.list_adrs(standing="in_force,retired")
        assert calls["get"] == []
        assert _parse(out) == {
            "error": "unknown_standing",
            "values": ["retired"],
            "allowed": [
                "scheduled",
                "in_force",
                "amended",
                "superseded",
                "revoked",
                "expired",
            ],
            "message": (
                "standing takes one value or a comma-separated list of: scheduled, "
                "in_force, amended, superseded, revoked, expired. For the decisions "
                'in force use standing="in_force,amended".'
            ),
        }


class TestStandingFilter:
    def test_empty_means_no_filter(self):
        assert server._adr_standing_filter("") == (None, None)
        assert server._adr_standing_filter(" , ") == (None, None)

    @pytest.mark.parametrize("value", server._ADR_STANDINGS)
    def test_every_standing_is_accepted(self, value):
        assert server._adr_standing_filter(value) == (value, None)


class TestListSoaws:
    @pytest.mark.asyncio
    async def test_hides_earlier_revisions_by_default(self, fake_token):
        mocks, calls = _backend(get=[])
        with mocks[2]:
            await server.list_soaws()
        assert calls["get"] == [("/soaw", {"include_earlier": "false"})]

    @pytest.mark.asyncio
    async def test_include_earlier_true(self, fake_token):
        mocks, calls = _backend(get=[])
        with mocks[2]:
            await server.list_soaws(initiative_id="i-1", include_earlier=True)
        assert calls["get"] == [("/soaw", {"initiative_id": "i-1", "include_earlier": "true"})]


# ── field translation ───────────────────────────────────────────────────────


class TestTranslateLinks:
    def test_maps_adr_id_to_decision_id_and_keeps_notes(self):
        links = [
            {"adr_id": " ADR-012 ", "kind": "replaces", "note": "obsolete"},
            {"adr_id": ADR_ID, "kind": "relates"},
        ]
        assert server._translate_adr_links(links, server._ADR_LINK_KINDS) == (
            [
                {"decision_id": "ADR-012", "kind": "replaces", "note": "obsolete"},
                {"decision_id": ADR_ID, "kind": "relates"},
            ],
            None,
        )

    def test_not_a_dict(self):
        assert server._translate_adr_links(["ADR-1"], server._ADR_LINK_KINDS) == (
            [],
            {
                "error": "invalid_link",
                "index": 0,
                "message": "Each link must be an {adr_id, kind, note?} dict.",
            },
        )

    def test_unknown_field_is_refused_never_dropped(self):
        links = [{"adr_id": "ADR-1", "kind": "relates", "target": "x", "decision_id": "y"}]
        assert server._translate_adr_links(links, server._ADR_LINK_KINDS) == (
            [],
            {
                "error": "unknown_link_field",
                "index": 0,
                "fields": ["decision_id", "target"],
                "message": "A link takes adr_id, kind and an optional note.",
            },
        )

    @pytest.mark.parametrize("target", [None, "", "   ", 7, "x" * 101])
    def test_bad_target(self, target):
        links = [{"adr_id": "ADR-1", "kind": "relates"}, {"adr_id": target, "kind": "relates"}]
        _, err = server._translate_adr_links(links, server._ADR_LINK_KINDS)
        assert err == {
            "error": "invalid_link_target",
            "index": 1,
            "message": (
                'adr_id must be a decision id or a reference such as "ADR-012" '
                "(at most 100 characters)."
            ),
        }

    def test_target_of_exactly_100_characters_is_accepted(self):
        links = [{"adr_id": "x" * 100, "kind": "relates"}]
        assert server._translate_adr_links(links, server._ADR_LINK_KINDS)[1] is None

    @pytest.mark.parametrize("kind", ["supersedes", "consolidates", None, "Relates"])
    def test_unknown_kind_on_create(self, kind):
        links = [{"adr_id": "ADR-1", "kind": kind}]
        assert server._translate_adr_links(links, server._ADR_LINK_KINDS) == (
            [],
            {
                "error": "unknown_kind",
                "index": 0,
                "kind": kind,
                "allowed": ["replaces", "amends", "revokes", "relates"],
                "message": "Link kinds are replaces, amends, revokes, relates.",
            },
        )

    def test_consolidates_allowed_on_a_revision_update(self):
        links = [{"adr_id": "ADR-1", "kind": "consolidates"}]
        assert server._translate_adr_links(links, server._ADR_REVISION_LINK_KINDS) == (
            [{"decision_id": "ADR-1", "kind": "consolidates"}],
            None,
        )

    @pytest.mark.parametrize("note", [3, "n" * 1001])
    def test_bad_note(self, note):
        links = [{"adr_id": "ADR-1", "kind": "amends", "note": note}]
        assert server._translate_adr_links(links, server._ADR_LINK_KINDS) == (
            [],
            {
                "error": "invalid_link_note",
                "index": 0,
                "message": "note must be a string of at most 1000 characters.",
            },
        )

    def test_note_of_exactly_1000_characters_is_accepted(self):
        links = [{"adr_id": "ADR-1", "kind": "amends", "note": "n" * 1000}]
        assert server._translate_adr_links(links, server._ADR_LINK_KINDS)[0][0]["note"] == (
            "n" * 1000
        )

    def test_duplicate_target_ignores_case_and_spaces(self):
        links = [
            {"adr_id": "ADR-012", "kind": "amends"},
            {"adr_id": " adr-012", "kind": "relates"},
        ]
        assert server._translate_adr_links(links, server._ADR_LINK_KINDS) == (
            [],
            {
                "error": "duplicate_target",
                "index": 1,
                "adr_id": " adr-012",
                "message": "A decision can be linked to another decision only once.",
            },
        )


class TestTranslatePeople:
    def test_users_and_names(self):
        people = [{"user_id": " u-1 "}, {"name": " Ada Lovelace "}]
        assert server._translate_adr_people(people, "decision_makers") == (
            [{"user_id": "u-1"}, {"name": "Ada Lovelace"}],
            None,
        )

    @pytest.mark.parametrize(
        "person",
        [
            "Ada",
            {},
            {"user_id": "u", "name": "n"},
            {"email": "a@b"},
            {"name": ""},
            {"name": "  "},
            {"user_id": 5},
        ],
    )
    def test_malformed_entries(self, person):
        assert server._translate_adr_people([person], "participants") == (
            [],
            {
                "error": "invalid_person",
                "part": "participants",
                "index": 0,
                "message": (
                    "Each entry of participants is {user_id} (a user of Turbo EA) or {name}."
                ),
            },
        )

    def test_name_length(self):
        assert server._translate_adr_people([{"name": "n" * 255}], "participants")[1] is None
        assert server._translate_adr_people([{"name": "n" * 256}], "participants") == (
            [],
            {
                "error": "invalid_person",
                "part": "participants",
                "index": 0,
                "message": "A name is at most 255 characters.",
            },
        )


class TestDates:
    def test_valid_dates_and_equal_bounds(self):
        dates = {"decided_on": "2026-01-02", "effective_from": "2026-03-01"}
        assert server._adr_date_errors({**dates, "valid_until": "2026-03-01"}) is None

    @pytest.mark.parametrize("value", ["2026-02-30", "20260101", "2026-1-01", "tomorrow"])
    def test_not_an_iso_date(self, value):
        assert server._adr_date_errors({"decided_on": "", "valid_until": value}) == {
            "error": "invalid_date",
            "field": "valid_until",
            "value": value,
            "message": "valid_until must be an ISO date (YYYY-MM-DD).",
        }

    def test_valid_until_before_effective_from(self):
        dates = {"effective_from": "2026-03-02", "valid_until": "2026-03-01"}
        assert server._adr_date_errors(dates) == {
            "error": "valid_until_before_effective",
            "message": "valid_until cannot be before effective_from.",
        }

    def test_one_bound_alone_is_not_compared(self):
        assert server._adr_date_errors({"valid_until": "2020-01-01"}) is None


class TestRegisterFields:
    def _fields(self, **overrides):
        args = {
            "links": None,
            "link_kinds": server._ADR_LINK_KINDS,
            "decision_makers": None,
            "participants": None,
            "decided_on": "",
            "effective_from": "",
            "valid_until": "",
            "change_summary": "",
        }
        return server._adr_register_fields(**{**args, **overrides})

    def test_nothing_given_sends_nothing(self):
        assert self._fields() == ({}, None)

    def test_empty_lists_are_sent_to_clear(self):
        assert self._fields(links=[], decision_makers=[], participants=[]) == (
            {"links": [], "decision_makers": [], "participants": []},
            None,
        )

    def test_every_field(self):
        assert self._fields(
            links=[{"adr_id": "ADR-2", "kind": "revokes"}],
            decision_makers=[{"user_id": "u-1"}],
            participants=[{"name": "Bo"}],
            decided_on="2026-01-01",
            effective_from="2026-02-01",
            valid_until="2027-01-31",
            change_summary="why",
        ) == (
            {
                "links": [{"decision_id": "ADR-2", "kind": "revokes"}],
                "decision_makers": [{"user_id": "u-1"}],
                "participants": [{"name": "Bo"}],
                "decided_on": "2026-01-01",
                "effective_from": "2026-02-01",
                "valid_until": "2027-01-31",
                "change_summary": "why",
            },
            None,
        )

    def test_people_error_names_the_part(self):
        _, err = self._fields(decision_makers=[{"user_id": "u"}], participants=[{}])
        assert (err["error"], err["part"]) == ("invalid_person", "participants")
        _, err = self._fields(decision_makers=[{}])
        assert (err["error"], err["part"]) == ("invalid_person", "decision_makers")

    def test_link_and_date_errors_pass_through(self):
        assert self._fields(links=[{"adr_id": "A", "kind": "x"}])[1]["error"] == "unknown_kind"
        assert self._fields(decided_on="x")[1]["error"] == "invalid_date"

    def test_change_summary_length(self):
        assert self._fields(change_summary="s" * 2000) == ({"change_summary": "s" * 2000}, None)
        assert self._fields(change_summary="s" * 2001) == (
            {},
            {
                "error": "change_summary_too_long",
                "message": "change_summary is at most 2000 characters.",
            },
        )


class TestRefLabel:
    def test_labels(self):
        assert server._adr_ref_label({"reference_number": "ADR-1", "revision_number": 1}) == (
            "ADR-1"
        )
        assert server._adr_ref_label({"reference_number": "ADR-1", "revision_number": 2}) == (
            "ADR-1 · Rev 2"
        )
        assert server._adr_ref_label({"reference_number": "ADR-1"}) == "ADR-1"
        assert server._adr_ref_label({"revision_number": 2}) is None
        assert server._adr_ref_label(None) is None


# ── create_adr / update_adr ─────────────────────────────────────────────────


class TestCreateAdrRegisterFields:
    @pytest.mark.asyncio
    async def test_dry_run_shows_the_backend_payload(self, fake_token):
        mocks, calls = _backend()
        with mocks[0]:
            out = await server.create_adr(
                title="Retire Oracle",
                sections=[{"heading": "Decision", "body": "Move."}],
                links=[{"adr_id": "ADR-003", "kind": "replaces", "note": "n"}],
                decision_makers=[{"user_id": "u-1"}],
                participants=[{"name": "Bo"}],
                decided_on="2026-01-05",
                effective_from="2026-02-01",
                valid_until="2026-12-31",
                change_summary="first",
            )
        assert calls["post"] == [_open("create_adr", True), _close({"status": "previewed"})]
        assert _parse(out)["would_create"] == {
            "title": "Retire Oracle",
            "decision": "Move.",
            "links": [{"decision_id": "ADR-003", "kind": "replaces", "note": "n"}],
            "decision_makers": [{"user_id": "u-1"}],
            "participants": [{"name": "Bo"}],
            "decided_on": "2026-01-05",
            "effective_from": "2026-02-01",
            "valid_until": "2026-12-31",
            "change_summary": "first",
        }

    @pytest.mark.asyncio
    async def test_commit_merges_related_with_typed_links(self, fake_token):
        mocks, calls = _backend(write={"id": "new"})
        with mocks[0]:
            out = await server.create_adr(
                title="t",
                sections=[],
                related_adr_ids=["adr-003", "ADR-004", ADR_ID],
                links=[
                    {"adr_id": "ADR-003", "kind": "amends"},
                    {"adr_id": ADR_ID, "kind": "revokes"},
                ],
                dry_run=False,
            )
        assert calls["post"] == [
            _open("create_adr", False),
            (
                "/adr",
                {
                    "title": "t",
                    "related_decisions": ["ADR-004"],
                    "links": [
                        {"decision_id": "ADR-003", "kind": "amends"},
                        {"decision_id": ADR_ID, "kind": "revokes"},
                    ],
                },
            ),
            _close({"adr_id": "new"}),
        ]
        assert _parse(out) == {"id": "new", "batch_id": "B-1"}

    @pytest.mark.asyncio
    async def test_related_alone_is_sent_unchanged(self, fake_token):
        mocks, calls = _backend()
        with mocks[0]:
            out = await server.create_adr(title="t", sections=[], related_adr_ids=["ADR-9"])
        assert _parse(out)["would_create"] == {"title": "t", "related_decisions": ["ADR-9"]}

    @pytest.mark.asyncio
    @pytest.mark.parametrize("dry_run", [True, False])
    async def test_a_bad_link_kind_fails_preview_and_commit_alike(self, fake_token, dry_run):
        mocks, calls = _backend()
        with mocks[0]:
            out = await server.create_adr(
                title="t",
                sections=[],
                links=[{"adr_id": "ADR-1", "kind": "supersedes"}],
                dry_run=dry_run,
            )
        assert calls["post"] == []
        assert _parse(out)["error"] == "unknown_kind"

    @pytest.mark.asyncio
    async def test_consolidates_is_refused_on_create(self, fake_token):
        mocks, calls = _backend()
        with mocks[0]:
            out = await server.create_adr(
                title="t", sections=[], links=[{"adr_id": "ADR-1", "kind": "consolidates"}]
            )
        assert calls["post"] == []
        assert _parse(out)["allowed"] == ["replaces", "amends", "revokes", "relates"]

    @pytest.mark.asyncio
    async def test_a_bad_date_is_refused_before_any_request(self, fake_token):
        mocks, calls = _backend()
        with mocks[0]:
            out = await server.create_adr(title="t", sections=[], effective_from="01/02/2026")
        assert calls["post"] == []
        assert _parse(out)["error"] == "invalid_date"


class TestUpdateAdrRegisterFields:
    @pytest.mark.asyncio
    async def test_dry_run_accepts_consolidates_and_clears(self, fake_token):
        mocks, calls = _backend()
        with mocks[0], mocks[1]:
            out = await server.update_adr(
                adr_id="A-1",
                links=[{"adr_id": "ADR-7", "kind": "consolidates"}],
                participants=[],
                valid_until="2027-01-01",
            )
        assert calls["patch"] == []
        assert calls["post"] == [
            _open("update_adr", True),
            _close({"adr_id": "A-1", "status": "previewed"}),
        ]
        assert _parse(out) == {
            "dry_run": True,
            "adr_id": "A-1",
            "would_update": {
                "links": [{"decision_id": "ADR-7", "kind": "consolidates"}],
                "participants": [],
                "valid_until": "2027-01-01",
            },
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_commit_patches_the_fields(self, fake_token):
        mocks, calls = _backend(write={"id": "A-1"})
        with mocks[0], mocks[1]:
            out = await server.update_adr(
                adr_id="A-1",
                decision_makers=[{"name": "Board"}],
                change_summary="tightened",
                dry_run=False,
            )
        assert calls["patch"] == [
            (
                "/adr/A-1",
                {"decision_makers": [{"name": "Board"}], "change_summary": "tightened"},
            )
        ]
        assert calls["post"] == [_open("update_adr", False), _close({"adr_id": "A-1"})]
        assert _parse(out) == {"id": "A-1", "batch_id": "B-1"}

    @pytest.mark.asyncio
    async def test_a_malformed_person_is_refused_before_any_request(self, fake_token):
        mocks, calls = _backend()
        with mocks[0], mocks[1]:
            out = await server.update_adr(adr_id="A-1", decision_makers=[{"email": "x"}])
        assert calls == {"post": [], "patch": [], "get": []}
        assert _parse(out)["error"] == "invalid_person"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "detail, error, message",
        [
            (
                "Cannot edit a decision in review. Recall the signatures to edit it.",
                "decision_in_review",
                "A decision sent for signature is locked: only linked_card_ids can "
                "change. Recall the signature requests in the web UI to edit it.",
            ),
            (
                "Cannot edit a signed decision. Create a new revision instead.",
                "decision_signed",
                "A signed decision cannot be edited. Start its next revision with "
                "revise_adr and edit that draft.",
            ),
        ],
    )
    async def test_the_lock_is_answered_clearly(self, fake_token, detail, error, message):
        mocks, calls = _backend(raises=_http_error(403, detail))
        with mocks[0], mocks[1]:
            out = await server.update_adr(adr_id="A-1", title="new", dry_run=False)
        assert _parse(out) == {
            "error": error,
            "detail": detail,
            "message": message,
            "adr_id": "A-1",
            "batch_id": "B-1",
        }
        assert calls["post"][-1] == _close({"adr_id": "A-1", "status": "refused", "error": error})

    @pytest.mark.asyncio
    async def test_a_missing_permission_is_forbidden(self, fake_token):
        mocks, _calls = _backend(raises=_http_error(403, "Not enough permissions"))
        with mocks[0], mocks[1]:
            out = await server.update_adr(adr_id="A-1", title="new", dry_run=False)
        assert _parse(out) == {
            "error": "forbidden",
            "detail": "Not enough permissions",
            "message": "Editing a decision needs the adr.manage permission.",
            "adr_id": "A-1",
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_other_errors_are_raised(self, fake_token):
        mocks, calls = _backend(raises=_http_error(400, {"error": "same_chain"}))
        with mocks[0], mocks[1], pytest.raises(httpx.HTTPStatusError):
            await server.update_adr(adr_id="A-1", title="new", dry_run=False)
        assert calls["post"][-1][1]["summary"]["status"] == "errored"


# ── revise_adr ──────────────────────────────────────────────────────────────


def _signed(**overrides) -> dict:
    adr = {
        "id": ADR_ID,
        "reference_number": "ADR-012",
        "revision_number": 1,
        "status": "signed",
        "standing": "in_force",
        "is_earlier_revision": False,
        "open_revision": None,
        "revisions": [
            {"id": ADR_ID, "revision_number": 1, "status": "signed"},
        ],
    }
    return {**adr, **overrides}


class TestRevisePreview:
    def test_would_create_the_next_revision(self):
        adr = _signed(
            revision_number=2,
            revisions=[
                {"id": REV2_ID, "revision_number": 1, "status": "signed"},
                {"id": ADR_ID, "revision_number": 2, "status": "signed"},
            ],
        )
        assert server._adr_revise_preview(adr, ADR_ID) == {
            "would_create": {
                "revision_of": ADR_ID,
                "reference_number": "ADR-012",
                "revision_number": 3,
            }
        }

    def test_numbering_uses_the_detail_when_revisions_are_missing(self):
        adr = _signed(revision_number=4, revisions=None)
        assert server._adr_revise_preview(adr, ADR_ID)["would_create"]["revision_number"] == 5

    def test_expired_and_amended_stay_revisable(self):
        for standing in ("expired", "amended"):
            assert "would_create" in server._adr_revise_preview(_signed(standing=standing), ADR_ID)

    @pytest.mark.parametrize("status", ["draft", "in_review", None])
    def test_not_signed(self, status):
        assert server._adr_revise_preview(_signed(status=status), ADR_ID) == {
            "would_refuse": {"error": "not_signed", "message": server._ADR_NOT_SIGNED_MESSAGE}
        }

    def test_open_revision_from_the_chain(self):
        adr = _signed(
            revisions=[
                {"id": ADR_ID, "revision_number": 1, "status": "signed"},
                {"id": REV2_ID, "revision_number": 2, "status": "in_review"},
            ]
        )
        refusal = server._adr_revise_preview(adr, ADR_ID)["would_refuse"]
        assert (refusal["error"], refusal["revision_id"]) == ("open_revision_exists", REV2_ID)

    def test_open_revision_from_the_pointer(self):
        adr = _signed(open_revision={"id": REV3_ID})
        refusal = server._adr_revise_preview(adr, ADR_ID)["would_refuse"]
        assert (refusal["error"], refusal["revision_id"]) == ("open_revision_exists", REV3_ID)

    def test_a_later_signed_revision(self):
        adr = _signed(
            standing="superseded",
            is_earlier_revision=True,
            revisions=[
                {"id": ADR_ID, "revision_number": 1, "status": "signed"},
                {"id": REV2_ID, "revision_number": 2, "status": "signed"},
            ],
        )
        assert server._adr_revise_preview(adr, ADR_ID) == {
            "would_refuse": server._ADR_NOT_LATEST_REFUSAL
        }

    def test_an_earlier_signed_revision_does_not_block(self):
        adr = _signed(
            revisions=[
                {"id": REV2_ID, "revision_number": 1, "status": "signed"},
                {"id": ADR_ID, "revision_number": 2, "status": "signed"},
            ]
        )
        assert "would_create" in server._adr_revise_preview(adr, ADR_ID)

    def test_revoked(self):
        by = {"id": REV3_ID, "reference_number": "ADR-020", "revision_number": 1}
        refusal = server._adr_revise_preview(_signed(standing="revoked", revoked_by=by), ADR_ID)[
            "would_refuse"
        ]
        assert (refusal["error"], refusal["by"]) == ("not_revisable", by)
        assert "revoked or replaced by ADR-020," in refusal["message"]

    def test_replaced(self):
        by = {"id": REV3_ID, "reference_number": "ADR-021", "revision_number": 2}
        refusal = server._adr_revise_preview(
            _signed(standing="superseded", superseded_by=by), ADR_ID
        )["would_refuse"]
        assert (refusal["error"], refusal["by"]) == ("not_revisable", by)
        assert "by ADR-021 · Rev 2," in refusal["message"]


class TestReviseRefusal:
    def test_open_revision_exists(self):
        detail = {"error": "open_revision_exists", "revision_id": REV2_ID}
        assert server._adr_revise_refusal(409, detail) == {
            "error": "open_revision_exists",
            "revision_id": REV2_ID,
            "message": (
                "This decision already has a revision being drafted. Edit that "
                "draft (revision_id) with update_adr instead of starting another."
            ),
        }

    def test_not_latest(self):
        detail = {"error": "not_revisable", "reason": "not_latest"}
        assert server._adr_revise_refusal(409, detail) == {
            "error": "not_revisable",
            "reason": "not_latest",
            "message": (
                "A later revision of this decision is already signed. Revise the "
                "latest revision (see revisions in get_adr)."
            ),
        }

    def test_closed_by_another_decision(self):
        by = {"id": REV3_ID, "reference_number": "ADR-030", "revision_number": 1, "title": "x"}
        assert server._adr_revise_refusal(409, {"error": "not_revisable", "by": by}) == {
            "error": "not_revisable",
            "by": by,
            "message": (
                "This decision was revoked or replaced by ADR-030, so it can no "
                "longer be revised. To change the outcome, create a new decision "
                "with create_adr."
            ),
        }

    def test_closed_without_a_readable_ref(self):
        refusal = server._adr_revise_refusal(409, {"error": "not_revisable", "by": None})
        assert "replaced by another decision," in refusal["message"]

    def test_not_signed(self):
        assert server._adr_revise_refusal(400, "Only signed decisions can be revised") == {
            "error": "not_signed",
            "message": server._ADR_NOT_SIGNED_MESSAGE,
        }

    def test_forbidden(self):
        assert server._adr_revise_refusal(403, "nope") == {
            "error": "forbidden",
            "detail": "nope",
            "message": "Revising a decision needs the adr.manage permission.",
        }

    def test_a_consolidates_entry_that_does_not_amend(self):
        detail = {
            "error": "consolidates_not_amender",
            "problems": ["consolidates_not_amender"],
            "target_id": REV3_ID,
            "message": f"The consolidated decision does not amend this decision ({REV3_ID})",
        }
        assert server._adr_revise_refusal(400, detail) == {
            "error": "consolidates_not_amender",
            "problems": ["consolidates_not_amender"],
            "target_id": REV3_ID,
            "detail": f"The consolidated decision does not amend this decision ({REV3_ID})",
            "message": (
                f"{REV3_ID} does not amend this decision, so the revision cannot "
                "consolidate it. List only decisions shown in this decision's "
                "amended_by (get_adr)."
            ),
        }

    def test_a_consolidates_entry_named_twice(self):
        detail = {
            "error": "duplicate_target",
            "problems": ["duplicate_target"],
            "target_id": REV3_ID,
            "message": "A decision can be linked only once",
        }
        refusal = server._adr_revise_refusal(400, detail)
        assert (refusal["error"], refusal["problems"], refusal["target_id"]) == (
            "duplicate_target",
            ["duplicate_target"],
            REV3_ID,
        )
        assert refusal["message"] == f"{REV3_ID} is named more than once in consolidates."

    def test_a_consolidates_entry_in_the_same_chain(self):
        detail = {"error": "same_chain", "problems": ["same_chain"], "target_id": REV2_ID}
        refusal = server._adr_revise_refusal(400, detail)
        assert (refusal["error"], refusal["target_id"], refusal["detail"]) == (
            "same_chain",
            REV2_ID,
            None,
        )
        assert refusal["message"] == (
            f"{REV2_ID} is a revision of this decision itself; consolidates names "
            "the decisions that amend it."
        )

    def test_an_unknown_consolidates_problem_keeps_its_code(self):
        refusal = server._adr_revise_refusal(400, {"error": "target_missing"})
        assert refusal == {
            "error": "target_missing",
            "problems": ["target_missing"],
            "target_id": None,
            "detail": None,
            "message": (
                "A consolidates entry cannot be consolidated by this revision (target_missing)."
            ),
        }

    def test_an_unknown_consolidates_entry(self):
        detail = {
            "error": "decision_not_found",
            "value": "ADR-404",
            "message": "Decision not found: ADR-404",
        }
        assert server._adr_revise_refusal(404, detail) == {
            "error": "decision_not_found",
            "value": "ADR-404",
            "message": (
                "consolidates names 'ADR-404', which is neither a decision id "
                "nor a known reference. Find the amending decision with list_adrs."
            ),
        }

    def test_a_plain_400_is_still_not_signed(self):
        assert server._adr_revise_refusal(400, {"error": ""})["error"] == "not_signed"
        assert server._adr_revise_refusal(400, None)["error"] == "not_signed"

    @pytest.mark.parametrize(
        "status, detail",
        [
            (409, "conflict"),
            (409, {"error": "other"}),
            (404, {"error": "x"}),
            (404, "Architecture decision not found"),
            (500, None),
        ],
    )
    def test_anything_else_is_not_mapped(self, status, detail):
        assert server._adr_revise_refusal(status, detail) is None


class TestSignRefusal:
    def test_a_refused_final_signature(self):
        detail = {
            "error": "valid_until_before_effective",
            "problems": ["valid_until_before_effective", "valid_until_past"],
        }
        assert server._adr_sign_refusal(409, detail) == {
            "error": "valid_until_before_effective",
            "problems": ["valid_until_before_effective", "valid_until_past"],
            "message": (
                "The signature was not recorded: this is the final signature, and "
                "the decision cannot be locked because valid_until is before "
                "effective_from (an empty effective_from becomes the signing day); "
                "its valid_until date has passed. It stays in review; its author "
                "must recall the signature requests in the web UI, fix it and send "
                "it for signature again."
            ),
        }

    def test_the_closer_and_targets_are_kept(self):
        by = {"id": REV3_ID, "reference_number": "ADR-030", "revision_number": 1}
        detail = {
            "error": "chain_closed",
            "problems": ["chain_closed", "link_target_not_locked"],
            "by": by,
            "target_ids": [REV2_ID],
        }
        refusal = server._adr_sign_refusal(409, detail)
        assert (refusal["by"], refusal["target_ids"]) == (by, [REV2_ID])
        assert (
            "because another decision has revoked or replaced it; it links to a "
            in (refusal["message"])
        )

    def test_an_unknown_problem_reads_as_its_code(self):
        refusal = server._adr_sign_refusal(409, {"error": "new_rule"})
        assert refusal["problems"] == ["new_rule"]
        assert "cannot be locked because new_rule. It stays" in refusal["message"]

    @pytest.mark.parametrize(
        "status, detail",
        [(400, {"error": "x"}), (409, "conflict"), (409, {"error": ""}), (403, {"error": "x"})],
    )
    def test_anything_else_is_not_mapped(self, status, detail):
        assert server._adr_sign_refusal(status, detail) is None


class TestSignAdrRefused:
    @pytest.mark.asyncio
    async def test_a_409_comes_back_as_an_answer(self, fake_token):
        detail = {"error": "decided_on_future", "problems": ["decided_on_future"]}
        mocks, calls = _backend(raises=_http_error(409, detail))
        with mocks[0]:
            out = await server.sign_adr(adr_id=ADR_ID, dry_run=False)
        data = _parse(out)
        assert (data["error"], data["problems"], data["adr_id"], data["batch_id"]) == (
            "decided_on_future",
            ["decided_on_future"],
            ADR_ID,
            "B-1",
        )
        assert "status" not in data
        assert calls["post"][-1] == _close(
            {"adr_id": ADR_ID, "status": "refused", "error": "decided_on_future"}
        )

    @pytest.mark.asyncio
    async def test_a_409_whose_url_contains_403_is_not_a_permission_problem(self, fake_token):
        request = httpx.Request("POST", "http://backend/api/v1/adr/a403/sign")
        response = httpx.Response(409, json={"detail": {"error": "chain_closed"}}, request=request)
        exc = httpx.HTTPStatusError("409 for /adr/a403/sign", request=request, response=response)
        mocks, _calls = _backend(raises=exc)
        with mocks[0]:
            data = _parse(await server.sign_adr(adr_id="a403", dry_run=False))
        assert data["error"] == "chain_closed"

    @pytest.mark.asyncio
    async def test_a_403_still_degrades_to_the_deep_link(self, fake_token):
        mocks, _calls = _backend(raises=_http_error(403, "Not enough permissions"))
        with mocks[0]:
            data = _parse(await server.sign_adr(adr_id=ADR_ID, dry_run=False))
        assert (data["status"], data["reason"]) == ("pending", "missing_adr_sign_permission")

    @pytest.mark.asyncio
    async def test_an_unmapped_error_is_raised(self, fake_token):
        mocks, _calls = _backend(raises=_http_error(400, "Decision is already signed"))
        with mocks[0], pytest.raises(httpx.HTTPStatusError):
            await server.sign_adr(adr_id=ADR_ID, dry_run=False)


class TestReviseAdr:
    @pytest.mark.asyncio
    async def test_preview_reads_the_decision_and_creates_nothing(self, fake_token):
        mocks, calls = _backend(get=_signed())
        with mocks[0], mocks[2]:
            out = await server.revise_adr(
                adr_id=ADR_ID, change_summary="tighten", consolidates=[" ADR-020 "]
            )
        assert calls["get"] == [(f"/adr/{ADR_ID}", None)]
        assert calls["post"] == [
            _open("revise_adr", True),
            _close({"adr_id": ADR_ID, "status": "previewed"}),
        ]
        assert _parse(out) == {
            "dry_run": True,
            "adr_id": ADR_ID,
            "would_create": {
                "revision_of": ADR_ID,
                "reference_number": "ADR-012",
                "revision_number": 2,
                "body": {"consolidates": ["ADR-020"], "change_summary": "tighten"},
            },
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_preview_reports_the_refusal(self, fake_token):
        mocks, calls = _backend(get=_signed(open_revision={"id": REV2_ID}))
        with mocks[0], mocks[2]:
            out = await server.revise_adr(adr_id=ADR_ID)
        data = _parse(out)
        assert data["would_refuse"]["error"] == "open_revision_exists"
        assert "would_create" not in data
        assert [c[0] for c in calls["post"]] == [
            "/mutation-batches?row_count=1",
            "/mutation-batches/B-1/commit",
        ]

    @pytest.mark.asyncio
    async def test_commit_posts_the_body_through_the_batch(self, fake_token):
        mocks, calls = _backend(write={"id": REV2_ID, "revision_number": 2})
        with mocks[0], mocks[2]:
            out = await server.revise_adr(adr_id=ADR_ID, change_summary="why", dry_run=False)
        assert calls["get"] == []
        assert calls["post"] == [
            _open("revise_adr", False),
            (f"/adr/{ADR_ID}/revise", {"change_summary": "why"}),
            _close({"adr_id": ADR_ID, "revision_id": REV2_ID}),
        ]
        assert _parse(out) == {"id": REV2_ID, "revision_number": 2, "batch_id": "B-1"}

    @pytest.mark.asyncio
    async def test_commit_without_options_sends_an_empty_body(self, fake_token):
        mocks, calls = _backend(write={"id": REV2_ID})
        with mocks[0]:
            await server.revise_adr(adr_id=ADR_ID, dry_run=False)
        assert calls["post"][1] == (f"/adr/{ADR_ID}/revise", {})

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "status, detail, error",
        [
            (
                409,
                {"error": "open_revision_exists", "revision_id": REV2_ID},
                "open_revision_exists",
            ),
            (409, {"error": "not_revisable", "reason": "not_latest"}, "not_revisable"),
            (409, {"error": "not_revisable", "by": {"reference_number": "A"}}, "not_revisable"),
            (400, "Only signed decisions can be revised", "not_signed"),
            (
                400,
                {"error": "consolidates_not_amender", "target_id": REV3_ID},
                "consolidates_not_amender",
            ),
            (404, {"error": "decision_not_found", "value": "ADR-9"}, "decision_not_found"),
        ],
    )
    async def test_refusals_come_back_as_answers(self, fake_token, status, detail, error):
        mocks, calls = _backend(raises=_http_error(status, detail))
        with mocks[0]:
            out = await server.revise_adr(adr_id=ADR_ID, dry_run=False)
        data = _parse(out)
        assert (data["error"], data["adr_id"], data["batch_id"]) == (error, ADR_ID, "B-1")
        assert calls["post"][-1] == _close({"adr_id": ADR_ID, "status": "refused", "error": error})

    @pytest.mark.asyncio
    async def test_an_unmapped_error_is_raised(self, fake_token):
        mocks, _calls = _backend(raises=_http_error(404, "Architecture decision not found"))
        with mocks[0], pytest.raises(httpx.HTTPStatusError):
            await server.revise_adr(adr_id=ADR_ID, dry_run=False)

    @pytest.mark.asyncio
    @pytest.mark.parametrize("dry_run", [True, False])
    async def test_input_errors_send_nothing(self, fake_token, dry_run):
        mocks, calls = _backend(get=_signed())
        with mocks[0], mocks[2]:
            bad_id = _parse(await server.revise_adr(adr_id="ADR-012", dry_run=dry_run))
            long = _parse(
                await server.revise_adr(adr_id=ADR_ID, change_summary="s" * 2001, dry_run=dry_run)
            )
            blank = _parse(
                await server.revise_adr(adr_id=ADR_ID, consolidates=["A", " "], dry_run=dry_run)
            )
            many = _parse(
                await server.revise_adr(adr_id=ADR_ID, consolidates=["A"] * 101, dry_run=dry_run)
            )
        assert calls == {"post": [], "patch": [], "get": []}
        assert bad_id == {
            "error": "invalid_adr_id",
            "adr_id": "ADR-012",
            "message": (
                "adr_id must be the UUID of a decision revision; find it with "
                "list_adrs (search the reference)."
            ),
        }
        assert long == {
            "error": "change_summary_too_long",
            "message": "change_summary is at most 2000 characters.",
        }
        expected = {
            "error": "invalid_consolidates",
            "message": "consolidates takes up to 100 decision ids or references.",
        }
        assert blank == expected
        assert many == expected

    @pytest.mark.asyncio
    async def test_limits_are_inclusive(self, fake_token):
        mocks, calls = _backend(write={"id": REV2_ID})
        with mocks[0]:
            await server.revise_adr(
                adr_id=ADR_ID, change_summary="s" * 2000, consolidates=["A"] * 100, dry_run=False
            )
        assert calls["post"][1] == (
            f"/adr/{ADR_ID}/revise",
            {"consolidates": ["A"] * 100, "change_summary": "s" * 2000},
        )

    @pytest.mark.asyncio
    async def test_writes_disabled(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_WRITES_ENABLED", False)
        mocks, calls = _backend()
        with mocks[0], mocks[2]:
            out = await server.revise_adr(adr_id=ADR_ID)
        assert _parse(out)["error"] == "writes_disabled"
        assert calls == {"post": [], "patch": [], "get": []}

    def test_is_an_additive_write_tool(self):
        tool = server.mcp._tool_manager._tools["revise_adr"]
        assert tool.annotations == server._WRITE_ADDITIVE_ANNOT
