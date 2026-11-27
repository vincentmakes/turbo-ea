"""The pure helpers behind the PPM tools (``turbo_ea_mcp/ppm.py``).

Every helper is called directly and its whole return value asserted, so a
changed literal, bound or message is caught here rather than in a tool test.
"""

from __future__ import annotations

import pytest

from turbo_ea_mcp import ppm

U1 = "00000000-0000-4000-8000-000000000001"
U2 = "00000000-0000-4000-8000-000000000002"
U3 = "00000000-0000-4000-8000-000000000003"
UPPER = "ABCDEF00-0000-4000-8000-000000000001"


class TestLiterals:
    def test_the_literals_mirror_the_backend_schemas(self):
        assert ppm.TASK_STATUSES == ("todo", "in_progress", "done", "blocked")
        assert ppm.TASK_PRIORITIES == ("critical", "high", "medium", "low")
        assert ppm.HEALTH_VALUES == ("onTrack", "atRisk", "offTrack")
        assert ppm.RISK_STATUSES == ("open", "mitigating", "mitigated", "closed", "accepted")
        assert ppm.DEPENDENCY_KINDS == ("task", "wbs")
        assert ppm.DEPENDENCY_TYPE == "FS"
        assert (ppm.SCORE_MIN, ppm.SCORE_MAX) == (1, 5)
        assert (ppm.COMPLETION_MIN, ppm.COMPLETION_MAX) == (0, 100)
        assert ppm.COMMENT_MAX_LENGTH == 10000
        assert ppm.REFUSAL_STATUSES == (400, 403, 404, 409, 422)

    def test_the_entities_route_to_their_collections_and_tabs(self):
        shapes = [
            (e.label, e.collection, e.item, e.tab, e.required, e.dates, e.local_keys)
            for e in (ppm.WORK_PACKAGES, ppm.TASKS, ppm.STATUS_REPORTS, ppm.RISKS)
        ]
        assert shapes == [
            (
                "work package",
                "wbs",
                "wbs",
                "gantt",
                ("title",),
                ("start_date", "end_date"),
                frozenset({"ref", "parent_ref"}),
            ),
            (
                "task",
                "tasks",
                "tasks",
                "tasks",
                ("title",),
                ("start_date", "due_date"),
                frozenset(),
            ),
            ("status report", "reports", "reports", "reports", ("report_date",), None, frozenset()),
            ("risk", "risks", "risks", "risks", ("title",), None, frozenset()),
        ]

    def test_the_key_sets_are_closed_and_match_the_create_schemas(self):
        assert sorted(ppm.WORK_PACKAGES.fields) == sorted(
            [
                "title",
                "description",
                "parent_id",
                "start_date",
                "end_date",
                "sort_order",
                "is_milestone",
                "completion",
                "assignee_id",
            ]
        )
        assert sorted(ppm.TASKS.fields) == sorted(
            [
                "title",
                "description",
                "status",
                "priority",
                "assignee_id",
                "start_date",
                "due_date",
                "sort_order",
                "tags",
                "wbs_id",
            ]
        )
        assert ppm.STATUS_REPORTS.fields == {
            "report_date": ppm.REQUIRED_DATE,
            "schedule_health": ppm.Choice(ppm.HEALTH_VALUES),
            "cost_health": ppm.Choice(ppm.HEALTH_VALUES),
            "scope_health": ppm.Choice(ppm.HEALTH_VALUES),
            "summary": ppm.TEXT,
            "accomplishments": ppm.TEXT,
            "next_steps": ppm.TEXT,
        }
        assert ppm.RISKS.fields == {
            "title": ppm.TITLE,
            "description": ppm.TEXT,
            "probability": ppm.SCORE,
            "impact": ppm.SCORE,
            "mitigation": ppm.TEXT,
            "owner_id": ppm.REF_ID,
            "status": ppm.Choice(ppm.RISK_STATUSES),
        }
        assert ppm.WORK_PACKAGES.fields["completion"] == ppm.COMPLETION
        assert ppm.WORK_PACKAGES.fields["is_milestone"] == ppm.FLAG
        assert ppm.WORK_PACKAGES.fields["sort_order"] == ppm.ORDER
        assert ppm.TASKS.fields["tags"] == ppm.TAGS
        assert ppm.TASKS.fields["status"] == ppm.Choice(ppm.TASK_STATUSES)
        assert ppm.TASKS.fields["priority"] == ppm.Choice(ppm.TASK_PRIORITIES)
        assert ppm.TASKS.fields["due_date"] == ppm.DATE

    def test_the_response_key_tuples(self):
        assert ppm.DEPENDENCY_KEYS == ("id", "pred_kind", "pred_id", "succ_kind", "succ_id", "kind")
        assert ppm.COMMENT_KEYS == (
            "id",
            "user_id",
            "user_display_name",
            "content",
            "created_at",
            "updated_at",
        )
        assert ppm.RISK_KEYS[-1] == "status" and "risk_score" in ppm.RISK_KEYS
        assert "initiative_id" not in ppm.TASK_KEYS + ppm.WORK_PACKAGE_KEYS + ppm.REPORT_KEYS
        assert ppm.WORK_PACKAGES.keys == ppm.WORK_PACKAGE_KEYS
        assert ppm.TASKS.keys == ppm.TASK_KEYS
        assert ppm.STATUS_REPORTS.keys == ppm.REPORT_KEYS
        assert ppm.RISKS.keys == ppm.RISK_KEYS


class TestIds:
    def test_canonical_uuid(self):
        assert ppm.canonical_uuid(UPPER) == UPPER.lower()
        assert ppm.canonical_uuid("abcdef0000004000800000000000000 1") is None
        assert ppm.canonical_uuid("x/../cards") is None
        assert ppm.canonical_uuid(12) is None
        assert ppm.canonical_uuid(None) is None

    def test_normalise_ids_canonicalises_every_id(self):
        assert ppm.normalise_ids({"initiative_id": UPPER, "task_id": U2}) == (
            {"initiative_id": UPPER.lower(), "task_id": U2},
            None,
        )

    def test_normalise_ids_refuses_the_first_bad_one(self):
        assert ppm.normalise_ids({"initiative_id": U1, "task_id": "../x"}) == (
            {},
            {
                "error": "invalid_id",
                "parameter": "task_id",
                "message": (
                    "task_id must be a UUID. search_cards with type='Initiative' "
                    "finds an initiative; get_ppm_plan lists its work packages "
                    "and tasks."
                ),
            },
        )

    def test_ppm_path(self):
        assert ppm.ppm_path(U1, "gantt") == f"/ppm/{U1}?tab=gantt"


class TestSmallChecks:
    @pytest.mark.parametrize(
        "value, expected",
        [
            ("2026-11-27", "2026-11-27"),
            ("2024-02-29", "2024-02-29"),
            ("2026-02-30", None),
            ("2026-13-01", None),
            ("20261127", None),
            ("2026-11-27T10:00:00", None),
            (" 2026-11-27", None),
            ("", None),
            (None, None),
            (20261127, None),
        ],
    )
    def test_iso_date(self, value, expected):
        assert ppm.iso_date(value) == expected

    @pytest.mark.parametrize(
        "limit, expected",
        [(0, 1), (1, 1), (10, 10), (100, 100), (101, 100), (-5, 1), (True, 1), ("5", 1), (None, 1)],
    )
    def test_clamp_limit(self, limit, expected):
        assert ppm.clamp_limit(limit) == expected

    def test_clamp_limit_takes_other_bounds(self):
        assert ppm.clamp_limit(7, 2, 5) == 5
        assert ppm.clamp_limit(1, 2, 5) == 2

    def test_disabled_refusal(self):
        off = {
            "error": "ppm_disabled",
            "message": (
                "The PPM module is switched off on this Turbo EA instance. An "
                "administrator can switch it on under Settings; until then the "
                "PPM tools read and write nothing."
            ),
        }
        assert ppm.disabled_refusal({"enabled": True}) is None
        assert ppm.disabled_refusal({"enabled": False}) == off
        assert ppm.disabled_refusal({"enabled": "true"}) == off
        assert ppm.disabled_refusal({}) == off
        assert ppm.disabled_refusal([]) == off

    def test_cap_refusal(self):
        assert ppm.cap_refusal(200, 200) is None
        assert ppm.cap_refusal(0, 200) is None
        assert ppm.cap_refusal(201, 200) == {
            "error": "batch_too_large",
            "message": (
                "This call names 201 rows but the MCP per-call cap is 200 "
                "(MCP_MAX_PPM_ROWS_PER_CALL). Split it into several calls."
            ),
            "cap": 200,
            "received": 201,
        }

    @pytest.mark.parametrize("status", [400, 403, 404, 409, 422])
    def test_refusal_maps_the_caller_statuses(self, status):
        assert ppm.refusal(status, "Nope", "save_refused") == {
            "error": "save_refused",
            "status_code": status,
            "detail": "Nope",
        }

    @pytest.mark.parametrize("status", [401, 405, 429, 500, 502])
    def test_refusal_leaves_other_statuses_to_be_raised(self, status):
        assert ppm.refusal(status, "x", "e") is None


class TestTrimming:
    def test_trim_keeps_only_the_keys(self):
        assert ppm.trim({"id": U1, "kind": "FS", "initiative_id": U2}, ppm.DEPENDENCY_KEYS) == {
            "id": U1,
            "pred_kind": None,
            "pred_id": None,
            "succ_kind": None,
            "succ_id": None,
            "kind": "FS",
        }
        assert ppm.trim("x", ("id",)) == {"id": None}

    def test_trim_rows_drops_non_dicts(self):
        assert ppm.trim_rows([{"id": 1, "x": 2}, "junk", None], ("id",)) == [{"id": 1}]
        assert ppm.trim_rows({"id": 1}, ("id",)) == []

    def test_orderings(self):
        rows = [
            {"d": "2026-01-02", "risk_score": 4},
            {"d": None, "risk_score": 25},
            {"d": "2026-03-01", "risk_score": True},
            {"d": "2025-12-31", "risk_score": 4},
        ]
        assert [r["d"] for r in ppm.newest_first(rows, "d")] == [
            "2026-03-01",
            "2026-01-02",
            "2025-12-31",
            None,
        ]
        assert [r["d"] for r in ppm.oldest_first(rows, "d")] == [
            None,
            "2025-12-31",
            "2026-01-02",
            "2026-03-01",
        ]
        assert [r["d"] for r in ppm.highest_score_first(rows)] == [
            None,
            "2026-01-02",
            "2025-12-31",
            "2026-03-01",
        ]

    def test_label_dependencies(self):
        deps = [
            {"id": "d1", "pred_kind": "wbs", "pred_id": U1, "succ_kind": "task", "succ_id": U2},
            {"id": "d2", "pred_kind": "task", "pred_id": U1, "succ_kind": "wbs", "succ_id": U3},
        ]
        tasks = [{"id": U2, "title": "Build"}]
        packages = [{"id": U1, "title": "Design"}]
        assert ppm.label_dependencies(deps, tasks, packages) == [
            {**deps[0], "pred_title": "Design", "succ_title": "Build"},
            {**deps[1], "pred_title": None, "succ_title": None},
        ]

    def test_plan_counts(self):
        packages = [{"is_milestone": True}, {"is_milestone": False}, {}, {"is_milestone": "yes"}]
        tasks = [{"status": "done"}, {"status": "todo"}, {"status": "done"}]
        assert ppm.plan_counts(packages, tasks) == {
            "work_packages": 3,
            "milestones": 1,
            "tasks": 3,
            "tasks_done": 2,
        }
        assert ppm.plan_counts([], []) == {
            "work_packages": 0,
            "milestones": 0,
            "tasks": 0,
            "tasks_done": 0,
        }


class TestCheckValue:
    @pytest.mark.parametrize(
        "kind, value, expected",
        [
            (ppm.TITLE, "  Plan  ", ("Plan", None)),
            (ppm.TITLE, "x", ("x", None)),
            (ppm.TITLE, "", (None, "must be a non-blank string")),
            (ppm.TITLE, "   ", (None, "must be a non-blank string")),
            (ppm.TITLE, None, (None, "must be a non-blank string")),
            (ppm.TEXT, "Hi", ("Hi", None)),
            (ppm.TEXT, "", ("", None)),
            (ppm.TEXT, None, (None, None)),
            (ppm.TEXT, 3, (None, "must be a string, or null to clear it")),
            (ppm.DATE, "2026-11-27", ("2026-11-27", None)),
            (ppm.DATE, None, (None, None)),
            (ppm.DATE, "27/11/2026", (None, "must be a date as YYYY-MM-DD, or null to clear it")),
            (ppm.REQUIRED_DATE, "2026-11-27", ("2026-11-27", None)),
            (ppm.REQUIRED_DATE, None, (None, "must be a date as YYYY-MM-DD")),
            (ppm.REQUIRED_DATE, "2026-11-31", (None, "must be a date as YYYY-MM-DD")),
            (ppm.REF_ID, UPPER, (UPPER.lower(), None)),
            (ppm.REF_ID, "", (None, None)),
            (ppm.REF_ID, None, (None, None)),
            (ppm.REF_ID, "u1", (None, 'must be a UUID, or "" / null to clear it')),
            (ppm.SCORE, 0, (None, "must be an integer from 1 to 5")),
            (ppm.SCORE, 1, (1, None)),
            (ppm.SCORE, 5, (5, None)),
            (ppm.SCORE, 6, (None, "must be an integer from 1 to 5")),
            (ppm.SCORE, 3.0, (None, "must be an integer from 1 to 5")),
            (ppm.SCORE, True, (None, "must be an integer from 1 to 5")),
            (ppm.SCORE, "3", (None, "must be an integer from 1 to 5")),
            (ppm.COMPLETION, 0, (0, None)),
            (ppm.COMPLETION, 100, (100, None)),
            (ppm.COMPLETION, 37.5, (37.5, None)),
            (ppm.COMPLETION, 100.1, (None, "must be a number from 0 to 100")),
            (ppm.COMPLETION, -0.1, (None, "must be a number from 0 to 100")),
            (ppm.COMPLETION, False, (None, "must be a number from 0 to 100")),
            (ppm.COMPLETION, "50", (None, "must be a number from 0 to 100")),
            (ppm.ORDER, 0, (0, None)),
            (ppm.ORDER, -2, (-2, None)),
            (ppm.ORDER, 1.5, (None, "must be an integer")),
            (ppm.ORDER, True, (None, "must be an integer")),
            (ppm.FLAG, True, (True, None)),
            (ppm.FLAG, False, (False, None)),
            (ppm.FLAG, 1, (None, "must be true or false")),
            (ppm.TAGS, ["a", "b"], (["a", "b"], None)),
            (ppm.TAGS, [], ([], None)),
            (ppm.TAGS, ["a", 1], (None, "must be a list of strings")),
            (ppm.TAGS, "a", (None, "must be a list of strings")),
            ("nope", 1, (None, "is not a field this tool writes")),
        ],
    )
    def test_kinds(self, kind, value, expected):
        assert ppm.check_value(kind, value) == expected

    def test_choice(self):
        choice = ppm.Choice(ppm.TASK_STATUSES)
        assert ppm.check_value(choice, "done") == ("done", None)
        problem = (None, "takes one of todo, in_progress, done, blocked")
        assert ppm.check_value(choice, "Done") == problem
        assert ppm.check_value(choice, None) == problem
        assert ppm.check_value(choice, ["done"]) == problem

    def test_tags_are_copied(self):
        tags = ["a"]
        sent, _ = ppm.check_value(ppm.TAGS, tags)
        assert sent == tags and sent is not tags


class TestCheckComment:
    def test_accepts_one_to_ten_thousand_characters(self):
        assert ppm.check_comment("x") == ("x", None)
        assert ppm.check_comment("y" * 10000) == ("y" * 10000, None)
        assert ppm.check_comment("  padded  ") == ("  padded  ", None)

    def test_refuses_longer(self):
        assert ppm.check_comment("y" * 10001) == (
            "",
            {
                "error": "invalid_value",
                "field": "content",
                "length": 10001,
                "message": "content takes at most 10000 characters.",
            },
        )

    @pytest.mark.parametrize("content", ["", "   \n", None, 3])
    def test_refuses_blank_or_not_text(self, content):
        assert ppm.check_comment(content) == (
            "",
            {
                "error": "invalid_value",
                "field": "content",
                "message": "content must be a non-blank string.",
            },
        )


class TestValidateItem:
    def test_a_create(self):
        assert ppm.validate_item(
            {"title": " Risk ", "probability": 2, "owner_id": ""}, 3, ppm.RISKS
        ) == (
            {
                "index": 3,
                "id": None,
                "fields": {"title": "Risk", "probability": 2, "owner_id": None},
            },
            [],
        )

    def test_an_update(self):
        assert ppm.validate_item({"id": UPPER, "status": "done"}, 0, ppm.TASKS) == (
            {"index": 0, "id": UPPER.lower(), "fields": {"status": "done"}},
            [],
        )

    def test_not_a_dict(self):
        assert ppm.validate_item(["title"], 2, ppm.TASKS) == (
            {},
            [{"error": "invalid_row", "index": 2, "message": "Each item must be an object."}],
        )

    def test_an_unknown_key_lists_the_allowed_ones(self):
        _, errors = ppm.validate_item({"title": "x", "budget": 1}, 1, ppm.RISKS)
        assert errors == [
            {
                "error": "unknown_field",
                "index": 1,
                "field": "budget",
                "allowed_fields": sorted({"id", *ppm.RISKS.fields}),
                "message": "Unknown keys are refused, never silently dropped.",
            }
        ]

    def test_ref_is_not_a_key_of_other_entities(self):
        _, errors = ppm.validate_item({"title": "x", "ref": "a"}, 0, ppm.TASKS)
        assert [e["error"] for e in errors] == ["unknown_field"]

    def test_a_bad_id(self):
        _, errors = ppm.validate_item({"id": "T-1", "title": "x"}, 0, ppm.TASKS)
        assert errors == [
            {
                "error": "invalid_value",
                "index": 0,
                "field": "id",
                "message": ("id must be the UUID of an existing task; leave it out to create one."),
            }
        ]

    def test_a_bad_value_names_the_field_and_the_value(self):
        _, errors = ppm.validate_item({"title": "x", "impact": 6}, 4, ppm.RISKS)
        assert errors == [
            {
                "error": "invalid_value",
                "index": 4,
                "field": "impact",
                "value": 6,
                "message": "impact must be an integer from 1 to 5.",
            }
        ]

    def test_every_problem_of_a_row_is_listed(self):
        _, errors = ppm.validate_item({"title": "", "status": "nope", "x": 1}, 0, ppm.TASKS)
        assert [(e["error"], e["field"]) for e in errors] == [
            ("invalid_value", "title"),
            ("invalid_value", "status"),
            ("unknown_field", "x"),
        ]

    @pytest.mark.parametrize("value", ["", "  ", None, 3])
    def test_a_blank_ref(self, value):
        _, errors = ppm.validate_item({"title": "x", "ref": value}, 0, ppm.WORK_PACKAGES)
        assert errors == [
            {
                "error": "invalid_value",
                "index": 0,
                "field": "ref",
                "message": "ref must be a non-blank string.",
            }
        ]

    def test_refs_are_kept_beside_the_fields(self):
        row, errors = ppm.validate_item(
            {"title": "x", "ref": "a", "parent_ref": "b"}, 0, ppm.WORK_PACKAGES
        )
        assert errors == []
        assert row == {
            "index": 0,
            "id": None,
            "fields": {"title": "x"},
            "ref": "a",
            "parent_ref": "b",
        }

    def test_an_update_that_names_nothing(self):
        assert ppm.validate_item({"id": U1}, 5, ppm.RISKS)[1] == [
            {
                "error": "invalid_row",
                "index": 5,
                "message": "An update must name a field to change.",
            }
        ]

    def test_an_update_naming_only_a_parent_ref_is_a_change(self):
        assert ppm.validate_item({"id": U1, "parent_ref": "a"}, 0, ppm.WORK_PACKAGES)[1] == []

    def test_a_create_without_its_required_field(self):
        assert ppm.validate_item({"summary": "s"}, 1, ppm.STATUS_REPORTS)[1] == [
            {
                "error": "invalid_row",
                "index": 1,
                "missing": ["report_date"],
                "message": "A new status report needs report_date.",
            }
        ]

    def test_an_update_needs_no_required_field(self):
        assert ppm.validate_item({"id": U1, "summary": "s"}, 0, ppm.STATUS_REPORTS)[1] == []

    def test_an_update_with_a_ref(self):
        assert ppm.validate_item({"id": U1, "title": "t", "ref": "a"}, 0, ppm.WORK_PACKAGES)[1] == [
            {
                "error": "invalid_row",
                "index": 0,
                "message": "ref names a new item; an update has its id.",
            }
        ]

    def test_parent_id_and_parent_ref_together(self):
        item = {"title": "t", "parent_id": U1, "parent_ref": "a"}
        assert ppm.validate_item(item, 0, ppm.WORK_PACKAGES)[1] == [
            {
                "error": "invalid_row",
                "index": 0,
                "message": "Give parent_id or parent_ref, not both.",
            }
        ]

    def test_a_milestone_with_an_end_date(self):
        item = {
            "title": "t",
            "is_milestone": True,
            "start_date": "2026-01-01",
            "end_date": "2026-01-01",
        }
        assert ppm.validate_item(item, 0, ppm.WORK_PACKAGES)[1] == [
            {
                "error": "invalid_row",
                "index": 0,
                "message": (
                    "A milestone has one date: set start_date only; its end_date "
                    "is always its start_date."
                ),
            }
        ]

    def test_a_work_package_with_both_dates_is_fine(self):
        item = {"title": "t", "is_milestone": False, "end_date": "2026-01-01"}
        assert ppm.validate_item(item, 0, ppm.WORK_PACKAGES)[1] == []

    def test_inverted_dates(self):
        item = {"title": "t", "start_date": "2026-02-01", "due_date": "2026-01-31"}
        assert ppm.validate_item(item, 2, ppm.TASKS)[1] == [
            {
                "error": "invalid_row",
                "index": 2,
                "message": "start_date (2026-02-01) is after due_date (2026-01-31).",
            }
        ]

    def test_equal_or_one_sided_dates_are_fine(self):
        same = {"title": "t", "start_date": "2026-02-01", "due_date": "2026-02-01"}
        assert ppm.validate_item(same, 0, ppm.TASKS)[1] == []
        one = {"title": "t", "start_date": "2026-02-01", "due_date": None}
        assert ppm.validate_item(one, 0, ppm.TASKS)[1] == []


class TestValidateItems:
    def test_empty_or_not_a_list(self):
        refusal = [
            {"error": "invalid_row", "index": None, "message": "items must be a non-empty list."}
        ]
        assert ppm.validate_items([], ppm.TASKS) == ([], refusal)
        assert ppm.validate_items({"title": "x"}, ppm.TASKS) == ([], refusal)

    def test_good_rows(self):
        rows, errors = ppm.validate_items([{"title": "a"}, {"id": U1, "title": "b"}], ppm.TASKS)
        assert errors == []
        assert rows == [
            {"index": 0, "id": None, "fields": {"title": "a"}},
            {"index": 1, "id": U1, "fields": {"title": "b"}},
        ]

    def test_an_id_named_twice(self):
        _, errors = ppm.validate_items(
            [
                {"id": U1, "title": "a"},
                {"id": UPPER.lower(), "title": "c"},
                {"id": U1, "title": "b"},
            ],
            ppm.TASKS,
        )
        assert errors == [
            {
                "error": "duplicate_id",
                "index": 2,
                "id": U1,
                "message": "This id is already item 0; give each row once.",
            }
        ]

    def test_refs(self):
        items = [
            {"title": "a", "ref": "A"},
            {"title": "b", "parent_ref": "A", "ref": "B"},
            {"title": "c", "parent_ref": "C"},
            {"title": "d", "ref": "A"},
            {"title": "e", "parent_ref": "E", "ref": "E"},
        ]
        _, errors = ppm.validate_items(items, ppm.WORK_PACKAGES)
        assert errors == [
            {
                "error": "unknown_ref",
                "index": 2,
                "parent_ref": "C",
                "message": "parent_ref must be the ref of an earlier item of this call.",
            },
            {
                "error": "duplicate_ref",
                "index": 3,
                "ref": "A",
                "message": "ref is already item 0's.",
            },
            {
                "error": "unknown_ref",
                "index": 4,
                "parent_ref": "E",
                "message": "parent_ref must be the ref of an earlier item of this call.",
            },
        ]

    def test_a_parent_ref_naming_a_later_item(self):
        items = [{"title": "b", "parent_ref": "A"}, {"title": "a", "ref": "A"}]
        _, errors = ppm.validate_items(items, ppm.WORK_PACKAGES)
        assert [(e["error"], e["index"]) for e in errors] == [("unknown_ref", 0)]


class TestAgainstTheCurrentRows:
    def test_diff_changes(self):
        current = {"title": "Old", "assignee_id": UPPER.lower(), "completion": 50.0, "tags": ["a"]}
        fields = {"title": "New", "assignee_id": UPPER, "completion": 50, "tags": ["a"], "x": None}
        assert ppm.diff_changes(fields, current) == {"title": {"old": "Old", "new": "New"}}

    def test_diff_changes_sees_a_clear(self):
        assert ppm.diff_changes({"description": None}, {"description": "d"}) == {
            "description": {"old": "d", "new": None}
        }

    def test_unknown_id_errors(self):
        rows = [
            {"index": 0, "id": None, "fields": {}},
            {"index": 1, "id": U1, "fields": {}},
            {"index": 2, "id": U2, "fields": {}},
        ]
        assert ppm.unknown_id_errors(rows, {U1: {}}, ppm.RISKS) == [
            {
                "error": "unknown_id",
                "index": 2,
                "id": U2,
                "message": (
                    "This id is not a risk of this initiative; get_ppm_plan "
                    "and the list tools give the ids."
                ),
            }
        ]

    def test_work_package_parents(self):
        packages = {U1: {"is_milestone": False}, U2: {"is_milestone": True}}
        rows = [
            {"index": 0, "id": None, "fields": {"parent_id": U1}},
            {"index": 1, "id": U1, "fields": {"parent_id": U1}},
            {"index": 2, "id": None, "fields": {"parent_id": U3}},
            {"index": 3, "id": None, "fields": {"parent_id": None}},
        ]
        assert ppm.work_package_errors(rows, packages) == [
            {
                "error": "invalid_value",
                "index": 1,
                "message": "A work package cannot be its own parent.",
            },
            {
                "error": "unknown_ref",
                "index": 2,
                "field": "parent_id",
                "value": U3,
                "message": "parent_id is not a work package of this initiative.",
            },
        ]

    def test_an_end_date_for_a_stored_milestone(self):
        packages = {U1: {"is_milestone": False}, U2: {"is_milestone": True}}
        rows = [
            {"index": 0, "id": U2, "fields": {"end_date": "2026-01-01"}},
            {"index": 1, "id": U1, "fields": {"end_date": "2026-01-01"}},
            {"index": 2, "id": U2, "fields": {"end_date": "2026-01-01", "is_milestone": False}},
        ]
        assert ppm.work_package_errors(rows, packages) == [
            {
                "error": "invalid_row",
                "index": 0,
                "message": (
                    "This work package is a milestone: set its start_date; its "
                    "end_date is always its start_date."
                ),
            }
        ]

    def test_task_work_packages(self):
        packages = {U1: {"is_milestone": False}, U2: {"is_milestone": True}}
        rows = [
            {"index": 0, "id": None, "fields": {"wbs_id": U1}},
            {"index": 1, "id": None, "fields": {"wbs_id": U2}},
            {"index": 2, "id": None, "fields": {"wbs_id": U3}},
            {"index": 3, "id": None, "fields": {"wbs_id": None}},
            {"index": 4, "id": None, "fields": {}},
        ]
        assert ppm.task_errors(rows, packages) == [
            {
                "error": "invalid_value",
                "index": 1,
                "field": "wbs_id",
                "value": U2,
                "message": "wbs_id is a milestone; a task sits in a work package.",
            },
            {
                "error": "unknown_ref",
                "index": 2,
                "field": "wbs_id",
                "value": U3,
                "message": (
                    "wbs_id is not a work package of this initiative; save the "
                    "work package first with save_ppm_work_packages."
                ),
            },
        ]


class TestMilestoneFields:
    def test_a_new_milestone_ends_on_its_start(self):
        fields = {"is_milestone": True, "start_date": "2026-05-01"}
        assert ppm.milestone_fields(fields, {}) == {**fields, "end_date": "2026-05-01"}

    def test_a_new_milestone_without_a_date(self):
        assert ppm.milestone_fields({"is_milestone": True}, {}) == {
            "is_milestone": True,
            "end_date": None,
        }

    def test_turning_a_package_into_a_milestone_uses_its_stored_start(self):
        assert ppm.milestone_fields({"is_milestone": True}, {"start_date": "2026-01-02"}) == {
            "is_milestone": True,
            "end_date": "2026-01-02",
        }

    def test_moving_a_stored_milestone(self):
        current = {"is_milestone": True, "start_date": "2026-01-02"}
        assert ppm.milestone_fields({"start_date": "2026-03-04"}, current) == {
            "start_date": "2026-03-04",
            "end_date": "2026-03-04",
        }

    def test_other_changes_to_a_milestone_leave_its_dates(self):
        current = {"is_milestone": True, "start_date": "2026-01-02"}
        assert ppm.milestone_fields({"title": "t"}, current) == {"title": "t"}

    def test_a_work_package_is_left_alone(self):
        fields = {"start_date": "2026-01-01", "end_date": "2026-02-01"}
        assert ppm.milestone_fields(fields, {"is_milestone": False}) == fields
        assert ppm.milestone_fields({"is_milestone": False, "start_date": "x"}, {}) == {
            "is_milestone": False,
            "start_date": "x",
        }


class TestPlanSaves:
    def test_create_update_unchanged(self):
        rows = [
            {"index": 0, "id": None, "fields": {"title": "New"}},
            {"index": 1, "id": U1, "fields": {"title": "Renamed", "status": "todo"}},
            {"index": 2, "id": U2, "fields": {"status": "done"}},
        ]
        current = {
            U1: {"id": U1, "title": "Old", "status": "todo"},
            U2: {"id": U2, "title": "Same", "status": "done"},
        }
        assert ppm.plan_saves(rows, current) == [
            {"index": 0, "action": "create", "fields": {"title": "New"}},
            {
                "index": 1,
                "id": U1,
                "title": "Old",
                "action": "update",
                "changes": {"title": {"old": "Old", "new": "Renamed"}},
            },
            {"index": 2, "id": U2, "title": "Same", "action": "unchanged"},
        ]

    def test_refs_and_milestones(self):
        rows = [
            {
                "index": 0,
                "id": None,
                "fields": {"title": "M", "is_milestone": True, "start_date": "2026-06-01"},
                "ref": "M",
            },
            {"index": 1, "id": U1, "fields": {}, "parent_ref": "M"},
        ]
        current = {U1: {"id": U1, "title": "P", "parent_id": None}}
        assert ppm.plan_saves(rows, current, milestones=True) == [
            {
                "index": 0,
                "action": "create",
                "fields": {
                    "title": "M",
                    "is_milestone": True,
                    "start_date": "2026-06-01",
                    "end_date": "2026-06-01",
                },
                "ref": "M",
            },
            {
                "index": 1,
                "id": U1,
                "title": "P",
                "action": "update",
                "changes": {"parent_id": {"old": None, "new": {"ref": "M"}}},
                "parent_ref": "M",
            },
        ]

    def test_without_milestones_the_date_rule_is_off(self):
        rows = [{"index": 0, "id": None, "fields": {"is_milestone": True, "start_date": "x"}}]
        assert ppm.plan_saves(rows, {})[0]["fields"] == {"is_milestone": True, "start_date": "x"}

    def test_request_body(self):
        create = {"action": "create", "fields": {"title": "a"}, "parent_ref": "P"}
        assert ppm.request_body(create, {"P": U1}) == {"title": "a", "parent_id": U1}
        update = {
            "action": "update",
            "changes": {"title": {"old": "a", "new": "b"}, "wbs_id": {"old": U1, "new": None}},
        }
        assert ppm.request_body(update, {}) == {"title": "b", "wbs_id": None}
        moved = {
            "action": "update",
            "changes": {"parent_id": {"old": None, "new": {"ref": "P"}}},
            "parent_ref": "P",
        }
        assert ppm.request_body(moved, {"P": U2}) == {"parent_id": U2}

    def test_request_body_does_not_change_the_plan(self):
        entry = {"action": "create", "fields": {"title": "a"}, "parent_ref": "P"}
        ppm.request_body(entry, {"P": U1})
        assert entry["fields"] == {"title": "a"}

    def test_plan_refusal(self):
        assert ppm.plan_refusal([]) is None
        bad = [{"error": "invalid_value", "index": 0}]
        assert ppm.plan_refusal(bad) == {
            "error": "invalid_items",
            "errors": bad,
            "message": "Nothing was saved. Fix the items listed and call again.",
        }
        mixed = [*bad, {"error": "unknown_id", "index": 1}]
        assert ppm.plan_refusal(mixed) == {
            "error": "unknown_id",
            "errors": mixed,
            "message": "Nothing was saved. Fix the items listed and call again.",
        }

    def test_plan_tally(self):
        plan = [{"action": "create"}, {"action": "create"}, {"action": "unchanged"}]
        assert ppm.plan_tally(plan) == {"create": 2, "update": 0, "unchanged": 1}

    def test_index_rows(self):
        rows = [{"id": UPPER, "t": 1}, {"id": "nope"}, "junk", {"t": 2}]
        assert ppm.index_rows(rows) == {UPPER.lower(): {"id": UPPER, "t": 1}}
        assert ppm.index_rows({"id": U1}) == {}


class TestDependencies:
    def _link(self, pk="wbs", pid=U1, sk="task", sid=U2):
        return {"pred_kind": pk, "pred_id": pid, "succ_kind": sk, "succ_id": sid}

    def test_link_key(self):
        assert ppm.link_key(self._link()) == ("wbs", U1, "task", U2)

    def test_a_good_entry(self):
        raw = self._link(pid=UPPER)
        assert ppm.dependency_entry(raw, 0) == ({**raw, "pred_id": UPPER.lower()}, [])

    def test_not_a_dict(self):
        assert ppm.dependency_entry("x", 3) == (
            {},
            [{"error": "invalid_row", "index": 3, "message": "Each add entry must be an object."}],
        )

    def test_every_problem_of_an_entry(self):
        raw = {
            "pred_kind": "card",
            "pred_id": "x",
            "succ_kind": "task",
            "succ_id": U2,
            "kind": "SS",
        }
        entry, errors = ppm.dependency_entry(raw, 1)
        assert entry == {"pred_kind": "card", "pred_id": None, "succ_kind": "task", "succ_id": U2}
        assert errors == [
            {
                "error": "unknown_field",
                "index": 1,
                "fields": ["kind"],
                "allowed_fields": ["pred_kind", "pred_id", "succ_kind", "succ_id"],
                "message": "Unknown keys are refused; every link is finish-to-start.",
            },
            {
                "error": "invalid_value",
                "index": 1,
                "field": "pred_kind",
                "message": "pred_kind takes one of task, wbs.",
            },
            {
                "error": "invalid_value",
                "index": 1,
                "field": "pred_id",
                "message": "pred_id must be the UUID of a task or work package.",
            },
        ]

    def test_a_missing_successor(self):
        _, errors = ppm.dependency_entry({"pred_kind": "task", "pred_id": U1}, 0)
        assert [e["field"] for e in errors] == ["succ_kind", "succ_id"]

    def test_a_row_depending_on_itself(self):
        _, errors = ppm.dependency_entry(self._link("task", U1, "task", U1), 2)
        assert errors == [
            {"error": "invalid_row", "index": 2, "message": "A row cannot depend on itself."}
        ]

    def test_same_id_other_kind_is_not_a_self_link(self):
        assert ppm.dependency_entry(self._link("task", U1, "wbs", U1), 0)[1] == []

    def test_changes_need_something(self):
        nothing = [
            {"error": "invalid_row", "index": None, "message": "Give at least one add or remove."}
        ]
        assert ppm.dependency_changes(None, None) == ([], [], nothing)
        assert ppm.dependency_changes([], []) == ([], [], nothing)

    def test_changes_must_be_lists(self):
        assert ppm.dependency_changes({"x": 1}, None) == (
            [],
            [],
            [{"error": "invalid_row", "index": None, "message": "add and remove must be lists."}],
        )
        assert ppm.dependency_changes(None, U1)[2][0]["message"] == "add and remove must be lists."

    def test_good_changes(self):
        assert ppm.dependency_changes([self._link()], [UPPER]) == (
            [self._link()],
            [UPPER.lower()],
            [],
        )

    def test_repeats_and_bad_removes(self):
        adds, removes, errors = ppm.dependency_changes(
            [self._link(), self._link()], [U3, "bad", U3]
        )
        assert removes == [U3, "", U3]
        assert errors == [
            {
                "error": "duplicate_link",
                "index": 1,
                "message": "This link is already add entry 0.",
                "list": "add",
            },
            {
                "error": "invalid_value",
                "index": 1,
                "message": "Each remove entry is a dependency UUID.",
                "list": "remove",
            },
            {
                "error": "duplicate_id",
                "index": 2,
                "message": "This dependency is already removed.",
                "list": "remove",
            },
        ]

    def test_entry_errors_carry_the_list(self):
        _, _, errors = ppm.dependency_changes(["x"], None)
        assert errors == [
            {
                "error": "invalid_row",
                "index": 0,
                "message": "Each add entry must be an object.",
                "list": "add",
            }
        ]

    def test_plan(self):
        dep = {"id": U3, "initiative_id": "i", **self._link(), "kind": "FS"}
        new = self._link("task", U2, "wbs", U1)
        add_plan, remove_plan, errors = ppm.dependency_plan(
            [self._link(), new],
            [],
            {U3: dep},
            {U2: {}},
            {U1: {}},
        )
        assert errors == []
        assert remove_plan == []
        assert add_plan == [
            {"index": 0, "action": "exists", **self._link(), "id": U3},
            {"index": 1, "action": "add", **new},
        ]

    def test_a_removed_link_can_be_added_again(self):
        dep = {"id": U3, **self._link(), "kind": "FS"}
        add_plan, remove_plan, errors = ppm.dependency_plan(
            [self._link()], [U3], {U3: dep}, {U2: {}}, {U1: {}}
        )
        assert errors == []
        assert remove_plan == [
            {
                "index": 0,
                "action": "remove",
                "id": U3,
                "pred_kind": "wbs",
                "pred_id": U1,
                "succ_kind": "task",
                "succ_id": U2,
                "kind": "FS",
            }
        ]
        assert add_plan == [{"index": 0, "action": "add", **self._link()}]

    def test_unknown_ids(self):
        add_plan, remove_plan, errors = ppm.dependency_plan(
            [self._link(), self._link("task", U1, "wbs", U2)], [U3], {}, {U2: {}}, {U1: {}}
        )
        assert add_plan == [{"index": 0, "action": "add", **self._link()}]
        assert remove_plan == []
        assert errors == [
            {
                "error": "unknown_id",
                "index": 0,
                "id": U3,
                "message": (
                    "This id is not a dependency of this initiative; get_ppm_plan lists them."
                ),
                "list": "remove",
            },
            {
                "error": "unknown_id",
                "index": 1,
                "ends": ["pred", "succ"],
                "message": (
                    "Both ends must be a task or work package of this initiative "
                    "(of the kind given)."
                ),
                "list": "add",
            },
        ]

    def test_only_the_missing_end_is_named(self):
        _, _, errors = ppm.dependency_plan([self._link()], [], {}, {}, {U1: {}})
        assert errors[0]["ends"] == ["succ"]
