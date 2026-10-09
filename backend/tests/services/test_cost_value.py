"""``cost_value`` — the one reading of a stored cost or number attribute.

Every cost reader (cost report, treemap, capability heatmap, process map)
sums through it, so what it accepts is what every report counts.
"""

from __future__ import annotations

import math

import pytest

from app.services.cost_value import cost_value, is_numeric_text


class TestCostValue:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (100, 100),
            (0, 0),
            (-25, -25),
            (50.5, 50.5),
            ("1200", 1200.0),
            (" 300.5 ", 300.5),
            ("1e3", 1000.0),
            ("-7.25", -7.25),
            (".5", 0.5),
            ("+40", 40.0),
        ],
    )
    def test_numbers_and_plain_decimal_text_count(self, value, expected):
        assert cost_value(value) == expected

    @pytest.mark.parametrize(
        "value",
        [
            "n/a",
            "",
            "   ",
            "1_000",
            "0x10",
            "nan",
            "inf",
            "-inf",
            "Infinity",
            "12abc",
            "1,200",
            True,
            False,
            None,
            ["100"],
            {"amount": 100},
            float("nan"),
            float("inf"),
            float("-inf"),
        ],
    )
    def test_everything_else_counts_as_nothing(self, value):
        assert cost_value(value) == 0

    def test_an_integer_stays_integral(self):
        assert isinstance(cost_value(100), int)
        assert isinstance(cost_value("100"), float)

    def test_never_returns_a_non_finite_number(self):
        for v in ("1e400", float("inf"), "nan"):
            assert math.isfinite(cost_value(v))


class TestIsNumericText:
    def test_plain_decimals_only(self):
        assert is_numeric_text("12")
        assert is_numeric_text(" 12.5 ")
        assert is_numeric_text("1e3")
        assert not is_numeric_text("1_000")
        assert not is_numeric_text("nan")
        assert not is_numeric_text("")
        assert not is_numeric_text(12)
        assert not is_numeric_text(None)
