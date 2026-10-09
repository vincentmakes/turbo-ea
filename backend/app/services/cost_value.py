"""One reading of a stored cost or number attribute.

A ``cost`` / ``number`` field carries no numeric check on write before 2.157.9,
so an install can hold a string in one — an Excel import, an integration, an
older client. Every reader that sums such values goes through ``cost_value``:
a number counts as itself, numeric text counts as the number it spells, and
anything else counts as nothing rather than failing the whole report. The
process map, the cost report, the cost treemap and the capability heatmap all
read the same way, and the Process Navigator's own roll-up (``costValue`` in
``ProcessMapReport.tsx``) accepts the same text, so the two totals agree.

"Numeric text" is a plain decimal — digits, one point, an optional exponent,
surrounding whitespace — and deliberately not everything ``float()`` parses:
``"1_000"``, ``"nan"`` and ``"inf"`` are not costs.
"""

from __future__ import annotations

import math
import re

# Every repetition is unambiguous: the digits before a point can only be split
# one way. ``\d+\.?\d*`` could split a run of digits between its two halves in
# n ways, so a long digit string that failed at its last character backtracked
# quadratically (16 000 digits held the event loop for six seconds), and the
# write path runs this on request input. ``\d+(?:\.\d*)?`` accepts the same
# strings in linear time.
_DECIMAL = re.compile(r"^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$")


def is_numeric_text(value: object) -> bool:
    """Whether ``value`` is a string spelling a plain decimal number."""
    return isinstance(value, str) and _DECIMAL.match(value) is not None


def cost_value(value: object) -> float:
    """``value`` as a number, or 0 when it is not one.

    Booleans are not numbers here (``True`` would pass an ``int`` check), and
    a non-finite float is not a cost either. An integer stays an integer, so a
    total of whole costs renders without a trailing ``.0``.
    """
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)):
        return value if math.isfinite(value) else 0
    if is_numeric_text(value):
        num = float(value)  # type: ignore[arg-type]
        return num if math.isfinite(num) else 0
    return 0
