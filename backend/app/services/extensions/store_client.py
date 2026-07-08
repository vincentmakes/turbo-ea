"""Client for the vendor-hosted Extension Store (optional, online installs).

The connection is one redeem code away: the admin enters the store URL +
the one-time code from checkout, the instance exchanges it for an
account token (stored encrypted in ``app_settings``), and can from then
on pull its current signed license and download entitled ``.teax``
bundles. Everything downloaded goes through the exact same signature
verification and preview pipeline as a manual upload — the store is a
convenience transport, never a trust shortcut. Air-gapped installs
simply never connect.
"""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_value, encrypt_value
from app.models.app_settings import AppSettings

STORE_SETTINGS_KEY = "extensionStore"
_TIMEOUT = httpx.Timeout(30.0)
_MAX_BUNDLE_BYTES = 200 * 1024 * 1024  # hard cap on a downloaded bundle


class StoreClientError(Exception):
    """Raised when the store is unreachable or answers with an error."""


async def _get_settings_row(db: AsyncSession) -> AppSettings:
    row = (
        await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    ).scalar_one_or_none()
    if row is None:
        row = AppSettings(id="default", general_settings={}, email_settings={})
        db.add(row)
        await db.flush()
    return row


async def get_store_config(db: AsyncSession) -> tuple[str, str] | None:
    """Return ``(url, account_token)`` or ``None`` when not connected."""
    row = (
        await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    ).scalar_one_or_none()
    cfg = ((row.general_settings if row else None) or {}).get(STORE_SETTINGS_KEY) or {}
    url = str(cfg.get("url") or "").rstrip("/")
    token = decrypt_value(str(cfg.get("accountToken") or ""))
    if not url or not token:
        return None
    return url, token


async def save_store_config(db: AsyncSession, url: str, token: str) -> None:
    row = await _get_settings_row(db)
    general = dict(row.general_settings or {})
    general[STORE_SETTINGS_KEY] = {
        "url": url.rstrip("/"),
        "accountToken": encrypt_value(token),
    }
    row.general_settings = general
    await db.flush()


async def clear_store_config(db: AsyncSession) -> None:
    row = await _get_settings_row(db)
    general = dict(row.general_settings or {})
    general.pop(STORE_SETTINGS_KEY, None)
    row.general_settings = general
    await db.flush()


# ---------------------------------------------------------------------------
# HTTP calls (module-level functions so tests can monkeypatch them)
# ---------------------------------------------------------------------------


def _raise_for_response(res: httpx.Response, action: str) -> None:
    if res.status_code >= 400:
        try:
            detail = res.json().get("detail", res.text)
        except Exception:  # noqa: BLE001
            detail = res.text
        raise StoreClientError(f"Store {action} failed ({res.status_code}): {detail}")


async def redeem_code(url: str, code: str) -> dict[str, Any]:
    """Exchange a one-time code for an account token."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            res = await client.post(f"{url.rstrip('/')}/redeem", json={"code": code})
    except httpx.HTTPError as exc:
        raise StoreClientError(f"Cannot reach the store at {url}: {exc}") from exc
    _raise_for_response(res, "redeem")
    return res.json()


async def fetch_license(url: str, token: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            res = await client.get(
                f"{url}/account/license", headers={"Authorization": f"Bearer {token}"}
            )
    except httpx.HTTPError as exc:
        raise StoreClientError(f"Cannot reach the store at {url}: {exc}") from exc
    _raise_for_response(res, "license refresh")
    return str(res.json().get("text") or "")


async def fetch_catalog(url: str, token: str) -> list[dict[str, Any]]:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            res = await client.get(
                f"{url}/account/catalog", headers={"Authorization": f"Bearer {token}"}
            )
    except httpx.HTTPError as exc:
        raise StoreClientError(f"Cannot reach the store at {url}: {exc}") from exc
    _raise_for_response(res, "catalog fetch")
    data = res.json()
    return data if isinstance(data, list) else []


async def create_checkout(url: str, extension_key: str) -> str:
    """Ask the store for a Stripe Checkout URL for a product (public endpoint)."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            res = await client.post(
                f"{url.rstrip('/')}/checkout", json={"product_key": extension_key}
            )
    except httpx.HTTPError as exc:
        raise StoreClientError(f"Cannot reach the store at {url}: {exc}") from exc
    _raise_for_response(res, "checkout")
    return str(res.json().get("checkout_url") or "")


async def download_bundle(url: str, token: str, extension_key: str, core_version: str) -> bytes:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
            res = await client.get(
                f"{url}/account/bundles/{extension_key}",
                params={"core_version": core_version},
                headers={"Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError as exc:
        raise StoreClientError(f"Cannot reach the store at {url}: {exc}") from exc
    _raise_for_response(res, "bundle download")
    raw = res.content
    if not raw or len(raw) > _MAX_BUNDLE_BYTES:
        raise StoreClientError("Store returned an empty or oversized bundle")
    return raw


def as_http_error(exc: StoreClientError) -> HTTPException:
    return HTTPException(status_code=502, detail=str(exc))
