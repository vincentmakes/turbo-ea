"""Static formula analysis — no database needed.

Covers the two checks that exist to stop #886 recurring: naming a field key that
does not exist on the target type, and plucking a bare key off a related card
(which raises nothing and quietly sums to 0).
"""

from __future__ import annotations

from app.services.calculation_lint import (
    data_refs,
    lint_formula,
    split_formula_lines,
    suggest_field,
    unknown_field_refs,
)

FIELDS_SCHEMA = [
    {
        "section": "Cost",
        "fields": [
            {"key": "licenseCost", "label": "License Cost", "type": "cost"},
            {"key": "supportCost", "label": "Support Cost", "type": "cost"},
            {"key": "costTotalAnnual", "label": "Total Annual Cost", "type": "cost"},
        ],
    },
    {
        "section": "Fit",
        "fields": [{"key": "businessFit", "label": "Business Fit", "type": "single_select"}],
    },
]


class TestSplitFormulaLines:
    def test_drops_blanks_and_comments(self):
        assert split_formula_lines("# a comment\n\n  data.x  \n") == [(None, "data.x")]

    def test_detects_assignment(self):
        assert split_formula_lines("bf = data.x\nbf * 2") == [("bf", "data.x"), (None, "bf * 2")]

    def test_equality_is_not_an_assignment(self):
        assert split_formula_lines('data.x == "a"') == [(None, 'data.x == "a"')]

    def test_inequality_is_not_an_assignment(self):
        assert split_formula_lines('data.x != "a"') == [(None, 'data.x != "a"')]


class TestDataRefs:
    def test_plain_reference(self):
        assert data_refs("data.licenseCost + 1") == {"licenseCost"}

    def test_subscript_reference(self):
        # `_DotDict` raises KeyError on a missing subscript rather than
        # returning None, so this path must be checked too — and it would
        # otherwise be an easy way past the save-time validation.
        assert data_refs('data["licenseCost"]') == {"licenseCost"}

    def test_nested_lifecycle_yields_the_root_key(self):
        # `lifecycle` is the key that has to exist; `endOfLife` lives inside it.
        assert data_refs("data.lifecycle.endOfLife") == {"lifecycle"}

    def test_string_literal_is_not_a_reference(self):
        # The whole reason this is AST-based rather than a regex.
        assert data_refs('PLUCK(relations.relAppToITC, "data.foo")') == set()

    def test_collects_across_assignment_lines(self):
        formula = "a = data.licenseCost\nb = data.supportCost\na + b"
        assert data_refs(formula) == {"licenseCost", "supportCost"}

    def test_unparseable_formula_yields_nothing(self):
        assert data_refs("data.x +") == set()

    def test_parent_attributes_are_not_data_refs(self):
        assert data_refs("parent.attributes.licenseCost") == set()


class TestUnknownFieldRefs:
    def test_known_keys_pass(self):
        formula = "data.licenseCost + data.supportCost"
        assert unknown_field_refs(formula, FIELDS_SCHEMA) == []

    def test_builtin_props_pass(self):
        formula = 'IF(data.status == "ACTIVE", data.lifecycle.endOfLife, data.name)'
        assert unknown_field_refs(formula, FIELDS_SCHEMA) == []

    def test_typo_is_reported(self):
        formula = "data.LicenseCost + data.supportCost"
        assert unknown_field_refs(formula, FIELDS_SCHEMA) == ["LicenseCost"]

    def test_multiple_unknowns_sorted(self):
        formula = "data.zeta + data.alpha"
        assert unknown_field_refs(formula, FIELDS_SCHEMA) == ["alpha", "zeta"]

    def test_empty_schema_still_allows_builtins(self):
        assert unknown_field_refs("data.name", []) == []
        assert unknown_field_refs("data.anything", None) == ["anything"]


class TestSuggestField:
    def test_case_mismatch_is_the_first_guess(self):
        assert suggest_field("LicenseCost", FIELDS_SCHEMA) == "licenseCost"

    def test_near_miss(self):
        assert suggest_field("licenseCst", FIELDS_SCHEMA) == "licenseCost"

    def test_nothing_close_returns_none(self):
        assert suggest_field("zzzzzzzz", FIELDS_SCHEMA) is None


class TestLintFormula:
    def test_bare_key_over_relations_warns(self):
        warnings = lint_formula('SUM(PLUCK(relations.relInitiativeToApp, "CAPEX"))')
        assert len(warnings) == 1
        assert 'PLUCK key "CAPEX"' in warnings[0]
        assert '"attributes.CAPEX"' in warnings[0]

    def test_attributes_prefix_is_clean(self):
        assert lint_formula('SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))') == ()

    def test_rel_attributes_prefix_is_clean(self):
        assert (
            lint_formula('SUM(PLUCK(relations.relAppToITC, "rel_attributes.costTotalAnnual"))')
            == ()
        )

    def test_ppm_prefix_is_clean(self):
        assert lint_formula('SUM(PLUCK(relations.relInitiativeToApp, "ppm.capexBudget"))') == ()

    def test_wrapper_level_keys_are_clean(self):
        assert lint_formula('PLUCK(relations.relAppToITC, "name")') == ()
        assert lint_formula('FILTER(relations.relAppToITC, "type", "ITComponent")') == ()

    def test_children_collection_is_checked_too(self):
        warnings = lint_formula('SUM(PLUCK(children, "costTotalAnnual"))')
        assert len(warnings) == 1
        assert '"attributes.costTotalAnnual"' in warnings[0]

    def test_alias_from_an_earlier_line_is_tracked(self):
        # The shape where the `attributes.` prefix is most often forgotten, and
        # the one a per-expression walker cannot see.
        formula = 'apps = relations.relAppToITC\nSUM(PLUCK(apps, "costTotalAnnual"))'
        warnings = lint_formula(formula)
        assert len(warnings) == 1
        assert '"attributes.costTotalAnnual"' in warnings[0]

    def test_alias_of_a_plain_list_is_not_flagged(self):
        formula = 'years = ppm.byYear\nSUM(PLUCK(years, "capexBudget"))'
        assert lint_formula(formula) == ()

    def test_concatenated_collections_keep_provenance(self):
        formula = 'SUM(PLUCK(relations.relAppToITC + relations.relAppToDataObj, "cost"))'
        assert len(lint_formula(formula)) == 1

    def test_subscripted_relations_keep_provenance(self):
        formula = 'SUM(PLUCK(relations["relAppToITC"], "cost"))'
        assert len(lint_formula(formula)) == 1

    def test_nested_call_still_recognised(self):
        warnings = lint_formula(
            'COUNT(PLUCK(FILTER(relations.relOrgToApp, "attributes.hosting", "onPrem"), "x"))'
        )
        assert len(warnings) == 1
        assert 'PLUCK key "x"' in warnings[0]

    def test_non_card_collection_is_not_flagged(self):
        # ppm.byYear is a plain list of dicts whose keys sit at the top level.
        assert lint_formula('SUM(PLUCK(FILTER(ppm.byYear, "year", 2026), "capexBudget"))') == ()

    def test_computed_key_is_not_flagged(self):
        assert lint_formula('PLUCK(relations.relAppToITC, "attributes." + data.pick)') == ()

    def test_filter_is_checked(self):
        warnings = lint_formula('COUNT(FILTER(relations.relOrgToApp, "hostingType", "onPremise"))')
        assert len(warnings) == 1
        assert 'FILTER key "hostingType"' in warnings[0]

    def test_duplicate_warnings_are_collapsed(self):
        formula = (
            'a = SUM(PLUCK(relations.relAppToITC, "CAPEX"))\n'
            'b = SUM(PLUCK(relations.relAppToITC, "CAPEX"))\n'
            "a + b"
        )
        assert len(lint_formula(formula)) == 1

    def test_clean_formula_has_no_warnings(self):
        assert lint_formula("COALESCE(data.licenseCost, 0) + COALESCE(data.supportCost, 0)") == ()
