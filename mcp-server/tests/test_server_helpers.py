"""The plain helpers behind the MCP write tools, called directly.

The tools are decorated, so mutmut never mutates them; the helpers they
delegate to are where the rules live. Each error a helper returns is the
whole answer an agent reads before deciding what to send next, so the
dicts are compared whole: a renamed key or a reworded instruction is a
change to that contract.
"""

from __future__ import annotations

import json

import pytest

from turbo_ea_mcp import server

CREATE = server._RISK_CREATE_FIELDS
UPDATE = server._RISK_UPDATE_FIELDS


class TestTranslateRiskRow:
    def test_a_row_that_is_not_a_dict(self):
        assert server._translate_risk_row(["x"], 3, allowed=CREATE) == (
            {},
            {"error": "invalid_row", "index": 3, "message": "Each row must be a dict."},
        )

    def test_aliases_are_rewritten_onto_the_backend_fields(self):
        row = {
            "title": "T",
            "probability": "high",
            "impact": "low",
            "linked_card_ids": ["c1"],
            "category": None,
        }
        assert server._translate_risk_row(row, 0, allowed=CREATE) == (
            {
                "title": "T",
                "initial_probability": "high",
                "initial_impact": "low",
                "card_ids": ["c1"],
                "category": None,
            },
            None,
        )

    def test_status_cannot_be_set_on_create(self):
        assert server._translate_risk_row({"status": "closed"}, 1, allowed=CREATE) == (
            {},
            {
                "error": "unknown_field",
                "index": 1,
                "field": "status",
                "message": (
                    'New risks always start as "identified". '
                    "Change status afterwards with update_risks."
                ),
            },
        )

    def test_status_is_an_ordinary_field_on_update(self):
        assert server._translate_risk_row({"status": "closed"}, 0, allowed=UPDATE) == (
            {"status": "closed"},
            None,
        )

    @pytest.mark.parametrize("key", ["source_type", "source_ref"])
    def test_the_source_is_server_managed(self, key):
        assert server._translate_risk_row({key: "x"}, 2, allowed=UPDATE) == (
            {},
            {
                "error": "unknown_field",
                "index": 2,
                "field": key,
                "message": (
                    "source_type/source_ref are server-managed; "
                    "risks created here are always source=manual."
                ),
            },
        )

    def test_any_other_unknown_key_lists_what_is_allowed(self):
        assert server._translate_risk_row({"title": "T", "colour": "red"}, 4, allowed=CREATE) == (
            {},
            {
                "error": "unknown_field",
                "index": 4,
                "field": "colour",
                "allowed_fields": sorted(CREATE),
                "message": "Unknown fields are rejected, never silently dropped.",
            },
        )

    def test_an_alias_names_the_backend_field_it_was_rejected_as(self):
        """``linked_card_ids`` maps onto ``card_ids``, which an update does not take."""
        _, error = server._translate_risk_row({"linked_card_ids": []}, 0, allowed=UPDATE)
        assert error["field"] == "linked_card_ids"
        assert error["allowed_fields"] == sorted(UPDATE)

    @pytest.mark.parametrize("value", [3, "extreme"])
    def test_a_literal_field_takes_only_its_values(self, value):
        assert server._translate_risk_row({"impact": value}, 5, allowed=CREATE) == (
            {},
            {
                "error": "invalid_value",
                "index": 5,
                "field": "initial_impact",
                "value": value,
                "allowed_values": ["critical", "high", "medium", "low"],
                "message": (
                    "initial_impact takes one of ['critical', 'high', 'medium', 'low'] "
                    "(numeric scales are not accepted)."
                ),
            },
        )

    def test_a_free_text_field_takes_anything(self):
        assert server._translate_risk_row({"description": 7}, 0, allowed=CREATE) == (
            {"description": 7},
            None,
        )


class TestTranslateSoawSections:
    def test_each_section_becomes_a_custom_entry_in_order(self):
        sections = [
            {"heading": "  Scope ", "body": "All of it"},
            {"heading": "Risks", "body": "", "insert_after": "scope"},
        ]
        assert server._translate_soaw_sections(sections) == (
            {
                "custom_mcp_1": {"title": "Scope", "content": "All of it", "hidden": False},
                "custom_mcp_2": {
                    "title": "Risks",
                    "content": "",
                    "hidden": False,
                    "insertAfter": "scope",
                },
            },
            None,
        )

    def test_no_sections(self):
        assert server._translate_soaw_sections([]) == ({}, None)

    @pytest.mark.parametrize(
        "section, error",
        [
            (
                "text",
                {
                    "error": "invalid_section",
                    "index": 1,
                    "message": "Each section must be a {heading, body} dict.",
                },
            ),
            (
                {"heading": "  ", "body": "b"},
                {
                    "error": "missing_heading",
                    "index": 1,
                    "message": "Each section needs a non-empty string heading.",
                },
            ),
            (
                {"heading": 5, "body": "b"},
                {
                    "error": "missing_heading",
                    "index": 1,
                    "message": "Each section needs a non-empty string heading.",
                },
            ),
            (
                {"heading": "H", "body": None},
                {
                    "error": "missing_body",
                    "index": 1,
                    "heading": "H",
                    "message": "Each section needs a string body.",
                },
            ),
            (
                {"heading": "H", "body": "b", "insert_after": 2},
                {
                    "error": "invalid_insert_after",
                    "index": 1,
                    "heading": "H",
                    "message": "insert_after must be a section-id string when given.",
                },
            ),
        ],
    )
    def test_a_bad_section_names_itself_and_nothing_is_kept(self, section, error):
        sections = [{"heading": "Fine", "body": "ok"}, section]
        assert server._translate_soaw_sections(sections) == ({}, error)


class TestSoawStatusError:
    @pytest.mark.parametrize("status", ["", "draft"])
    def test_draft_is_the_only_status_set_on_create(self, status):
        assert server._soaw_status_error(status) is None

    @pytest.mark.parametrize(
        "status, message",
        [
            (
                "signed",
                "signed is reached through the SoAW signature workflow "
                "(request signatures, then sign in the UI), not set directly.",
            ),
            (
                "in_review",
                "in_review is entered by requesting signatures via the UI, not set directly.",
            ),
            (
                "approved",
                'approved is reached through review in the UI. New SoAWs always land in "draft".',
            ),
        ],
    )
    def test_a_workflow_status_says_how_it_is_reached(self, status, message):
        assert server._soaw_status_error(status) == {
            "error": "invalid_status",
            "status": status,
            "message": message,
        }

    def test_an_unknown_status_lists_the_real_ones(self):
        assert server._soaw_status_error("done") == {
            "error": "unknown_status",
            "status": "done",
            "message": (
                'SoAW statuses are "draft", "in_review", "approved", "signed". '
                'New SoAWs always land in "draft".'
            ),
        }


SUPPORTED = ["Context", "Decision", "Consequences", "Alternatives Considered"]


class TestTranslateAdrSections:
    def test_headings_map_onto_the_four_columns(self):
        sections = [
            {"heading": "CONTEXT", "body": "c"},
            {"heading": "decision", "body": "d"},
            {"heading": " Consequences ", "body": "q"},
            {"heading": "alternatives-considered", "body": "a1"},
            {"heading": "Alternatives_", "body": "a2"},
        ]
        assert server._translate_adr_sections(sections) == (
            {
                "context": "c",
                "decision": "d",
                "consequences": "q",
                "alternatives_considered": "a1\n\na2",
            },
            None,
        )

    def test_a_repeated_heading_joins_its_bodies_in_order(self):
        sections = [{"heading": "Context", "body": s} for s in ("one", "two", "three")]
        assert server._translate_adr_sections(sections) == (
            {"context": "one\n\ntwo\n\nthree"},
            None,
        )

    @pytest.mark.parametrize(
        "section, error",
        [
            (
                ["Context"],
                {
                    "error": "invalid_section",
                    "index": 1,
                    "message": "Each section must be a {heading, body} dict.",
                    "supported_headings": SUPPORTED,
                },
            ),
            (
                {"heading": " ", "body": "b"},
                {"error": "missing_heading", "index": 1, "supported_headings": SUPPORTED},
            ),
            (
                {"body": "b"},
                {"error": "missing_heading", "index": 1, "supported_headings": SUPPORTED},
            ),
            (
                {"heading": "Context", "body": 1},
                {
                    "error": "missing_body",
                    "index": 1,
                    "heading": "Context",
                    "message": "Each section needs a string body.",
                },
            ),
            (
                {"heading": "Status", "body": "b"},
                {
                    "error": "unknown_heading",
                    "index": 1,
                    "heading": "Status",
                    "supported_headings": SUPPORTED,
                    "message": (
                        "ADRs store four fixed sections. Use one of the supported "
                        "headings (matched case-insensitively) — unknown headings are "
                        "rejected, never dropped."
                    ),
                },
            ),
        ],
    )
    def test_a_bad_section_names_itself_and_nothing_is_kept(self, section, error):
        sections = [{"heading": "Decision", "body": "ok"}, section]
        assert server._translate_adr_sections(sections) == ({}, error)


class TestAdrStatusError:
    @pytest.mark.parametrize("create", [True, False])
    @pytest.mark.parametrize("status", ["", "draft"])
    def test_draft_needs_nothing(self, status, create):
        assert server._adr_status_error(status, create=create) is None

    @pytest.mark.parametrize("create", [True, False])
    def test_signing_goes_through_sign_adr(self, create):
        assert server._adr_status_error("signed", create=create) == {
            "error": "invalid_status",
            "status": "signed",
            "message": "Use the sign_adr tool to sign a decision.",
        }

    @pytest.mark.parametrize("create", [True, False])
    def test_in_review_is_entered_by_requesting_signatures(self, create):
        assert server._adr_status_error("in_review", create=create) == {
            "error": "invalid_status",
            "status": "in_review",
            "message": (
                "in_review is entered by requesting signatures "
                "(POST /adr/{id}/request-signatures via the UI), not set directly."
            ),
        }

    @pytest.mark.parametrize(
        "create, tail",
        [(True, 'New ADRs always land in "draft".'), (False, 'Only "draft" can be set here.')],
    )
    def test_an_unknown_status_says_what_can_be_set(self, create, tail):
        assert server._adr_status_error("approved", create=create) == {
            "error": "unknown_status",
            "status": "approved",
            "message": 'ADR statuses are "draft", "in_review", and "signed". ' + tail,
        }


class TestValidateStakeholderOps:
    def test_valid_ops_default_to_assign_and_keep_their_keys(self):
        ops = [
            {"card_id": "c", "user_id": "u", "role": "owner", "note": "kept"},
            {"action": "remove", "stakeholder_id": "s"},
        ]
        assert server._validate_stakeholder_ops(ops) == (
            [
                {
                    "card_id": "c",
                    "user_id": "u",
                    "role": "owner",
                    "note": "kept",
                    "action": "assign",
                },
                {"action": "remove", "stakeholder_id": "s"},
            ],
            None,
        )

    @pytest.mark.parametrize(
        "op, error",
        [
            (
                "assign",
                {
                    "error": "invalid_operation",
                    "index": 1,
                    "message": "Each operation must be a dict.",
                },
            ),
            (
                {"action": "assign", "card_id": "c", "role": ""},
                {
                    "error": "missing_fields",
                    "index": 1,
                    "action": "assign",
                    "missing": ["user_id", "role"],
                    "message": "assign ops need card_id, user_id, and role.",
                },
            ),
            (
                {"user_id": "u", "role": "r"},
                {
                    "error": "missing_fields",
                    "index": 1,
                    "action": "assign",
                    "missing": ["card_id"],
                    "message": "assign ops need card_id, user_id, and role.",
                },
            ),
            (
                {"action": "remove", "card_id": "c"},
                {
                    "error": "missing_fields",
                    "index": 1,
                    "action": "remove",
                    "missing": ["stakeholder_id"],
                    "message": "remove ops need stakeholder_id.",
                },
            ),
            (
                {"action": "promote"},
                {
                    "error": "unknown_action",
                    "index": 1,
                    "action": "promote",
                    "message": 'Supported actions are "assign" and "remove".',
                },
            ),
        ],
    )
    def test_a_bad_op_names_itself_and_nothing_is_kept(self, op, error):
        ops = [{"card_id": "c", "user_id": "u", "role": "owner"}, op]
        assert server._validate_stakeholder_ops(ops) == ([], error)


class TestWriteGates:
    def test_writes_enabled_means_no_message(self, monkeypatch):
        monkeypatch.setattr(server, "MCP_WRITES_ENABLED", True)
        assert server._writes_disabled_message() is None

    def test_the_kill_switch_message(self, monkeypatch):
        monkeypatch.setattr(server, "MCP_WRITES_ENABLED", False)
        assert server._writes_disabled_message() == server._fmt(
            {
                "error": "writes_disabled",
                "message": (
                    "MCP writes are disabled on this deployment "
                    "(MCP_WRITES_ENABLED=false). Read tools remain available."
                ),
            }
        )

    def test_no_confirmation_when_the_gate_is_off(self, monkeypatch):
        monkeypatch.setattr(server, "MCP_REQUIRE_DRYRUN_FIRST", False)
        monkeypatch.setattr(server, "MCP_BATCH_CONFIRMATION_THRESHOLD", 1)
        assert server._confirmation_required_message("create_cards_bulk", 500) is None

    @pytest.mark.parametrize("rows", [0, 20])
    def test_no_confirmation_up_to_the_threshold(self, monkeypatch, rows):
        monkeypatch.setattr(server, "MCP_REQUIRE_DRYRUN_FIRST", True)
        monkeypatch.setattr(server, "MCP_BATCH_CONFIRMATION_THRESHOLD", 20)
        assert server._confirmation_required_message("create_cards_bulk", rows) is None

    def test_above_the_threshold_a_confirm_token_is_required(self, monkeypatch):
        monkeypatch.setattr(server, "MCP_REQUIRE_DRYRUN_FIRST", True)
        monkeypatch.setattr(server, "MCP_BATCH_CONFIRMATION_THRESHOLD", 20)
        assert json.loads(server._confirmation_required_message("archive_cards", 21)) == {
            "error": "confirm_token_required",
            "message": (
                "This commit would write 21 rows, which is above the per-call "
                "confirmation threshold (20). Re-run with dry_run=True first; the "
                "response will include a confirm_token. Show the dry-run preview to "
                "the user, then pass the confirm_token back here on the commit call."
            ),
            "threshold": 20,
            "received": 21,
            "tool": "archive_cards",
        }


class TestFormatting:
    def test_fmt_indents_two_spaces_and_stringifies_the_unknown(self):
        class Odd:
            def __str__(self):
                return "odd"

        assert server._fmt({"a": [1, Odd()]}) == '{\n  "a": [\n    1,\n    "odd"\n  ]\n}'

    def test_compact_drops_only_none_and_empty_strings(self):
        assert server._compact({"a": None, "b": "", "c": 0, "d": False, "e": [], "f": "x"}) == {
            "c": 0,
            "d": False,
            "e": [],
            "f": "x",
        }
