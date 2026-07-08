"""Extension Store server — FastAPI app.

Public surface:  catalog, Stripe checkout + webhook, redeem-code exchange,
success page. Instance surface (Bearer account token): current composite
license, entitled catalog, bundle downloads. Vendor surface (Bearer admin
token): product upserts and ``.teax`` release publishing.

The store never holds the offline vendor key — it signs licenses with its
own ``store-1`` key, whose public half is baked into customer cores.
"""

from __future__ import annotations

import hashlib
import re
import secrets
import zipfile
from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import Any

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from turbo_ea_store import stripe_gateway
from turbo_ea_store.config import settings
from turbo_ea_store.db import get_db, init_db
from turbo_ea_store.licensing import ENTITLED_STATUSES, build_license
from turbo_ea_store.models import Customer, Product, RedeemCode, Release, Subscription

app = FastAPI(title="Turbo EA Extension Store", docs_url=None, redoc_url=None)

_FILENAME_SAFE = re.compile(r"[^A-Za-z0-9._-]")


@app.on_event("startup")
async def _startup() -> None:
    await init_db()


def version_tuple(v: str) -> tuple[int, ...]:
    parts: list[int] = []
    for chunk in str(v).split("."):
        digits = ""
        for ch in chunk:
            if ch.isdigit():
                digits += ch
            else:
                break
        parts.append(int(digits) if digits else 0)
    return tuple(parts)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _new_redeem_code() -> str:
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O/1/I/L
    chunks = ["".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(3)]
    return "-".join(chunks)


async def _customer_from_token(db: AsyncSession, authorization: str | None) -> Customer:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing account token")
    token = authorization[7:].strip()
    customer = (
        await db.execute(select(Customer).where(Customer.account_token_hash == _token_hash(token)))
    ).scalar_one_or_none()
    if customer is None:
        raise HTTPException(status_code=401, detail="Invalid account token")
    return customer


def _require_admin(authorization: str | None) -> None:
    if not settings.STORE_ADMIN_TOKEN:
        raise HTTPException(status_code=503, detail="Admin API disabled (no STORE_ADMIN_TOKEN)")
    if authorization != f"Bearer {settings.STORE_ADMIN_TOKEN}":
        raise HTTPException(status_code=401, detail="Invalid admin token")


async def _latest_releases(db: AsyncSession) -> dict[str, Release]:
    latest: dict[str, Release] = {}
    for release in (await db.execute(select(Release))).scalars():
        current = latest.get(release.extension_key)
        if current is None or version_tuple(release.version) > version_tuple(current.version):
            latest[release.extension_key] = release
    return latest


def _product_out(product: Product, release: Release | None, entitled: bool | None) -> dict:
    out: dict[str, Any] = {
        "key": product.key,
        "name": product.name,
        "description": product.description,
        "display_price": product.display_price,
        "plan": product.plan,
        "latest_version": release.version if release else None,
        "core_min": release.core_min if release else None,
    }
    if entitled is not None:
        out["entitled"] = entitled
    return out


# ---------------------------------------------------------------------------
# Public
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "store": "turbo-ea"}


@app.get("/catalog")
async def catalog(db: AsyncSession = Depends(get_db)) -> list[dict]:
    products = (
        (
            await db.execute(
                select(Product)
                .where(Product.active == True)  # noqa: E712
                .order_by(Product.sort_order, Product.key)
            )
        )
        .scalars()
        .all()
    )
    latest = await _latest_releases(db)
    return [_product_out(p, latest.get(p.key), None) for p in products]


class CheckoutIn(BaseModel):
    product_key: str
    email: str | None = Field(default=None, max_length=320)


@app.post("/checkout")
async def checkout(payload: CheckoutIn, db: AsyncSession = Depends(get_db)) -> dict:
    product = (
        await db.execute(
            select(Product).where(Product.key == payload.product_key, Product.active == True)  # noqa: E712
        )
    ).scalar_one_or_none()
    if product is None:
        raise HTTPException(status_code=404, detail="Unknown product")
    try:
        session = stripe_gateway.create_checkout_session(
            product.stripe_price_id, product.key, payload.email
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"checkout_url": session["url"], "session_id": session["id"]}


@app.get("/success", response_class=HTMLResponse)
async def success(session_id: str = "", db: AsyncSession = Depends(get_db)) -> str:
    """Post-checkout landing page: shows the one-time redeem code once the
    webhook has landed (auto-refreshes while Stripe's webhook is in flight)."""
    code_row = None
    if session_id:
        code_row = (
            await db.execute(select(RedeemCode).where(RedeemCode.stripe_session_id == session_id))
        ).scalar_one_or_none()
    if code_row is None:
        return (
            "<html><head><meta http-equiv='refresh' content='3'></head><body "
            "style='font-family:sans-serif;max-width:40em;margin:4em auto'>"
            "<h2>Thanks for your purchase!</h2>"
            "<p>Preparing your activation code… this page refreshes automatically.</p>"
            "</body></html>"
        )
    if code_row.used_at is not None:
        body = (
            "<h2>Purchase complete</h2><p>Your Turbo EA instance is already connected "
            "to the store — the new subscription appears after a license refresh in "
            "<strong>Admin → Extensions</strong>.</p>"
        )
    else:
        body = (
            "<h2>Thanks for your purchase!</h2>"
            f"<p>Your one-time activation code:</p><h1><code>{code_row.code}</code></h1>"
            "<p>In Turbo EA, open <strong>Admin → Extensions → Store</strong>, enter this "
            "store's URL and the code. Your instance then installs entitled extensions "
            "and refreshes its license with one click.</p>"
        )
    return (
        "<html><body style='font-family:sans-serif;max-width:40em;margin:4em auto'>"
        f"{body}</body></html>"
    )


# ---------------------------------------------------------------------------
# Stripe webhook
# ---------------------------------------------------------------------------


async def _upsert_customer(db: AsyncSession, stripe_customer_id: str, email: str) -> Customer:
    customer = (
        await db.execute(select(Customer).where(Customer.stripe_customer_id == stripe_customer_id))
    ).scalar_one_or_none()
    if customer is None:
        customer = Customer(
            email=email,
            stripe_customer_id=stripe_customer_id,
            created_at=datetime.now(timezone.utc),
        )
        db.add(customer)
        await db.flush()
    elif email and customer.email != email:
        customer.email = email
    return customer


async def _sync_subscription(
    db: AsyncSession, customer: Customer, sub_info: dict[str, Any]
) -> None:
    if not sub_info.get("product_key"):
        return
    row = (
        await db.execute(
            select(Subscription).where(Subscription.stripe_subscription_id == sub_info["id"])
        )
    ).scalar_one_or_none()
    if row is None:
        row = Subscription(
            customer_id=customer.id,
            extension_key=sub_info["product_key"],
            stripe_subscription_id=sub_info["id"],
        )
        db.add(row)
    row.status = sub_info.get("status", "active")
    row.current_period_end = sub_info.get("current_period_end")


async def _ensure_redeem_code(db: AsyncSession, customer: Customer, session_id: str) -> None:
    """Mint a code for a not-yet-connected customer (idempotent per session)."""
    if customer.account_token_hash is not None:
        return
    existing = (
        await db.execute(
            select(RedeemCode).where(
                RedeemCode.customer_id == customer.id, RedeemCode.used_at.is_(None)
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        if session_id and not existing.stripe_session_id:
            existing.stripe_session_id = session_id
        return
    db.add(
        RedeemCode(
            code=_new_redeem_code(),
            customer_id=customer.id,
            stripe_session_id=session_id or None,
            expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REDEEM_CODE_TTL_DAYS),
        )
    )


@app.post("/stripe/webhook")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
) -> dict:
    payload = await request.body()
    try:
        event = stripe_gateway.verify_webhook(payload, stripe_signature or "")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    event_type = event.get("type", "")
    obj = (event.get("data") or {}).get("object") or {}

    if event_type == "checkout.session.completed":
        email = (
            ((obj.get("customer_details") or {}).get("email")) or obj.get("customer_email") or ""
        )
        customer = await _upsert_customer(db, str(obj.get("customer")), str(email))
        if obj.get("subscription"):
            sub_info = stripe_gateway.retrieve_subscription(str(obj["subscription"]))
            if not sub_info.get("product_key"):
                sub_info["product_key"] = (obj.get("metadata") or {}).get("product_key", "")
            await _sync_subscription(db, customer, sub_info)
        await _ensure_redeem_code(db, customer, str(obj.get("id") or ""))
        await db.commit()

    elif event_type in ("customer.subscription.updated", "customer.subscription.deleted"):
        customer_id = str(obj.get("customer") or "")
        customer = (
            await db.execute(select(Customer).where(Customer.stripe_customer_id == customer_id))
        ).scalar_one_or_none()
        if customer is not None:
            period_end = obj.get("current_period_end")
            await _sync_subscription(
                db,
                customer,
                {
                    "id": obj.get("id"),
                    "status": "canceled" if event_type.endswith("deleted") else obj.get("status"),
                    "current_period_end": (
                        datetime.fromtimestamp(period_end, tz=timezone.utc) if period_end else None
                    ),
                    "product_key": (obj.get("metadata") or {}).get("product_key", ""),
                },
            )
            await db.commit()

    elif event_type == "invoice.paid":
        sub_id = obj.get("subscription")
        if sub_id:
            sub_info = stripe_gateway.retrieve_subscription(str(sub_id))
            customer = (
                await db.execute(
                    select(Customer).where(
                        Customer.stripe_customer_id == str(sub_info.get("customer") or "")
                    )
                )
            ).scalar_one_or_none()
            if customer is not None:
                await _sync_subscription(db, customer, sub_info)
                await db.commit()

    return {"received": True}


# ---------------------------------------------------------------------------
# Instance API (redeem + account)
# ---------------------------------------------------------------------------


class RedeemIn(BaseModel):
    code: str = Field(min_length=4, max_length=32)


@app.post("/redeem")
async def redeem(payload: RedeemIn, db: AsyncSession = Depends(get_db)) -> dict:
    code = (
        await db.execute(select(RedeemCode).where(RedeemCode.code == payload.code.strip().upper()))
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    expires_at = code.expires_at if code else None
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if code is None or code.used_at is not None or (expires_at and expires_at < now):
        raise HTTPException(status_code=400, detail="Invalid, used, or expired code")
    customer = (
        await db.execute(select(Customer).where(Customer.id == code.customer_id))
    ).scalar_one()
    token = secrets.token_urlsafe(32)
    customer.account_token_hash = _token_hash(token)
    code.used_at = now
    await db.commit()
    return {"account_token": token, "licensee": customer.email}


@app.get("/account/license")
async def account_license(
    db: AsyncSession = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> dict:
    customer = await _customer_from_token(db, authorization)
    subs = (
        (await db.execute(select(Subscription).where(Subscription.customer_id == customer.id)))
        .scalars()
        .all()
    )
    products = {p.key: p for p in (await db.execute(select(Product))).scalars()}
    try:
        text = build_license(customer, subs, products)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"text": text, "licensee": customer.email}


@app.get("/account/catalog")
async def account_catalog(
    db: AsyncSession = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> list[dict]:
    customer = await _customer_from_token(db, authorization)
    entitled_keys = {
        s.extension_key
        for s in (
            await db.execute(select(Subscription).where(Subscription.customer_id == customer.id))
        ).scalars()
        if s.status in ENTITLED_STATUSES
    }
    products = (
        (
            await db.execute(
                select(Product)
                .where(Product.active == True)  # noqa: E712
                .order_by(Product.sort_order, Product.key)
            )
        )
        .scalars()
        .all()
    )
    latest = await _latest_releases(db)
    return [_product_out(p, latest.get(p.key), p.key in entitled_keys) for p in products]


@app.get("/account/bundles/{extension_key}")
async def account_bundle(
    extension_key: str,
    core_version: str = "",
    db: AsyncSession = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> FileResponse:
    customer = await _customer_from_token(db, authorization)
    entitled = any(
        s.status in ENTITLED_STATUSES
        for s in (
            await db.execute(
                select(Subscription).where(
                    Subscription.customer_id == customer.id,
                    Subscription.extension_key == extension_key,
                )
            )
        ).scalars()
    )
    if not entitled:
        raise HTTPException(status_code=403, detail="No entitlement for this extension")

    releases = (
        (await db.execute(select(Release).where(Release.extension_key == extension_key)))
        .scalars()
        .all()
    )
    if core_version:
        running = version_tuple(core_version)
        releases = [
            r
            for r in releases
            if running >= version_tuple(r.core_min)
            and (not r.core_max_exclusive or running < version_tuple(r.core_max_exclusive))
        ]
    if not releases:
        raise HTTPException(
            status_code=404, detail="No compatible release published for this extension"
        )
    best = max(releases, key=lambda r: version_tuple(r.version))
    path = settings.artifacts_dir / best.filename
    if not path.is_file():
        raise HTTPException(status_code=500, detail="Release artifact missing on the store")
    return FileResponse(
        path,
        media_type="application/zip",
        filename=f"{extension_key}-{best.version}.teax",
        headers={"X-Bundle-Sha256": best.sha256, "X-Bundle-Version": best.version},
    )


# ---------------------------------------------------------------------------
# Vendor admin API
# ---------------------------------------------------------------------------


class ProductIn(BaseModel):
    name: str
    description: str = ""
    stripe_price_id: str
    display_price: str = ""
    plan: str = "standard"
    active: bool = True
    sort_order: int = 0


@app.put("/admin/products/{key}")
async def upsert_product(
    key: str,
    payload: ProductIn,
    db: AsyncSession = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> dict:
    _require_admin(authorization)
    product = (await db.execute(select(Product).where(Product.key == key))).scalar_one_or_none()
    if product is None:
        product = Product(key=key, **payload.model_dump())
        db.add(product)
    else:
        for field_name, value in payload.model_dump().items():
            setattr(product, field_name, value)
    await db.commit()
    return {"key": key, "ok": True}


@app.post("/admin/releases")
async def publish_release(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> dict:
    _require_admin(authorization)
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty bundle")
    try:
        with zipfile.ZipFile(BytesIO(raw)) as zf:
            import json as _json

            manifest = _json.loads(zf.read("manifest.json"))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Not a valid .teax bundle: {exc}") from exc

    key = str(manifest.get("key") or "")
    version = str(manifest.get("version") or "")
    if not key or not version:
        raise HTTPException(status_code=400, detail="Bundle manifest missing key/version")
    core = manifest.get("core") or {}

    existing = (
        await db.execute(
            select(Release).where(Release.extension_key == key, Release.version == version)
        )
    ).scalar_one_or_none()
    filename = _FILENAME_SAFE.sub("_", f"{key}-{version}.teax")
    (settings.artifacts_dir / filename).write_bytes(raw)
    if existing is None:
        db.add(
            Release(
                extension_key=key,
                version=version,
                filename=filename,
                sha256=hashlib.sha256(raw).hexdigest(),
                core_min=str(core.get("min") or "0.0.1"),
                core_max_exclusive=(
                    str(core["max_exclusive"]) if core.get("max_exclusive") else None
                ),
                created_at=datetime.now(timezone.utc),
            )
        )
    else:
        existing.filename = filename
        existing.sha256 = hashlib.sha256(raw).hexdigest()
        existing.core_min = str(core.get("min") or "0.0.1")
        existing.core_max_exclusive = (
            str(core["max_exclusive"]) if core.get("max_exclusive") else None
        )
    await db.commit()
    return {"extension_key": key, "version": version, "ok": True}
