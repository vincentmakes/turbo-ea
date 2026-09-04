"""End-of-Life classification, shared by every surface that shows it.

A card stores only the *link* to endoflife.date — ``attributes.eol_product``
plus ``attributes.eol_cycle`` — or a hand-entered ``lifecycle.endOfLife``
date. The dates behind that link (release, active-support end, EOL) live
upstream and are fetched live, so "is this component end-of-life?" is a
question only this module answers.

It started life inside the EOL report. The inventory grid now asks the same
question of the same cards, and two implementations of "approaching" would be
two different answers to a user comparing a grid column with a report row —
so the classifiers and the batch fetch live here, and the report imports them.

The per-product cycle cache exists because of that second caller: the report
is opened occasionally, but the inventory refetches on every type change, and
without a cache each of those would fan out to endoflife.date once per
distinct product on screen.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.services.card_flags import (
    EOL_CYCLE_KEY,
    EOL_PRODUCT_KEY,
    has_eol_link,
    has_manual_eol,
)

log = logging.getLogger("turboea.eol")

EOL_BASE = "https://endoflife.date/api"

#: A cycle is "approaching" this far ahead of its EOL date. Six months is the
#: window the report has always used; the inventory column inherits it so the
#: same card cannot read amber in one place and green in the other.
APPROACHING_DAYS = 182

#: Cached upstream cycle lists, ``product -> (fetched_at, cycles)``. Same
#: 30-minute window as the product-list cache in ``api/v1/eol.py``.
_CYCLES_TTL = 1800
_cycles_cache: dict[str, tuple[float, list[dict]]] = {}


def _parse(value: Any) -> "datetime.date | None":
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def eol_status(eol_val: Any, support_val: Any) -> str:
    """Classify a cycle as 'eol', 'approaching', 'supported', or 'unknown'."""
    now = datetime.now(timezone.utc).date()

    # Check EOL first
    if eol_val is True:
        return "eol"
    eol_date = _parse(eol_val)
    if eol_date is not None:
        if eol_date <= now:
            return "eol"
        if eol_date <= now + timedelta(days=APPROACHING_DAYS):
            return "approaching"

    # If active support has ended
    sup_date = _parse(support_val)
    if sup_date is not None and sup_date <= now:
        return "approaching"

    if eol_val is False:
        return "supported"

    return "supported" if eol_val is not None else "unknown"


def manual_eol_status(lifecycle: dict | None) -> str:
    """Classify a card with manually maintained lifecycle dates."""
    if not lifecycle:
        return "unknown"

    now = datetime.now(timezone.utc).date()
    eol_date = _parse(lifecycle.get("endOfLife"))
    if eol_date is not None:
        if eol_date <= now:
            return "eol"
        if eol_date <= now + timedelta(days=APPROACHING_DAYS):
            return "approaching"

    # phaseOut is the manual analogue of active support ending
    phase_out = _parse(lifecycle.get("phaseOut"))
    if phase_out is not None and phase_out <= now:
        return "approaching"

    return "supported"


async def fetch_product_cycles(
    client: httpx.AsyncClient,
    product: str,
) -> list[dict] | None:
    """Fetch cycles for a single product, returning None on failure.

    Served from a 30-minute in-process cache. A failed fetch falls back to a
    stale cached copy rather than blanking the column: an upstream blip should
    not turn every row's status into "unknown".
    """
    now = time.time()
    cached = _cycles_cache.get(product)
    if cached is not None and (now - cached[0]) < _CYCLES_TTL:
        return cached[1]

    try:
        resp = await client.get(f"{EOL_BASE}/{product}.json", timeout=10.0)
        if resp.status_code == 200:
            cycles = resp.json()
            _cycles_cache[product] = (now, cycles)
            return cycles
    except httpx.HTTPError:
        log.warning("Failed to fetch EOL data for %s", product)
    return cached[1] if cached is not None else None


async def fetch_cycles_for_products(products: set[str]) -> dict[str, list[dict]]:
    """Fetch every product's cycles in parallel, skipping failures."""
    if not products:
        return {}
    out: dict[str, list[dict]] = {}
    async with httpx.AsyncClient(timeout=15.0) as client:
        ordered = list(products)
        results = await asyncio.gather(*(fetch_product_cycles(client, p) for p in ordered))
        for product, cycles in zip(ordered, results):
            if cycles is not None:
                out[product] = cycles
    return out


def find_cycle(cycles: list[dict], cycle_key: str) -> dict | None:
    """The upstream entry matching a card's stored cycle, if it still exists."""
    for c in cycles:
        if str(c.get("cycle")) == str(cycle_key):
            return c
    return None


async def resolve_eol_statuses(cards: list) -> dict[str, dict]:
    """Resolve the EOL status of every covered card in one pass.

    Takes anything with ``id`` / ``attributes`` / ``lifecycle`` and returns
    ``{card_id: entry}`` for cards that carry EOL data at all. Cards with
    neither a link nor a manual date are **absent** rather than present with a
    null status — "no entry" is the one shape a caller cannot misread as a
    status, and it keeps the payload proportional to what is actually linked.

    The caller must not hold a database session across this call: it is
    outbound HTTP, and the connection pool is 30 for the whole process.
    """
    linked = [c for c in cards if has_eol_link(getattr(c, "attributes", None))]
    manual = [
        c
        for c in cards
        if not has_eol_link(getattr(c, "attributes", None))
        and has_manual_eol(getattr(c, "lifecycle", None))
    ]

    product_cycles = await fetch_cycles_for_products(
        {(c.attributes or {})[EOL_PRODUCT_KEY] for c in linked}
    )

    out: dict[str, dict] = {}
    for card in linked:
        attrs = card.attributes or {}
        product = attrs[EOL_PRODUCT_KEY]
        cycle_key = str(attrs[EOL_CYCLE_KEY])
        cycle = find_cycle(product_cycles.get(product, []), cycle_key)
        out[str(card.id)] = {
            "status": eol_status(cycle.get("eol"), cycle.get("support")) if cycle else "unknown",
            "source": "api",
            "eol_product": product,
            "eol_cycle": cycle_key,
            # `eol` is a date string, `true`/`false`, or absent upstream. Only
            # a real date is worth showing in a date column; the rest is
            # already carried by `status`.
            "eol_date": cycle.get("eol") if cycle and isinstance(cycle.get("eol"), str) else None,
            "support_date": (
                cycle.get("support") if cycle and isinstance(cycle.get("support"), str) else None
            ),
            "latest": cycle.get("latest") if cycle else None,
        }

    for card in manual:
        lifecycle = card.lifecycle or {}
        out[str(card.id)] = {
            "status": manual_eol_status(lifecycle),
            "source": "manual",
            "eol_product": None,
            "eol_cycle": None,
            "eol_date": lifecycle.get("endOfLife"),
            "support_date": lifecycle.get("phaseOut"),
            "latest": None,
        }

    return out
