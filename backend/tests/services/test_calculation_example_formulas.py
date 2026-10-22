"""The TIME Model example in the calculation editor must work on a stock install.

The Formula Reference panel (``CalculationsAdmin.tsx``) ships a TIME Model
example that admins copy into a new calculation. It used to read
``data.businessFit`` / ``data.technicalFit`` — fields no built-in type has —
so ``POST /calculations`` refused to save it (discussion #1310). These tests read
the example off disk and check it against the seeded Application type and the
real evaluator.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

from app.services.calculation_engine import _DotDict, _evaluate_formula, base_context_roots
from app.services.seed import TYPES

_ROOT = Path(__file__).resolve().parents[3]
_CALCULATIONS_ADMIN = _ROOT / "frontend" / "src" / "features" / "admin" / "CalculationsAdmin.tsx"
_TIME_HEADER = "# ── TIME Model (Tolerate / Invest / Migrate / Eliminate) ──"


def _time_example() -> str:
    source = _CALCULATIONS_ADMIN.read_text(encoding="utf-8")
    start = source.index(_TIME_HEADER)
    end = source.index("`;", start)
    return source[start:end]


def _application_fields() -> dict[str, dict]:
    app = next(t for t in TYPES if t["key"] == "Application")
    return {f["key"]: f for section in app["fields_schema"] for f in section["fields"]}


def test_example_reads_only_built_in_application_fields():
    fields = _application_fields()
    referenced = set(re.findall(r"data\.(\w+)", _time_example()))
    assert referenced == {"functionalSuitability", "technicalSuitability"}
    assert referenced <= fields.keys()


def test_example_scores_every_option_of_each_field_it_reads():
    fields = _application_fields()
    calls = re.findall(r"MAP_SCORE\(data\.(\w+), (\{[^}]*\})\)", _time_example())
    assert len(calls) == 2
    for key, mapping in calls:
        option_keys = {o["key"] for o in fields[key]["options"]}
        assert set(ast.literal_eval(mapping)) == option_keys


def test_example_writes_time_model_option_keys():
    produced = set(re.findall(r'"(invest|migrate|tolerate|eliminate)"', _time_example()))
    time_model = {o["key"] for o in _application_fields()["timeModel"]["options"]}
    assert produced == time_model


@pytest.mark.parametrize(
    ("functional", "technical", "expected"),
    [
        ("perfect", "fullyAppropriate", "invest"),
        ("appropriate", "adequate", "invest"),
        ("appropriate", "unreasonable", "migrate"),
        ("perfect", "inappropriate", "migrate"),
        ("insufficient", "adequate", "tolerate"),
        ("unreasonable", "fullyAppropriate", "tolerate"),
        ("insufficient", "unreasonable", "eliminate"),
        ("unreasonable", "inappropriate", "eliminate"),
        ("perfect", None, None),
        (None, "adequate", None),
    ],
)
def test_example_places_each_rating_pair_in_its_quadrant(functional, technical, expected):
    data = {
        k: v
        for k, v in (("functionalSuitability", functional), ("technicalSuitability", technical))
        if v is not None
    }
    result = _evaluate_formula(_time_example(), base_context_roots(data=_DotDict(data)))
    assert result == expected
