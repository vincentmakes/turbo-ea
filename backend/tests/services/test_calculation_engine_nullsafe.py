"""The opt-in blanks-as-zero mode, and the error messages that replaced
"Evaluation error".

No database. The point of both features is that a formula author is told what
is wrong instead of being handed a generic failure (#886), so most of these
assert on message content.
"""

from __future__ import annotations

import ast

import pytest
from simpleeval import DEFAULT_OPERATORS, FunctionNotDefined, IterableTooLong, NameNotDefined

from app.services.calculation_engine import (
    NULL_SAFE_OPERATORS,
    _DotDict,
    _evaluate_formula,
    base_context_roots,
    describe_error,
)


def ctx(**data_fields):
    return base_context_roots(data=_DotDict(data_fields))


class TestBlanksAsZeroArithmetic:
    def test_off_by_default_still_raises(self):
        with pytest.raises(TypeError):
            _evaluate_formula("data.a + data.b", ctx(a=None, b=5))

    def test_addition_treats_blank_as_zero(self):
        assert _evaluate_formula("data.a + data.b", ctx(a=None, b=5), blanks_as_zero=True) == 5

    def test_both_operands_blank(self):
        assert _evaluate_formula("data.a + data.b", ctx(a=None, b=None), blanks_as_zero=True) == 0

    def test_multiplication(self):
        assert _evaluate_formula("data.a * data.b", ctx(a=None, b=5), blanks_as_zero=True) == 0

    def test_string_concatenation_uses_empty_string(self):
        result = _evaluate_formula("data.s + data.a", ctx(s="x", a=None), blanks_as_zero=True)
        assert result == "x"

    def test_unary_minus(self):
        # Would still raise if only the binary operators were wrapped.
        assert _evaluate_formula("-data.a", ctx(a=None), blanks_as_zero=True) == 0

    def test_division_by_a_blank_still_raises(self):
        # Coercion makes the divisor 0, so this is a genuine division by zero
        # rather than something the mode should paper over.
        with pytest.raises(ZeroDivisionError):
            _evaluate_formula("data.a / data.b", ctx(a=5, b=None), blanks_as_zero=True)


class TestBlanksAsZeroComparisons:
    def test_ordering_comparison_is_coerced(self):
        # Would still raise if only the binary operators were wrapped.
        assert _evaluate_formula("data.a > 5", ctx(a=None), blanks_as_zero=True) is False
        assert _evaluate_formula("data.a < 5", ctx(a=None), blanks_as_zero=True) is True

    def test_chained_comparison(self):
        # Documents the semantics: each comparison coerces independently and the
        # uncoerced value carries forward as the next left operand, exactly as
        # Python does. A blank therefore behaves as a literal 0 throughout —
        # `0 < 0` is False and short-circuits the chain, while `0 <= 0 < 10`
        # runs both halves and holds.
        assert _evaluate_formula("0 < data.a < 10", ctx(a=None), blanks_as_zero=True) is False
        assert _evaluate_formula("0 <= data.a < 10", ctx(a=None), blanks_as_zero=True) is True

    @pytest.mark.parametrize(
        "formula,expected",
        [
            ("data.a == None", True),
            ("data.a is None", True),
            ("data.a != 0", True),
            ("data.a in [1, 2]", False),
        ],
    )
    def test_identity_and_equality_are_untouched(self, formula, expected):
        # The whole reason only ordering comparisons are wrapped: these must
        # mean the same thing whether or not the mode is on, or COALESCE and
        # `IF(x is None, …)` would quietly change behaviour.
        assert _evaluate_formula(formula, ctx(a=None)) is expected
        assert _evaluate_formula(formula, ctx(a=None), blanks_as_zero=True) is expected


class TestNullSafeOperatorTable:
    def test_equality_operators_are_the_defaults_verbatim(self):
        # Identity, not equality — the cheapest guard against a future refactor
        # wrapping these by accident.
        for op in (ast.Eq, ast.NotEq, ast.Is, ast.IsNot, ast.In, ast.NotIn):
            assert NULL_SAFE_OPERATORS[op] is DEFAULT_OPERATORS[op]

    def test_wrapping_preserves_simpleevals_dos_guards(self):
        # The table is built from DEFAULT_OPERATORS (safe_add / safe_mult), not
        # from `operator.mul` — rebuilding from the stdlib would silently drop
        # the IterableTooLong protection.
        with pytest.raises(IterableTooLong):
            _evaluate_formula('"x" * 500000', ctx(), blanks_as_zero=True)


class TestDescribeError:
    def test_names_an_undefined_identifier(self):
        message = describe_error(NameNotDefined("relatons", "relatons.x"), "relatons.x", None)
        assert "relatons" in message

    def test_suggests_the_data_prefix_for_a_bare_field(self):
        context = ctx(licenseCost=10)
        message = describe_error(
            NameNotDefined("licenseCost", "licenseCost"), "licenseCost", context
        )
        assert "data.licenseCost" in message

    def test_names_an_undefined_function(self):
        message = describe_error(FunctionNotDefined("SUMM", "SUMM(1)"), "SUMM(1)", None)
        assert "SUMM" in message

    def test_names_the_empty_fields(self):
        formula = "data.a + data.b"
        context = ctx(a=None, b=5)
        exc = TypeError("unsupported operand type(s) for +: 'NoneType' and 'int'")
        message = describe_error(exc, formula, context)
        assert "'a'" in message
        assert "'b'" not in message
        assert "COALESCE" in message

    def test_caps_a_long_list_of_empty_fields(self):
        formula = " + ".join(f"data.f{i}" for i in range(8))
        context = ctx(**{f"f{i}": None for i in range(8)})
        exc = TypeError("unsupported operand type(s) for +: 'NoneType' and 'NoneType'")
        message = describe_error(exc, formula, context)
        assert "and 3 more" in message

    def test_points_at_the_parent_guard(self):
        exc = TypeError("'NoneType' object has no attribute 'attributes'")
        message = describe_error(exc, "parent.attributes.x", None)
        assert "IF(parent" in message

    def test_division_by_zero_has_its_own_message(self):
        message = describe_error(ZeroDivisionError("division by zero"), "1 / 0", None)
        assert message == "Division by zero"
        assert "COALESCE" not in message

    def test_unexpected_errors_leak_only_the_class_name(self):
        exc = RuntimeError("connection failed: postgresql://user:hunter2@db/turboea")
        message = describe_error(exc, "data.a", None)
        assert "RuntimeError" in message
        assert "postgresql" not in message
        assert "hunter2" not in message
