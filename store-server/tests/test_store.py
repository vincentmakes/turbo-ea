"""End-to-end store-server tests with a mocked Stripe gateway.

Covers the full commercial loop: publish release → checkout → webhook →
redeem code → account token → composite license (verified with the same
Ed25519 math the Turbo EA core uses) → entitled bundle download →
subscription lapse reflected in the next license.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import zipfile
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from httpx import ASGITransport, AsyncClient

PERIOD_END = datetime.now(timezone.utc) + timedelta(days=365)
ADMIN = {"Authorization": "Bearer admintoken"}


def make_signing_key() -> tuple[str, str]:
    private = Ed25519PrivateKey.generate()
    private_b64 = base64.b64encode(
        private.private_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PrivateFormat.Raw,
            encryption_algorithm=serialization.NoEncryption(),
        )
    ).decode()
    public_b64 = base64.b64encode(
        private.public_key().public_bytes(
            encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
        )
    ).decode()
    return private_b64, public_b64


def build_teax(key: str = "esg-pack", version: str = "1.0.0") -> bytes:
    manifest = {
        "schema": "turboea-extension/1",
        "key": key,
        "name": "ESG Pack",
        "version": version,
        "core": {"min": "1.60.0", "max_exclusive": "2.0.0"},
        "capabilities": ["content"],
        "content": ["content/pack.json"],
        "files": {},
    }
    content = json.dumps({"CardTypes": []}).encode()
    manifest["files"]["content/pack.json"] = hashlib.sha256(content).hexdigest()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("manifest.json", json.dumps(manifest))
        zf.writestr("manifest.sig", "dGVzdA==")  # store does not verify signatures itself
        zf.writestr("content/pack.json", content)
    return buf.getvalue()


@pytest.fixture
async def client(tmp_path, monkeypatch):
    """Fresh app + fresh sqlite DB per test, Stripe fully mocked.

    The app modules are singletons; isolation comes from pointing the
    settings at a per-test tmp dir and swapping in a fresh engine.
    """
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    import turbo_ea_store.app as app_mod
    import turbo_ea_store.db as db_mod
    from turbo_ea_store.config import settings

    private_b64, public_b64 = make_signing_key()
    monkeypatch.setattr(settings, "DATA_DIR", Path(tmp_path))
    monkeypatch.setattr(settings, "DATABASE_URL", "")
    monkeypatch.setattr(settings, "STORE_SIGNING_KEY", private_b64)
    monkeypatch.setattr(settings, "STORE_SIGNING_KEY_ID", "store-1")
    monkeypatch.setattr(settings, "STORE_ADMIN_TOKEN", "admintoken")

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/store.db")
    monkeypatch.setattr(db_mod, "engine", engine)
    monkeypatch.setattr(
        db_mod,
        "async_session",
        async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False),
    )

    # Mock the Stripe gateway
    def fake_checkout(price_id, product_key, email):
        return {"id": "cs_test_1", "url": "https://checkout.stripe.test/cs_test_1"}

    def fake_retrieve_subscription(sub_id):
        return {
            "id": sub_id,
            "status": "active",
            "customer": "cus_test_1",
            "current_period_end": PERIOD_END,
            "product_key": "esg-pack",
        }

    def fake_verify(payload, signature_header):
        return json.loads(payload)

    monkeypatch.setattr(app_mod.stripe_gateway, "create_checkout_session", fake_checkout)
    monkeypatch.setattr(app_mod.stripe_gateway, "retrieve_subscription", fake_retrieve_subscription)
    monkeypatch.setattr(app_mod.stripe_gateway, "verify_webhook", fake_verify)

    await db_mod.init_db()
    async with AsyncClient(
        transport=ASGITransport(app=app_mod.app), base_url="http://store"
    ) as http:
        http.public_key = public_b64  # type: ignore[attr-defined]
        yield http


async def publish_and_buy(client) -> None:
    res = await client.put(
        "/admin/products/esg-pack",
        json={
            "name": "ESG Pack",
            "description": "ESG metamodel content",
            "stripe_price_id": "price_123",
            "display_price": "990 EUR / year",
        },
        headers=ADMIN,
    )
    assert res.status_code == 200, res.text
    res = await client.post(
        "/admin/releases",
        files={"file": ("esg-pack-1.0.0.teax", build_teax(), "application/zip")},
        headers=ADMIN,
    )
    assert res.status_code == 200, res.text

    # Checkout + webhook (as Stripe would deliver it)
    res = await client.post("/checkout", json={"product_key": "esg-pack", "email": "a@acme.io"})
    assert res.status_code == 200 and res.json()["checkout_url"].startswith("https://")
    event = {
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": "cs_test_1",
                "customer": "cus_test_1",
                "customer_details": {"email": "a@acme.io"},
                "subscription": "sub_test_1",
                "metadata": {"product_key": "esg-pack"},
            }
        },
    }
    res = await client.post("/stripe/webhook", content=json.dumps(event).encode())
    assert res.status_code == 200


async def get_code(client) -> str:
    res = await client.get("/success", params={"session_id": "cs_test_1"})
    assert res.status_code == 200
    html = res.text
    start = html.index("<code>") + len("<code>")
    return html[start : html.index("</code>")]


class TestStoreFlow:
    async def test_catalog_lists_published_products(self, client):
        await publish_and_buy(client)
        res = await client.get("/catalog")
        assert res.status_code == 200
        [item] = res.json()
        assert item["key"] == "esg-pack"
        assert item["latest_version"] == "1.0.0"
        assert item["display_price"] == "990 EUR / year"
        assert "entitled" not in item  # public catalog carries no account info

    async def test_full_purchase_to_license_flow(self, client):
        await publish_and_buy(client)
        code = await get_code(client)

        # Redeem is one-time
        res = await client.post("/redeem", json={"code": code})
        assert res.status_code == 200
        token = res.json()["account_token"]
        assert res.json()["licensee"] == "a@acme.io"
        res = await client.post("/redeem", json={"code": code})
        assert res.status_code == 400

        auth = {"Authorization": f"Bearer {token}"}

        # License verifies with the same Ed25519 math the core uses
        res = await client.get("/account/license", headers=auth)
        assert res.status_code == 200
        envelope = json.loads(res.json()["text"])
        assert envelope["schema"] == "turboea-license/1"
        assert envelope["key_id"] == "store-1"
        payload = base64.b64decode(envelope["payload"])
        public = Ed25519PublicKey.from_public_bytes(base64.b64decode(client.public_key))
        public.verify(base64.b64decode(envelope["signature"]), payload)  # raises if invalid
        doc = json.loads(payload)
        assert doc["licensee"] == "a@acme.io"
        [ent] = doc["entitlements"]
        assert ent["extension_key"] == "esg-pack"
        assert ent["expires_at"].startswith(str(PERIOD_END.year))

        # Entitled catalog + bundle download
        res = await client.get("/account/catalog", headers=auth)
        assert res.json()[0]["entitled"] is True
        res = await client.get(
            "/account/bundles/esg-pack", params={"core_version": "1.70.0"}, headers=auth
        )
        assert res.status_code == 200
        assert res.headers["X-Bundle-Version"] == "1.0.0"
        assert hashlib.sha256(res.content).hexdigest() == res.headers["X-Bundle-Sha256"]

    async def test_incompatible_core_gets_404(self, client):
        await publish_and_buy(client)
        code = await get_code(client)
        token = (await client.post("/redeem", json={"code": code})).json()["account_token"]
        res = await client.get(
            "/account/bundles/esg-pack",
            params={"core_version": "1.10.0"},  # below core.min
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 404

    async def test_cancellation_drops_entitlement_from_next_license(self, client):
        await publish_and_buy(client)
        code = await get_code(client)
        token = (await client.post("/redeem", json={"code": code})).json()["account_token"]
        auth = {"Authorization": f"Bearer {token}"}

        event = {
            "type": "customer.subscription.deleted",
            "data": {
                "object": {
                    "id": "sub_test_1",
                    "customer": "cus_test_1",
                    "status": "canceled",
                    "current_period_end": int(PERIOD_END.timestamp()),
                    "metadata": {"product_key": "esg-pack"},
                }
            },
        }
        res = await client.post("/stripe/webhook", content=json.dumps(event).encode())
        assert res.status_code == 200

        doc = json.loads(
            base64.b64decode(
                json.loads((await client.get("/account/license", headers=auth)).json()["text"])[
                    "payload"
                ]
            )
        )
        assert doc["entitlements"] == []
        # Bundle download refused once the entitlement is gone
        res = await client.get("/account/bundles/esg-pack", headers=auth)
        assert res.status_code == 403

    async def test_account_endpoints_require_token(self, client):
        assert (await client.get("/account/license")).status_code == 401
        assert (
            await client.get("/account/license", headers={"Authorization": "Bearer nope"})
        ).status_code == 401

    async def test_admin_endpoints_require_admin_token(self, client):
        res = await client.put(
            "/admin/products/x",
            json={"name": "X", "stripe_price_id": "price_x"},
            headers={"Authorization": "Bearer wrong"},
        )
        assert res.status_code == 401
        res = await client.post(
            "/admin/releases", files={"file": ("x.teax", b"zip", "application/zip")}
        )
        assert res.status_code == 401

    async def test_second_purchase_reuses_connection(self, client):
        """A connected customer buying another product needs no new code."""
        await publish_and_buy(client)
        code = await get_code(client)
        token = (await client.post("/redeem", json={"code": code})).json()["account_token"]

        await client.put(
            "/admin/products/sap-sync",
            json={"name": "SAP Sync", "stripe_price_id": "price_456"},
            headers=ADMIN,
        )
        event = {
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": "cs_test_2",
                    "customer": "cus_test_1",
                    "customer_details": {"email": "a@acme.io"},
                    "subscription": "sub_test_2",
                    "metadata": {"product_key": "sap-sync"},
                }
            },
        }
        # retrieve_subscription mock always answers esg-pack; override product_key
        # via the session metadata path by mocking a metadata-less subscription.
        import turbo_ea_store.app as app_mod

        def retrieve_no_meta(sub_id):
            return {
                "id": sub_id,
                "status": "active",
                "customer": "cus_test_1",
                "current_period_end": PERIOD_END,
                "product_key": "",
            }

        original = app_mod.stripe_gateway.retrieve_subscription
        app_mod.stripe_gateway.retrieve_subscription = retrieve_no_meta
        try:
            res = await client.post("/stripe/webhook", content=json.dumps(event).encode())
            assert res.status_code == 200
        finally:
            app_mod.stripe_gateway.retrieve_subscription = original

        # No new redeem code for the second session — already connected
        res = await client.get("/success", params={"session_id": "cs_test_2"})
        assert "refresh" not in res.headers.get("refresh", "")

        doc = json.loads(
            base64.b64decode(
                json.loads(
                    (
                        await client.get(
                            "/account/license", headers={"Authorization": f"Bearer {token}"}
                        )
                    ).json()["text"]
                )["payload"]
            )
        )
        keys = {e["extension_key"] for e in doc["entitlements"]}
        assert keys == {"esg-pack", "sap-sync"}
