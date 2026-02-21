"""Unit tests for the calculation engine built-in functions and formula evaluator.

These tests do NOT require a database — they test the pure evaluation logic only.
"""

from __future__ import annotations

import pytest

from app.services.calculation_engine import (
    _ABS,
    _AVG,
    _COALESCE,
    _CONCAT,
    _CONTAINS,
    _COUNT,
    _FILTER,
    _IF,
    _LOWER,
    _MAP_SCORE,
    _MAX,
    _MIN,
    _PLUCK,
    _ROUND,
    _SUM,
    _UPPER,
    _DotDict,
    _evaluate_formula,
)

# ---------------------------------------------------------------------------
# Built-in functions
# ---------------------------------------------------------------------------


class TestIF:
    def test_truthy_returns_true_val(self):
        assert _IF(True, "yes", "no") == "yes"

    def test_falsy_returns_false_val(self):
        assert _IF(False, "yes", "no") == "no"

    def test_none_is_falsy(self):
        assert _IF(None, "yes", "no") == "no"

    def test_zero_is_falsy(self):
        assert _IF(0, "yes", "no") == "no"

    def test_nonempty_string_is_truthy(self):
        assert _IF("hello", "yes", "no") == "yes"


class TestSUM:
    def test_sum_numbers(self):
        assert _SUM([1, 2, 3]) == 6

    def test_sum_with_floats(self):
        assert _SUM([1.5, 2.5]) == 4.0

    def test_sum_empty(self):
        assert _SUM([]) == 0

    def test_sum_none(self):
        assert _SUM(None) == 0

    def test_sum_ignores_non_numeric(self):
        assert _SUM([1, "two", None, 3]) == 4


class TestAVG:
    def test_avg_numbers(self):
        assert _AVG([2, 4, 6]) == 4.0

    def test_avg_empty(self):
        assert _AVG([]) is None

    def test_avg_none(self):
        assert _AVG(None) is None

    def test_avg_ignores_non_numeric(self):
        assert _AVG([10, "skip", 20]) == 15.0

    def test_avg_all_non_numeric(self):
        assert _AVG(["a", "b"]) is None


class TestMIN:
    def test_min_numbers(self):
        assert _MIN([3, 1, 2]) == 1

    def test_min_empty(self):
        assert _MIN([]) is None

    def test_min_none(self):
        assert _MIN(None) is None

    def test_min_ignores_non_numeric(self):
        assert _MIN([5, "x", 2]) == 2


class TestMAX:
    def test_max_numbers(self):
        assert _MAX([3, 1, 2]) == 3

    def test_max_empty(self):
        assert _MAX([]) is None

    def test_max_none(self):
        assert _MAX(None) is None


class TestCOUNT:
    def test_count_items(self):
        assert _COUNT([1, 2, 3]) == 3

    def test_count_empty(self):
        assert _COUNT([]) == 0

    def test_count_none(self):
        assert _COUNT(None) == 0

    def test_count_includes_non_numeric(self):
        assert _COUNT(["a", None, 1]) == 3


class TestROUND:
    def test_round_default_zero_decimals(self):
        assert _ROUND(3.7) == 4

    def test_round_two_decimals(self):
        assert _ROUND(3.14159, 2) == 3.14

    def test_round_none(self):
        assert _ROUND(None) is None


class TestABS:
    def test_positive(self):
        assert _ABS(5) == 5

    def test_negative(self):
        assert _ABS(-5) == 5

    def test_none(self):
        assert _ABS(None) is None


class TestCOALESCE:
    def test_returns_first_non_none(self):
        assert _COALESCE(None, None, 42) == 42

    def test_returns_first_if_not_none(self):
        assert _COALESCE("first", "second") == "first"

    def test_all_none(self):
        assert _COALESCE(None, None) is None

    def test_zero_is_not_none(self):
        assert _COALESCE(0, 1) == 0


class TestLOWER:
    def test_lowercase(self):
        assert _LOWER("HELLO") == "hello"

    def test_none(self):
        assert _LOWER(None) is None

    def test_non_string(self):
        assert _LOWER(123) is None


class TestUPPER:
    def test_uppercase(self):
        assert _UPPER("hello") == "HELLO"

    def test_none(self):
        assert _UPPER(None) is None

    def test_non_string(self):
        assert _UPPER(123) is None


class TestCONCAT:
    def test_join_strings(self):
        assert _CONCAT("hello", " ", "world") == "hello world"

    def test_skips_none(self):
        assert _CONCAT("a", None, "b") == "ab"

    def test_converts_numbers(self):
        assert _CONCAT("count: ", 5) == "count: 5"

    def test_empty(self):
        assert _CONCAT() == ""


class TestCONTAINS:
    def test_found(self):
        assert _CONTAINS("hello world", "world") is True

    def test_not_found(self):
        assert _CONTAINS("hello", "world") is False

    def test_non_string(self):
        assert _CONTAINS(None, "x") is False

    def test_number_input(self):
        assert _CONTAINS(123, "1") is False


class TestPLUCK:
    def test_simple_key(self):
        items = [{"name": "A"}, {"name": "B"}]
        assert _PLUCK(items, "name") == ["A", "B"]

    def test_dot_notation(self):
        items = [
            {"attributes": {"cost": 100}},
            {"attributes": {"cost": 200}},
        ]
        assert _PLUCK(items, "attributes.cost") == [100, 200]

    def test_missing_key(self):
        items = [{"name": "A"}, {"other": "B"}]
        assert _PLUCK(items, "name") == ["A", None]

    def test_empty_list(self):
        assert _PLUCK([], "name") == []

    def test_none_input(self):
        assert _PLUCK(None, "name") == []

    def test_non_dict_item(self):
        items = [{"name": "A"}, "not-a-dict"]
        result = _PLUCK(items, "name")
        assert result[0] == "A"
        assert result[1] is None


class TestFILTER:
    def test_filter_match(self):
        items = [{"status": "ACTIVE"}, {"status": "ARCHIVED"}, {"status": "ACTIVE"}]
        result = _FILTER(items, "status", "ACTIVE")
        assert len(result) == 2

    def test_filter_no_match(self):
        items = [{"status": "ACTIVE"}]
        assert _FILTER(items, "status", "ARCHIVED") == []

    def test_filter_empty(self):
        assert _FILTER([], "status", "ACTIVE") == []

    def test_filter_none(self):
        assert _FILTER(None, "status", "ACTIVE") == []

    def test_filter_dot_notation(self):
        items = [
            {"attributes": {"risk": "high"}},
            {"attributes": {"risk": "low"}},
        ]
        result = _FILTER(items, "attributes.risk", "high")
        assert len(result) == 1


class TestMAPSCORE:
    def test_maps_value(self):
        mapping = {"low": 1, "medium": 2, "high": 3}
        assert _MAP_SCORE("high", mapping) == 3

    def test_missing_key(self):
        assert _MAP_SCORE("unknown", {"low": 1}) is None

    def test_none_value(self):
        assert _MAP_SCORE(None, {"low": 1}) is None


# ---------------------------------------------------------------------------
# _DotDict
# ---------------------------------------------------------------------------


class TestDotDict:
    def test_attribute_access(self):
        d = _DotDict({"name": "test"})
        assert d.name == "test"

    def test_missing_key_returns_none(self):
        d = _DotDict({})
        assert d.missing is None

    def test_set_attribute(self):
        d = _DotDict({})
        d.name = "test"
        assert d["name"] == "test"

    def test_nested(self):
        d = _DotDict({"inner": _DotDict({"value": 42})})
        assert d.inner.value == 42


# ---------------------------------------------------------------------------
# _evaluate_formula
# ---------------------------------------------------------------------------


class TestEvaluateFormula:
    def _ctx(self, **data_fields):
        """Build a minimal context with the given data fields."""
        return {
            "data": _DotDict(data_fields),
            "relations": _DotDict(),
            "relation_count": _DotDict(),
            "children": [],
            "children_count": 0,
            "None": None,
            "True": True,
            "False": False,
        }

    def test_simple_expression(self):
        ctx = self._ctx(cost=100)
        assert _evaluate_formula("data.cost * 2", ctx) == 200

    def test_function_call(self):
        ctx = self._ctx()
        assert _evaluate_formula("SUM([1, 2, 3])", ctx) == 6

    def test_if_expression(self):
        ctx = self._ctx(risk="high")
        result = _evaluate_formula('IF(data.risk == "high", 100, 0)', ctx)
        assert result == 100

    def test_lazy_if_short_circuits(self):
        """IF should NOT evaluate the branch not taken (prevents None + 1 error)."""
        ctx = self._ctx()  # data.cost is None
        result = _evaluate_formula("IF(data.cost is None, 0, data.cost + 1)", ctx)
        assert result == 0

    def test_multiline_with_assignments(self):
        ctx = self._ctx(a=10, b=20)
        formula = """
        x = data.a + data.b
        x * 2
        """
        assert _evaluate_formula(formula, ctx) == 60

    def test_comments_ignored(self):
        ctx = self._ctx(x=5)
        formula = """
        # This is a comment
        data.x + 10
        """
        assert _evaluate_formula(formula, ctx) == 15

    def test_empty_formula_raises(self):
        with pytest.raises(ValueError, match="Empty formula"):
            _evaluate_formula("", {})

    def test_only_comments_raises(self):
        with pytest.raises(ValueError, match="Empty formula"):
            _evaluate_formula("# just a comment", {})

    def test_nested_if(self):
        ctx = self._ctx(level="medium")
        formula = 'IF(data.level == "high", 3, IF(data.level == "medium", 2, 1))'
        assert _evaluate_formula(formula, ctx) == 2

    def test_pluck_with_sum(self):
        ctx = self._ctx()
        ctx["relations"] = _DotDict(
            {
                "related_apps": [
                    _DotDict({"attributes": _DotDict({"cost": 100})}),
                    _DotDict({"attributes": _DotDict({"cost": 200})}),
                ]
            }
        )
        formula = 'SUM(PLUCK(relations.related_apps, "attributes.cost"))'
        assert _evaluate_formula(formula, ctx) == 300

    def test_filter_and_count(self):
        ctx = self._ctx()
        ctx["children"] = [
            _DotDict({"status": "ACTIVE"}),
            _DotDict({"status": "ARCHIVED"}),
            _DotDict({"status": "ACTIVE"}),
        ]
        formula = 'COUNT(FILTER(children, "status", "ACTIVE"))'
        assert _evaluate_formula(formula, ctx) == 2

    def test_map_score_in_formula(self):
        ctx = self._ctx(risk="high")
        formula = 'MAP_SCORE(data.risk, {"low": 1, "medium": 2, "high": 3})'
        assert _evaluate_formula(formula, ctx) == 3

    def test_coalesce_in_formula(self):
        ctx = self._ctx()  # data.cost is None
        result = _evaluate_formula("COALESCE(data.cost, 0)", ctx)
        assert result == 0

    def test_python_builtins_available(self):
        ctx = self._ctx()
        assert _evaluate_formula("len([1, 2, 3])", ctx) == 3
        assert _evaluate_formula("int(3.7)", ctx) == 3
        assert _evaluate_formula("float(3)", ctx) == 3.0
        assert _evaluate_formula("str(42)", ctx) == "42"

    def test_multiline_with_map_score(self):
        ctx = self._ctx(businessFit="excellent", technicalFit="poor")
        formula = """
        bf = MAP_SCORE(data.businessFit, {"excellent": 4, "good": 3, "poor": 1})
        tf = MAP_SCORE(data.technicalFit, {"excellent": 4, "good": 3, "poor": 1})
        IF(bf >= 2.5, IF(tf >= 2.5, "invest", "migrate"), "tolerate")
        """
        assert _evaluate_formula(formula, ctx) == "migrate"

    def test_children_count_in_formula(self):
        ctx = self._ctx()
        ctx["children_count"] = 5
        assert _evaluate_formula("children_count", ctx) == 5

    def test_relation_count_in_formula(self):
        ctx = self._ctx()
        ctx["relation_count"] = _DotDict({"app_to_itc": 3})
        assert _evaluate_formula("relation_count.app_to_itc", ctx) == 3
