"""
Safe formula evaluation engine using simpleeval.

Provides a sandboxed expression evaluator with EA-specific helper functions
and a context builder that loads card data + relations for formula execution.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

from simpleeval import EvalWithCompoundTypes, FunctionNotDefined, NameNotDefined
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calculation import Calculation
from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType

logger = logging.getLogger("turboea.calculations")

MAX_FORMULA_LENGTH = 5000


# ── Built-in functions ────────────────────────────────────────────────


def _IF(condition: Any, true_val: Any, false_val: Any) -> Any:  # noqa: N802
    return true_val if condition else false_val


def _SUM(values: list | None) -> float:  # noqa: N802
    if not values:
        return 0
    return sum(v for v in values if isinstance(v, (int, float)))


def _AVG(values: list | None) -> float | None:  # noqa: N802
    if not values:
        return None
    nums = [v for v in values if isinstance(v, (int, float))]
    return sum(nums) / len(nums) if nums else None


def _MIN(values: list | None) -> float | None:  # noqa: N802
    nums = [v for v in (values or []) if isinstance(v, (int, float))]
    return min(nums) if nums else None


def _MAX(values: list | None) -> float | None:  # noqa: N802
    nums = [v for v in (values or []) if isinstance(v, (int, float))]
    return max(nums) if nums else None


def _COUNT(values: list | None) -> int:  # noqa: N802
    return len(values) if values else 0


def _ROUND(value: float | None, decimals: int = 0) -> float | None:  # noqa: N802
    if value is None:
        return None
    return round(value, decimals)


def _ABS(value: float | None) -> float | None:  # noqa: N802
    if value is None:
        return None
    return abs(value)


def _COALESCE(*args: Any) -> Any:  # noqa: N802
    for a in args:
        if a is not None:
            return a
    return None


def _LOWER(s: str | None) -> str | None:  # noqa: N802
    return s.lower() if isinstance(s, str) else None


def _UPPER(s: str | None) -> str | None:  # noqa: N802
    return s.upper() if isinstance(s, str) else None


def _CONCAT(*args: Any) -> str:  # noqa: N802
    return "".join(str(a) for a in args if a is not None)


def _CONTAINS(s: str | None, sub: str) -> bool:  # noqa: N802
    if not isinstance(s, str):
        return False
    return sub in s


def _PLUCK(items: list[dict] | None, key: str) -> list:  # noqa: N802
    """Extract a nested key from each dict. Supports dot notation."""
    if not items:
        return []
    result = []
    for item in items:
        val = item
        for part in key.split("."):
            if isinstance(val, dict):
                val = val.get(part)
            else:
                val = None
                break
        result.append(val)
    return result


def _FILTER(items: list[dict] | None, key: str, value: Any) -> list[dict]:  # noqa: N802
    """Filter list of dicts where dict[key] == value. Supports dot notation."""
    if not items:
        return []
    result = []
    for item in items:
        val = item
        for part in key.split("."):
            if isinstance(val, dict):
                val = val.get(part)
            else:
                val = None
                break
        if val == value:
            result.append(item)
    return result


def _MAP_SCORE(value: str | None, mapping: dict) -> float | None:  # noqa: N802
    """Map a select key to a numeric score."""
    if value is None:
        return None
    return mapping.get(value)


SAFE_FUNCTIONS = {
    "IF": _IF,
    "SUM": _SUM,
    "AVG": _AVG,
    "MIN": _MIN,
    "MAX": _MAX,
    "COUNT": _COUNT,
    "ROUND": _ROUND,
    "ABS": _ABS,
    "COALESCE": _COALESCE,
    "LOWER": _LOWER,
    "UPPER": _UPPER,
    "CONCAT": _CONCAT,
    "CONTAINS": _CONTAINS,
    "PLUCK": _PLUCK,
    "FILTER": _FILTER,
    "MAP_SCORE": _MAP_SCORE,
    # Python builtins that are safe
    "len": len,
    "str": str,
    "int": int,
    "float": float,
    "bool": bool,
    "abs": abs,
    "round": round,
    "min": min,
    "max": max,
    "sum": sum,
}


# ── Data context builder ─────────────────────────────────────────────


class _DotDict(dict):
    """Dict subclass that allows attribute-style access (data.fieldKey)."""

    def __getattr__(self, key: str) -> Any:
        try:
            return self[key]
        except KeyError:
            return None

    def __setattr__(self, key: str, value: Any) -> None:
        self[key] = value


async def _build_context(db: AsyncSession, card: Card) -> dict[str, Any]:
    """Build the data context dict for a card's formula evaluation."""
    # Base card data
    attrs = dict(card.attributes or {})
    data = _DotDict(
        {
            "name": card.name,
            "description": card.description,
            "status": card.status,
            "approval_status": card.approval_status,
            "subtype": card.subtype,
            "lifecycle": _DotDict(card.lifecycle or {}),
            **attrs,
        }
    )

    # Relations data — group by relation type key
    relations = _DotDict()
    relation_count = _DotDict()

    # Get all relation types that touch this card type
    rel_types_result = await db.execute(
        select(RelationType).where(
            (RelationType.source_type_key == card.type)
            | (RelationType.target_type_key == card.type),
            RelationType.is_hidden == False,  # noqa: E712
        )
    )
    rel_types = {rt.key: rt for rt in rel_types_result.scalars().all()}

    # Fetch all relations involving this card
    rels_result = await db.execute(
        select(Relation).where(
            (Relation.source_id == card.id) | (Relation.target_id == card.id)
        )
    )
    all_rels = rels_result.scalars().all()

    # Initialise groups
    for rt_key in rel_types:
        relations[rt_key] = []
        relation_count[rt_key] = 0

    for rel in all_rels:
        if rel.type not in rel_types:
            continue
        # Determine the "other" card
        other_id = rel.target_id if rel.source_id == card.id else rel.source_id
        other_result = await db.execute(select(Card).where(Card.id == other_id))
        other_card = other_result.scalar_one_or_none()
        if not other_card or other_card.status != "ACTIVE":
            continue

        entry = _DotDict(
            {
                "id": str(other_card.id),
                "name": other_card.name,
                "type": other_card.type,
                "attributes": _DotDict(other_card.attributes or {}),
                "rel_attributes": _DotDict(rel.attributes or {}),
            }
        )
        if rel.type not in relations:
            relations[rel.type] = []
        relations[rel.type].append(entry)
        relation_count[rel.type] = relation_count.get(rel.type, 0) + 1

    # Children (hierarchical)
    children_result = await db.execute(
        select(Card).where(Card.parent_id == card.id, Card.status == "ACTIVE")
    )
    children_cards = children_result.scalars().all()
    children = [
        _DotDict(
            {
                "id": str(c.id),
                "name": c.name,
                "type": c.type,
                "subtype": c.subtype,
                "attributes": _DotDict(c.attributes or {}),
            }
        )
        for c in children_cards
    ]

    return {
        "data": data,
        "relations": relations,
        "relation_count": relation_count,
        "children": children,
        "children_count": len(children),
        "None": None,
        "True": True,
        "False": False,
    }


# ── Evaluation engine ────────────────────────────────────────────────


def _evaluate_formula(formula: str, context: dict[str, Any]) -> Any:
    """Evaluate a formula string in a sandboxed environment."""
    evaluator = EvalWithCompoundTypes(
        names=context,
        functions=SAFE_FUNCTIONS,
    )
    return evaluator.eval(formula)


async def execute_calculation(
    db: AsyncSession,
    calc: Calculation,
    card: Card,
) -> tuple[bool, str | None]:
    """Execute a single calculation for a single card.

    Returns (success: bool, error_message: str | None).
    Updates the card's attributes in-place (caller must commit).
    """
    try:
        context = await _build_context(db, card)
        result = _evaluate_formula(calc.formula, context)

        # Write result to card attributes
        attrs = dict(card.attributes or {})
        if result is None:
            attrs.pop(calc.target_field_key, None)
        else:
            attrs[calc.target_field_key] = result
        card.attributes = attrs

        return True, None

    except (NameNotDefined, FunctionNotDefined) as e:
        error = f"Formula error: {e}"
        logger.warning("Calculation '%s' failed for card %s: %s", calc.name, card.id, error)
        return False, error

    except Exception as e:
        error = f"Evaluation error: {type(e).__name__}: {e}"
        logger.warning("Calculation '%s' failed for card %s: %s", calc.name, card.id, error)
        return False, error


async def run_calculations_for_card(
    db: AsyncSession,
    card: Card,
    *,
    exclude_field: str | None = None,
) -> list[dict]:
    """Run all active calculations for a card's type, in execution_order.

    Args:
        db: database session
        card: the card to compute
        exclude_field: skip calculations targeting this field (loop prevention)

    Returns list of {calculation_id, name, success, error} dicts.
    """
    result = await db.execute(
        select(Calculation)
        .where(
            Calculation.target_type_key == card.type,
            Calculation.is_active == True,  # noqa: E712
        )
        .order_by(Calculation.execution_order, Calculation.created_at)
    )
    calcs = result.scalars().all()

    results = []
    for calc in calcs:
        if exclude_field and calc.target_field_key == exclude_field:
            continue

        success, error = await execute_calculation(db, calc, card)

        # Update calculation metadata
        calc.last_run_at = datetime.now(timezone.utc)
        calc.last_error = error

        results.append(
            {
                "calculation_id": str(calc.id),
                "name": calc.name,
                "target_field": calc.target_field_key,
                "success": success,
                "error": error,
            }
        )

    return results


async def run_calculations_for_type(
    db: AsyncSession,
    target_type_key: str,
) -> dict:
    """Bulk recalculate all cards of a given type. Returns summary stats."""
    cards_result = await db.execute(
        select(Card).where(Card.type == target_type_key, Card.status == "ACTIVE")
    )
    cards = cards_result.scalars().all()

    total = len(cards)
    success_count = 0
    error_count = 0
    errors = []

    for card in cards:
        results = await run_calculations_for_card(db, card)
        for r in results:
            if r["success"]:
                success_count += 1
            else:
                error_count += 1
                errors.append({"card_id": str(card.id), "card_name": card.name, **r})

    await db.commit()
    return {
        "cards_processed": total,
        "calculations_succeeded": success_count,
        "calculations_failed": error_count,
        "errors": errors[:50],
    }


async def validate_formula(
    formula: str, target_type_key: str, db: AsyncSession
) -> dict:
    """Validate a formula without executing it on real data."""
    try:
        if len(formula) > MAX_FORMULA_LENGTH:
            return {
                "valid": False,
                "error": f"Formula exceeds maximum length of {MAX_FORMULA_LENGTH} characters",
            }

        type_result = await db.execute(
            select(CardType).where(CardType.key == target_type_key)
        )
        card_type = type_result.scalar_one_or_none()
        if not card_type:
            return {"valid": False, "error": f"Card type '{target_type_key}' not found"}

        # Build dummy data from fields_schema
        dummy_data = _DotDict(
            {
                "name": "Test",
                "description": "",
                "status": "ACTIVE",
                "approval_status": "DRAFT",
                "subtype": None,
                "lifecycle": _DotDict({}),
            }
        )
        for section in card_type.fields_schema or []:
            for field in section.get("fields", []):
                key = field["key"]
                ftype = field.get("type", "text")
                if ftype in ("number", "cost"):
                    dummy_data[key] = 0
                elif ftype == "boolean":
                    dummy_data[key] = False
                elif ftype in ("single_select", "multiple_select"):
                    opts = field.get("options", [])
                    dummy_data[key] = opts[0]["key"] if opts else None
                else:
                    dummy_data[key] = ""

        context = {
            "data": dummy_data,
            "relations": _DotDict(),
            "relation_count": _DotDict(),
            "children": [],
            "children_count": 0,
            "None": None,
            "True": True,
            "False": False,
        }

        result = _evaluate_formula(formula, context)
        return {"valid": True, "error": None, "preview_result": result}

    except Exception as e:
        return {"valid": False, "error": f"{type(e).__name__}: {e}"}


async def detect_cycles(
    db: AsyncSession, new_calc: Calculation
) -> list[str] | None:
    """Check if activating new_calc would create a dependency cycle.

    Returns list of field keys in the cycle, or None if safe.
    """
    # Load all active calculations for this type
    result = await db.execute(
        select(Calculation).where(
            Calculation.target_type_key == new_calc.target_type_key,
            Calculation.is_active == True,  # noqa: E712
        )
    )
    all_calcs = result.scalars().all()

    # Add the new/updated calculation
    calcs = [c for c in all_calcs if str(c.id) != str(new_calc.id)]
    calcs.append(new_calc)

    # Build dependency graph: target_field -> set of source fields referenced in formula
    graph: dict[str, set[str]] = {}
    for calc in calcs:
        target = calc.target_field_key
        refs = set(re.findall(r"data\.(\w+)", calc.formula))
        graph[target] = refs

    # DFS cycle detection
    def has_cycle(node: str, visited: set, stack: set) -> list[str] | None:
        visited.add(node)
        stack.add(node)
        for dep in graph.get(node, set()):
            if dep in graph:  # dep is also a calculated field
                if dep in stack:
                    return [dep, node]
                if dep not in visited:
                    cycle = has_cycle(dep, visited, stack)
                    if cycle:
                        return cycle
        stack.discard(node)
        return None

    visited: set[str] = set()
    for node in graph:
        if node not in visited:
            cycle = has_cycle(node, visited, set())
            if cycle:
                return cycle

    return None
