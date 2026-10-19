"""The card-type category registry (the EA layers a card type sits in).

``card_types.category`` is a plain string that names a row of
``card_type_categories`` by its ``key``. Two rules keep the registry and the
data in agreement:

* **The route validates.** ``POST`` / ``PATCH /metamodel/types`` refuse a
  category that is not a registry key (``unknown_category``), so an admin can
  no longer invent a layer by typo.
* **The importers adopt.** Workspace transfer, content packs and the
  platform-migration importer write card types without the route; they call
  :func:`ensure_categories` so any category they carry becomes a registry row
  instead of a value the type editor would then refuse to save.

Everything here flushes and never commits — the caller owns the transaction.
The pure helpers (:func:`normalize_key`, :func:`normalize_category_value`,
:func:`plan_adoption`, :func:`validate_order`, :func:`is_duplicate`) carry the
decisions so they can be tested without a database.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import TypeVar

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card_type import CardType
from app.models.card_type_category import CardTypeCategory

_R = TypeVar("_R")

# ``card_type_categories.key`` / ``label`` and ``card_types.category`` are all
# ``String(100)``.
MAX_KEY_LENGTH = 100
# The frontend's sentinel for "no category" (``UNCATEGORIZED_GROUP_KEY`` in
# ``lib/cardTypeOrder.ts``). A registry row under that key would share the
# uncategorised lane and group with every type that has no category at all.
RESERVED_KEYS = frozenset({"__uncategorized__"})
# The colour a category gets when none is chosen (an adopted one, or a create
# that sent none) — the neutral grey the dependency view always used for an
# unknown layer.
DEFAULT_COLOR = "#999999"
# Adopted categories are numbered from here so they sort after the defaults
# (0–3) and after anything an admin placed by hand in the low range.
ADOPTED_SORT_ORDER_START = 100


class CategoryError(ValueError):
    """A category value or request the registry refuses. ``code`` is the
    machine-readable reason the API returns."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def normalize_key(label: object) -> str:
    """The registry key for a category typed as ``label``: the label trimmed.

    Raises :class:`CategoryError` (``invalid_category``) for a non-string, a
    blank label or one longer than the column."""
    if not isinstance(label, str):
        raise CategoryError("invalid_category", "Category label must be a string")
    key = label.strip()
    if not key:
        raise CategoryError("invalid_category", "Category label is required")
    if len(key) > MAX_KEY_LENGTH:
        raise CategoryError(
            "invalid_category", f"Category label must be at most {MAX_KEY_LENGTH} characters"
        )
    if key.lower() in RESERVED_KEYS:
        raise CategoryError("invalid_category", f"'{key}' is a reserved name")
    return key


def normalize_category_value(value: object) -> str | None:
    """A card type's ``category`` as the route stores it: ``None`` for
    ``None`` or a blank string (uncategorised), the trimmed string otherwise.

    Raises :class:`CategoryError` (``invalid_category``) for a non-string."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise CategoryError("invalid_category", "category must be a string")
    stripped = value.strip()
    return stripped or None


def is_duplicate(rows: Iterable[_R], name: str, exclude_key: str | None = None) -> _R | None:
    """The registry row ``name`` collides with — ``None`` when it is new.

    ``rows`` are registry rows (anything with ``key`` and ``label``);
    ``exclude_key`` leaves out the row being renamed. A name collides with
    another row's **key or label**, compared case-insensitively: the key is
    what card types store and the label is what every person reads, so after
    renaming ``Foo`` to ``Bar`` a new ``Bar`` (or renaming ``Baz`` to ``bar``)
    would put two layers on screen that read as one."""
    folded = name.casefold()
    for row in rows:
        key = getattr(row, "key", None)
        if exclude_key is not None and key == exclude_key:
            continue
        for candidate in (key, getattr(row, "label", None)):
            if isinstance(candidate, str) and candidate.casefold() == folded:
                return row
    return None


def plan_adoption(values: Iterable[object], known_keys: Iterable[str]) -> list[str]:
    """The distinct category keys in ``values`` that the registry lacks, in
    first-seen order. ``None``, non-strings and blank strings are skipped (they
    mean uncategorised); the comparison is exact after trimming, because the
    value has to resolve against the registry exactly as it is stored."""
    known = set(known_keys)
    out: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        key = value.strip()
        if not key or len(key) > MAX_KEY_LENGTH or key in known:
            continue
        known.add(key)
        out.append(key)
    return out


def validate_order(current_keys: Iterable[str], requested: Iterable[object]) -> list[str]:
    """``requested`` as a list when it is a permutation of ``current_keys``.

    Every key must appear exactly once, so a reorder can never silently drop or
    double a layer. Raises :class:`CategoryError` (``invalid_order``)."""
    current = list(current_keys)
    order = list(requested)
    if not all(isinstance(k, str) for k in order):
        raise CategoryError("invalid_order", "Order must be a list of category keys")
    if len(order) != len(set(order)):
        raise CategoryError("invalid_order", "Order lists a category more than once")
    if set(order) != set(current):
        raise CategoryError("invalid_order", "Order must list every category exactly once")
    return order  # type: ignore[return-value]


def serialize(c: CardTypeCategory) -> dict:
    return {
        "id": str(c.id),
        "key": c.key,
        "label": c.label,
        "color": c.color,
        "sort_order": c.sort_order,
        "built_in": c.built_in,
        "translations": c.translations or {},
    }


async def list_categories(db: AsyncSession) -> list[CardTypeCategory]:
    """Every category, in layer order (``sort_order``, then label)."""
    result = await db.execute(
        select(CardTypeCategory).order_by(CardTypeCategory.sort_order, CardTypeCategory.label)
    )
    return list(result.scalars().all())


async def get_category(db: AsyncSession, key: str) -> CardTypeCategory | None:
    result = await db.execute(select(CardTypeCategory).where(CardTypeCategory.key == key))
    return result.scalar_one_or_none()


async def category_exists(db: AsyncSession, key: str) -> bool:
    return await get_category(db, key) is not None


async def next_sort_order(db: AsyncSession, floor: int = 0) -> int:
    """One past the highest ``sort_order`` in use, and at least ``floor``."""
    current = (await db.execute(select(func.max(CardTypeCategory.sort_order)))).scalar()
    return max((current if current is not None else -1) + 1, floor)


async def types_using(db: AsyncSession, key: str) -> list[str]:
    """The labels of the card types (hidden ones included) whose category is
    ``key``, alphabetically."""
    result = await db.execute(
        select(CardType.label).where(func.trim(CardType.category) == key).order_by(CardType.label)
    )
    return [label for label in result.scalars().all()]


async def ensure_categories(db: AsyncSession, values: Iterable[object]) -> list[str]:
    """Adopt every category in ``values`` the registry lacks as a custom row
    (label = key, the default colour, ordered after everything there is).
    Idempotent; returns the keys it created. Flushes, never commits."""
    existing = (await db.execute(select(CardTypeCategory.key))).scalars().all()
    missing = plan_adoption(values, existing)
    if not missing:
        return []
    order = await next_sort_order(db, ADOPTED_SORT_ORDER_START)
    for offset, key in enumerate(missing):
        db.add(
            CardTypeCategory(
                id=uuid.uuid4(),
                key=key,
                label=key,
                color=DEFAULT_COLOR,
                sort_order=order + offset,
                built_in=False,
                translations={},
            )
        )
    await db.flush()
    return missing


async def seed_default_categories(db: AsyncSession) -> list[str]:
    """Insert the built-in layers the registry lacks (insert-only: a default
    already there is never touched). Returns the keys it inserted. Flushes,
    never commits."""
    from app.services.seed import CARD_TYPE_CATEGORIES

    existing = set((await db.execute(select(CardTypeCategory.key))).scalars().all())
    inserted: list[str] = []
    for cat in CARD_TYPE_CATEGORIES:
        if cat["key"] in existing:
            continue
        db.add(
            CardTypeCategory(
                id=uuid.uuid4(),
                key=cat["key"],
                label=cat["label"],
                color=cat["color"],
                sort_order=cat["sort_order"],
                built_in=True,
                translations=dict(cat["translations"]),
            )
        )
        inserted.append(cat["key"])
    if inserted:
        await db.flush()
    return inserted
