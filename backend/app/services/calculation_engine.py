"""
Safe formula evaluation engine using simpleeval.

Provides a sandboxed expression evaluator with EA-specific helper functions
and a context builder that loads card data + relations for formula execution.
"""

from __future__ import annotations

import ast
import logging
import math
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from simpleeval import (
    DEFAULT_OPERATORS,
    EvalWithCompoundTypes,
    InvalidExpression,
    NameNotDefined,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calculation import Calculation
from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.services.calculation_lint import (
    data_refs,
    lint_formula,
    split_formula_lines,
    suggest_field,
    unknown_field_refs,
)
from app.services.calculation_ppm import (
    INITIATIVE_TYPE,
    build_ppm_map,
    empty_ppm,
    fiscal_year_for,
    get_fiscal_year_start,
    needs_ppm,
)
from app.services.hierarchy import compute_hierarchy_level

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


def _LN(value: float | None) -> float | None:  # noqa: N802
    """Natural logarithm. Non-positive, None, and non-numeric input all yield
    None (never raise) so a formula can't crash on empty/zero field values."""
    if not isinstance(value, (int, float)) or value <= 0:
        return None
    return math.log(value)


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
    "LN": _LN,
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


def card_data(card: Card) -> _DotDict:
    """The ``data`` root: the card's own fields and built-in properties.

    Cheap and pure, and deliberately re-derived for every calculation rather
    than shared: one calculation routinely reads a field an earlier one just
    wrote (which is exactly what ``detect_cycles`` guards), so this view has to
    reflect writes made moments ago.

    Keys must stay in step with ``calculation_lint.BUILTIN_CARD_PROPS`` — that
    constant is what the save-time validator accepts, so a property provided
    here but missing there would be rejected in a formula that works.
    """
    return _DotDict(
        {
            "name": card.name,
            "description": card.description,
            "status": card.status,
            "approval_status": card.approval_status,
            "subtype": card.subtype,
            "reference": card.reference,
            "lifecycle": _DotDict(card.lifecycle or {}),
            **dict(card.attributes or {}),
        }
    )


async def build_shared_context(
    db: AsyncSession,
    card: Card,
    *,
    needs_ppm_data: bool = False,
    fiscal_year_start: int | None = None,
) -> dict[str, Any]:
    """Everything in the context that does NOT change between calculations.

    Relations, children, the parent and the hierarchy level are the same for
    every calculation on a card, but the old code rebuilt them once per
    calculation — so a type with six calculations issued six copies of the same
    queries, on a path that ``workspace_io`` walks over every card in the
    database. Splitting the invariant part out lets ``run_calculations_for_card``
    pay for it once.

    ``needs_ppm_data`` gates the PPM aggregation so workspaces with no PPM
    formulas pay nothing for it.
    """
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
        select(Relation).where((Relation.source_id == card.id) | (Relation.target_id == card.id))
    )
    all_rels = rels_result.scalars().all()

    # Initialise groups
    for rt_key in rel_types:
        relations[rt_key] = []
        relation_count[rt_key] = 0

    # Wrapper entries paired with the card they describe, so the PPM pass below
    # can find the Initiatives without re-querying.
    wrappers: list[tuple[_DotDict, Card]] = []

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
        wrappers.append((entry, other_card))
        if rel.type not in relations:
            relations[rel.type] = []
        relations[rel.type].append(entry)
        relation_count[rel.type] = relation_count.get(rel.type, 0) + 1

    # Children (hierarchical)
    children_result = await db.execute(
        select(Card).where(Card.parent_id == card.id, Card.status == "ACTIVE")
    )
    children_cards = children_result.scalars().all()
    children = []
    for c in children_cards:
        entry = _DotDict(
            {
                "id": str(c.id),
                "name": c.name,
                "type": c.type,
                "subtype": c.subtype,
                "attributes": _DotDict(c.attributes or {}),
            }
        )
        wrappers.append((entry, c))
        children.append(entry)

    # Parent card (same ACTIVE filter as children/relations). None — not an
    # empty dict — when absent so `IF(parent, parent.attributes.x, …)` and
    # `COALESCE(parent, …)` behave; an empty dict would still crash on the
    # nested `parent.attributes.x` access.
    parent = None
    if card.parent_id:
        parent_result = await db.execute(select(Card).where(Card.id == card.parent_id))
        parent_card = parent_result.scalar_one_or_none()
        if parent_card and parent_card.status == "ACTIVE":
            parent = _DotDict(
                {
                    "id": str(parent_card.id),
                    "name": parent_card.name,
                    "type": parent_card.type,
                    "subtype": parent_card.subtype,
                    "attributes": _DotDict(parent_card.attributes or {}),
                }
            )
            wrappers.append((parent, parent_card))

    # Hierarchy depth (1 = root). Computed live so it's independent of the
    # persisted attributes.hierarchyLevel (immune to sync/backfill ordering)
    # and defined for non-hierarchical types too (always 1).
    hierarchy_level = await compute_hierarchy_level(db, card.parent_id, exclude={card.id})

    # PPM budget/cost aggregates — the card's own under `ppm`, and every
    # related/child/parent Initiative's under that wrapper's `ppm` key, so
    # `PLUCK(relations.relInitiativeToApp, "ppm.capexBudget")` resolves. Two
    # grouped queries for all of them together, never one per card.
    ppm: dict[str, Any] = empty_ppm()
    if needs_ppm_data:
        if fiscal_year_start is None:
            fiscal_year_start = await get_fiscal_year_start(db)
        initiative_ids = [c.id for _entry, c in wrappers if c.type == INITIATIVE_TYPE]
        if card.type == INITIATIVE_TYPE:
            initiative_ids.append(card.id)
        aggregates = await build_ppm_map(db, initiative_ids, start_month=fiscal_year_start)
        blank = empty_ppm(fiscal_year_for(datetime.now(timezone.utc).date(), fiscal_year_start))
        for entry, other in wrappers:
            if other.type == INITIATIVE_TYPE:
                entry["ppm"] = aggregates.get(str(other.id), blank)
        ppm = aggregates.get(str(card.id), blank)

    return {
        "ppm": _DotDict(ppm),
        "relations": relations,
        "relation_count": relation_count,
        "children": children,
        "children_count": len(children),
        "parent": parent,
        "hierarchy_level": hierarchy_level,
        "None": None,
        "True": True,
        "False": False,
    }


def base_context_roots(**overrides: Any) -> dict[str, Any]:
    """Every root the evaluator expects, with inert defaults.

    The single source of truth for the context *shape*. ``validate_formula``'s
    dummy context and the unit-test helpers build on this, so adding a root can
    never again leave one of them raising ``NameNotDefined`` for a formula that
    works in production.
    """
    roots: dict[str, Any] = {
        "data": _DotDict(),
        "relations": _DotDict(),
        "relation_count": _DotDict(),
        "children": [],
        "children_count": 0,
        "parent": None,
        "hierarchy_level": 1,
        "ppm": _DotDict(empty_ppm()),
        "None": None,
        "True": True,
        "False": False,
    }
    roots.update(overrides)
    return roots


def compose_context(shared: dict[str, Any], card: Card) -> dict[str, Any]:
    """Shared roots plus this card's own (possibly just-written) field values."""
    return {**shared, "data": card_data(card)}


async def _build_context(
    db: AsyncSession,
    card: Card,
    *,
    needs_ppm_data: bool = False,
    fiscal_year_start: int | None = None,
) -> dict[str, Any]:
    """Full evaluation context for a single card."""
    shared = await build_shared_context(
        db, card, needs_ppm_data=needs_ppm_data, fiscal_year_start=fiscal_year_start
    )
    return compose_context(shared, card)


# ── Evaluation engine ────────────────────────────────────────────────


class _LazyIfEval(EvalWithCompoundTypes):
    """Evaluator subclass that makes ``IF(cond, a, b)`` short-circuit.

    Without this, all three arguments are evaluated eagerly (normal Python
    function-call semantics), so ``IF(x is None, 0, x + 1)`` would crash
    when ``x`` is ``None`` because ``x + 1`` is evaluated regardless.
    """

    def _eval_call(self, node):  # type: ignore[override]
        if (
            isinstance(node.func, ast.Name)
            and node.func.id == "IF"
            and len(node.args) == 3
            and not node.keywords
        ):
            cond = self._eval(node.args[0])
            return self._eval(node.args[1]) if cond else self._eval(node.args[2])
        return super()._eval_call(node)


# ── blanks-as-zero operator table ────────────────────────────────────
#
# Opt-in per calculation. Implemented as a replacement *operator table* passed
# to the evaluator's constructor rather than by overriding `_eval_binop`:
# simpleeval routes binary ops, unary ops and comparisons through the same
# `self.operators` mapping, so one table covers all three. Overriding only
# `_eval_binop` would silently miss `-data.x` and every `>` / `<` comparison.
#
# Only ARITHMETIC and the ORDERING comparisons are wrapped. `==` / `!=` / `is`
# / `in` stay object-identical to the defaults, so `IF(data.x is None, …)` and
# `COALESCE` keep meaning exactly what they mean today.
#
# The wrappers close over DEFAULT_OPERATORS' own functions, not `operator.add`
# — `safe_add` and `safe_mult` carry simpleeval's IterableTooLong guards, and
# rebuilding the table from the stdlib would quietly drop them.
_COERCED_BINARY = (
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.FloorDiv,
    ast.Mod,
    ast.Pow,
    ast.Lt,
    ast.LtE,
    ast.Gt,
    ast.GtE,
)
_COERCED_UNARY = (ast.UAdd, ast.USub)


def _zero_like(other: Any) -> Any:
    """The additive identity matching the surviving operand's kind."""
    if isinstance(other, str):
        return ""
    if isinstance(other, (list, tuple)):
        return type(other)()
    return 0


def _null_safe_binary(fn):
    def wrapped(a, b):
        if a is None:
            a = _zero_like(b)
        if b is None:
            b = _zero_like(a)
        return fn(a, b)

    return wrapped


def _null_safe_unary(fn):
    def wrapped(a):
        return fn(0 if a is None else a)

    return wrapped


NULL_SAFE_OPERATORS = {
    **DEFAULT_OPERATORS,
    **{op: _null_safe_binary(DEFAULT_OPERATORS[op]) for op in _COERCED_BINARY},
    **{op: _null_safe_unary(DEFAULT_OPERATORS[op]) for op in _COERCED_UNARY},
}


def _evaluate_formula(
    formula: str,
    context: dict[str, Any],
    *,
    blanks_as_zero: bool = False,
) -> Any:
    """Evaluate a formula string in a sandboxed environment.

    Supports multi-line formulas with intermediate variable assignments::

        bf = MAP_SCORE(data.businessFit, {"excellent": 4, ...})
        tf = MAP_SCORE(data.technicalFit, {"excellent": 4, ...})
        IF(bf >= 2.5, IF(tf >= 2.5, "invest", "migrate"), ...)

    Assignment lines (``name = expr``) store the result in the context so
    subsequent lines can reference them.  The value of the *last* line is
    returned as the formula result.  ``IF()`` calls are lazily evaluated
    (only the taken branch is computed).

    With ``blanks_as_zero`` the evaluator reads an empty field as ``0`` in
    arithmetic and ordering comparisons — see ``_BlanksAsZeroEval``.
    """
    # Line splitting lives in calculation_lint so the static checks analyse
    # exactly what this loop executes, rather than a second interpretation of
    # the same text that can drift out of sync.
    lines = split_formula_lines(formula)

    if not lines:
        raise ValueError("Empty formula")

    evaluator = _LazyIfEval(
        names=dict(context),  # copy — assignments mutate this
        functions=SAFE_FUNCTIONS,
        operators=NULL_SAFE_OPERATORS if blanks_as_zero else None,  # None → defaults
    )

    result = None
    for var_name, expression in lines:
        value = evaluator.eval(expression)
        if var_name:
            evaluator.names[var_name] = value
        result = value

    return result


_MAX_NAMED_BLANKS = 5


def _blank_data_refs(formula: str, context: dict[str, Any] | None) -> list[str]:
    """Field keys the formula reads that are empty on this card."""
    data = (context or {}).get("data") or {}
    return sorted(ref for ref in data_refs(formula) if data.get(ref) is None)


def describe_error(exc: Exception, formula: str, context: dict[str, Any] | None) -> str:
    """Turn an evaluation failure into something an author can act on.

    Both callers are gated on ``admin.metamodel``, so naming the offending
    identifier or field discloses nothing the caller cannot already read.

    ``InvalidExpression`` subclasses are passed through verbatim: simpleeval
    interpolates only the *formula text* into those, which is admin-authored,
    never card data. Everything else is composed here, and an unrecognised
    exception yields its class name alone — so a stray ``RuntimeError``
    carrying a connection string can never reach the UI.

    This exists because "Evaluation error" told the author of #886 nothing at
    all, when the engine knew exactly which field was missing.
    """
    if isinstance(exc, NameNotDefined):
        name = getattr(exc, "name", "") or ""
        data = (context or {}).get("data") or {}
        if name and name in data:
            return f"Unknown name '{name}' — card fields are read as 'data.{name}'"
        return f"Unknown name '{name}' in formula" if name else str(exc)

    if isinstance(exc, ZeroDivisionError):
        return "Division by zero"

    none_typed = isinstance(exc, TypeError) and "NoneType" in str(exc)
    if none_typed and "attribute" in str(exc).lower():
        return (
            "The formula reads an attribute of something empty — most often "
            "'parent' on a root card. Guard it with IF(parent, …)."
        )
    if none_typed:
        blanks = _blank_data_refs(formula, context)
        shown = ", ".join(f"'{b}'" for b in blanks[:_MAX_NAMED_BLANKS])
        if len(blanks) > _MAX_NAMED_BLANKS:
            shown += f" and {len(blanks) - _MAX_NAMED_BLANKS} more"
        subject = f"Field(s) {shown} are empty on this card" if blanks else "An empty value is used"
        return (
            f"{subject} and the formula does arithmetic on them. Wrap them in "
            "COALESCE(field, 0), or switch on 'Treat blank numbers as zero'."
        )

    if isinstance(exc, InvalidExpression):
        # Covers FunctionNotDefined, AttributeDoesNotExist, OperatorNotDefined,
        # FeatureNotAvailable, NumberTooHigh, IterableTooLong — all of which
        # quote only the formula back at the author.
        return str(exc)

    if isinstance(exc, ValueError) and str(exc) == "Empty formula":
        return "Formula is empty"

    return f"Evaluation error ({type(exc).__name__})"


async def execute_calculation(
    db: AsyncSession,
    calc: Calculation,
    card: Card,
    *,
    shared: dict[str, Any] | None = None,
) -> tuple[bool, str | None]:
    """Execute a single calculation for a single card.

    Returns (success: bool, error_message: str | None).
    Updates the card's attributes in-place (caller must commit).

    ``shared`` lets a caller running several calculations over one card build
    the invariant roots once (see ``run_calculations_for_card``). Omitted, this
    builds its own — so single-calculation callers such as the Test endpoint
    need no special handling.
    """
    context: dict[str, Any] | None = None
    try:
        if shared is None:
            context = await _build_context(db, card, needs_ppm_data=needs_ppm(calc.formula))
        else:
            context = compose_context(shared, card)
        result = _evaluate_formula(calc.formula, context, blanks_as_zero=bool(calc.blanks_as_zero))

        # Write result to card attributes
        attrs = dict(card.attributes or {})
        if result is None:
            attrs.pop(calc.target_field_key, None)
        else:
            attrs[calc.target_field_key] = result
        card.attributes = attrs

        return True, None

    except Exception as e:
        logger.warning(
            "Calculation '%s' failed for card %s: %s: %s",
            calc.name,
            card.id,
            type(e).__name__,
            e,
        )
        return False, describe_error(e, calc.formula, context)


async def run_calculations_for_card(
    db: AsyncSession,
    card: Card,
    *,
    exclude_field: str | None = None,
    exclude_fields: set[str] | None = None,
    fiscal_year_start: int | None = None,
) -> list[dict]:
    """Run all active calculations for a card's type, in execution_order.

    Args:
        db: database session
        card: the card to compute
        exclude_field: skip calculations targeting this field (loop prevention)
        exclude_fields: skip calculations targeting any of these fields
                        (e.g. PPM-managed cost fields)
        fiscal_year_start: pre-fetched setting, so a bulk caller looping over
                        thousands of cards reads it once rather than per card

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
    calcs = [
        calc
        for calc in result.scalars().all()
        if not (exclude_field and calc.target_field_key == exclude_field)
        and not (exclude_fields and calc.target_field_key in exclude_fields)
    ]
    if not calcs:
        return []

    # Relations, children, parent, hierarchy level and PPM aggregates are the
    # same for every calculation on this card, so they are built once here
    # rather than once per calculation. Only `data` is re-derived per
    # calculation, because one calculation may read what an earlier one wrote.
    shared = await build_shared_context(
        db,
        card,
        needs_ppm_data=any(needs_ppm(calc.formula) for calc in calcs),
        fiscal_year_start=fiscal_year_start,
    )

    results = []
    for calc in calcs:
        success, error = await execute_calculation(db, calc, card, shared=shared)

        # Update calculation metadata. `last_error` is only assigned when it
        # actually changes: these rows are shared by every card of the type, and
        # a rewrite on each card save turns a bulk recalculation into needless
        # row contention.
        calc.last_run_at = datetime.now(timezone.utc)
        if calc.last_error != error:
            calc.last_error = error

        results.append(
            {
                "calculation_id": str(calc.id),
                "name": calc.name,
                "target_field": calc.target_field_key,
                "success": success,
                "error": error if not success else None,
            }
        )

    return results


MAX_SAMPLE_CARDS = 10


async def run_calculations_for_type(
    db: AsyncSession,
    target_type_key: str,
) -> dict:
    """Bulk recalculate all cards of a given type.

    The report is grouped rather than flat: per calculation, how many cards
    succeeded and failed, and within that, one entry per *distinct* error
    message with the cards it hit. Twenty-one cards failing the same way is one
    thing to fix, not twenty-one — and the old flat list said neither, because
    it was truncated at fifty with no indication that it had been.
    """
    cards_result = await db.execute(
        select(Card).where(Card.type == target_type_key, Card.status == "ACTIVE")
    )
    cards = cards_result.scalars().all()

    total = len(cards)
    success_count = 0
    error_count = 0

    # calculation_id -> report. Insertion-ordered, and `run_calculations_for_card`
    # yields results in execution_order, so the report comes out in execution
    # order without a second sort.
    reports: dict[str, dict[str, Any]] = {}
    # calculation_id -> error message -> {count, cards}
    failures: dict[str, dict[str, dict[str, Any]]] = {}

    # One settings read for the whole run rather than one per card.
    fiscal_year_start = await get_fiscal_year_start(db)

    for card in cards:
        results = await run_calculations_for_card(db, card, fiscal_year_start=fiscal_year_start)
        for r in results:
            calc_id = r["calculation_id"]
            report = reports.get(calc_id)
            if report is None:
                report = reports[calc_id] = {
                    "calculation_id": calc_id,
                    "name": r["name"],
                    "target_field": r["target_field"],
                    "succeeded": 0,
                    "failed": 0,
                    "failures": [],
                }
                failures[calc_id] = {}

            if r["success"]:
                success_count += 1
                report["succeeded"] += 1
                continue

            error_count += 1
            report["failed"] += 1
            message = r["error"] or "Evaluation error"
            group = failures[calc_id].get(message)
            if group is None:
                group = failures[calc_id][message] = {
                    "error": message,
                    "count": 0,
                    "cards": [],
                    "cards_truncated": False,
                }
                report["failures"].append(group)
            group["count"] += 1
            if len(group["cards"]) < MAX_SAMPLE_CARDS:
                group["cards"].append({"id": str(card.id), "name": card.name})
            else:
                group["cards_truncated"] = True

    # `run_calculations_for_card` rewrites `last_error` on every card, so after a
    # bulk run the row carried whichever card happened to be processed last — a
    # run that failed twenty-one times and then succeeded once showed a green OK
    # chip. Settle it on the dominant failure instead, once, at the end.
    if reports:
        calcs_result = await db.execute(
            select(Calculation).where(
                Calculation.id.in_([uuid.UUID(cid) for cid in reports]),
            )
        )
        for calc in calcs_result.scalars().all():
            groups = failures.get(str(calc.id)) or {}
            dominant = max(groups.values(), key=lambda g: g["count"])["error"] if groups else None
            if calc.last_error != dominant:
                calc.last_error = dominant

    await db.commit()
    return {
        "cards_processed": total,
        "calculations_succeeded": success_count,
        "calculations_failed": error_count,
        "calculations": list(reports.values()),
    }


async def calculation_target_fields(db: AsyncSession, target_type_key: str) -> set[str]:
    """Field keys other calculations write on this type.

    A calculation's target need not be a declared schema field, and one
    calculation routinely reads another's output — the very dependency
    ``detect_cycles`` exists to police. So these count as known keys for the
    save-time validation, or chaining two calculations would be rejected.
    """
    rows = await db.execute(
        select(Calculation.target_field_key).where(Calculation.target_type_key == target_type_key)
    )
    return {key for key in rows.scalars().all() if key}


async def unknown_fields_message(
    db: AsyncSession, formula: str, target_type_key: str
) -> str | None:
    """Complaint about field keys the formula reads that cannot exist, or None.

    This is the check that would have caught #886's first formula immediately:
    ``data.LicenseCost`` where the key is ``licenseCost``. It runs at save time
    so the mistake never reaches a card, and it is what lets ``blanks_as_zero``
    assume a ``None`` means "empty" rather than "misspelt".
    """
    type_result = await db.execute(select(CardType).where(CardType.key == target_type_key))
    card_type = type_result.scalar_one_or_none()
    if not card_type:
        return f"Card type '{target_type_key}' not found"

    extra = await calculation_target_fields(db, target_type_key)
    unknown = unknown_field_refs(formula, card_type.fields_schema, extra=extra)
    if not unknown:
        return None

    parts = []
    for key in unknown:
        hint = suggest_field(key, card_type.fields_schema, extra=extra)
        parts.append(f"'{key}' (did you mean '{hint}'?)" if hint else f"'{key}'")
    return (
        f"Formula reads {', '.join(parts)}, which "
        f"{'does' if len(parts) == 1 else 'do'} not exist on {target_type_key}. "
        "Fields are referenced by key, not by the label shown on the card."
    )


async def validate_formula(formula: str, target_type_key: str, db: AsyncSession) -> dict:
    """Validate a formula without executing it on real data."""
    warnings = list(lint_formula(formula))
    try:
        if len(formula) > MAX_FORMULA_LENGTH:
            return {
                "valid": False,
                "error": f"Formula exceeds maximum length of {MAX_FORMULA_LENGTH} characters",
                "warnings": warnings,
            }

        type_result = await db.execute(select(CardType).where(CardType.key == target_type_key))
        card_type = type_result.scalar_one_or_none()
        if not card_type:
            return {
                "valid": False,
                "error": f"Card type '{target_type_key}' not found",
                "warnings": warnings,
            }

        unknown = await unknown_fields_message(db, formula, target_type_key)
        if unknown:
            return {"valid": False, "error": unknown, "warnings": warnings}

        # Build dummy data from fields_schema
        dummy_data = _DotDict(
            {
                "name": "Test",
                "description": "",
                "status": "ACTIVE",
                "approval_status": "DRAFT",
                "subtype": None,
                "reference": "TEST-1",
                "lifecycle": _DotDict({}),
            }
        )
        for section in card_type.fields_schema or []:
            for field in section.get("fields", []):
                key = field["key"]
                ftype = field.get("type", "text")
                if ftype == "boolean":
                    dummy_data[key] = False
                elif ftype in ("single_select", "multiple_select"):
                    opts = field.get("options", [])
                    dummy_data[key] = opts[0]["key"] if opts else None
                else:
                    # Everything else — number/cost, text-ish, ext.* custom
                    # types, unknowns — is seeded as a NON-ZERO number. The old
                    # 0/"" seeds failed legitimate formulas: `3 * data.rating`
                    # over an ext.* field hit 3 * "" → "" and blew up on the
                    # next arithmetic op, and a ratio over numeric fields hit
                    # 0/(0*0) → ZeroDivisionError. A dummy of 1 exercises the
                    # same code paths with realistic input; the string builtins
                    # (LOWER/UPPER/CONTAINS) are isinstance-guarded, so a
                    # numeric dummy never crashes a string formula.
                    dummy_data[key] = 1

        # A populated dummy parent so `parent.attributes.someField` validates;
        # hierarchy_level of 2 so both branches of `hierarchy_level == 1` checks
        # exercise cleanly.
        dummy_parent = _DotDict(
            {
                "id": "00000000-0000-0000-0000-000000000000",
                "name": "Parent",
                "type": target_type_key,
                "subtype": None,
                "attributes": _DotDict(dict(dummy_data)),
            }
        )

        # Built from the shared root factory so a newly added context root can
        # never be present in production but missing here — which would report
        # a working formula as invalid.
        context = base_context_roots(
            data=dummy_data,
            parent=dummy_parent,
            hierarchy_level=2,
        )

        result = _evaluate_formula(formula, context)
        return {"valid": True, "error": None, "preview_result": result, "warnings": warnings}

    except Exception as e:
        logger.warning("Formula validation failed: %s: %s", type(e).__name__, e)
        return {"valid": False, "error": describe_error(e, formula, None), "warnings": warnings}


async def detect_cycles(db: AsyncSession, new_calc: Calculation) -> list[str] | None:
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
