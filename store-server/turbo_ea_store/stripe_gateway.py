"""Thin wrapper around the Stripe SDK.

Everything the store needs from Stripe goes through these four
functions so tests can monkeypatch them without touching the SDK, and so
SDK-version churn stays contained to one file.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import stripe

from turbo_ea_store.config import settings


def _client_configured() -> None:
    if not settings.STRIPE_API_KEY:
        raise RuntimeError("STRIPE_API_KEY is not configured")
    stripe.api_key = settings.STRIPE_API_KEY


def create_checkout_session(price_id: str, product_key: str, email: str | None) -> dict[str, Any]:
    """Create a subscription Checkout Session; returns {id, url}."""
    _client_configured()
    session = stripe.checkout.Session.create(
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        customer_email=email or None,
        success_url=f"{settings.STORE_PUBLIC_URL}/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{settings.STORE_PUBLIC_URL}/catalog",
        metadata={"product_key": product_key},
        subscription_data={"metadata": {"product_key": product_key}},
    )
    return {"id": session["id"], "url": session["url"]}


def retrieve_subscription(subscription_id: str) -> dict[str, Any]:
    """Return {id, status, customer, current_period_end (datetime|None), product_key}."""
    _client_configured()
    sub = stripe.Subscription.retrieve(subscription_id)
    period_end = sub.get("current_period_end")
    return {
        "id": sub["id"],
        "status": sub.get("status", "active"),
        "customer": sub.get("customer"),
        "current_period_end": (
            datetime.fromtimestamp(period_end, tz=timezone.utc) if period_end else None
        ),
        "product_key": (sub.get("metadata") or {}).get("product_key", ""),
    }


def verify_webhook(payload: bytes, signature_header: str) -> dict[str, Any]:
    """Verify + parse a webhook event. Raises ValueError on bad signature."""
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise ValueError("STRIPE_WEBHOOK_SECRET is not configured")
    try:
        event = stripe.Webhook.construct_event(
            payload, signature_header, settings.STRIPE_WEBHOOK_SECRET
        )
    except (stripe.error.SignatureVerificationError, ValueError) as exc:  # type: ignore[attr-defined]
        raise ValueError(f"Invalid Stripe webhook: {exc}") from exc
    return dict(event)
