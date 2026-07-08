"""API tests for the online-store connection (redeem, catalog, install, refresh).

The store's HTTP surface is mocked at the ``store_client`` function level —
these tests cover the core's behaviour: token storage (encrypted), license
application through the normal verification path, the download→verify→preview
pipeline reuse, and route precedence over ``/admin/extensions/{key}``.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.api.v1 import extensions as ext_api
from app.config import settings
from app.models.app_settings import AppSettings
from app.models.extension import ExtensionInstall
from app.services.extensions import installer as ext_installer
from app.services.extensions import store_client
from app.services.extensions.registry import extension_registry
from tests.api.test_extensions_api import CONTENT_PACK, make_license_text
from tests.conftest import auth_headers, create_role, create_user
from tests.teax_helpers import build_teax, make_keypair

STORE_URL = "https://store.example.test"


@pytest.fixture(autouse=True)
def _reset_registry():
    extension_registry.clear()
    yield
    extension_registry.clear()


@pytest.fixture
def vendor(monkeypatch, tmp_path):
    private, public_b64 = make_keypair()
    monkeypatch.setattr(settings, "ENVIRONMENT", "development")
    monkeypatch.setattr(settings, "EXTENSION_VENDOR_PUBLIC_KEY", public_b64)
    monkeypatch.setattr(ext_api, "_UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(ext_installer, "EXTENSIONS_DIR", tmp_path / "extensions")
    monkeypatch.setattr(ext_api, "_verify_and_preview_job", _noop_job)
    monkeypatch.setattr(ext_api, "_apply_job", _noop_job)
    return private


async def _noop_job(*args, **kwargs):
    return None


@pytest.fixture
def fake_store(monkeypatch, vendor):
    """Mock the store's HTTP surface: one entitled product 'sample-ext'."""
    expires = (datetime.now(timezone.utc) + timedelta(days=365)).strftime("%Y-%m-%dT%H:%M:%SZ")
    state = {
        "license_text": make_license_text(vendor, extension_key="sample-ext", expires_at=expires),
        "bundle": build_teax(
            vendor, files={"content/pack.json": json.dumps(CONTENT_PACK).encode()}
        ),
        "redeemed_codes": [],
    }

    async def fake_redeem(url, code):
        state["redeemed_codes"].append((url, code))
        if code != "GOOD-CODE-1234":
            raise store_client.StoreClientError("Store redeem failed (400): Invalid code")
        return {"account_token": "tok_secret_123", "licensee": "ACME Corp"}

    async def fake_fetch_license(url, token):
        assert token == "tok_secret_123"
        return state["license_text"]

    async def fake_fetch_catalog(url, token):
        return [
            {
                "key": "sample-ext",
                "name": "Sample Extension",
                "display_price": "990 EUR / year",
                "latest_version": "1.0.0",
                "entitled": True,
            },
            {"key": "other-ext", "name": "Other", "display_price": "", "entitled": False},
        ]

    async def fake_download(url, token, extension_key, core_version):
        if extension_key != "sample-ext":
            raise store_client.StoreClientError(
                "Store bundle download failed (403): No entitlement"
            )
        return state["bundle"]

    monkeypatch.setattr(store_client, "redeem_code", fake_redeem)
    monkeypatch.setattr(store_client, "fetch_license", fake_fetch_license)
    monkeypatch.setattr(store_client, "fetch_catalog", fake_fetch_catalog)
    monkeypatch.setattr(store_client, "download_bundle", fake_download)
    return state


async def make_admin(db):
    await create_role(db, key="admin")
    return await create_user(db, role="admin")


async def connect(client, db, admin):
    res = await client.post(
        "/api/v1/admin/extensions/store/redeem",
        json={"url": STORE_URL, "code": "GOOD-CODE-1234"},
        headers=auth_headers(admin),
    )
    assert res.status_code == 200, res.text
    return res


class TestStoreConnection:
    async def test_redeem_connects_and_applies_license(self, client, db, fake_store):
        admin = await make_admin(db)
        res = await connect(client, db, admin)
        assert res.json()["licensee"] == "ACME Corp"

        # Status shows connected; token stored encrypted, never in plaintext
        res = await client.get("/api/v1/admin/extensions/store", headers=auth_headers(admin))
        assert res.json() == {"connected": True, "url": STORE_URL}
        row = (
            await db.execute(select(AppSettings).where(AppSettings.id == "default"))
        ).scalar_one()
        stored = row.general_settings["extensionStore"]["accountToken"]
        assert stored.startswith("enc:") and "tok_secret_123" not in stored

        # License is active — the manual license endpoint sees it
        res = await client.get("/api/v1/admin/extensions/license", headers=auth_headers(admin))
        assert res.status_code == 200
        assert res.json()["entitlements"][0]["extension_key"] == "sample-ext"

    async def test_bad_code_is_502_and_stays_disconnected(self, client, db, fake_store):
        admin = await make_admin(db)
        res = await client.post(
            "/api/v1/admin/extensions/store/redeem",
            json={"url": STORE_URL, "code": "WRONG"},
            headers=auth_headers(admin),
        )
        assert res.status_code == 502
        assert "Invalid code" in res.json()["detail"]
        res = await client.get("/api/v1/admin/extensions/store", headers=auth_headers(admin))
        assert res.json()["connected"] is False

    async def test_non_http_url_rejected(self, client, db, fake_store):
        admin = await make_admin(db)
        res = await client.post(
            "/api/v1/admin/extensions/store/redeem",
            json={"url": "ftp://weird", "code": "GOOD-CODE-1234"},
            headers=auth_headers(admin),
        )
        assert res.status_code == 400

    async def test_refresh_requires_connection(self, client, db, fake_store):
        admin = await make_admin(db)
        res = await client.post(
            "/api/v1/admin/extensions/store/refresh-license", headers=auth_headers(admin)
        )
        assert res.status_code == 400

    async def test_refresh_applies_new_license(self, client, db, fake_store, vendor):
        admin = await make_admin(db)
        await connect(client, db, admin)
        # Store now issues a license that also covers other-ext
        fake_store["license_text"] = make_license_text(vendor, extension_key="other-ext")
        res = await client.post(
            "/api/v1/admin/extensions/store/refresh-license", headers=auth_headers(admin)
        )
        assert res.status_code == 200
        assert res.json()["entitlements"][0]["extension_key"] == "other-ext"

    async def test_disconnect_is_not_captured_by_uninstall_route(self, client, db, fake_store):
        """DELETE /admin/extensions/store must hit the store router, not
        the parametrized DELETE /admin/extensions/{key} uninstall."""
        admin = await make_admin(db)
        await connect(client, db, admin)
        res = await client.delete("/api/v1/admin/extensions/store", headers=auth_headers(admin))
        assert res.status_code == 204  # uninstall would answer 200/404 with a body
        res = await client.get("/api/v1/admin/extensions/store", headers=auth_headers(admin))
        assert res.json()["connected"] is False
        # License survives the disconnect (offline continuity)
        res = await client.get("/api/v1/admin/extensions/license", headers=auth_headers(admin))
        assert res.status_code == 200

    async def test_member_cannot_touch_store_routes(self, client, db, fake_store):
        await create_role(db, key="member", permissions={"inventory.view": True})
        member = await create_user(db, role="member")
        res = await client.get("/api/v1/admin/extensions/store", headers=auth_headers(member))
        assert res.status_code == 403


class TestStoreCatalogAndInstall:
    async def test_catalog_is_annotated_with_install_state(self, client, db, fake_store):
        admin = await make_admin(db)
        await connect(client, db, admin)
        res = await client.get(
            "/api/v1/admin/extensions/store/catalog", headers=auth_headers(admin)
        )
        assert res.status_code == 200
        items = {i["key"]: i for i in res.json()}
        assert items["sample-ext"]["entitled"] is True
        assert items["sample-ext"]["installed"] is False

    async def test_install_from_store_reuses_upload_pipeline(self, client, db, fake_store):
        admin = await make_admin(db)
        await connect(client, db, admin)
        res = await client.post(
            "/api/v1/admin/extensions/store/install",
            json={"extension_key": "sample-ext"},
            headers=auth_headers(admin),
        )
        assert res.status_code == 202, res.text
        install_id = res.json()["id"]
        install = (
            await db.execute(select(ExtensionInstall).where(ExtensionInstall.id == install_id))
        ).scalar_one()
        # Drive the (neutered) background step inline, as the upload tests do
        await ext_api.run_verify_and_preview(db, install, admin)
        assert install.status == "previewed"
        assert install.extension_key == "sample-ext"
        assert install.diff["totals"]["created"] == 1

        # Apply completes the normal lifecycle
        res = await client.post(
            f"/api/v1/admin/extensions/install/{install.id}/apply", headers=auth_headers(admin)
        )
        assert res.status_code == 202
        await ext_api.run_apply(db, install, admin)
        assert install.status == "installed"

        # Catalog now reports it installed
        res = await client.get(
            "/api/v1/admin/extensions/store/catalog", headers=auth_headers(admin)
        )
        items = {i["key"]: i for i in res.json()}
        assert items["sample-ext"]["installed"] is True
        assert items["sample-ext"]["installed_version"] == "1.0.0"

    async def test_install_unentitled_is_502_with_store_detail(self, client, db, fake_store):
        admin = await make_admin(db)
        await connect(client, db, admin)
        res = await client.post(
            "/api/v1/admin/extensions/store/install",
            json={"extension_key": "other-ext"},
            headers=auth_headers(admin),
        )
        assert res.status_code == 502
        assert "No entitlement" in res.json()["detail"]
