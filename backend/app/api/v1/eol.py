"""Proxy endpoints for the endoflife.date API.

These endpoints allow the frontend to search for products and fetch
end-of-life / release-cycle data without running into CORS restrictions.
"""

from __future__ import annotations

import logging
import re
import uuid
from difflib import SequenceMatcher

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.user import User
from app.schemas.eol_custom import (
    EolCustomCycleCreate,
    EolCustomCycleOut,
    EolCustomCycleUpdate,
    EolCustomProductCreate,
    EolCustomProductOut,
    EolCustomProductUpdate,
    EolCustomSwitchRequest,
    EolCustomSwitchResult,
    EolUpstreamMatch,
)
from app.services import eol_custom_service as custom
from app.services.card_flags import eol_type_keys
from app.services.card_read_scope import CardReadScope
from app.services.eol_service import fetch_product_cycles, resolve_eol_statuses
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

logger = logging.getLogger("turboea.eol")

router = APIRouter(prefix="/eol", tags=["End of Life"])

EOL_BASE = "https://endoflife.date/api"

#: The "now on endoflife.date?" hint needs more than ``_fuzzy_score``'s 0.85,
#: which any upstream slug contained in a title scores — "go" inside "Pingo
#: Analytics". From 0.9 only an exact match, or the title inside the slug, counts.
UPSTREAM_MATCH_THRESHOLD = 0.9

# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class EolProduct(BaseModel):
    """A product identifier returned from the product list.

    ``custom`` products are the organisation's own (``name`` is then
    ``custom:<key>`` and ``title`` its display name).
    """

    name: str
    title: str | None = None
    custom: bool = False


class EolCycle(BaseModel):
    """A single release cycle for a product."""

    model_config = {"populate_by_name": True}

    cycle: str
    release_date: str | None = Field(None, alias="releaseDate")
    eol: str | bool | None = None
    latest: str | None = None
    latest_release_date: str | None = Field(None, alias="latestReleaseDate")
    lts: str | bool | None = None
    support: str | bool | None = None
    discontinued: str | bool | None = None
    codename: str | None = None
    link: str | None = None
    #: A custom product's title (endoflife.date cycles carry none).
    title: str | None = None


class EolProductMatch(BaseModel):
    """A product with a fuzzy match score."""

    name: str
    score: float
    title: str | None = None
    custom: bool = False


class MassEolCandidate(BaseModel):
    """A candidate EOL match for a card."""

    card_id: str
    card_name: str
    card_type: str
    eol_product: str
    score: float
    title: str | None = None
    custom: bool = False


class MassEolResult(BaseModel):
    """Result of mass EOL search for a single card."""

    card_id: str
    card_name: str
    card_type: str
    current_eol_product: str | None = None
    #: The current link's title when it is a custom product.
    current_title: str | None = None
    current_eol_cycle: str | None = None
    candidates: list[MassEolCandidate]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_client: httpx.AsyncClient | None = None


async def _get_client() -> httpx.AsyncClient:
    global _client  # noqa: N816
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=15.0)
    return _client


# In-memory cache for the product list (refreshed every 30 min max)
_products_cache: list[str] | None = None
_products_cache_time: float = 0


async def _get_all_products() -> list[str]:
    """Fetch and cache the full product list from endoflife.date."""
    global _products_cache, _products_cache_time  # noqa: N816
    import time

    now = time.time()
    if _products_cache is not None and (now - _products_cache_time) < 1800:
        return _products_cache

    client = await _get_client()
    try:
        resp = await client.get(f"{EOL_BASE}/all.json")
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        if _products_cache is not None:
            return _products_cache
        logger.warning("endoflife.date API error: %s", exc)
        raise HTTPException(status_code=502, detail="endoflife.date API is unavailable") from exc

    _products_cache = resp.json()
    _products_cache_time = now
    return _products_cache  # type: ignore[return-value]


def _normalize(text: str) -> str:
    """Normalize a string for fuzzy comparison: lowercase, strip separators."""
    return re.sub(r"[\s\-_./]+", "", text.lower())


def _tokenize(text: str) -> list[str]:
    """Split text into lowercase tokens on separators."""
    return [t for t in re.split(r"[\s\-_./]+", text.lower()) if t]


def _fuzzy_score(query: str, product: str) -> float:
    """Compute a fuzzy match score between a search query and a product name.

    Returns a float between 0.0 and 1.0. Higher is better.
    Uses a combination of:
      - Normalized substring match (high weight)
      - Token overlap (medium weight)
      - SequenceMatcher ratio (fallback)
    """
    q_norm = _normalize(query)
    p_norm = _normalize(product)

    if not q_norm:
        return 0.0

    # Exact normalized match
    if q_norm == p_norm:
        return 1.0

    # Substring match on normalized form
    if q_norm in p_norm:
        return 0.9 + 0.1 * (len(q_norm) / len(p_norm))

    if p_norm in q_norm:
        return 0.85

    # Token-based scoring
    q_tokens = _tokenize(query)
    p_tokens = _tokenize(product)

    if q_tokens and p_tokens:
        # Count how many query tokens are substrings of any product token
        matches = 0
        for qt in q_tokens:
            for pt in p_tokens:
                if qt in pt or pt in qt:
                    matches += 1
                    break
        token_score = matches / len(q_tokens) if q_tokens else 0
    else:
        token_score = 0.0

    # SequenceMatcher on normalized strings
    seq_score = SequenceMatcher(None, q_norm, p_norm).ratio()

    # Weighted combination
    return max(token_score * 0.7 + seq_score * 0.3, seq_score)


def _fuzzy_search(
    query: str, products: list[str], limit: int = 20, threshold: float = 0.3
) -> list[tuple[str, float]]:
    """Return products sorted by fuzzy match score, above threshold."""
    scored = []
    for p in products:
        score = _fuzzy_score(query, p)
        if score >= threshold:
            scored.append((p, score))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:limit]


def _custom_fuzzy(
    query: str, products: list[tuple[str, str]], limit: int, threshold: float
) -> list[tuple[str, str, float]]:
    """Fuzzy-match custom products on title and key: ``[(key, title, score)]``."""
    scored = []
    for key, title in products:
        score = max(_fuzzy_score(query, title), _fuzzy_score(query, key))
        if score >= threshold:
            scored.append((key, title, score))
    scored.sort(key=lambda x: x[2], reverse=True)
    return scored[:limit]


def _custom_substring(query: str, products: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Custom products whose title or key contains ``query`` (all when empty)."""
    q = query.lower()
    hits = [(k, t) for k, t in products if not q or q in t.lower() or q in k.lower()]
    return sorted(hits, key=lambda kt: kt[1].lower())


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/products", response_model=list[EolProduct])
async def list_products(
    search: str = Query("", description="Filter product names (case-insensitive substring match)"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the list of all products tracked by endoflife.date.

    An optional *search* query filters the list client-side (the upstream API
    is purely static JSON and does not support server-side filtering).
    """
    await PermissionService.require_permission(db, user, "eol.view")
    customs = _custom_substring(search, await custom.product_titles(db))
    # Release the connection before the (possibly uncached) upstream fetch.
    await db.commit()
    out = [EolProduct(name=custom.product_ref(k), title=t, custom=True) for k, t in customs]
    try:
        products = await _get_all_products()
    except HTTPException:
        # endoflife.date is down: the organisation's own products still answer.
        if out:
            return out[:100]
        raise
    if search:
        q = search.lower()
        products = [p for p in products if q in p.lower()]

    return (out + [EolProduct(name=p) for p in products])[:100]


@router.get("/products/fuzzy", response_model=list[EolProductMatch])
async def fuzzy_search_products(
    search: str = Query(..., min_length=2, description="Fuzzy search query"),
    limit: int = Query(10, ge=1, le=50, description="Max results"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fuzzy-search products on endoflife.date.

    Returns products ranked by fuzzy match score. Handles common
    mismatches like "SAP HANA" → "sap-hana", "Node.js" → "nodejs", etc.
    """
    await PermissionService.require_permission(db, user, "eol.view")
    customs = _custom_fuzzy(search, await custom.product_titles(db), limit, 0.3)
    await db.commit()
    out = [
        EolProductMatch(name=custom.product_ref(k), title=t, score=round(sc, 3), custom=True)
        for k, t, sc in customs
    ]
    try:
        products = await _get_all_products()
    except HTTPException:
        if out:
            return out
        raise
    matches = _fuzzy_search(search, products, limit=limit)
    # The organisation's own products first: someone who made one meant it.
    return (out + [EolProductMatch(name=n, score=round(sc, 3)) for n, sc in matches])[:limit]


@router.get("/products/{product}", response_model=list[EolCycle])
async def get_product_cycles(
    product: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return all release cycles for a given product.

    A ``custom:<key>`` product is served from the database and never reaches
    the upstream proxy below.
    """
    await PermissionService.require_permission(db, user, "eol.view")
    if custom.is_custom_product(product):
        return await custom.product_cycles(db, custom.key_of(product))
    # M6: SSRF prevention — only allow alphanumeric, hyphens, and dots
    if not re.match(r"^[a-zA-Z0-9._-]+$", product):
        raise HTTPException(status_code=400, detail="Invalid product name")
    client = await _get_client()
    try:
        resp = await client.get(f"{EOL_BASE}/{product}.json")
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail=f"Product '{product}' not found")
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail=f"Product '{product}' not found") from exc
        logger.warning("endoflife.date API error for product '%s': %s", product, exc)
        raise HTTPException(status_code=502, detail="endoflife.date API is unavailable") from exc
    except httpx.HTTPError as exc:
        logger.warning("endoflife.date API error for product '%s': %s", product, exc)
        raise HTTPException(status_code=502, detail="endoflife.date API is unavailable") from exc

    return resp.json()


@router.get("/types", response_model=list[str])
async def eol_types(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The card types that track End of Life.

    A type tracks it when its End of Life section is shown in the Card Layout
    editor — Applications and IT Components unless an admin hid it there,
    any other type once an admin shows it (``card_flags.type_tracks_eol``).
    """
    await PermissionService.require_permission(db, user, "eol.view")
    return list(await eol_type_keys(db))


class EolCardStatus(BaseModel):
    """The resolved end-of-life picture for one card."""

    status: str = Field(description="eol | approaching | supported | unknown")
    source: str = Field(
        description="api (endoflife.date link) | custom (custom EOL product) | "
        "manual (lifecycle date)"
    )
    eol_product: str | None = None
    eol_product_title: str | None = Field(
        None, description="A custom product's title; null for endoflife.date links"
    )
    eol_cycle: str | None = None
    eol_date: str | None = None
    support_date: str | None = None
    latest: str | None = None


class EolCardStatusResponse(BaseModel):
    """Card id → status, for every card of the type that carries EOL data."""

    items: dict[str, EolCardStatus]


@router.get("/card-status", response_model=EolCardStatusResponse)
async def eol_card_status(
    type_key: str = Query(..., alias="type", description="A card type that tracks End of Life"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Resolve the end-of-life status of every card of a type in one call.

    Backs the inventory's End of life column and filter. Cards with neither a
    product link nor a manual End of Life date are **absent** from the map
    rather than present with a null status — the client reads absence as "not
    recorded", and it keeps the payload proportional to what is actually
    linked rather than to the size of the landscape.
    """
    await PermissionService.require_permission(db, user, "eol.view")

    if type_key not in await eol_type_keys(db):
        raise HTTPException(
            status_code=400,
            detail="This card type does not track End of Life",
        )

    read_scope = await CardReadScope.load(db, user)
    result = await db.execute(
        select(Card)
        .where(Card.type == type_key)
        .where(Card.status == "ACTIVE")
        .where(*read_scope.where(Card, mode="module"))
    )
    cards = result.scalars().all()
    # Custom products live in the database: read them while the session is
    # still open, then hand the connection back BEFORE the outbound
    # round-trip. `get_db` is a yield-dependency, so without this commit the
    # reads above would pin one of the pool's 30 connections for the whole
    # endoflife.date fetch — and this endpoint is hit on every inventory type
    # change, not once a day.
    custom_cycles = await custom.load_custom_cycles(
        db, {(c.attributes or {}).get("eol_product") for c in cards}
    )
    await db.commit()

    statuses = await resolve_eol_statuses(cards, custom_cycles)
    return {"items": statuses}


@router.post("/mass-search", response_model=list[MassEolResult])
async def mass_eol_search(
    type_key: str = Query(..., description="Card type to search (one that tracks End of Life)"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Mass-search EOL products for all cards of a given type.

    Finds fuzzy matches on endoflife.date for each card name.
    Only returns cards that have potential matches.
    """
    await PermissionService.require_permission(db, user, "eol.manage")

    if type_key not in await eol_type_keys(db):
        raise HTTPException(
            status_code=400,
            detail="This card type does not track End of Life",
        )

    # Fetch all active cards of the given type
    stmt = (
        select(Card)
        .where(Card.type == type_key)
        .where(Card.status == "ACTIVE")
        .where(*(await CardReadScope.load(db, user)).where(Card, mode="module"))
        .order_by(Card.name)
    )
    result = await db.execute(stmt)
    cards = result.scalars().all()

    if not cards:
        return []

    custom_products = await custom.product_titles(db)
    custom_titles = {custom.product_ref(k): t for k, t in custom_products}
    await db.commit()
    # Fetch EOL product list
    products = await _get_all_products()

    # Build results with fuzzy matches for each card
    results: list[MassEolResult] = []

    # Process in parallel using asyncio (fuzzy search is CPU-bound but fast)
    for card in cards:
        matches = _fuzzy_search(card.name, products, limit=5, threshold=0.35)
        current_product = (card.attributes or {}).get("eol_product")
        current_cycle = (card.attributes or {}).get("eol_cycle")

        candidates = [
            MassEolCandidate(
                card_id=str(card.id),
                card_name=card.name,
                card_type=card.type,
                eol_product=name,
                score=round(score, 3),
            )
            for name, score in matches
        ] + [
            MassEolCandidate(
                card_id=str(card.id),
                card_name=card.name,
                card_type=card.type,
                eol_product=custom.product_ref(key),
                title=title,
                custom=True,
                score=round(score, 3),
            )
            for key, title, score in _custom_fuzzy(card.name, custom_products, 5, 0.35)
        ]
        candidates.sort(key=lambda c: c.score, reverse=True)
        candidates = candidates[:5]

        results.append(
            MassEolResult(
                card_id=str(card.id),
                card_name=card.name,
                card_type=card.type,
                current_eol_product=current_product,
                current_title=custom_titles.get(current_product) if current_product else None,
                current_eol_cycle=current_cycle,
                candidates=candidates,
            )
        )

    return results


@router.post("/mass-link")
async def mass_eol_link(
    links: list[dict],
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Bulk-link cards to EOL products/cycles.

    Expects a list of: [{card_id, eol_product, eol_cycle}].
    Only the EOL product/cycle association is recorded — lifecycle phase dates
    (including End of Life, the decommission date) are manually owned and are
    never auto-filled from vendor EOL data.
    """
    await PermissionService.require_permission(db, user, "eol.manage")
    read_scope = await CardReadScope.load(db, user)

    # A custom product is ours to check: refuse a link to one that does not
    # exist, or to a cycle it does not have, rather than store a dead link.
    custom_cycles = await custom.load_custom_cycles(db, {lk.get("eol_product") for lk in links})
    for link in links:
        product = link.get("eol_product")
        if not custom.is_custom_product(product):
            continue
        if product not in custom_cycles:
            raise HTTPException(422, f"Unknown custom EOL product '{product}'")
        if link.get("eol_cycle") and not any(
            str(c["cycle"]) == str(link["eol_cycle"]) for c in custom_cycles[product]
        ):
            raise HTTPException(422, f"Unknown cycle '{link['eol_cycle']}' of '{product}'")

    updated = []

    for link in links:
        card_id = link.get("card_id")
        product = link.get("eol_product")
        cycle = link.get("eol_cycle")
        if not card_id or not product or not cycle:
            continue

        stmt = select(Card).where(Card.id == card_id)
        result = await db.execute(stmt)
        card = result.scalar_one_or_none()
        if not card or not read_scope.readable(card.id, card.type, mode="module"):
            continue

        # Update attributes. Re-linking a card to the product/cycle it already
        # carries must write nothing: the old `flag_modified` forced an UPDATE
        # regardless, moving Last-changed with no History entry behind it (#995).
        old_attrs = dict(card.attributes or {})
        if old_attrs.get("eol_product") == product and old_attrs.get("eol_cycle") == cycle:
            continue

        attrs = dict(old_attrs)
        attrs["eol_product"] = product
        attrs["eol_cycle"] = cycle
        card.attributes = attrs

        await event_bus.publish(
            "card.updated",
            {
                "id": str(card.id),
                "source": "eol_mass_link",
                "changes": {"attributes": {"old": old_attrs, "new": attrs}},
            },
            db=db,
            card_id=card.id,
            user_id=user.id,
        )

        updated.append(str(card.id))

    await db.commit()
    return {"updated": updated, "count": len(updated)}


# ---------------------------------------------------------------------------
# Custom EOL products — the organisation's own end-of-life data for products
# endoflife.date does not track. Logic lives in `eol_custom_service`; these
# handlers check permission, own the transaction and shape the response.
# ---------------------------------------------------------------------------


@router.get("/custom-products", response_model=list[EolCustomProductOut])
async def list_custom_products(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Every custom product with its cycles and how many cards link to each.

    The counts cover the cards the caller may read, never naming one.
    """
    await PermissionService.require_permission(db, user, "eol.view")
    read_scope = await CardReadScope.load(db, user)
    return await custom.list_products(db, read_scope)


@router.get("/custom-products/upstream-matches", response_model=dict[str, EolUpstreamMatch])
async def custom_product_upstream_matches(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Custom products that now look covered by endoflife.date.

    ``{key: {name, score}}`` for each custom product whose title or key
    closely matches an upstream product — the cue to switch its cards over.
    An unreachable endoflife.date yields an empty map, not an error: this is
    a hint, and the grid must still load without it.
    """
    await PermissionService.require_permission(db, user, "eol.view")
    titles = await custom.product_titles(db)
    await db.commit()  # no connection held across the upstream fetch
    if not titles:
        return {}
    try:
        products = await _get_all_products()
    except HTTPException:
        return {}
    out: dict[str, EolUpstreamMatch] = {}
    for key, title in titles:
        best = _fuzzy_search(
            title, products, limit=1, threshold=UPSTREAM_MATCH_THRESHOLD
        ) or _fuzzy_search(key, products, limit=1, threshold=UPSTREAM_MATCH_THRESHOLD)
        if best:
            out[key] = EolUpstreamMatch(name=best[0][0], score=round(best[0][1], 3))
    return out


async def _product_out(db: AsyncSession, user: User, key: str) -> dict:
    read_scope = await CardReadScope.load(db, user)
    for p in await custom.list_products(db, read_scope):
        if p["key"] == key:
            return p
    raise HTTPException(404, "Custom EOL product not found")


@router.post("/custom-products", response_model=EolCustomProductOut, status_code=201)
async def create_custom_product(
    body: EolCustomProductCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a custom product, optionally with its first cycles.

    One request, so a user who found nothing on endoflife.date from a card
    can define the product and link the card without leaving it.
    """
    await PermissionService.require_permission(db, user, "eol.manage")
    product = await custom.create_product(db, user, body)
    await db.commit()
    return await _product_out(db, user, product.key)


@router.patch("/custom-products/{key}", response_model=EolCustomProductOut)
async def update_custom_product(
    key: str,
    body: EolCustomProductUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Edit a product's title, description or link. The key never changes."""
    await PermissionService.require_permission(db, user, "eol.manage")
    await custom.update_product(db, user, key, body)
    await db.commit()
    return await _product_out(db, user, key)


@router.delete("/custom-products/{key}", status_code=204)
async def delete_custom_product(
    key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a product no card links to (409 ``cards_linked`` otherwise)."""
    await PermissionService.require_permission(db, user, "eol.manage")
    read_scope = await CardReadScope.load(db, user)
    await custom.delete_product(db, user, key, read_scope)
    await db.commit()


@router.post("/custom-products/{key}/cycles", response_model=EolCustomCycleOut, status_code=201)
async def create_custom_cycle(
    key: str,
    body: EolCustomCycleCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Add a release cycle to a custom product."""
    await PermissionService.require_permission(db, user, "eol.manage")
    cycle = await custom.create_cycle(db, user, key, body)
    await db.commit()
    return _cycle_out(await _product_out(db, user, key), str(cycle.id))


@router.patch("/custom-products/{key}/cycles/{cycle_id}", response_model=EolCustomCycleOut)
async def update_custom_cycle(
    key: str,
    cycle_id: str,
    body: EolCustomCycleUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Patch one cycle: the admin grid's per-cell and drag-fill write."""
    await PermissionService.require_permission(db, user, "eol.manage")
    await custom.update_cycle(db, user, key, cycle_id, body)
    await db.commit()
    return _cycle_out(await _product_out(db, user, key), cycle_id)


@router.delete("/custom-products/{key}/cycles/{cycle_id}")
async def delete_custom_cycle(
    key: str,
    cycle_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a cycle no card links (409 ``cards_linked`` otherwise)."""
    await PermissionService.require_permission(db, user, "eol.manage")
    read_scope = await CardReadScope.load(db, user)
    await custom.delete_cycle(db, user, key, cycle_id, read_scope)
    await db.commit()
    return {"ok": True}


def _cycle_out(product: dict, cycle_id: str) -> dict:
    try:
        wanted = uuid.UUID(cycle_id)
    except ValueError:
        raise HTTPException(404, "Cycle not found") from None
    cycles: list[dict] = product["cycles"]
    for c in cycles:
        if uuid.UUID(c["id"]) == wanted:
            return c
    raise HTTPException(404, "Cycle not found")


@router.post("/custom-products/{key}/switch", response_model=EolCustomSwitchResult)
async def switch_custom_product(
    key: str,
    body: EolCustomSwitchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Move a custom product's card links onto an endoflife.date product.

    Once endoflife.date tracks a product (perhaps after someone proposed it),
    the custom copy should give way. The target's cycles are fetched first,
    with no connection held, then the cards the caller can read are relinked
    cycle by cycle as ``cycle_map`` says; a cycle mapped to null keeps its
    cards. Lifecycle dates are never touched, as with mass-link.
    """
    await PermissionService.require_permission(db, user, "eol.manage")
    await custom.get_product(db, key)
    target = body.target_product
    if custom.is_custom_product(target) or not re.match(r"^[a-zA-Z0-9._-]+$", target):
        raise HTTPException(422, "The target must be an endoflife.date product")
    await db.commit()  # release the connection across the outbound fetch

    client = await _get_client()
    upstream = await fetch_product_cycles(client, target)
    if not upstream:
        raise HTTPException(422, f"endoflife.date has no product '{target}'")

    read_scope = await CardReadScope.load(db, user)
    result = await custom.switch_to_upstream(
        db,
        user,
        key,
        target,
        upstream,
        body.cycle_map,
        body.delete_when_unused,
        read_scope,
    )
    await db.commit()
    return result
