"""Proxy endpoints for the endoflife.date API.

These endpoints allow the frontend to search for products and fetch
end-of-life / release-cycle data without running into CORS restrictions.
"""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.api.deps import get_current_user

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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_client: httpx.AsyncClient | None = None


async def _get_client() -> httpx.AsyncClient:
    global _client  # noqa: N816
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=15.0)
    return _client


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/products", response_model=list[EolProduct])
async def list_products(
    search: str = Query("", description="Filter product names (case-insensitive substring match)"),
    _user=Depends(get_current_user),
):
    """Return the list of all products tracked by endoflife.date.

    An optional *search* query filters the list client-side (the upstream API
    is purely static JSON and does not support server-side filtering).
    """
    client = await _get_client()
    try:
        resp = await client.get(f"{EOL_BASE}/all.json")
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"endoflife.date API error: {exc}") from exc

    products: list[str] = resp.json()
    if search:
        q = search.lower()
        products = [p for p in products if q in p.lower()]

    return [EolProduct(name=p) for p in products[:100]]


@router.get("/products/{product}", response_model=list[EolCycle])
async def get_product_cycles(
    product: str,
    _user=Depends(get_current_user),
):
    """Return all release cycles for a given product."""
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
