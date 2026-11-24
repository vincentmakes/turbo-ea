"""Validation and row-local evaluation for PML financial fields."""

from __future__ import annotations

import ast
import math
import operator
import re
import uuid
from collections.abc import Callable
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from simpleeval import InvalidExpression

from app.schemas.ppm_fields import PmlFieldDefinition, PmlRowKind, PmlSectionConfig
from app.services.calculation_engine import SAFE_FUNCTIONS, _DotDict, _evaluate_formula
from app.services.calculation_lint import split_formula_lines


class _Unavailable:
    """A reference that the current reader cannot see."""


UNAVAILABLE = _Unavailable()


class PmlFieldError(ValueError):
    def __init__(self, errors: dict[str, str]) -> None:
        self.errors = errors
        super().__init__(str(errors))


STANDARD_INPUTS = {
    "budget": {"fiscal_year", "category", "description", "amount"},
    "cost_item": {
        "description",
        "category",
        "date",
        "actual",
        "planned",
        "provider.effective",
        "provider.budget",
        "budget.amount",
        "budget.fiscal_year",
        "budget.category",
        "budget.description",
        "budget.provider",
        "budget.initiative.id",
        "budget.initiative.name",
        "budget.initiative.type",
    },
    "invoice": {"invoice_date", "invoice_id", "amount"},
}
_STANDARD_TYPES = {
    "fiscal_year": "number",
    "amount": "number",
    "actual": "number",
    "planned": "number",
    "date": "date",
    "invoice_date": "date",
    "category": "text",
    "description": "text",
    "invoice_id": "text",
    "provider.effective": "card_reference",
    "provider.budget": "card_reference",
    "budget.amount": "number",
    "budget.fiscal_year": "number",
    "budget.category": "text",
    "budget.description": "text",
    "budget.provider": "card_reference",
    "budget.initiative.id": "text",
    "budget.initiative.name": "text",
    "budget.initiative.type": "text",
}

_CORE_STANDARD_NAMES = {
    "providerEffective": "provider.effective",
    "providerBudget": "provider.budget",
    "budgetAmount": "budget.amount",
    "budgetFiscalYear": "budget.fiscal_year",
    "budgetCategory": "budget.category",
    "budgetDescription": "budget.description",
}

_SYSTEM_KEYS = {
    "budget_line_id",
    "cost_item_id",
    "initiative_id",
    "id",
    "total_cost_items",
    "total_invoiced",
    "remaining_to_invoice",
    "actual_invoiced",
}
_BINARY = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Mod: operator.mod,
}
_COMPARE = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
}
_PREDICATES: dict[str, Callable[[Any, Any], Any]] = {
    "eq": operator.eq,
    "ne": operator.ne,
    "lt": operator.lt,
    "lte": operator.le,
    "gt": operator.gt,
    "gte": operator.ge,
}


def _input_types(fields: dict[str, PmlFieldDefinition], inputs: dict[str, str]) -> dict[str, str]:
    types = dict(_STANDARD_TYPES)
    for key, field in fields.items():
        types[key] = field.calculation.result_type if field.calculation is not None else field.kind
    return {alias: types[source] for alias, source in inputs.items()}


def _typed_operand(value: Any, kind: str) -> Any:
    if value is None or value is UNAVAILABLE:
        return value
    if kind == "number":
        if isinstance(value, bool):
            raise ValueError("Expected numeric input")
        number = Decimal(str(value))
        if not number.is_finite():
            raise ValueError("Expected finite numeric input")
        return number
    if kind == "date":
        if type(value) is date:
            return value.isoformat()
        if not isinstance(value, str):
            raise ValueError("Expected an ISO date")
        return date.fromisoformat(value).isoformat()
    if kind == "boolean":
        if not isinstance(value, bool):
            raise ValueError("Expected boolean input")
    elif kind in {"text", "select", "card_reference"} and not isinstance(value, str):
        raise ValueError("Expected text input")
    return value


def _normalize(field: PmlFieldDefinition, value: Any, *, existing_value: Any = None) -> Any:
    if value is None or value is UNAVAILABLE:
        return value
    try:
        if field.kind == "text":
            if not isinstance(value, str):
                raise ValueError("Expected text")
            return value
        if field.kind == "number":
            if isinstance(value, bool):
                raise ValueError("Expected a number")
            number = Decimal(str(value))
            if not number.is_finite():
                raise ValueError("Expected a finite number")
            return str(number)
        if field.kind == "date":
            if not isinstance(value, str):
                raise ValueError("Expected an ISO date")
            return date.fromisoformat(value).isoformat()
        if field.kind == "boolean":
            if not isinstance(value, bool):
                raise ValueError("Expected a boolean")
            return value
        if field.kind == "select":
            if not isinstance(value, str):
                raise ValueError("Expected an option ID")
            option = next((item for item in field.options if item.id == value), None)
            if option is None or (not option.active and value != existing_value):
                raise ValueError("Option is not active")
            return value
        if field.kind == "card_reference":
            return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, InvalidOperation) as exc:
        raise ValueError(str(exc)) from exc
    raise ValueError("Calculated fields cannot be written")


def validate_field_values(
    config: PmlSectionConfig,
    submitted: dict[str, Any],
    existing: dict[str, Any],
    *,
    creating: bool,
) -> dict[str, Any]:
    fields = {field.key: field for field in config.fields}
    result = dict(existing)
    errors: dict[str, str] = {}
    for key, value in submitted.items():
        field = fields.get(key)
        if field is None or not field.active or field.kind == "calculated":
            errors[key] = "Field is not editable"
            continue
        try:
            result[key] = _normalize(field, value, existing_value=existing.get(key))
        except ValueError as exc:
            errors[key] = str(exc)
    for field in config.fields:
        if not field.active or field.kind == "calculated":
            continue
        if creating and field.key not in result and field.default is not None:
            try:
                result[field.key] = _normalize(field, field.default)
            except ValueError as exc:
                errors[field.key] = str(exc)
        if field.required and (
            field.key not in result or result[field.key] is None or result[field.key] == ""
        ):
            errors[field.key] = "Field is required"
    if errors:
        raise PmlFieldError(errors)
    return result


def _core_data_sources(
    section: PmlRowKind, fields: dict[str, PmlFieldDefinition]
) -> dict[str, str]:
    sources = {key: key for key in STANDARD_INPUTS[section] if key.isidentifier()}
    sources.update(
        {
            name: source
            for name, source in _CORE_STANDARD_NAMES.items()
            if source in STANDARD_INPUTS[section]
        }
    )
    # A Cost Item's budget root denotes its linked budget. A legacy custom
    # field named budget remains available through an explicit input alias.
    if section == "cost_item":
        sources.update({key: key for key in STANDARD_INPUTS[section] if key.startswith("budget.")})
    sources.update(
        {
            key: key
            for key, field in fields.items()
            if field.active and not (section == "cost_item" and key == "budget")
        }
    )
    return sources


def _core_data_sources_for_evaluation(
    fields: dict[str, PmlFieldDefinition],
) -> dict[str, str]:
    sources = {key: key for key in _STANDARD_TYPES if key.isidentifier()}
    sources.update(_CORE_STANDARD_NAMES)
    sources.update({key: key for key in _STANDARD_TYPES if key.startswith("budget.")})
    sources.update({key: key for key, field in fields.items() if field.active})
    return sources


def _data_path(node: ast.AST) -> str | None:
    parts: list[str] = []
    while isinstance(node, (ast.Attribute, ast.Subscript)):
        if isinstance(node, ast.Attribute):
            parts.append(node.attr)
        else:
            if not isinstance(node.slice, ast.Constant) or not isinstance(node.slice.value, str):
                return None
            parts.append(node.slice.value)
        node = node.value
    if isinstance(node, ast.Name) and node.id == "data" and parts:
        return ".".join(reversed(parts))
    return None


def _core_formula_refs(expression: str) -> set[str]:
    refs: set[str] = set()
    for _assignment, line in split_formula_lines(expression):
        try:
            tree = ast.parse(line, mode="eval")
        except SyntaxError as exc:
            raise ValueError("Invalid expression") from exc
        nodes = list(ast.walk(tree))
        parents = {child: node for node in nodes for child in ast.iter_child_nodes(node)}
        for node in nodes:
            if not isinstance(node, ast.Name) or node.id != "data":
                continue
            path_node: ast.AST = node
            while True:
                parent = parents.get(path_node)
                if not isinstance(parent, (ast.Attribute, ast.Subscript)):
                    break
                if parent.value is not path_node:
                    break
                path_node = parent
            path = _data_path(path_node)
            if path is None:
                raise ValueError("Data fields must be referenced by name")
            refs.add(path)
    return refs


def _validate_core_formula(expression: str, aliases: set[str], sources: dict[str, str]) -> set[str]:
    lines = split_formula_lines(expression)
    if not lines:
        raise ValueError("Empty formula")
    reserved = set(aliases) | set(SAFE_FUNCTIONS) | {"data"}
    names = set(reserved)
    for assignment, line in lines:
        try:
            tree = ast.parse(line, mode="eval")
        except SyntaxError as exc:
            raise ValueError("Invalid expression") from exc
        nodes = list(ast.walk(tree))
        if len(nodes) > 150:
            raise ValueError("Expression is too complex")
        for node in nodes:
            if isinstance(node, ast.Name) and node.id not in names:
                raise ValueError(f"Unknown input {node.id}")
        if assignment:
            if assignment in reserved:
                raise ValueError("Assignment cannot overwrite a reserved name")
            names.add(assignment)
    refs = _core_formula_refs(expression)
    unknown = refs - set(sources)
    if unknown:
        raise ValueError(f"Unknown or inactive data fields: {', '.join(sorted(unknown))}")
    return {sources[name] for name in refs}


def _nested_data(values: dict[str, Any]) -> _DotDict:
    data = _DotDict()
    for path, value in values.items():
        parts = path.split(".")
        target = data
        for part in parts[:-1]:
            if part not in target:
                target[part] = _DotDict()
            target = target[part]
        target[parts[-1]] = value
    return data


def _validate_expression(expression: str, aliases: set[str]) -> ast.Expression:
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as exc:
        raise ValueError("Invalid expression") from exc
    nodes = list(ast.walk(tree))
    if len(nodes) > 150:
        raise ValueError("Expression is too complex")
    allowed = (
        ast.Expression,
        ast.Constant,
        ast.Name,
        ast.Load,
        ast.BinOp,
        ast.UnaryOp,
        ast.BoolOp,
        ast.Compare,
        ast.Call,
        ast.Add,
        ast.Sub,
        ast.Mult,
        ast.Div,
        ast.Mod,
        ast.USub,
        ast.UAdd,
        ast.Not,
        ast.And,
        ast.Or,
        ast.Eq,
        ast.NotEq,
        ast.Lt,
        ast.LtE,
        ast.Gt,
        ast.GtE,
    )
    for node in nodes:
        if not isinstance(node, allowed):
            raise ValueError("Unsupported expression syntax")
        if isinstance(node, ast.Name) and node.id not in aliases | {"YEAR", "MONTH", "DAY", "IF"}:
            raise ValueError(f"Unknown input {node.id}")
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in {
                "YEAR",
                "MONTH",
                "DAY",
                "IF",
            }:
                raise ValueError("Unsupported function")
            expected_args = 3 if node.func.id == "IF" else 1
            if len(node.args) != expected_args or node.keywords:
                raise ValueError(f"{node.func.id} requires {expected_args} arguments")
        if isinstance(node, ast.Constant) and not isinstance(
            node.value, (str, int, float, bool, type(None))
        ):
            raise ValueError("Unsupported literal")
        if isinstance(node, ast.Constant) and isinstance(node.value, float):
            if not math.isfinite(node.value):
                raise ValueError("Expected finite numeric literal")
            literal = ast.get_source_segment(expression, node)
            if literal is None:
                raise ValueError("Invalid numeric literal")
            # The parser represents fractional literals as floats. Keep their source digits.
            setattr(node, "decimal_value", Decimal(literal.replace("_", "")))
    return tree


def _validate_condition(
    condition: Any, aliases: set[str], depth: int = 0, budget: int = 1000
) -> int:
    if budget < 1:
        raise ValueError("Rules are too complex")
    budget -= 1
    if depth > 20 or not isinstance(condition, dict):
        raise ValueError("Invalid condition")
    op = condition.get("op")
    if not isinstance(op, str):
        raise ValueError("Unsupported condition")
    if op in _PREDICATES:
        alias = condition.get("input")
        if (
            set(condition) != {"op", "input", "value"}
            or not isinstance(alias, str)
            or alias not in aliases
        ):
            raise ValueError("Invalid comparison input")
        if not isinstance(condition["value"], (str, int, float, bool, type(None))):
            raise ValueError("Invalid comparison value")
    elif op in {"all", "any"}:
        conditions = condition.get("conditions")
        if (
            set(condition) != {"op", "conditions"}
            or not isinstance(conditions, list)
            or not conditions
            or len(conditions) > 100
        ):
            raise ValueError("Invalid boolean group")
        for child in conditions:
            budget = _validate_condition(child, aliases, depth + 1, budget)
    elif op == "not":
        if set(condition) != {"op", "condition"}:
            raise ValueError("Invalid negation")
        budget = _validate_condition(condition["condition"], aliases, depth + 1, budget)
    else:
        raise ValueError("Unsupported condition")
    return budget


def _result_type(value: Any, expected: str) -> None:
    if value is None:
        return
    if expected == "text" and isinstance(value, str):
        return
    if expected == "boolean" and isinstance(value, bool):
        return
    if expected == "number" and not isinstance(value, bool):
        try:
            if Decimal(str(value)).is_finite():
                return
        except InvalidOperation:
            pass
    if expected == "date" and isinstance(value, str):
        try:
            date.fromisoformat(value)
            return
        except ValueError:
            pass
    raise ValueError(f"Expected {expected} result")


def _infer_expression_type(node: ast.AST, input_types: dict[str, str]) -> str:
    if isinstance(node, ast.Expression):
        return _infer_expression_type(node.body, input_types)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool):
            return "boolean"
        if isinstance(node.value, (int, float, Decimal)):
            return "number"
        if isinstance(node.value, str):
            return "text"
        return "null"
    if isinstance(node, ast.Name):
        if node.id not in input_types:
            raise ValueError("Function must be called")
        return input_types[node.id]
    if isinstance(node, ast.Call):
        if isinstance(node.func, ast.Name) and node.func.id == "IF":
            if _infer_expression_type(node.args[0], input_types) != "boolean":
                raise ValueError("IF condition requires a boolean")
            branches = {_infer_expression_type(arg, input_types) for arg in node.args[1:]}
            branches.discard("null")
            if len(branches) > 1:
                raise ValueError("IF branches must have compatible types")
            return next(iter(branches), "null")
        if _infer_expression_type(node.args[0], input_types) != "date":
            raise ValueError("Date function requires a date")
        return "number"
    if isinstance(node, ast.BinOp):
        if any(
            _infer_expression_type(item, input_types) != "number"
            for item in (node.left, node.right)
        ):
            raise ValueError("Arithmetic requires numeric inputs")
        return "number"
    if isinstance(node, ast.UnaryOp):
        operand_type = _infer_expression_type(node.operand, input_types)
        expected = "boolean" if isinstance(node.op, ast.Not) else "number"
        if operand_type != expected:
            raise ValueError("Invalid unary input type")
        return expected
    if isinstance(node, ast.BoolOp):
        if any(_infer_expression_type(item, input_types) != "boolean" for item in node.values):
            raise ValueError("Boolean operator requires boolean inputs")
        return "boolean"
    if isinstance(node, ast.Compare):
        types = [
            _infer_expression_type(item, input_types) for item in (node.left, *node.comparators)
        ]
        if len({item for item in types if item != "null"}) > 1:
            raise ValueError("Comparison types do not match")
        return "boolean"
    raise ValueError("Unsupported expression")


def _validate_condition_types(condition: dict[str, Any], input_types: dict[str, str]) -> None:
    op = condition["op"]
    if op in _PREDICATES:
        kind = input_types[condition["input"]]
        expected = "text" if kind in {"select", "card_reference"} else kind
        _result_type(condition["value"], expected)
    elif op in {"all", "any"}:
        for child in condition["conditions"]:
            _validate_condition_types(child, input_types)
    else:
        _validate_condition_types(condition["condition"], input_types)


def validate_section_config(
    section: PmlRowKind,
    config: PmlSectionConfig,
    previous: PmlSectionConfig | None = None,
) -> None:
    errors: dict[str, str] = {}
    fields = {field.key: field for field in config.fields}
    if len(fields) != len(config.fields):
        errors["fields"] = "Field keys must be unique"
    if len(config.visible_columns) != len(set(config.visible_columns)):
        errors["visible_columns"] = "Column keys must be unique"
    summary_columns = {
        "budget": {"total_cost_items", "total_invoiced", "remaining_to_invoice"},
        "cost_item": {"total_invoiced", "remaining_to_invoice"},
        "invoice": set(),
    }
    if set(config.visible_columns) - (
        set(fields) | STANDARD_INPUTS[section] | summary_columns[section]
    ):
        errors["visible_columns"] = "Unknown column key"
    if config.provider_source is not None and section != "cost_item":
        errors["provider_source"] = "Provider inheritance is available on Cost Items only"
    dependencies: dict[str, set[str]] = {}
    for field in config.fields:
        try:
            if field.key in STANDARD_INPUTS[section] | _SYSTEM_KEYS:
                raise ValueError("Field key is reserved")
            if len({option.id for option in field.options}) != len(field.options):
                raise ValueError("Option IDs must be unique")
            if field.kind != "select" and field.options:
                raise ValueError("Options require a select field")
            if field.kind == "card_reference" and not field.card_type:
                raise ValueError("Card type is required")
            if section == "invoice" and field.card_type == "Provider":
                raise ValueError("Provider is not available on invoices")
            if field.kind != "card_reference" and (field.card_type or field.relation_type):
                raise ValueError("Card configuration requires a card reference")
            if field.default is not None:
                _normalize(field, field.default)
            if field.kind == "calculated":
                calc = field.calculation
                if calc is None or (calc.expression is None) == (calc.rules is None):
                    raise ValueError("Choose an expression or ordered rules")
                if not field.active:
                    continue
                constants = calc.provider_constants
                if constants and (section != "cost_item" or calc.expression is None):
                    raise ValueError("Provider constants require a Cost Item formula")
                if set(calc.inputs) & set(constants):
                    raise ValueError("Provider constants must have unique aliases")
                aliases = set(calc.inputs) | set(constants)
                if calc.formula_engine == "core" and aliases & (set(SAFE_FUNCTIONS) | {"data"}):
                    raise ValueError("Input alias is reserved")
                if any(not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) for key in aliases):
                    raise ValueError("Invalid input alias")
                if set(constants) & {"IF", "YEAR", "MONTH", "DAY"}:
                    raise ValueError("Provider constant alias is reserved")
                for value in constants.values():
                    if str(uuid.UUID(value)) != value:
                        raise ValueError("Provider constant requires a canonical UUID")
                for source in calc.inputs.values():
                    dependency = fields.get(source)
                    if source not in STANDARD_INPUTS[section] and (
                        not dependency or not dependency.active
                    ):
                        raise ValueError(f"Unknown or inactive input {source}")
                dependencies[field.key] = {
                    source for source in calc.inputs.values() if source in fields
                }
                input_types = _input_types(fields, calc.inputs)
                input_types.update({alias: "card_reference" for alias in constants})
                if calc.expression is not None:
                    if calc.formula_engine == "core":
                        refs = _validate_core_formula(
                            calc.expression, aliases, _core_data_sources(section, fields)
                        )
                        dependencies[field.key].update(refs & set(fields))
                    else:
                        tree = _validate_expression(calc.expression, aliases)
                        actual = _infer_expression_type(tree, input_types)
                        if actual not in {calc.result_type, "null"}:
                            raise ValueError("Expression result type does not match")
                if calc.rules is not None:
                    _result_type(calc.fallback, calc.result_type)
                    budget = 1000
                    for rule in calc.rules:
                        if set(rule) != {"when", "then"}:
                            raise ValueError("Invalid rule")
                        budget = _validate_condition(rule["when"], aliases, budget=budget)
                        _validate_condition_types(rule["when"], input_types)
                        _result_type(rule["then"], calc.result_type)
            elif field.calculation is not None:
                raise ValueError("Calculation requires a calculated field")
        except ValueError as exc:
            errors[field.key] = str(exc)

    visited: set[str] = set()
    visiting: set[str] = set()

    def visit(key: str) -> None:
        if key in visiting:
            raise ValueError("Circular dependency")
        if key in visited:
            return
        visiting.add(key)
        for dep in dependencies.get(key, set()):
            if dep in dependencies:
                visit(dep)
        visiting.remove(key)
        visited.add(key)

    for key in dependencies:
        try:
            visit(key)
        except ValueError as exc:
            errors[key] = str(exc)
    if errors:
        raise PmlFieldError(errors)


def _expression_value(node: ast.AST, names: dict[str, Any]) -> Any:
    if isinstance(node, ast.Expression):
        return _expression_value(node.body, names)
    if isinstance(node, ast.Constant):
        return getattr(node, "decimal_value", node.value)
    if isinstance(node, ast.Name):
        return names[node.id]
    if isinstance(node, ast.Call):
        if isinstance(node.func, ast.Name) and node.func.id == "IF":
            condition = _expression_value(node.args[0], names)
            return _expression_value(node.args[1] if condition else node.args[2], names)
        value = _expression_value(node.args[0], names)
        if value is None:
            return None
        parsed = date.fromisoformat(value) if isinstance(value, str) else value
        if not isinstance(node.func, ast.Name):
            raise ValueError("Unsupported date function")
        return {"YEAR": parsed.year, "MONTH": parsed.month, "DAY": parsed.day}[node.func.id]
    if isinstance(node, ast.UnaryOp):
        value = _expression_value(node.operand, names)
        if isinstance(node.op, ast.Not):
            return not value
        return -Decimal(str(value)) if isinstance(node.op, ast.USub) else Decimal(str(value))
    if isinstance(node, ast.BinOp):
        left = _expression_value(node.left, names)
        right = _expression_value(node.right, names)
        if left is None or right is None:
            return None
        return _BINARY[type(node.op)](Decimal(str(left)), Decimal(str(right)))
    if isinstance(node, ast.BoolOp):
        values = (_expression_value(item, names) for item in node.values)
        return all(values) if isinstance(node.op, ast.And) else any(values)
    if isinstance(node, ast.Compare):
        left = _expression_value(node.left, names)
        for op, comparator in zip(node.ops, node.comparators):
            right = _expression_value(comparator, names)
            if not _COMPARE[type(op)](left, right):
                return False
            left = right
        return True
    raise ValueError("Unsupported expression")


def _condition_value(
    condition: dict[str, Any], names: dict[str, Any], input_types: dict[str, str]
) -> bool:
    op = condition["op"]
    if op in _PREDICATES:
        alias = condition["input"]
        left = names[alias]
        right = _typed_operand(condition["value"], input_types[alias])
        if (left is None or right is None) and op not in {"eq", "ne"}:
            return False
        return bool(_PREDICATES[op](left, right))
    if op in {"all", "any"}:
        results = [_condition_value(item, names, input_types) for item in condition["conditions"]]
        return all(results) if op == "all" else any(results)
    return not _condition_value(condition["condition"], names, input_types)


def evaluate_row_fields(
    config: PmlSectionConfig,
    values: dict[str, Any],
    context: dict[str, Any],
    *,
    unavailable_calculations: set[str] | None = None,
) -> tuple[dict[str, Any], dict[str, str]]:
    fields = {field.key: field for field in config.fields}
    calculated = {
        key: field for key, field in fields.items() if field.active and field.kind == "calculated"
    }
    output: dict[str, Any] = {}
    errors: dict[str, str] = {}
    unavailable = set(unavailable_calculations or ())
    visiting: set[str] = set()

    def compute(key: str) -> Any:
        if key in output:
            return output[key]
        if key in unavailable:
            return UNAVAILABLE
        if key in errors:
            return None
        if key in visiting:
            errors[key] = "Circular dependency"
            return None
        field = calculated[key]
        calc = field.calculation
        if calc is None:
            errors[key] = "Missing calculation"
            return None
        visiting.add(key)
        inputs = {}
        for alias, source in calc.inputs.items():
            inputs[alias] = (
                compute(source) if source in calculated else values.get(source, context.get(source))
            )
        data = {}
        sources = {}
        if calc.formula_engine == "core" and calc.expression is not None:
            available_sources = _core_data_sources_for_evaluation(fields)
            sources = {
                name: available_sources[name]
                for name in _core_formula_refs(calc.expression)
                if name in available_sources
            }
            for name, source in sources.items():
                data[name] = (
                    compute(source)
                    if source in calculated
                    else values.get(source, context.get(source))
                )
        visiting.remove(key)
        if any(value is UNAVAILABLE for value in (*inputs.values(), *data.values())):
            unavailable.add(key)
            return UNAVAILABLE
        if any(source in errors for source in (*calc.inputs.values(), *sources.values())):
            errors[key] = "Calculation dependency failed"
            return None
        try:
            input_types = _input_types(fields, calc.inputs)
            inputs = {
                alias: _typed_operand(value, input_types[alias]) for alias, value in inputs.items()
            }
            if calc.expression is not None:
                inputs.update(calc.provider_constants)
                if calc.formula_engine == "core":
                    data_types = _input_types(fields, {name: sources[name] for name in data})
                    typed_data = {
                        name: _typed_operand(value, data_types[name])
                        for name, value in data.items()
                    }
                    result = _evaluate_formula(
                        calc.expression,
                        {**inputs, "data": _nested_data(typed_data)},
                        decimal_numbers=True,
                    )
                else:
                    result = _expression_value(
                        _validate_expression(calc.expression, set(inputs)), inputs
                    )
            else:
                result = calc.fallback
                for rule in calc.rules or []:
                    if _condition_value(rule["when"], inputs, input_types):
                        result = rule["then"]
                        break
            if result is not None:
                if calc.result_type == "number":
                    result = str(_typed_operand(result, "number"))
                elif calc.result_type == "text" and not isinstance(result, str):
                    raise ValueError("Expected text result")
                elif calc.result_type == "boolean" and not isinstance(result, bool):
                    raise ValueError("Expected boolean result")
                elif calc.result_type == "date":
                    result = date.fromisoformat(str(result)).isoformat()
            output[key] = result
            return result
        except (
            ValueError,
            KeyError,
            TypeError,
            ArithmeticError,
            InvalidExpression,
            SyntaxError,
        ) as exc:
            errors[key] = str(exc)
            return None

    for key in calculated:
        compute(key)
    return output, errors
