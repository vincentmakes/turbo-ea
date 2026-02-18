# Calculated Fields — Feature Specification

## 1. Overview

Add admin-configurable **calculated fields** to Turbo EA, inspired by SAP LeanIX's Calculations feature. Calculated fields automatically populate Card attribute values based on formulas that reference other fields on the same Card or aggregate data from related Cards via relations.

**Design choice — safe Python expressions instead of sandboxed JavaScript:**
LeanIX uses server-side JavaScript. Since Turbo EA's backend is Python/FastAPI, we use the [`simpleeval`](https://github.com/danthedeckie/simpleeval) library instead. This gives us a safe, sandboxed expression evaluator (no `import`, `exec`, filesystem, or network access) with zero dependency on Node.js. The expression syntax is Python-like and intuitive: `data.budgetCapEx + data.budgetOpEx`, `IF(data.score > 80, "high", "low")`, etc.

---

## 2. Functional Requirements

### 2.1 What a Calculation Is

A Calculation is an admin-defined rule consisting of:
- **Name** — human-readable label (e.g. "Total Budget")
- **Description** — optional explanation
- **Target Card Type** — which card type this applies to (e.g. `Initiative`)
- **Target Field Key** — which attribute field receives the result (must exist in the type's `fields_schema`)
- **Formula** — a safe Python expression string evaluated by `simpleeval`
- **Is Active** — toggle to enable/disable without deleting
- **Execution order** — integer to control evaluation sequence when multiple calculations target the same card type

### 2.2 What Formulas Can Access

Formulas receive a `data` context object with:

| Variable | Type | Description |
|----------|------|-------------|
| `data.<fieldKey>` | any | Any attribute field value from the current card's `attributes` JSONB |
| `data.name` | str | Card name |
| `data.description` | str | Card description |
| `data.status` | str | Card status (ACTIVE/ARCHIVED) |
| `data.approval_status` | str | Approval status |
| `data.subtype` | str | Card subtype key |
| `data.lifecycle` | dict | Lifecycle dates dict (`plan`, `phaseIn`, `active`, `phaseOut`, `endOfLife`) |
| `relations.<relationTypeKey>` | list[dict] | List of related cards' attributes (see §2.3) |
| `relation_count.<relationTypeKey>` | int | Count of relations of each type |
| `children` | list[dict] | Direct child cards' attributes (for hierarchical types) |
| `children_count` | int | Number of direct children |

### 2.3 Relation Data Structure

Each item in `relations.<relationTypeKey>` is a dict containing:
```python
{
    "id": "<card uuid>",
    "name": "<card name>",
    "type": "<card type key>",
    "attributes": { ... },   # the related card's attributes
    "rel_attributes": { ... } # attributes on the relation itself
}
```

### 2.4 Built-in Functions

The formula evaluator exposes these safe functions:

| Function | Signature | Description |
|----------|-----------|-------------|
| `IF` | `IF(condition, true_val, false_val)` | Conditional |
| `SUM` | `SUM(list_of_numbers)` | Sum a list |
| `AVG` | `AVG(list_of_numbers)` | Average a list |
| `MIN` | `MIN(list_of_numbers)` | Minimum |
| `MAX` | `MAX(list_of_numbers)` | Maximum |
| `COUNT` | `COUNT(list)` | Length of a list |
| `ROUND` | `ROUND(number, decimals)` | Round |
| `ABS` | `ABS(number)` | Absolute value |
| `COALESCE` | `COALESCE(val1, val2, ...)` | First non-None value |
| `LOWER` | `LOWER(string)` | Lowercase |
| `UPPER` | `UPPER(string)` | Uppercase |
| `CONCAT` | `CONCAT(str1, str2, ...)` | String concatenation |
| `CONTAINS` | `CONTAINS(string, substring)` | Substring check |
| `PLUCK` | `PLUCK(list_of_dicts, key)` | Extract a field from each dict in a list |
| `FILTER` | `FILTER(list_of_dicts, key, value)` | Filter list where dict[key] == value |
| `MAP_SCORE` | `MAP_SCORE(value, mapping)` | Map a select key to a numeric score |

### 2.5 Example Formulas

**Total Budget (sum two cost fields):**
```python
COALESCE(data.budgetCapEx, 0) + COALESCE(data.budgetOpEx, 0)
```

**Weighted Technical Fit Score:**
```python
scores = {"perfect": 4, "good": 3, "adequate": 2, "poor": 1}
(MAP_SCORE(data.stability, scores) * 0.4 +
 MAP_SCORE(data.maintainability, scores) * 0.3 +
 MAP_SCORE(data.security, scores) * 0.3)
```
> Note: multi-line expressions are supported — `simpleeval` receives the *last expression* result.

**TIME Classification from Functional/Technical Fit (LeanIX template):**
```python
IF(data.functionalFit == "excellent" and data.technicalFit == "excellent", "tolerate",
IF(data.functionalFit == "excellent" and data.technicalFit == "insufficient", "invest",
IF(data.functionalFit == "insufficient" and data.technicalFit == "excellent", "migrate",
IF(data.functionalFit == "insufficient" and data.technicalFit == "insufficient", "eliminate",
None))))
```

**Count of related Applications:**
```python
relation_count.applicationToITComponent
```

**Total users from relation attributes:**
```python
SUM(PLUCK(relations.relApplicationToOrganization, "rel_attributes.numberOfUsers"))
```

**Maturity Gap Score:**
```python
scores = {"adhoc": 1, "initial": 2, "defined": 3, "managed": 4, "optimized": 5}
MAP_SCORE(data.targetMaturity, scores) - MAP_SCORE(data.currentMaturity, scores)
```

### 2.6 Trigger Behavior

Calculations execute:
1. **On card save** — whenever a card of the target type is created or updated
2. **On relation change** — when a relation involving a card of the target type is created, updated, or deleted (for formulas that reference `relations.*` or `relation_count.*`)
3. **On bulk recalculate** — admin can trigger recalculation across all cards of a type
4. **Cascading** — if calculation A writes to field X, and calculation B reads field X, B runs after A (controlled by `execution_order`)

**Loop prevention:** The system tracks which fields are being computed in the current execution chain. If a cycle is detected (A→B→A), the system logs a warning and stops. On activation, the system checks for cycles and blocks activation if found.

### 2.7 Target Field Behavior

When a calculation targets a field:
- The field is automatically treated as **read-only** in the Card detail UI (shows a "calculated" chip badge, same as the existing `readonly` pattern for `capabilityLevel`)
- Manual edits to calculated fields are blocked on the frontend
- The API still accepts attribute updates but the calculated value will be overwritten on next trigger
- If the formula returns `None`, the field is set to empty/null

---

## 3. Data Model

### 3.1 New Table: `calculations`

```python
# backend/app/models/calculation.py

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin, TimestampMixin


class Calculation(Base, UUIDMixin, TimestampMixin):
    """Admin-defined formula that auto-populates a card attribute field."""

    __tablename__ = "calculations"

    name: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    target_type_key: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    target_field_key: Mapped[str] = mapped_column(String(200), nullable=False)
    formula: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    execution_order: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
```

### 3.2 Alembic Migration

Create `backend/alembic/versions/028_add_calculations.py`:

```python
"""Add calculations table for calculated fields.

Revision ID: 028
Revises: 027
Create Date: 2026-02-18
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = "028"
down_revision: Union[str, None] = "027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "calculations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("target_type_key", sa.String(100), nullable=False, index=True),
        sa.Column("target_field_key", sa.String(200), nullable=False),
        sa.Column("formula", sa.Text, nullable=False),
        sa.Column("is_active", sa.Boolean, default=False),
        sa.Column("execution_order", sa.Integer, default=0),
        sa.Column("last_error", sa.Text, nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  onupdate=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("calculations")
```

### 3.3 Register Model

In `backend/app/models/__init__.py`, add:
```python
from app.models.calculation import Calculation
```

---

## 4. Backend Implementation

### 4.1 Formula Evaluator Service

Create `backend/app/services/calculation_engine.py`:

```python
"""
Safe formula evaluation engine using simpleeval.

Provides a sandboxed expression evaluator with EA-specific helper functions
and a context builder that loads card data + relations for formula execution.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from simpleeval import EvalWithCompoundTypes, NameNotDefined, FunctionNotDefined
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calculation import Calculation
from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType

logger = logging.getLogger("turboea.calculations")


# ── Built-in functions ────────────────────────────────────────────────

def _IF(condition: Any, true_val: Any, false_val: Any) -> Any:
    return true_val if condition else false_val


def _SUM(values: list | None) -> float:
    if not values:
        return 0
    return sum(v for v in values if isinstance(v, (int, float)))


def _AVG(values: list | None) -> float | None:
    if not values:
        return None
    nums = [v for v in values if isinstance(v, (int, float))]
    return sum(nums) / len(nums) if nums else None


def _MIN(values: list | None) -> float | None:
    nums = [v for v in (values or []) if isinstance(v, (int, float))]
    return min(nums) if nums else None


def _MAX(values: list | None) -> float | None:
    nums = [v for v in (values or []) if isinstance(v, (int, float))]
    return max(nums) if nums else None


def _COUNT(values: list | None) -> int:
    return len(values) if values else 0


def _ROUND(value: float | None, decimals: int = 0) -> float | None:
    if value is None:
        return None
    return round(value, decimals)


def _ABS(value: float | None) -> float | None:
    if value is None:
        return None
    return abs(value)


def _COALESCE(*args: Any) -> Any:
    for a in args:
        if a is not None:
            return a
    return None


def _LOWER(s: str | None) -> str | None:
    return s.lower() if isinstance(s, str) else None


def _UPPER(s: str | None) -> str | None:
    return s.upper() if isinstance(s, str) else None


def _CONCAT(*args: Any) -> str:
    return "".join(str(a) for a in args if a is not None)


def _CONTAINS(s: str | None, sub: str) -> bool:
    if not isinstance(s, str):
        return False
    return sub in s


def _PLUCK(items: list[dict] | None, key: str) -> list:
    """Extract a nested key from each dict. Supports dot notation: 'rel_attributes.numberOfUsers'."""
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


def _FILTER(items: list[dict] | None, key: str, value: Any) -> list[dict]:
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


def _MAP_SCORE(value: str | None, mapping: dict) -> float | None:
    """Map a select key to a numeric score. Returns None if value not in mapping."""
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
    data = _DotDict({
        "name": card.name,
        "description": card.description,
        "status": card.status,
        "approval_status": card.approval_status,
        "subtype": card.subtype,
        "lifecycle": _DotDict(card.lifecycle or {}),
        **attrs,
    })

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

    # Group by relation type
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

        entry = _DotDict({
            "id": str(other_card.id),
            "name": other_card.name,
            "type": other_card.type,
            "attributes": _DotDict(other_card.attributes or {}),
            "rel_attributes": _DotDict(rel.attributes or {}),
        })
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
        _DotDict({
            "id": str(c.id),
            "name": c.name,
            "type": c.type,
            "subtype": c.subtype,
            "attributes": _DotDict(c.attributes or {}),
        })
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
    """Evaluate a formula string in a sandboxed environment.

    Returns the computed value, or raises on error.
    """
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

        results.append({
            "calculation_id": str(calc.id),
            "name": calc.name,
            "target_field": calc.target_field_key,
            "success": success,
            "error": error,
        })

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
        "errors": errors[:50],  # cap error list
    }


async def validate_formula(formula: str, target_type_key: str, db: AsyncSession) -> dict:
    """Validate a formula without executing it on real data. Returns {valid, error, preview_context}."""
    try:
        # Build a dummy context with None values to check syntax
        type_result = await db.execute(
            select(CardType).where(CardType.key == target_type_key)
        )
        card_type = type_result.scalar_one_or_none()
        if not card_type:
            return {"valid": False, "error": f"Card type '{target_type_key}' not found"}

        # Build dummy data from fields_schema
        dummy_data = _DotDict({"name": "Test", "description": "", "status": "ACTIVE",
                               "approval_status": "DRAFT", "subtype": None,
                               "lifecycle": _DotDict({})})
        for section in (card_type.fields_schema or []):
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

    # Build dependency graph: target_field → set of source fields referenced in formula
    # Simple heuristic: scan formula for `data.<fieldKey>` patterns
    import re
    graph: dict[str, set[str]] = {}
    for calc in calcs:
        target = calc.target_field_key
        # Find all data.xxx references
        refs = set(re.findall(r'data\.(\w+)', calc.formula))
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
```

### 4.2 Add `simpleeval` Dependency

In `backend/pyproject.toml`, add to `dependencies`:
```toml
dependencies = [
    # ... existing deps ...
    "simpleeval>=1.0.0",
]
```

### 4.3 API Routes

Create `backend/app/api/v1/calculations.py`:

```
Router prefix: /calculations
Tags: ["calculations"]
All endpoints require authentication.
Create/Update/Delete/Activate/Recalculate require admin.metamodel permission.
```

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/calculations` | List all calculations. Optional `?type_key=` filter |
| `GET` | `/calculations/{id}` | Get single calculation |
| `POST` | `/calculations` | Create new calculation |
| `PATCH` | `/calculations/{id}` | Update calculation (name, description, formula, execution_order) |
| `DELETE` | `/calculations/{id}` | Delete calculation |
| `POST` | `/calculations/{id}/activate` | Activate (with cycle detection) |
| `POST` | `/calculations/{id}/deactivate` | Deactivate |
| `POST` | `/calculations/{id}/test` | Test formula with a specific card ID (dry run, no save) |
| `POST` | `/calculations/validate` | Validate formula syntax (body: `{formula, target_type_key}`) |
| `POST` | `/calculations/recalculate/{type_key}` | Bulk recalculate all cards of a type |

**Request/response schemas:**

```python
# POST /calculations body:
{
    "name": "Total Budget",
    "description": "Sum of CapEx and OpEx budgets",
    "target_type_key": "Initiative",
    "target_field_key": "totalBudget",
    "formula": "COALESCE(data.budgetCapEx, 0) + COALESCE(data.budgetOpEx, 0)",
    "execution_order": 0
}

# Response:
{
    "id": "uuid",
    "name": "Total Budget",
    "description": "...",
    "target_type_key": "Initiative",
    "target_field_key": "totalBudget",
    "formula": "...",
    "is_active": false,
    "execution_order": 0,
    "last_error": null,
    "last_run_at": null,
    "created_by": "uuid",
    "created_at": "...",
    "updated_at": "..."
}
```

### 4.4 Integration Points

#### 4.4.1 Hook into Card Save

In `backend/app/api/v1/cards.py`, after the existing `_calc_data_quality()` call in both `create_card` and `update_card`, add calculation execution:

```python
# After: card.data_quality = await _calc_data_quality(db, card)
# Add:
from app.services.calculation_engine import run_calculations_for_card
await run_calculations_for_card(db, card)
```

This ensures calculations run every time a card is saved.

#### 4.4.2 Hook into Relation Changes

In `backend/app/api/v1/relations.py`, after relation create/update/delete, trigger recalculation for both source and target cards:

```python
from app.services.calculation_engine import run_calculations_for_card

# After relation create/update/delete:
# Re-fetch source and target cards and run calculations
source_card = await db.get(Card, relation.source_id)
target_card = await db.get(Card, relation.target_id)
if source_card:
    await run_calculations_for_card(db, source_card)
if target_card:
    await run_calculations_for_card(db, target_card)
```

#### 4.4.3 Register Router

In `backend/app/api/v1/router.py`, add:
```python
from app.api.v1.calculations import router as calculations_router
api_router.include_router(calculations_router)
```

### 4.5 Identifying Calculated Fields for the Frontend

Add a new API endpoint or extend the existing metamodel endpoint to return which fields are currently targeted by active calculations:

```python
# GET /calculations/calculated-fields
# Returns: { "Initiative": ["totalBudget"], "Application": ["timeClassification"] }
```

This allows the frontend to know which fields should be rendered as read-only with a "calculated" badge, without modifying the `fields_schema` itself.

---

## 5. Frontend Implementation

### 5.1 TypeScript Types

Add to `frontend/src/types/index.ts`:

```typescript
export interface Calculation {
  id: string;
  name: string;
  description?: string;
  target_type_key: string;
  target_field_key: string;
  formula: string;
  is_active: boolean;
  execution_order: number;
  last_error?: string;
  last_run_at?: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CalculatedFieldsMap {
  [typeKey: string]: string[]; // field keys that are calculated
}
```

### 5.2 Admin UI: Calculations Tab

Add a new **Calculations** tab in the admin area (`frontend/src/features/admin/CalculationsAdmin.tsx`).

**Layout:**
1. **Top bar** — "New Calculation" button
2. **List view** — table/cards showing all calculations with: name, target type, target field, status (active/inactive chip), last run, last error
3. **Edit dialog** — form with:
   - Name (text)
   - Description (text, optional)
   - Target Card Type (select from metamodel types)
   - Target Field (select from chosen type's fields_schema, filtered to eligible types: `number`, `cost`, `text`, `single_select`, `boolean`)
   - Formula (code editor textarea with monospace font, syntax highlighting optional)
   - Execution Order (number)
   - **Validate** button — calls `/calculations/validate`, shows success/error
   - **Test** button — calls `/calculations/{id}/test` with a card ID picker, shows result
4. **Actions per calculation:**
   - Activate / Deactivate toggle
   - Edit
   - Delete (with confirmation)
   - Recalculate All (triggers bulk recalculation for the target type)

**Formula editor hints** — show a collapsible "Formula Reference" panel below the textarea with:
- Available fields for the selected type (from `fields_schema`)
- Available relation types (from metamodel relation types)
- Built-in function reference table
- Example formulas

### 5.3 Card Detail: Calculated Field Badge

In `frontend/src/features/cards/CardDetail.tsx`:

1. Fetch the calculated fields map from `/calculations/calculated-fields` (cache in a hook or context)
2. In the `AttributeSection` component, check if a field key is in the calculated fields map for the current card type
3. If so:
   - In **read mode**: show a small `Chip` badge saying "calculated" (similar to existing "auto" chip for `readonly` fields)
   - In **edit mode**: render the field as read-only with the "calculated" badge (reuse the existing `readonly` rendering path)

**Minimal change approach** — the existing code already handles `field.readonly` with an "auto" chip. For calculated fields, you can either:
- Check the calculated fields map at render time and treat those fields as effectively `readonly`
- Or inject a `calculated: true` flag into the field definition client-side before rendering

Option A (check at render time) is recommended since it doesn't mutate the metamodel data.

### 5.4 Admin Navigation

Add "Calculations" to the admin tabs in `frontend/src/features/admin/` (in whichever component renders the admin tab bar — likely `AppLayout.tsx` or a sub-router in the admin section). Use the `calculate` Material Symbol icon.

---

## 6. Implementation Plan (Phased)

### Phase 1: Core Engine + Model (Backend Only)
1. Add `simpleeval` to `pyproject.toml`
2. Create `backend/app/models/calculation.py`
3. Create migration `028_add_calculations.py`
4. Register model in `__init__.py`
5. Create `backend/app/services/calculation_engine.py` with all functions
6. Create `backend/app/api/v1/calculations.py` with all CRUD + validate + test endpoints
7. Register router in `router.py`
8. Write basic tests

### Phase 2: Integration Hooks (Backend)
1. Hook `run_calculations_for_card()` into `cards.py` create/update handlers
2. Hook into `relations.py` create/update/delete handlers
3. Add the `/calculations/calculated-fields` endpoint
4. Test end-to-end: create a calculation, save a card, verify the computed value

### Phase 3: Admin UI (Frontend)
1. Add TypeScript types
2. Create `CalculationsAdmin.tsx` with list + edit dialog
3. Add formula reference panel
4. Add validate/test functionality
5. Add to admin navigation

### Phase 4: Card Detail Integration (Frontend)
1. Create `useCalculatedFields` hook to fetch + cache the calculated fields map
2. Modify `AttributeSection` in `CardDetail.tsx` to show "calculated" badge
3. Block editing of calculated fields in edit mode

### Phase 5: Demo Calculations (Seed Data)
1. Add 2-3 example calculations to `seed.py` or `seed_demo.py`:
   - **Total Budget** for Initiatives: `COALESCE(data.budgetCapEx, 0) + COALESCE(data.budgetOpEx, 0)`
   - **Application Count** for IT Components: `relation_count.applicationToITComponent`
   - **TIME Classification** for Applications (if functionalFit/technicalFit fields exist)

---

## 7. Key Architecture Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Separate `calculations` table, not embedded in `fields_schema` | Calculations can reference relations/children and have their own lifecycle (activate/deactivate, error tracking). Keeps `fields_schema` clean and simple. |
| `simpleeval` instead of sandboxed JS | Python-native, zero extra runtime dependencies, AST-based safety, well-maintained library. No need for Node.js or `py_mini_racer`. |
| Synchronous execution on card save | Keeps data immediately consistent. For the scale of a self-hosted EA tool (hundreds to low thousands of cards), this is fine. No need for async job queues. |
| Cycle detection on activation | Prevents infinite loops. Simple DFS on the dependency graph of `data.field` references. |
| Computed fields map via separate endpoint | Avoids mutating the metamodel schema, keeps frontend changes minimal, and allows the computed status to be dynamic (activate/deactivate a calculation without touching `fields_schema`). |

---

## 8. Security Considerations

- `simpleeval` uses Python's AST parser — no `eval()`, `exec()`, `import`, `__builtins__`, or file access
- Maximum expression length: enforce a 5000-char limit on the `formula` field
- Maximum evaluation time: wrap `_evaluate_formula` in an `asyncio.wait_for` with a 5-second timeout
- Only admin users with `admin.metamodel` permission can create/modify calculations
- Formula errors are logged and stored in `last_error` but never exposed to non-admin users

---

## 9. Files to Create/Modify Summary

### New Files
| File | Description |
|------|-------------|
| `backend/app/models/calculation.py` | SQLAlchemy model |
| `backend/alembic/versions/028_add_calculations.py` | Migration |
| `backend/app/services/calculation_engine.py` | Formula evaluator + context builder |
| `backend/app/api/v1/calculations.py` | API routes |
| `frontend/src/features/admin/CalculationsAdmin.tsx` | Admin UI |

### Modified Files
| File | Change |
|------|--------|
| `backend/pyproject.toml` | Add `simpleeval` dependency |
| `backend/app/models/__init__.py` | Import `Calculation` |
| `backend/app/api/v1/router.py` | Register calculations router |
| `backend/app/api/v1/cards.py` | Hook `run_calculations_for_card()` into create + update |
| `backend/app/api/v1/relations.py` | Hook calculations into relation create/update/delete |
| `frontend/src/types/index.ts` | Add `Calculation` and `CalculatedFieldsMap` types |
| `frontend/src/features/cards/CardDetail.tsx` | Show "calculated" badge on computed fields |
| `frontend/src/layouts/AppLayout.tsx` | Add Calculations admin tab (if admin tabs are here) |
| `frontend/src/features/admin/MetamodelAdmin.tsx` | Optional: link to calculations from field editor |

---

## 10. Testing Checklist

- [ ] Create a calculation with a simple formula → verify it saves
- [ ] Validate formula endpoint returns `{valid: true}` for valid formulas
- [ ] Validate formula endpoint returns `{valid: false, error: "..."}` for invalid formulas
- [ ] Activate a calculation → edit a card of the target type → verify the target field is computed
- [ ] Create a formula referencing `relations.*` → add a relation → verify recalculation
- [ ] Create two calculations A→B where B reads A's output → verify execution order works
- [ ] Try to create a cycle (A→B→A) → verify activation is blocked
- [ ] Deactivate a calculation → verify the field is no longer computed on save
- [ ] Bulk recalculate → verify all cards of the type are updated
- [ ] Formula with division by zero → verify graceful error handling
- [ ] Formula with undefined field → verify `None` handling
- [ ] Verify calculated fields show "calculated" badge in card detail UI
- [ ] Verify calculated fields are not editable in card detail edit mode
- [ ] Test with 100+ cards to verify performance is acceptable
