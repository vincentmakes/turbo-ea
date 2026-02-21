"""Extended unit tests for the calculation engine — covers FILTER/PLUCK edge cases
and the _LazyIfEval evaluator paths not hit by the base test file.

These tests do NOT require a database.
"""

from __future__ import annotations

import pytest

from app.services.calculation_engine import (
    _FILTER,
    _PLUCK,
    _DotDict,
    _evaluate_formula,
)

# ---------------------------------------------------------------------------
# PLUCK dot-notation edge cases (uncovered lines in base tests)
# ---------------------------------------------------------------------------


class TestPluckEdgeCases:
    def test_pluck_non_dict_intermediate(self):
        """When a dotted path traverses a non-dict, the value should be None."""
        items = [{"a": 42}]  # a is not a dict, so a.b fails
        result = _PLUCK(items, "a.b")
        assert result == [None]

    def test_pluck_deep_dotted_path(self):
        items = [
            {"a": {"b": {"c": 1}}},
            {"a": {"b": {"c": 2}}},
        ]
        result = _PLUCK(items, "a.b.c")
        assert result == [1, 2]

    def test_pluck_missing_key_at_leaf(self):
        items = [{"a": {"b": 10}}]
        result = _PLUCK(items, "a.c")
        assert result == [None]

    def test_pluck_with_none_item_values(self):
        items = [{"a": None}]
        result = _PLUCK(items, "a.b")
        assert result == [None]


# ---------------------------------------------------------------------------
# FILTER dot-notation edge cases (uncovered lines 130-131)
# ---------------------------------------------------------------------------


class TestFilterEdgeCases:
    def test_filter_non_dict_intermediate(self):
        """When a dotted key traverses a non-dict, the item should not match."""
        items = [{"a": 42}]  # a is int, not dict — "a.b" can't resolve
        result = _FILTER(items, "a.b", 42)
        assert result == []

    def test_filter_deep_dotted_path(self):
        items = [
            {"a": {"b": {"c": "yes"}}},
            {"a": {"b": {"c": "no"}}},
        ]
        result = _FILTER(items, "a.b.c", "yes")
        assert result == [items[0]]

    def test_filter_missing_intermediate_key(self):
        items = [{"a": {}}]
        result = _FILTER(items, "a.b.c", "x")
        assert result == []


# ---------------------------------------------------------------------------
# _evaluate_formula — edge cases not in base tests
# ---------------------------------------------------------------------------


class TestEvaluateFormulaExtended:
    def _ctx(self, **data_fields):
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

    def test_assignment_then_use(self):
        """Variable assigned on one line should be available on the next."""
        ctx = self._ctx(a=3, b=4)
        formula = """
        total = data.a + data.b
        total * 10
        """
        assert _evaluate_formula(formula, ctx) == 70

    def test_multiple_assignments(self):
        ctx = self._ctx(x=2)
        formula = """
        a = data.x * 3
        b = a + 1
        b
        """
        assert _evaluate_formula(formula, ctx) == 7

    def test_only_whitespace_raises(self):
        with pytest.raises(ValueError, match="Empty formula"):
            _evaluate_formula("   \n   \n  ", {})

    def test_lazy_if_false_branch_not_evaluated(self):
        """When condition is False, the true-branch is never evaluated."""
        ctx = self._ctx()  # data.missing is None
        result = _evaluate_formula("IF(False, 1 / 0, 42)", ctx)
        assert result == 42

    def test_lazy_if_true_branch_not_evaluated(self):
        """When condition is True, the false-branch is never evaluated."""
        ctx = self._ctx()
        result = _evaluate_formula("IF(True, 42, 1 / 0)", ctx)
        assert result == 42

    def test_non_if_function_call_uses_parent(self):
        """Non-IF functions use standard evaluation (super()._eval_call)."""
        ctx = self._ctx()
        result = _evaluate_formula("SUM([10, 20, 30])", ctx)
        assert result == 60

    def test_string_comparison(self):
        ctx = self._ctx(status="ACTIVE")
        result = _evaluate_formula('IF(data.status == "ACTIVE", 1, 0)', ctx)
        assert result == 1

    def test_boolean_literal(self):
        ctx = self._ctx(flag=True)
        result = _evaluate_formula("IF(data.flag, 100, 0)", ctx)
        assert result == 100

    def test_none_arithmetic_fallback(self):
        """Accessing a missing attribute returns None (via _DotDict)."""
        ctx = self._ctx()  # no field 'missing'
        result = _evaluate_formula("COALESCE(data.missing, -1)", ctx)
        assert result == -1

    def test_list_comprehension_style(self):
        """The evaluator should handle list literals."""
        ctx = self._ctx()
        result = _evaluate_formula("SUM([1, 2, 3, 4, 5])", ctx)
        assert result == 15

    def test_nested_function_calls(self):
        ctx = self._ctx()
        result = _evaluate_formula("ROUND(AVG([1.5, 2.5, 3.0]), 1)", ctx)
        assert result == 2.3

    def test_concat_with_none(self):
        ctx = self._ctx(name="App")
        result = _evaluate_formula('CONCAT(data.name, " - v", data.missing)', ctx)
        assert result == "App - v"

    def test_contains_with_none(self):
        ctx = self._ctx()
        result = _evaluate_formula('CONTAINS(data.missing, "x")', ctx)
        assert result is False


# ---------------------------------------------------------------------------
# _DotDict extended coverage
# ---------------------------------------------------------------------------


class TestDotDictExtended:
    def test_setattr(self):
        d = _DotDict()
        d.mykey = "val"
        assert d["mykey"] == "val"
        assert d.mykey == "val"

    def test_missing_key_returns_none(self):
        d = _DotDict()
        assert d.nonexistent is None

    def test_nested_dotdict(self):
        d = _DotDict({"inner": _DotDict({"value": 42})})
        assert d.inner.value == 42
        assert d.inner.missing is None
