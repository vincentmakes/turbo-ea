"""Proxy endpoints for the endoflife.date API.

These endpoints allow the frontend to search for products and fetch
end-of-life / release-cycle data without running into CORS restrictions.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.fact_sheet import FactSheet
from app.models.user import User
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/eol", tags=["End of Life"])

EOL_BASE = "https://endoflife.date/api"

# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class EolProduct(BaseModel):
    """A product identifier returned from the product list."""

    name: str


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


class EolProductMatch(BaseModel):
    """A product with a fuzzy match score."""

    name: str
    score: float


class MassEolCandidate(BaseModel):
    """A candidate EOL match for a fact sheet."""

    fact_sheet_id: str
    fact_sheet_name: str
    fact_sheet_type: str
    eol_product: str
    score: float


class MassEolResult(BaseModel):
    """Result of mass EOL search for a single fact sheet."""

    fact_sheet_id: str
    fact_sheet_name: str
    fact_sheet_type: str
    current_eol_product: str | None = None
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
        raise HTTPException(
            status_code=502, detail=f"endoflife.date API error: {exc}"
        ) from exc

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


def _fuzzy_search(query: str, products: list[str], limit: int = 20, threshold: float = 0.3) -> list[tuple[str, float]]:
    """Return products sorted by fuzzy match score, above threshold."""
    scored = []
    for p in products:
        score = _fuzzy_score(query, p)
        if score >= threshold:
            scored.append((p, score))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:limit]


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
    products = await _get_all_products()
    if search:
        q = search.lower()
        products = [p for p in products if q in p.lower()]

    return [EolProduct(name=p) for p in products[:100]]


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
    products = await _get_all_products()
    matches = _fuzzy_search(search, products, limit=limit)
    return [EolProductMatch(name=name, score=round(score, 3)) for name, score in matches]


@router.get("/products/{product}", response_model=list[EolCycle])
async def get_product_cycles(
    product: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return all release cycles for a given product."""
    await PermissionService.require_permission(db, user, "eol.view")
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
            raise HTTPException(
                status_code=404, detail=f"Product '{product}' not found"
            ) from exc
        raise HTTPException(
            status_code=502, detail=f"endoflife.date API error: {exc}"
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502, detail=f"endoflife.date API error: {exc}"
        ) from exc

    return resp.json()


@router.post("/mass-search", response_model=list[MassEolResult])
async def mass_eol_search(
    type_key: str = Query(..., description="Fact sheet type to search (Application or ITComponent)"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Mass-search EOL products for all fact sheets of a given type.

    Finds fuzzy matches on endoflife.date for each fact sheet name.
    Only returns fact sheets that have potential matches.
    """
    await PermissionService.require_permission(db, user, "eol.manage")

    if type_key not in ("Application", "ITComponent"):
        raise HTTPException(
            status_code=400,
            detail="Only Application and ITComponent types support EOL linking",
        )

    # Fetch all active fact sheets of the given type
    stmt = (
        select(FactSheet)
        .where(FactSheet.type == type_key)
        .where(FactSheet.status == "ACTIVE")
        .order_by(FactSheet.name)
    )
    result = await db.execute(stmt)
    fact_sheets = result.scalars().all()

    if not fact_sheets:
        return []

    # Fetch EOL product list
    products = await _get_all_products()

    # Build results with fuzzy matches for each fact sheet
    results: list[MassEolResult] = []

    # Process in parallel using asyncio (fuzzy search is CPU-bound but fast)
    for fs in fact_sheets:
        matches = _fuzzy_search(fs.name, products, limit=5, threshold=0.35)
        current_product = (fs.attributes or {}).get("eol_product")
        current_cycle = (fs.attributes or {}).get("eol_cycle")

        candidates = [
            MassEolCandidate(
                fact_sheet_id=str(fs.id),
                fact_sheet_name=fs.name,
                fact_sheet_type=fs.type,
                eol_product=name,
                score=round(score, 3),
            )
            for name, score in matches
        ]

        results.append(
            MassEolResult(
                fact_sheet_id=str(fs.id),
                fact_sheet_name=fs.name,
                fact_sheet_type=fs.type,
                current_eol_product=current_product,
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
    """Bulk-link fact sheets to EOL products/cycles.

    Expects a list of: [{fact_sheet_id, eol_product, eol_cycle}].
    For ITComponent type, lifecycle dates are synced from EOL data.
    """
    await PermissionService.require_permission(db, user, "eol.manage")

    client = await _get_client()
    updated = []

    for link in links:
        fs_id = link.get("fact_sheet_id")
        product = link.get("eol_product")
        cycle = link.get("eol_cycle")
        if not fs_id or not product or not cycle:
            continue

        stmt = select(FactSheet).where(FactSheet.id == fs_id)
        result = await db.execute(stmt)
        fs = result.scalar_one_or_none()
        if not fs:
            continue

        # Update attributes
        attrs = dict(fs.attributes or {})
        attrs["eol_product"] = product
        attrs["eol_cycle"] = cycle
        fs.attributes = attrs

        # For ITComponent: sync lifecycle dates
        if fs.type == "ITComponent":
            try:
                resp = await client.get(f"{EOL_BASE}/{product}.json")
                if resp.status_code == 200:
                    cycles_data = resp.json()
                    match = next(
                        (c for c in cycles_data if str(c.get("cycle")) == str(cycle)),
                        None,
                    )
                    if match:
                        lifecycle = dict(fs.lifecycle or {})
                        if match.get("releaseDate"):
                            lifecycle["active"] = match["releaseDate"]
                        support = match.get("support")
                        if isinstance(support, str):
                            lifecycle["phaseOut"] = support
                        eol_val = match.get("eol")
                        if isinstance(eol_val, str):
                            lifecycle["endOfLife"] = eol_val
                        fs.lifecycle = lifecycle
            except httpx.HTTPError:
                pass  # Link without lifecycle sync on error

        updated.append(str(fs.id))

    await db.commit()
    return {"updated": updated, "count": len(updated)}
