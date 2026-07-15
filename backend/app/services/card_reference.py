"""Human-readable card reference generator (discussion #811).

Produces stable, globally-unique, human-readable card IDs such as ``APP-10000``.
The **number is always system-generated** (never user-typed); a human may only
influence the **prefix**. The mechanism mirrors
:func:`app.services.risk_service.next_reference` (``R-NNNNNN``): a write-once
value scanned as ``max + 1`` and backed by a UNIQUE index on ``cards.reference``
so concurrent creates can retry on conflict.

``reference_config`` shape (stored on ``card_types``)::

    {"mode": "off" | "auto", "prefix": str, "start": int, "padding": int}

- ``off``  — feature disabled; ``cards.reference`` stays NULL.
- ``auto`` — the system generates ``{prefix}{number}`` (zero-padded to
             ``padding``) on creation. The admin sets the ``prefix``.

**Sequence scoping is per-prefix and GLOBAL across all card types.** Two types
that happen to share a prefix therefore share one contiguous, collision-free
series (scan filters by ``reference`` matching the prefix, never by ``type``).
"""

from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType

# Config defaults --------------------------------------------------------------
DEFAULT_START = 10000
DEFAULT_PADDING = 0
MAX_PREFIX_LEN = 32
MAX_PADDING = 12

_PREFIX_RE = re.compile(r"^[A-Za-z0-9_-]*$")


class ReferenceConfigError(ValueError):
    """Raised when a ``reference_config`` payload (or a chosen prefix) is invalid."""


def _cfg(card_type: CardType) -> dict:
    return card_type.reference_config or {}


def get_mode(card_type: CardType) -> str:
    mode = _cfg(card_type).get("mode", "off")
    return mode if mode in ("off", "auto") else "off"


def _prefix(cfg: dict) -> str:
    return str(cfg.get("prefix", "") or "")


def _start(cfg: dict) -> int:
    try:
        return int(cfg.get("start", DEFAULT_START))
    except (TypeError, ValueError):
        return DEFAULT_START


def _padding(cfg: dict) -> int:
    try:
        return int(cfg.get("padding", DEFAULT_PADDING))
    except (TypeError, ValueError):
        return DEFAULT_PADDING


def format_reference(prefix: str, padding: int, n: int) -> str:
    """Render a numeric sequence value as ``{prefix}{n}`` with optional zero-pad."""
    return f"{prefix}{n:0{padding}d}" if padding > 0 else f"{prefix}{n}"


def validate_prefix(prefix: str) -> str:
    """Validate + normalise a prefix (admin-configured or user-chosen). Raises."""
    prefix = str(prefix or "")
    if len(prefix) > MAX_PREFIX_LEN:
        raise ReferenceConfigError(f"prefix must be at most {MAX_PREFIX_LEN} characters")
    if not _PREFIX_RE.match(prefix):
        raise ReferenceConfigError("prefix may only contain letters, digits, '-' and '_'")
    return prefix


def validate_reference_config(cfg: dict | None) -> dict:
    """Validate + normalise a ``reference_config`` payload.

    Returns a clean dict with all keys present. Raises
    :class:`ReferenceConfigError` on any problem so the caller can surface a 400.
    """
    if cfg is None:
        return {"mode": "off", "prefix": "", "start": DEFAULT_START, "padding": DEFAULT_PADDING}
    if not isinstance(cfg, dict):
        raise ReferenceConfigError("reference_config must be an object")

    mode = cfg.get("mode", "off")
    if mode not in ("off", "auto"):
        raise ReferenceConfigError("mode must be one of: off, auto")

    prefix = validate_prefix(cfg.get("prefix", ""))

    try:
        start = int(cfg.get("start", DEFAULT_START))
    except (TypeError, ValueError):
        raise ReferenceConfigError("start must be an integer") from None
    if start < 0:
        raise ReferenceConfigError("start must be zero or greater")

    try:
        padding = int(cfg.get("padding", DEFAULT_PADDING))
    except (TypeError, ValueError):
        raise ReferenceConfigError("padding must be an integer") from None
    if padding < 0 or padding > MAX_PADDING:
        raise ReferenceConfigError(f"padding must be between 0 and {MAX_PADDING}")

    return {"mode": mode, "prefix": prefix, "start": start, "padding": padding}


async def scan_highest_for_prefix(db: AsyncSession, prefix: str, start: int) -> int:
    """Return the highest numeric suffix currently in use **globally** for ``prefix``.

    Scans every ``cards.reference`` matching ``^{prefix}(\\d+)$`` regardless of
    card type — so a prefix forms one contiguous series across the whole
    workspace and can never collide. Seeds at ``start - 1`` so the first
    allocation equals ``start``. References that don't fit the pattern are
    ignored.
    """
    pattern = re.compile(rf"^{re.escape(prefix)}(\d+)$")
    result = await db.execute(select(Card.reference).where(Card.reference.isnot(None)))
    highest = start - 1
    for (ref,) in result.all():
        match = pattern.match(ref or "")
        if match:
            highest = max(highest, int(match.group(1)))
    return highest


async def next_reference_for_prefix(db: AsyncSession, prefix: str, start: int, padding: int) -> str:
    """Return the next ``{prefix}{n}`` reference for an explicit prefix (global series)."""
    highest = await scan_highest_for_prefix(db, prefix, start)
    return format_reference(prefix, padding, highest + 1)


async def next_reference(db: AsyncSession, card_type: CardType) -> str | None:
    """Return the next reference for an ``auto``-mode type. ``None`` when ``off``."""
    if get_mode(card_type) != "auto":
        return None
    cfg = _cfg(card_type)
    return await next_reference_for_prefix(db, _prefix(cfg), _start(cfg), _padding(cfg))


async def backfill_references_for_type(db: AsyncSession, card_type: CardType) -> int:
    """Assign references to existing ID-less cards of an ``auto``-mode type.

    Uses the type's configured ``prefix`` + the global-per-prefix series,
    numbering cards in ``created_at`` order (same intent as
    :func:`app.services.hierarchy.backfill_hierarchy_levels_for_type`). No-op for
    ``off``. Returns the number of cards updated.

    **Fill-only** — it only touches cards where ``reference IS NULL``, so it never
    rewrites an existing ID (idempotent). This is the single generation primitive:
    a future "regenerate all" would just null the column for the type first and
    then call this again (see ``generate_references`` in ``api/v1/metamodel.py``).
    """
    if get_mode(card_type) == "off":
        return 0
    cfg = _cfg(card_type)
    prefix = _prefix(cfg)
    padding = _padding(cfg)
    n = await scan_highest_for_prefix(db, prefix, _start(cfg))
    result = await db.execute(
        select(Card)
        .where(Card.type == card_type.key, Card.reference.is_(None))
        .order_by(Card.created_at.asc(), Card.id.asc())
    )
    cards = result.scalars().all()
    updated = 0
    for card in cards:
        n += 1
        card.reference = format_reference(prefix, padding, n)
        updated += 1
    return updated
