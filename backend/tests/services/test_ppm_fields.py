"""Unit tests for configurable PML fields and calculated values."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.schemas.ppm_fields import PmlSectionConfig
from app.services.ppm_fields import (
    UNAVAILABLE,
    PmlFieldError,
    evaluate_row_fields,
    validate_field_values,
    validate_section_config,
)


def _config(*fields, visible_columns=None):
    return PmlSectionConfig.model_validate(
        {"fields": list(fields), "visible_columns": visible_columns or []}
    )


def _field(key, kind, **extra):
    return {"key": key, "label": key, "kind": kind, **extra}


def _calculated(key, inputs, **calculation):
    return _field(
        key,
        "calculated",
        calculation={"result_type": "text", "inputs": inputs, **calculation},
    )


def test_create_defaults_and_partial_update_preserve_existing():
    config = _config(
        _field("order", "text", required=True),
        _field("quantity", "number", default="1.25"),
        _field("retired", "text", active=False),
    )
    created = validate_field_values(config, {"order": "ODA-001"}, {}, creating=True)
    assert created == {"order": "ODA-001", "quantity": "1.25"}
    existing = {"order": "ODA-001", "quantity": "2.50", "retired": "old"}
    updated = validate_field_values(config, {"quantity": "3.75"}, existing, creating=False)
    assert updated == {"order": "ODA-001", "quantity": "3.75", "retired": "old"}
    assert existing["quantity"] == "2.50"


def test_required_historical_missing_and_protected_existing_reference():
    config = _config(
        _field("provider", "card_reference", required=True, card_type="Organization"),
        _field("note", "text"),
    )
    with pytest.raises(PmlFieldError):
        validate_field_values(config, {"note": "changed"}, {}, creating=False)
    preserved = validate_field_values(
        config,
        {"note": "changed"},
        {"provider": UNAVAILABLE},
        creating=False,
    )
    assert preserved["provider"] is UNAVAILABLE
    assert preserved["note"] == "changed"


def test_select_option_lifecycle_preserves_existing_and_rejects_new_inactive():
    config = _config(
        _field(
            "intercompany",
            "select",
            options=[
                {"id": "canone", "label": "Renamed", "active": True},
                {"id": "old", "label": "Old", "active": False},
            ],
        )
    )
    assert validate_field_values(config, {}, {"intercompany": "old"}, creating=False) == {
        "intercompany": "old"
    }
    with pytest.raises(PmlFieldError):
        validate_field_values(config, {"intercompany": "old"}, {}, creating=True)
    assert validate_field_values(config, {"intercompany": "canone"}, {}, creating=True) == {
        "intercompany": "canone"
    }


@pytest.mark.parametrize(
    ("kind", "value"),
    [
        ("number", "NaN"),
        ("number", "Infinity"),
        ("date", "2026-02-30"),
        ("boolean", "yes"),
        ("text", ["not", "text"]),
        ("card_reference", "not-a-uuid"),
    ],
)
def test_invalid_field_values_are_rejected(kind, value):
    config = _config(
        _field("value", kind, **({"card_type": "Organization"} if kind == "card_reference" else {}))
    )
    with pytest.raises(PmlFieldError):
        validate_field_values(config, {"value": value}, {}, creating=True)


def test_calculated_and_unknown_fields_cannot_be_written():
    config = _config(_calculated("derived", {}, rules=[], fallback="x"))
    with pytest.raises(PmlFieldError):
        validate_field_values(config, {"derived": "edited"}, {}, creating=True)
    with pytest.raises(PmlFieldError):
        validate_field_values(config, {"unknown": "edited"}, {}, creating=True)


def test_invoice_year_expression_matches_preview():
    config = _config(
        _field(
            "invoice_year",
            "calculated",
            calculation={
                "result_type": "number",
                "inputs": {"d": "invoice_date"},
                "expression": "YEAR(d)",
            },
        )
    )
    validate_section_config("invoice", config)
    values, errors = evaluate_row_fields(config, {}, {"invoice_date": "2026-11-10"})
    assert values == {"invoice_year": "2026"}
    assert errors == {}


def test_ordered_rules_first_match_and_provider_fallback():
    config = _config(
        _field(
            "tipo_spesa",
            "select",
            options=[
                {"id": "licenze", "label": "Licenze"},
                {"id": "servizi", "label": "Servizi"},
            ],
        ),
        _calculated(
            "aggregate",
            {"kind": "tipo_spesa", "provider": "provider.effective", "budget": "provider.budget"},
            rules=[
                {"when": {"op": "eq", "input": "kind", "value": "licenze"}, "then": "Licenze"},
                {
                    "when": {
                        "op": "all",
                        "conditions": [
                            {"op": "eq", "input": "provider", "value": "child"},
                            {"op": "eq", "input": "budget", "value": "parent"},
                        ],
                    },
                    "then": "Servizi interni",
                },
            ],
            fallback=None,
        ),
    )
    validate_section_config("cost_item", config)
    values, errors = evaluate_row_fields(
        config,
        {"tipo_spesa": "licenze"},
        {"provider.effective": "child", "provider.budget": "parent"},
    )
    assert values["aggregate"] == "Licenze"
    assert errors == {}
    values, errors = evaluate_row_fields(
        config,
        {"tipo_spesa": "servizi"},
        {"provider.effective": "child", "provider.budget": "parent"},
    )
    assert values["aggregate"] == "Servizi interni"
    assert errors == {}


def test_hidden_card_reference_redacts_transitive_results():
    config = _config(
        _field("source", "card_reference", card_type="Organization"),
        _calculated(
            "classification",
            {"p": "source"},
            rules=[{"when": {"op": "eq", "input": "p", "value": "known"}, "then": "yes"}],
            fallback="no",
        ),
        _calculated(
            "indirect",
            {"c": "classification"},
            rules=[{"when": {"op": "eq", "input": "c", "value": "yes"}, "then": "visible"}],
            fallback="other",
        ),
    )
    values, errors = evaluate_row_fields(config, {"source": UNAVAILABLE}, {})
    assert "classification" not in values
    assert "indirect" not in values
    assert errors == {}


def test_cycle_and_unknown_inputs_are_rejected():
    cyclic = _config(
        _calculated("a", {"x": "b"}, expression="x"),
        _calculated("b", {"x": "a"}, expression="x"),
    )
    with pytest.raises(PmlFieldError):
        validate_section_config("invoice", cyclic)
    unknown = _config(_calculated("x", {"x": "unknown_field"}, expression="x"))
    with pytest.raises(PmlFieldError):
        validate_section_config("invoice", unknown)


@pytest.mark.parametrize(
    "expression",
    ["__import__('os').system('echo unsafe')", "d.__class__", "d[0]", "(lambda: 1)()"],
)
def test_expression_rejects_arbitrary_python(expression):
    config = _config(_calculated("unsafe", {"d": "invoice_date"}, expression=expression))
    with pytest.raises(PmlFieldError):
        validate_section_config("invoice", config)


def test_invoice_provider_reference_is_not_configurable():
    config = _config(_field("origin", "card_reference", card_type="Provider"))
    with pytest.raises(PmlFieldError):
        validate_section_config("invoice", config)


def test_rules_reject_wrong_result_type_and_invalid_source_type():
    wrong_result = _config(
        _field(
            "bad",
            "calculated",
            calculation={
                "result_type": "number",
                "inputs": {},
                "rules": [],
                "fallback": "not a number",
            },
        )
    )
    with pytest.raises(PmlFieldError):
        validate_section_config("invoice", wrong_result)
    wrong_date = _config(
        _field(
            "bad",
            "calculated",
            calculation={
                "result_type": "number",
                "inputs": {"d": "invoice_id"},
                "expression": "YEAR(d)",
            },
        )
    )
    with pytest.raises(PmlFieldError):
        validate_section_config("invoice", wrong_date)


def test_arithmetic_error_is_local_to_the_calculated_field():
    config = _config(
        _field(
            "broken",
            "calculated",
            calculation={"result_type": "number", "inputs": {}, "expression": "1 / 0"},
        ),
        _calculated("healthy", {}, rules=[], fallback="ok"),
    )
    values, errors = evaluate_row_fields(config, {}, {})
    assert values["healthy"] == "ok"
    assert "broken" in errors


def test_rejects_comparison_value_with_wrong_type():
    config = _config(
        _field("quantity", "number"),
        _calculated(
            "classification",
            {"amount": "quantity"},
            rules=[
                {
                    "when": {"op": "gt", "input": "amount", "value": "not-a-number"},
                    "then": "high",
                }
            ],
            fallback="low",
        ),
    )
    with pytest.raises(PmlFieldError):
        validate_section_config("cost_item", config)


def test_naked_function_name_is_rejected_as_expression():
    config = _config(
        _field(
            "result",
            "calculated",
            calculation={"result_type": "text", "inputs": {}, "expression": "YEAR"},
        )
    )
    with pytest.raises(PmlFieldError):
        validate_section_config("invoice", config)


@pytest.mark.parametrize("threshold", ["20", 20])
def test_numeric_comparison_uses_declared_type(threshold):
    config = _config(
        _field("quantity", "number"),
        _calculated(
            "classification",
            {"qty": "quantity"},
            rules=[
                {"when": {"op": "gt", "input": "qty", "value": threshold}, "then": "high"},
            ],
            fallback="low",
        ),
        _calculated(
            "over_limit", {"qty": "quantity"}, result_type="boolean", expression="qty > 20"
        ),
    )
    validate_section_config("cost_item", config)
    assert evaluate_row_fields(config, {"quantity": "100"}, {}) == (
        {"classification": "high", "over_limit": True},
        {},
    )


@pytest.mark.parametrize(
    "condition",
    [
        {"op": [], "input": "qty", "value": 20},
        {"op": "eq", "input": {"unexpected": "qty"}, "value": 20},
    ],
)
def test_invalid_condition_structure_has_field_error(condition):
    config = _config(
        _field("quantity", "number"),
        _calculated(
            "classification",
            {"qty": "quantity"},
            rules=[
                {"when": condition, "then": "high"},
            ],
        ),
    )
    with pytest.raises(PmlFieldError) as error:
        validate_section_config("cost_item", config)
    assert "classification" in error.value.errors


def test_failed_calculation_is_evaluated_once_for_shared_dependants(monkeypatch):
    from app.services import ppm_fields

    config = _config(
        _calculated("broken", {}, result_type="number", expression="1 / 0"),
        _calculated("first", {"x": "broken"}, result_type="number", expression="x + 1"),
        _calculated("second", {"x": "broken"}, result_type="number", expression="x + 2"),
    )
    original = ppm_fields._validate_expression
    attempts = []

    def record(expression, aliases):
        attempts.append(expression)
        return original(expression, aliases)

    monkeypatch.setattr(ppm_fields, "_validate_expression", record)
    values, errors = evaluate_row_fields(config, {}, {})
    assert values == {}
    assert set(errors) == {"broken", "first", "second"}
    assert attempts == ["1 / 0"]


def test_blocked_calculation_cannot_be_unmasked_by_a_user_field():
    config = _config(
        _field("__pml_hidden", "text"),
        _calculated("private", {}, rules=[], fallback="protected"),
        _calculated("indirect", {"p": "private"}, expression="p"),
    )
    values, errors = evaluate_row_fields(
        config, {"__pml_hidden": "ordinary text"}, {}, unavailable_calculations={"private"}
    )
    assert values == {}
    assert errors == {}


def test_disabling_formula_and_its_source_together_is_allowed():
    config = _config(
        _field("source", "number", active=False),
        {
            **_calculated("total", {"n": "source"}, result_type="number", expression="n + 1"),
            "active": False,
        },
    )
    validate_section_config("cost_item", config)


def test_fractional_literals_keep_exact_digits_and_reject_nonfinite_values():
    value = "123456789.123456789123456789"
    config = _config(_calculated("total", {}, result_type="number", expression=value))
    validate_section_config("invoice", config)
    assert evaluate_row_fields(config, {}, {}) == ({"total": value}, {})
    nonfinite = _config(_calculated("total", {}, result_type="number", expression="1e309"))
    with pytest.raises(PmlFieldError, match="finite"):
        validate_section_config("invoice", nonfinite)


def test_column_keys_are_limited_to_known_fields_and_summaries():
    validate_section_config("budget", _config(visible_columns=["amount", "total_cost_items"]))
    with pytest.raises(PmlFieldError, match="visible_columns"):
        validate_section_config("invoice", _config(visible_columns=["total_cost_items"]))


def test_rule_complexity_has_a_shared_budget():
    predicate = {"op": "eq", "input": "n", "value": 1}
    group = {"op": "all", "conditions": [predicate] * 20}
    config = _config(
        _calculated("label", {"n": "fiscal_year"}, rules=[{"when": group, "then": "same"}] * 50)
    )
    with pytest.raises(PmlFieldError, match="too complex"):
        validate_section_config("budget", config)


def test_formula_bad_date_sample_returns_field_error():
    config = _config(
        _calculated("year", {"d": "invoice_date"}, result_type="number", expression="YEAR(d)"),
        _calculated("independent", {}, expression="'available'"),
    )
    validate_section_config("invoice", config)
    values, errors = evaluate_row_fields(config, {"invoice_date": 42}, {})
    assert values == {"independent": "available"}
    assert errors == {"year": "Expected an ISO date"}


@pytest.mark.parametrize(
    ("expression", "expected"),
    [
        ("quantity != 0 and amount / quantity > 1", False),
        ("quantity == 0 or amount / quantity > 1", True),
    ],
)
def test_boolean_expressions_short_circuit(expression, expected):
    config = _config(
        _field("quantity", "number"),
        _field(
            "result",
            "calculated",
            calculation={
                "result_type": "boolean",
                "inputs": {"quantity": "quantity", "amount": "amount"},
                "expression": expression,
            },
        ),
    )
    validate_section_config("budget", config)
    values, errors = evaluate_row_fields(config, {"quantity": "0"}, {"amount": "4"})
    assert errors == {}
    assert values["result"] is expected


def test_if_formula_compares_provider_constants_and_is_lazy():
    provider_id = "11111111-1111-4111-8111-111111111111"
    config = _config(
        _calculated(
            "aggregate",
            {"provider": "provider.effective", "amount": "actual"},
            provider_constants={"licence": provider_id},
            expression='IF(provider == licence, "Licenze", IF(amount > 0, "Servizi", "Altro"))',
        )
    )
    validate_section_config("cost_item", config)
    values, errors = evaluate_row_fields(
        config, {}, {"provider.effective": provider_id, "actual": 1}
    )
    assert values == {"aggregate": "Licenze"}
    assert not errors
    values, errors = evaluate_row_fields(config, {}, {"provider.effective": None, "actual": 1})
    assert values == {"aggregate": "Servizi"}
    assert not errors

    lazy = _config(
        _field(
            "result",
            "calculated",
            calculation={"result_type": "number", "inputs": {}, "expression": "IF(True, 7, 1 / 0)"},
        )
    )
    validate_section_config("invoice", lazy)
    assert evaluate_row_fields(lazy, {}, {}) == ({"result": "7"}, {})


@pytest.mark.parametrize(
    "expression",
    [
        'IF(1, "yes", "no")',
        'IF(True, "yes", 1)',
        'IF(True, "yes")',
        'IF(True, "yes", "no", "extra")',
    ],
)
def test_if_formula_requires_boolean_condition_and_compatible_branches(expression):
    config = _config(_calculated("result", {}, expression=expression))
    with pytest.raises(PmlFieldError):
        validate_section_config("cost_item", config)


@pytest.mark.parametrize(
    ("section", "constants", "inputs", "expression"),
    [
        ("budget", {"p": "11111111-1111-4111-8111-111111111111"}, {}, 'IF(True, "a", "b")'),
        ("invoice", {"p": "11111111-1111-4111-8111-111111111111"}, {}, 'IF(True, "a", "b")'),
        ("cost_item", {"p": "not-uuid"}, {}, 'IF(True, "a", "b")'),
        (
            "cost_item",
            {"p": "11111111-1111-4111-8111-111111111111"},
            {"p": "actual"},
            'IF(True, "a", "b")',
        ),
        ("cost_item", {"IF": "11111111-1111-4111-8111-111111111111"}, {}, 'IF(True, "a", "b")'),
    ],
)
def test_provider_constants_are_validated(section, constants, inputs, expression):
    config = _config(
        _calculated("result", inputs, expression=expression, provider_constants=constants)
    )
    with pytest.raises((PmlFieldError, ValueError)):
        validate_section_config(section, config)


def test_if_formula_handles_multiline_and_missing_provider():
    provider_id = "11111111-1111-4111-8111-111111111111"
    config = _config(
        _calculated(
            "aggregate",
            {"provider": "provider.effective"},
            provider_constants={"partner": provider_id},
            expression=(
                'IF(\n provider == None, None,\n IF(provider == partner, "Partner", "Other")\n)'
            ),
        )
    )
    validate_section_config("cost_item", config)
    assert evaluate_row_fields(config, {}, {"provider.effective": None}) == (
        {"aggregate": None},
        {},
    )
    assert evaluate_row_fields(config, {}, {"provider.effective": provider_id}) == (
        {"aggregate": "Partner"},
        {},
    )
    assert evaluate_row_fields(config, {}, {"provider.effective": UNAVAILABLE}) == ({}, {})


def test_core_formula_reads_select_and_provider_without_helper_fields():
    config = _config(
        _field("otherServiceType", "select", options=[{"id": "licencing", "label": "Licenze"}]),
        _calculated(
            "aggregate",
            {},
            formula_engine="core",
            provider_constants={"arubaSpa": "00000000-0000-4000-8000-000000000001"},
            expression="internal = data.providerEffective == arubaSpa\n"
            'IF(internal, "Servizi interni", IF(data.otherServiceType == "licencing", '
            '"Licenze", "Servizi Intercompany"))',
        ),
    )
    validate_section_config("cost_item", config)
    values, errors = evaluate_row_fields(
        config,
        {"otherServiceType": "licencing"},
        {"provider.effective": "00000000-0000-4000-8000-000000000001"},
    )
    assert not errors
    assert values["aggregate"] == "Servizi interni"
    values, errors = evaluate_row_fields(
        config,
        {"otherServiceType": "licencing"},
        {"provider.effective": "00000000-0000-4000-8000-000000000002"},
    )
    assert not errors
    assert values["aggregate"] == "Licenze"


def test_core_formula_computes_dependencies_and_propagates_unavailable():
    config = _config(
        _field("origin", "card_reference", card_type="Provider"),
        _calculated(
            "first", {}, formula_engine="core", expression='IF(data.origin == None, "empty", "set")'
        ),
        _calculated("second", {}, formula_engine="core", expression='CONCAT(data.first, "!")'),
    )
    validate_section_config("cost_item", config)
    values, errors = evaluate_row_fields(config, {"origin": UNAVAILABLE}, {})
    assert not errors
    assert "first" not in values and "second" not in values
    values, errors = evaluate_row_fields(config, {"origin": None}, {})
    assert not errors and values["second"] == "empty!"


def test_core_formula_rejects_unknown_dynamic_and_cyclic_data():
    for expression in ("data.notAField", "data[data.description]", "data", "IF("):
        config = _config(_calculated("first", {}, formula_engine="core", expression=expression))
        with pytest.raises(PmlFieldError):
            validate_section_config("cost_item", config)
    config = _config(
        _calculated("first", {}, formula_engine="core", expression="data.second"),
        _calculated("second", {}, formula_engine="core", expression="data.first"),
    )
    with pytest.raises(PmlFieldError):
        validate_section_config("cost_item", config)


def test_core_formula_financial_arithmetic_keeps_decimal_precision():
    config = _config(
        _field("charge", "number"),
        _field(
            "total",
            "calculated",
            calculation={
                "result_type": "number",
                "inputs": {},
                "formula_engine": "core",
                "expression": "SUM([data.charge, 0.2])",
            },
        ),
        _field(
            "rounded",
            "calculated",
            calculation={
                "result_type": "number",
                "inputs": {},
                "formula_engine": "core",
                "expression": "ROUND(data.total, 2)",
            },
        ),
    )
    validate_section_config("cost_item", config)
    values, errors = evaluate_row_fields(config, {"charge": "0.1"}, {})
    assert not errors
    assert values["total"] == "0.3"
    assert values["rounded"] == "0.30"


def test_core_formula_reads_budget_and_initiative_without_losing_decimal_precision():
    config = _config(
        _field(
            "remaining",
            "calculated",
            calculation={
                "result_type": "number",
                "inputs": {},
                "formula_engine": "core",
                "expression": 'IF(data.budget.initiative.name == "Demo", '
                "data.budget.amount - data.actual, 0)",
            },
        ),
    )
    validate_section_config("cost_item", config)
    values, errors = evaluate_row_fields(
        config, {}, {"budget.amount": "0.3", "actual": "0.1", "budget.initiative.name": "Demo"}
    )
    assert not errors and values["remaining"] == "0.2"


def test_core_formula_protects_unavailable_budget_and_rejects_bare_budget():
    field = _calculated(
        "result", {}, formula_engine="core", expression="data.budget.initiative.name"
    )
    config = _config(field)
    validate_section_config("cost_item", config)
    values, errors = evaluate_row_fields(config, {}, {"budget.initiative.name": UNAVAILABLE})
    assert not errors and "result" not in values
    for expression in ("data.budget", "data.budget.initiative", "data.budget[data.description]"):
        config = _config(_calculated("result", {}, formula_engine="core", expression=expression))
        with pytest.raises(PmlFieldError):
            validate_section_config("cost_item", config)


def test_core_formula_allows_reassigning_local_variables():
    config = _config(
        _field("charge", "number"),
        _calculated(
            "result",
            {},
            formula_engine="core",
            expression="amount = data.charge\namount = amount + 0.2\nstr(amount)",
        ),
    )
    validate_section_config("cost_item", config)
    values, errors = evaluate_row_fields(config, {"charge": "0.1"}, {})
    assert not errors and values["result"] == "0.3"


def test_core_budget_root_works_with_legacy_custom_budget_key():
    config = _config(
        _field("budget", "text"),
        _calculated(
            "result",
            {"legacyBudget": "budget"},
            formula_engine="core",
            expression='IF(data.budget.amount > 0, legacyBudget, "none")',
        ),
    )
    validate_section_config("cost_item", config)
    values, errors = evaluate_row_fields(config, {"budget": "preserved"}, {"budget.amount": "1"})
    assert not errors and values["result"] == "preserved"
    invalid = _config(
        _field("budget", "text"),
        _calculated("result", {}, formula_engine="core", expression="data.budget"),
    )
    with pytest.raises(PmlFieldError):
        validate_section_config("cost_item", invalid)


@pytest.mark.parametrize(
    ("expression", "expected"),
    [
        ("data.amount * (1 / 2)", "5.10"),
        ("LN(1) + data.amount", "10.20"),
        ("LN(data.amount)", str(Decimal("10.20").ln())),
        ("ROUND(data.amount / 3, 1)", "3.4"),
    ],
)
def test_core_financial_formula_decimal_operations(expression, expected):
    config = _config(
        _calculated(
            "result", {}, result_type="number", formula_engine="core", expression=expression
        )
    )
    validate_section_config("budget", config)
    values, errors = evaluate_row_fields(config, {}, {"amount": "10.20"})
    assert errors == {}
    assert Decimal(values["result"]) == Decimal(expected)
