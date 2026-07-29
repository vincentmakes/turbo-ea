"""Fiscal-year bucketing and the shape of the ``ppm`` formula root.

No database — the aggregation queries are covered by the DB-backed tests; what
matters here is the calendar convention, which is the part most likely to be
got wrong silently.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.services.calculation_engine import _DotDict, _evaluate_formula, base_context_roots
from app.services.calculation_ppm import empty_ppm, fiscal_year_for, needs_ppm


class TestFiscalYearFor:
    @pytest.mark.parametrize(
        "start_month,value,expected",
        [
            # January start: the fiscal year is just the calendar year. The
            # guard that makes this work is easy to omit, and without it every
            # date lands a year late because `month >= 1` is always true.
            (1, date(2025, 1, 1), 2025),
            (1, date(2025, 6, 15), 2025),
            (1, date(2025, 12, 31), 2025),
            # October start (US federal): FY2026 runs Oct 2025 – Sep 2026.
            (10, date(2025, 9, 30), 2025),
            (10, date(2025, 10, 1), 2026),
            (10, date(2026, 9, 30), 2026),
            (10, date(2026, 10, 1), 2027),
            # April start (UK/India style).
            (4, date(2025, 3, 31), 2025),
            (4, date(2025, 4, 1), 2026),
            # December start — the narrowest possible tail.
            (12, date(2025, 11, 30), 2025),
            (12, date(2025, 12, 1), 2026),
        ],
    )
    def test_truth_table(self, start_month, value, expected):
        assert fiscal_year_for(value, start_month) == expected

    def test_no_date_belongs_to_no_year(self):
        assert fiscal_year_for(None, 10) is None

    @pytest.mark.parametrize("bad", [0, 13, -1])
    def test_out_of_range_start_month_falls_back_to_calendar_year(self, bad):
        assert fiscal_year_for(date(2025, 11, 1), bad) == 2025


class TestNeedsPpm:
    def test_detects_a_direct_reference(self):
        assert needs_ppm("ppm.capexBudget") is True

    def test_detects_a_reference_inside_a_string_literal(self):
        # The reason this is a token match and not an AST walk: plucking PPM
        # data off a related card puts the reference in a string.
        assert needs_ppm('SUM(PLUCK(relations.relInitiativeToApp, "ppm.capexBudget"))') is True

    def test_ignores_an_unrelated_formula(self):
        assert needs_ppm("data.costTotalAnnual * 2") is False

    def test_does_not_match_a_substring(self):
        assert needs_ppm("data.ppmScore + 1") is False


class TestEmptyPpm:
    def test_every_measure_is_zero(self):
        payload = empty_ppm(2026)
        for bucket in ("capex", "opex", "total"):
            for measure in ("Budget", "Planned", "Actual"):
                assert payload[f"{bucket}{measure}"] == 0.0
        assert payload["byYear"] == []
        assert payload["currentFiscalYear"] == 2026

    def test_a_formula_over_an_empty_payload_evaluates_cleanly(self):
        # A card with no PPM data must read as zero, not crash — the same
        # reasoning as seeding `relations` with empty lists.
        context = base_context_roots(data=_DotDict())
        assert _evaluate_formula("ppm.capexBudget", context) == 0.0
        assert _evaluate_formula('SUM(PLUCK(ppm.byYear, "capexBudget"))', context) == 0


class TestBaseContextRoots:
    def test_shape_matches_what_the_engine_builds(self):
        # The regression guard for the roots that used to be duplicated across
        # _build_context, validate_formula and two test helpers: adding one in
        # a single place used to leave the others raising NameNotDefined.
        assert set(base_context_roots()) == {
            "data",
            "relations",
            "relation_count",
            "children",
            "children_count",
            "parent",
            "hierarchy_level",
            "ppm",
            "None",
            "True",
            "False",
        }
