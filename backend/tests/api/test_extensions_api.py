"""API tests for the Extension Store (license, bundle install lifecycle, RBAC)."""

from __future__ import annotations

import base64
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select

from app.api.v1 import extensions as ext_api
from app.config import settings
from app.models.card_type import CardType
from app.models.extension import Extension, ExtensionInstall
from app.services.extensions import installer as ext_installer
from app.services.extensions.registry import extension_registry
from tests.conftest import auth_headers, create_role, create_user
from tests.teax_helpers import build_teax, make_keypair, trust_test_key

EXPIRES = (datetime.now(timezone.utc) + timedelta(days=365)).strftime("%Y-%m-%dT%H:%M:%SZ")

CONTENT_PACK = {
    "CardTypes": [
        {
            "key": "EsgMetric",
            "label": "ESG Metric",
            "description": "Extension-provided type",
            "icon": "eco",
            "color": "#0f7e11",
            "category": "Business Architecture",
            "has_hierarchy": False,
            "has_successors": False,
            "subtypes": [],
            "fields_schema": [],
            "stakeholder_roles": [],
            "section_config": {},
            "built_in": False,
            "is_hidden": False,
            "sort_order": 90,
            "translations": {},
        }
    ]
}


@pytest.fixture(autouse=True)
def _reset_registry():
    extension_registry.clear()
    yield
    extension_registry.clear()


@pytest.fixture
def vendor(monkeypatch, tmp_path):
    """Trusted test keypair + tmp dirs for uploads and installed extensions."""
    private, public_b64 = make_keypair()
    monkeypatch.setattr(settings, "ENVIRONMENT", "development")
    trust_test_key(monkeypatch, public_b64)
    monkeypatch.setattr(ext_api, "_UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(ext_installer, "EXTENSIONS_DIR", tmp_path / "extensions")
    # Background jobs open their own session outside the test savepoint —
    # neuter them; tests drive run_verify_and_preview / run_apply directly.
    monkeypatch.setattr(ext_api, "_verify_and_preview_job", _noop_job)
    monkeypatch.setattr(ext_api, "_apply_job", _noop_job)
    return private


async def _noop_job(*args, **kwargs):
    return None


def make_license_text(
    private, *, extension_key="sample-ext", expires_at=EXPIRES, renewal_key="", instance_id=""
) -> str:
    payload = {
        "licensee": "ACME Corp",
        "customer_id": "cus_1",
        "issued_at": "2026-01-01T00:00:00Z",
        "grace_days": 30,
        "entitlements": [{"extension_key": extension_key, "expires_at": expires_at}],
    }
    if renewal_key:
        payload["renewal_key"] = renewal_key
    if instance_id:
        payload["instance_id"] = instance_id
    payload_bytes = json.dumps(payload).encode()
    return json.dumps(
        {
            "schema": "turboea-license/1",
            "key_id": "vendor-1",
            "payload": base64.b64encode(payload_bytes).decode(),
            "signature": base64.b64encode(private.sign(payload_bytes)).decode(),
        }
    )


async def make_admin(db):
    await create_role(db, key="admin")
    return await create_user(db, role="admin")


async def make_member(db):
    await create_role(db, key="member", permissions={"inventory.view": True}, is_system=True)
    return await create_user(db, role="member")


async def upload_and_preview(client, db, admin, private, **teax_kwargs):
    """Upload a bundle then run the preview step inline (job is neutered)."""
    files = teax_kwargs.pop("files", {"content/pack.json": json.dumps(CONTENT_PACK).encode()})
    raw = build_teax(private, files=files, **teax_kwargs)
    res = await client.post(
        "/api/v1/admin/extensions/install",
        files={"file": ("sample.teax", raw, "application/zip")},
        headers=auth_headers(admin),
    )
    assert res.status_code == 202, res.text
    install_id = res.json()["id"]
    install = (
        await db.execute(select(ExtensionInstall).where(ExtensionInstall.id == install_id))
    ).scalar_one()
    await ext_api.run_verify_and_preview(db, install, admin)
    return install


class TestLicenseRoutes:
    async def test_put_and_get_license(self, client, db, vendor):
        admin = await make_admin(db)
        res = await client.put(
            "/api/v1/admin/extensions/license",
            json={"text": make_license_text(vendor)},
            headers=auth_headers(admin),
        )
        assert res.status_code == 200, res.text
        assert res.json()["licensee"] == "ACME Corp"

        res = await client.get("/api/v1/admin/extensions/license", headers=auth_headers(admin))
        assert res.status_code == 200
        body = res.json()
        assert body["entitlements"][0]["extension_key"] == "sample-ext"
        assert body["grace_days"] == 30

    async def test_reupload_supersedes(self, client, db, vendor):
        admin = await make_admin(db)
        for licensee_key in ("sample-ext", "other-ext"):
            res = await client.put(
                "/api/v1/admin/extensions/license",
                json={"text": make_license_text(vendor, extension_key=licensee_key)},
                headers=auth_headers(admin),
            )
            assert res.status_code == 200
        res = await client.get("/api/v1/admin/extensions/license", headers=auth_headers(admin))
        assert res.json()["entitlements"][0]["extension_key"] == "other-ext"

    async def test_tampered_license_rejected(self, client, db, vendor):
        admin = await make_admin(db)
        text = make_license_text(vendor).replace("ACME", "EVIL")
        # Tampering the envelope JSON changes the payload → 400
        forged = json.loads(make_license_text(vendor))
        forged["payload"] = base64.b64encode(
            json.dumps({"licensee": "Evil", "entitlements": []}).encode()
        ).decode()
        res = await client.put(
            "/api/v1/admin/extensions/license",
            json={"text": json.dumps(forged)},
            headers=auth_headers(admin),
        )
        assert res.status_code == 400
        assert "signature" in res.json()["detail"]
        assert text  # silence lints

    async def test_get_license_404_when_absent(self, client, db, vendor):
        admin = await make_admin(db)
        res = await client.get("/api/v1/admin/extensions/license", headers=auth_headers(admin))
        assert res.status_code == 404

    async def test_member_cannot_manage_license(self, client, db, vendor):
        member = await make_member(db)
        res = await client.put(
            "/api/v1/admin/extensions/license",
            json={"text": make_license_text(vendor)},
            headers=auth_headers(member),
        )
        assert res.status_code == 403

    async def test_delete_license_removes_it(self, client, db, vendor):
        admin = await make_admin(db)
        await client.put(
            "/api/v1/admin/extensions/license",
            json={"text": make_license_text(vendor)},
            headers=auth_headers(admin),
        )
        res = await client.delete("/api/v1/admin/extensions/license", headers=auth_headers(admin))
        assert res.status_code == 204
        # Gone from the summary and the in-memory registry.
        got = await client.get("/api/v1/admin/extensions/license", headers=auth_headers(admin))
        assert got.status_code == 404
        assert extension_registry.license is None

    async def test_delete_license_404_when_absent(self, client, db, vendor):
        admin = await make_admin(db)
        res = await client.delete("/api/v1/admin/extensions/license", headers=auth_headers(admin))
        assert res.status_code == 404

    async def test_member_cannot_remove_license(self, client, db, vendor):
        member = await make_member(db)
        res = await client.delete("/api/v1/admin/extensions/license", headers=auth_headers(member))
        assert res.status_code == 403


class TestInstallLifecycle:
    async def test_upload_verify_apply_flow(self, client, db, vendor):
        admin = await make_admin(db)
        # License first (apply requires a usable entitlement)
        await client.put(
            "/api/v1/admin/extensions/license",
            json={"text": make_license_text(vendor)},
            headers=auth_headers(admin),
        )

        install = await upload_and_preview(client, db, admin, vendor)
        assert install.status == "previewed"
        assert install.extension_key == "sample-ext"
        totals = install.diff["totals"]
        assert totals["created"] == 1  # the EsgMetric card type, dry-run

        # Dry-run must not have persisted the card type
        ct = (
            await db.execute(select(CardType).where(CardType.key == "EsgMetric"))
        ).scalar_one_or_none()
        assert ct is None

        res = await client.post(
            f"/api/v1/admin/extensions/install/{install.id}/apply",
            headers=auth_headers(admin),
        )
        assert res.status_code == 202, res.text
        await ext_api.run_apply(db, install, admin)
        assert install.status == "installed"

        ct = (
            await db.execute(select(CardType).where(CardType.key == "EsgMetric"))
        ).scalar_one_or_none()
        assert ct is not None and ct.label == "ESG Metric"

        row = (
            await db.execute(select(Extension).where(Extension.key == "sample-ext"))
        ).scalar_one()
        assert row.status == "installed"  # content-only → no restart needed
        assert row.enabled is True

        # Extension list shows it with an active entitlement
        res = await client.get("/api/v1/admin/extensions", headers=auth_headers(admin))
        assert res.status_code == 200
        listed = res.json()
        assert listed[0]["key"] == "sample-ext"
        assert listed[0]["entitlement"]["state"] == "active"

    async def test_post_content_failure_leaves_content_governed(
        self, client, db, vendor, monkeypatch
    ):
        """A failure after content commits must not orphan ungoverned metamodel data.

        The extension row is committed before the content pack, so even if a
        later step (field contributions) blows up, the committed card type is
        governed by an existing extension row rather than stranded.
        """
        admin = await make_admin(db)
        await client.put(
            "/api/v1/admin/extensions/license",
            json={"text": make_license_text(vendor)},
            headers=auth_headers(admin),
        )
        install = await upload_and_preview(client, db, admin, vendor)

        async def _boom(*args, **kwargs):
            raise RuntimeError("contribution step failed")

        monkeypatch.setattr(ext_api, "apply_field_contributions", _boom)
        install_id = install.id
        await ext_api.run_apply(db, install, admin)

        refreshed = (
            await db.execute(select(ExtensionInstall).where(ExtensionInstall.id == install_id))
        ).scalar_one()
        assert refreshed.status == "failed"
        # The extension row exists — the committed card type is governed by it.
        row = (
            await db.execute(select(Extension).where(Extension.key == "sample-ext"))
        ).scalar_one_or_none()
        assert row is not None
        ct = (
            await db.execute(select(CardType).where(CardType.key == "EsgMetric"))
        ).scalar_one_or_none()
        assert ct is not None

    async def test_apply_without_entitlement_is_403(self, client, db, vendor):
        admin = await make_admin(db)
        install = await upload_and_preview(client, db, admin, vendor)
        res = await client.post(
            f"/api/v1/admin/extensions/install/{install.id}/apply",
            headers=auth_headers(admin),
        )
        assert res.status_code == 403
        assert "entitlement" in res.json()["detail"]

    async def test_tampered_bundle_fails_preview(self, client, db, vendor):
        admin = await make_admin(db)
        install = await upload_and_preview(
            client, db, admin, vendor, tamper_manifest_after_signing=True
        )
        assert install.status == "failed"
        assert "signature" in install.error_message

    async def test_incompatible_core_fails_preview(self, client, db, vendor):
        admin = await make_admin(db)
        install = await upload_and_preview(client, db, admin, vendor, core_min="99.0.0")
        assert install.status == "failed"
        assert "99.0.0" in install.error_message

    async def test_member_cannot_upload(self, client, db, vendor):
        member = await make_member(db)
        res = await client.post(
            "/api/v1/admin/extensions/install",
            files={"file": ("sample.teax", b"zip", "application/zip")},
            headers=auth_headers(member),
        )
        assert res.status_code == 403

    async def test_reapply_is_idempotent(self, client, db, vendor):
        admin = await make_admin(db)
        await client.put(
            "/api/v1/admin/extensions/license",
            json={"text": make_license_text(vendor)},
            headers=auth_headers(admin),
        )
        install = await upload_and_preview(client, db, admin, vendor)
        await ext_api.run_apply(db, install, admin)
        assert install.status == "installed"

        # Second upload of the same bundle: preview reports all-skip
        install2 = await upload_and_preview(client, db, admin, vendor)
        assert install2.status == "previewed"
        totals = install2.diff["totals"]
        assert totals["created"] == 0
        assert totals["skipped"] >= 1

    async def test_frontend_only_install_needs_no_restart(self, client, db, vendor):
        """A UI-only extension is live immediately: `installed` status and
        listed by /extensions/ui-manifest without a backend restart. Guard —
        the Store's buy-and-install flow must not end in `needs_restart` for
        extensions that carry no backend code."""
        admin = await make_admin(db)
        await client.put(
            "/api/v1/admin/extensions/license",
            json={"text": make_license_text(vendor)},
            headers=auth_headers(admin),
        )
        install = await upload_and_preview(
            client,
            db,
            admin,
            vendor,
            files={"frontend/entry.js": b"window.TurboEA.register('sample-ext', {});"},
            capabilities=["frontend"],
            frontend={"entry": "frontend/entry.js"},
        )
        await ext_api.run_apply(db, install, admin)
        assert install.status == "installed"

        row = (
            await db.execute(select(Extension).where(Extension.key == "sample-ext"))
        ).scalar_one()
        assert row.status == "installed"  # NOT needs_restart

        res = await client.get("/api/v1/extensions/ui-manifest", headers=auth_headers(admin))
        assert res.status_code == 200
        entries = res.json()
        assert [e["key"] for e in entries] == ["sample-ext"]
        assert entries[0]["entry"].endswith("/ext-assets/sample-ext/1.0.0/entry.js")

    async def test_backend_install_still_needs_restart(self, client, db, vendor):
        """Backend code loads at import time — installing it must keep the
        needs_restart gate (and stay off the ui-manifest until reboot)."""
        from tests.teax_helpers import build_wheel

        admin = await make_admin(db)
        await client.put(
            "/api/v1/admin/extensions/license",
            json={"text": make_license_text(vendor)},
            headers=auth_headers(admin),
        )
        wheel_rel = "wheels/turbo_ext_sample_ext-1.0.0-py3-none-any.whl"
        wheel = build_wheel("turbo_ext_sample_ext", "extension = None\n")
        install = await upload_and_preview(
            client,
            db,
            admin,
            vendor,
            files={
                wheel_rel: wheel,
                "frontend/entry.js": b"window.TurboEA.register('sample-ext', {});",
            },
            capabilities=["backend", "frontend"],
            backend={"entrypoint": "turbo_ext_sample_ext:extension", "wheels": [wheel_rel]},
            frontend={"entry": "frontend/entry.js"},
        )
        await ext_api.run_apply(db, install, admin)

        row = (
            await db.execute(select(Extension).where(Extension.key == "sample-ext"))
        ).scalar_one()
        assert row.status == "needs_restart"

        res = await client.get("/api/v1/extensions/ui-manifest", headers=auth_headers(admin))
        assert res.json() == []


class TestEnableDisableUninstall:
    async def _install(self, client, db, admin, vendor):
        await client.put(
            "/api/v1/admin/extensions/license",
            json={"text": make_license_text(vendor)},
            headers=auth_headers(admin),
        )
        install = await upload_and_preview(client, db, admin, vendor)
        await ext_api.run_apply(db, install, admin)

    async def test_disable_and_enable(self, client, db, vendor):
        admin = await make_admin(db)
        await self._install(client, db, admin, vendor)
        res = await client.put(
            "/api/v1/admin/extensions/sample-ext/enabled",
            json={"enabled": False},
            headers=auth_headers(admin),
        )
        assert res.status_code == 200
        assert res.json()["status"] == "disabled"
        assert extension_registry.get("sample-ext").enabled is False

        res = await client.put(
            "/api/v1/admin/extensions/sample-ext/enabled",
            json={"enabled": True},
            headers=auth_headers(admin),
        )
        assert res.json()["status"] == "installed"

    async def test_uninstall_keeps_data_but_hides_pack_types(self, client, db, vendor):
        admin = await make_admin(db)
        await self._install(client, db, admin, vendor)
        res = await client.delete(
            "/api/v1/admin/extensions/sample-ext", headers=auth_headers(admin)
        )
        assert res.status_code == 200
        assert res.json()["status"] == "removed"
        # Content-pack data survives the uninstall — but the pack's card
        # type is soft-hidden so the metamodel visibly reflects the removal.
        ct = (
            await db.execute(select(CardType).where(CardType.key == "EsgMetric"))
        ).scalar_one_or_none()
        assert ct is not None
        assert ct.is_hidden is True
        # And the list no longer shows the extension
        res = await client.get("/api/v1/admin/extensions", headers=auth_headers(admin))
        assert res.json() == []

    async def test_disable_hides_pack_types_and_enable_restores_them(self, client, db, vendor):
        admin = await make_admin(db)
        await self._install(client, db, admin, vendor)

        res = await client.put(
            "/api/v1/admin/extensions/sample-ext/enabled",
            json={"enabled": False},
            headers=auth_headers(admin),
        )
        assert res.status_code == 200
        ct = (await db.execute(select(CardType).where(CardType.key == "EsgMetric"))).scalar_one()
        await db.refresh(ct)
        assert ct.is_hidden is True

        res = await client.put(
            "/api/v1/admin/extensions/sample-ext/enabled",
            json={"enabled": True},
            headers=auth_headers(admin),
        )
        assert res.status_code == 200
        await db.refresh(ct)
        assert ct.is_hidden is False

    async def test_reinstall_after_uninstall_unhides_pack_types(self, client, db, vendor):
        admin = await make_admin(db)
        await self._install(client, db, admin, vendor)
        await client.delete("/api/v1/admin/extensions/sample-ext", headers=auth_headers(admin))
        ct = (await db.execute(select(CardType).where(CardType.key == "EsgMetric"))).scalar_one()
        await db.refresh(ct)
        assert ct.is_hidden is True

        # Reinstall the same bundle — the pack's types come back.
        install = await upload_and_preview(client, db, admin, vendor)
        await ext_api.run_apply(db, install, admin)
        await db.refresh(ct)
        assert ct.is_hidden is False

    async def test_unknown_extension_404(self, client, db, vendor):
        admin = await make_admin(db)
        res = await client.delete("/api/v1/admin/extensions/nope", headers=auth_headers(admin))
        assert res.status_code == 404


class TestStatusEndpoint:
    async def test_status_lists_enabled_extensions_for_members(self, client, db, vendor):
        admin = await make_admin(db)
        member = await make_member(db)
        await client.put(
            "/api/v1/admin/extensions/license",
            json={"text": make_license_text(vendor)},
            headers=auth_headers(admin),
        )
        install = await upload_and_preview(client, db, admin, vendor)
        await ext_api.run_apply(db, install, admin)

        res = await client.get("/api/v1/extensions/status", headers=auth_headers(member))
        assert res.status_code == 200
        assert res.json() == [
            {"key": "sample-ext", "version": "1.0.0", "entitlement_state": "active", "grants": []}
        ]

    async def test_status_requires_auth(self, client, db, vendor):
        res = await client.get("/api/v1/extensions/status")
        assert res.status_code == 401


# ---------------------------------------------------------------------------
# Store (catalogue proxy + install-from-store)
# ---------------------------------------------------------------------------

STORE_URL = "https://extensions.example.com"


def mock_store(
    monkeypatch,
    catalog: dict | None,
    bundles: dict[str, bytes] | None = None,
    claim: dict | None = None,
    renew: dict | None = None,
):
    """Point EXTENSION_STORE_URL at a MockTransport-backed fake static host.

    ``catalog=None`` simulates an unreachable host (connection error).
    ``claim`` / ``renew`` are the JSON bodies of /account/claim and
    /account/renew.
    """
    monkeypatch.setattr(settings, "EXTENSION_STORE_URL", STORE_URL)

    def handler(request: httpx.Request) -> httpx.Response:
        if catalog is None:
            raise httpx.ConnectError("boom", request=request)
        if request.url.path == "/catalog.json":
            return httpx.Response(200, json=catalog)
        if request.url.path == "/account/claim":
            return httpx.Response(200, json=claim or {"status": "pending"})
        if request.url.path == "/account/renew":
            if renew is None:
                return httpx.Response(403, json={"error": "invalid renewal credential"})
            return httpx.Response(200, json=renew)
        data = (bundles or {}).get(request.url.path)
        if data is not None:
            return httpx.Response(200, content=data)
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient

    def factory(**kwargs):
        kwargs.pop("timeout", None)
        return real_client(transport=transport, **kwargs)

    monkeypatch.setattr(ext_api.httpx, "AsyncClient", factory)


def catalog_payload(**overrides) -> dict:
    item = {
        "key": "sample-ext",
        "name": "Sample Extension",
        "description": "Adds sample things",
        "price": "990 EUR / year",
        "payment_link": "https://buy.stripe.test/pl_1",
        "version": "1.0.0",
        "bundle_url": "/bundles/sample-ext-1.0.0.teax",
    }
    item.update(overrides)
    return {"extensions": [item]}


class TestStoreCatalog:
    async def test_unconfigured_store(self, client, db, vendor, monkeypatch):
        admin = await make_admin(db)
        monkeypatch.setattr(settings, "EXTENSION_STORE_URL", "")
        res = await client.get(
            "/api/v1/admin/extensions/store/catalog", headers=auth_headers(admin)
        )
        assert res.status_code == 200
        assert res.json() == {
            "configured": False,
            "reachable": False,
            "store_url": "",
            "items": [],
        }

    async def test_unreachable_store_degrades_gracefully(self, client, db, vendor, monkeypatch):
        admin = await make_admin(db)
        mock_store(monkeypatch, catalog=None)
        res = await client.get(
            "/api/v1/admin/extensions/store/catalog", headers=auth_headers(admin)
        )
        assert res.status_code == 200
        body = res.json()
        assert body["configured"] is True and body["reachable"] is False

    async def test_catalog_annotated_with_license_and_install_state(
        self, client, db, vendor, monkeypatch
    ):
        admin = await make_admin(db)
        # Entitle sample-ext, install v0.9.0, and publish v1.0.0 in the catalogue.
        await client.put(
            "/api/v1/admin/extensions/license",
            json={"text": make_license_text(vendor)},
            headers=auth_headers(admin),
        )
        install = await upload_and_preview(client, db, admin, vendor, version="0.9.0")
        await ext_api.run_apply(db, install, admin)
        mock_store(
            monkeypatch,
            catalog=catalog_payload(demo_url="https://youtu.be/demo"),
        )

        res = await client.get(
            "/api/v1/admin/extensions/store/catalog", headers=auth_headers(admin)
        )
        assert res.status_code == 200
        body = res.json()
        assert body["configured"] and body["reachable"]
        (item,) = body["items"]
        assert item["key"] == "sample-ext"
        assert item["price"] == "990 EUR / year"
        assert item["payment_link"] == "https://buy.stripe.test/pl_1"
        assert item["demo_url"] == "https://youtu.be/demo"
        assert item["installed_version"] == "0.9.0"
        assert item["update_available"] is True
        assert item["entitlement_state"] == "active"

    async def test_unlicensed_uninstalled_item(self, client, db, vendor, monkeypatch):
        admin = await make_admin(db)
        mock_store(monkeypatch, catalog=catalog_payload(key="other-ext", name="Other"))
        res = await client.get(
            "/api/v1/admin/extensions/store/catalog", headers=auth_headers(admin)
        )
        (item,) = res.json()["items"]
        assert item["installed_version"] is None
        assert item["update_available"] is False
        assert item["entitlement_state"] == "unlicensed"

    async def test_member_cannot_read_catalog(self, client, db, vendor, monkeypatch):
        member = await make_member(db)
        mock_store(monkeypatch, catalog=catalog_payload())
        res = await client.get(
            "/api/v1/admin/extensions/store/catalog", headers=auth_headers(member)
        )
        assert res.status_code == 403


class TestStoreInstall:
    async def test_install_from_store_lands_in_upload_pipeline(
        self, client, db, vendor, monkeypatch
    ):
        admin = await make_admin(db)
        raw = build_teax(vendor, files={"content/pack.json": json.dumps(CONTENT_PACK).encode()})
        mock_store(
            monkeypatch,
            catalog=catalog_payload(),
            bundles={"/bundles/sample-ext-1.0.0.teax": raw},
        )
        res = await client.post(
            "/api/v1/admin/extensions/store/install",
            json={"key": "sample-ext"},
            headers=auth_headers(admin),
        )
        assert res.status_code == 202, res.text
        body = res.json()
        assert body["status"] == "verifying"
        assert body["filename"] == "sample-ext-1.0.0.teax"

        # The downloaded bytes verify + preview exactly like a manual upload.
        install = (
            await db.execute(select(ExtensionInstall).where(ExtensionInstall.id == body["id"]))
        ).scalar_one()
        await ext_api.run_verify_and_preview(db, install, admin)
        assert install.status == "previewed"
        assert install.extension_key == "sample-ext"

    async def test_off_origin_bundle_url_refused(self, client, db, vendor, monkeypatch):
        admin = await make_admin(db)
        mock_store(
            monkeypatch,
            catalog=catalog_payload(bundle_url="https://evil.example.net/x.teax"),
        )
        res = await client.post(
            "/api/v1/admin/extensions/store/install",
            json={"key": "sample-ext"},
            headers=auth_headers(admin),
        )
        assert res.status_code == 400
        assert "origin" in res.json()["detail"]

    async def test_unknown_key_404(self, client, db, vendor, monkeypatch):
        admin = await make_admin(db)
        mock_store(monkeypatch, catalog=catalog_payload())
        res = await client.post(
            "/api/v1/admin/extensions/store/install",
            json={"key": "nope"},
            headers=auth_headers(admin),
        )
        assert res.status_code == 404

    async def test_unconfigured_store_install_400(self, client, db, vendor, monkeypatch):
        admin = await make_admin(db)
        monkeypatch.setattr(settings, "EXTENSION_STORE_URL", "")
        res = await client.post(
            "/api/v1/admin/extensions/store/install",
            json={"key": "sample-ext"},
            headers=auth_headers(admin),
        )
        assert res.status_code == 400

    async def test_member_cannot_install_from_store(self, client, db, vendor, monkeypatch):
        member = await make_member(db)
        mock_store(monkeypatch, catalog=catalog_payload())
        res = await client.post(
            "/api/v1/admin/extensions/store/install",
            json={"key": "sample-ext"},
            headers=auth_headers(member),
        )
        assert res.status_code == 403


class TestUploadDirNotWritable:
    async def test_unwritable_upload_dir_returns_actionable_500(
        self, client, db, vendor, tmp_path, monkeypatch
    ):
        """A broken data volume must produce a diagnosable error, not a bare 500."""
        blocker = tmp_path / "blocked"
        blocker.write_text("a file where the upload dir should be")
        monkeypatch.setattr(ext_api, "_UPLOAD_DIR", blocker)

        admin = await make_admin(db)
        raw = build_teax(vendor, files={"content/pack.json": json.dumps(CONTENT_PACK).encode()})
        res = await client.post(
            "/api/v1/admin/extensions/install",
            files={"file": ("sample.teax", raw, "application/zip")},
            headers=auth_headers(admin),
        )
        assert res.status_code == 500
        assert "not writable" in res.json()["detail"] or "Cannot write" in res.json()["detail"]


class TestStoreClaimAndRefresh:
    async def test_claim_pending_until_checkout_completes(self, client, db, vendor, monkeypatch):
        admin = await make_admin(db)
        mock_store(monkeypatch, catalog=catalog_payload(), claim={"status": "pending"})
        res = await client.post(
            "/api/v1/admin/extensions/store/claim",
            json={"token": "tok_1234567890abcdef"},
            headers=auth_headers(admin),
        )
        assert res.status_code == 200
        assert res.json() == {"status": "pending", "license": None}
        # Nothing applied yet.
        res = await client.get("/api/v1/admin/extensions/license", headers=auth_headers(admin))
        assert res.status_code == 404

    async def test_claim_applies_license_when_checkout_found(self, client, db, vendor, monkeypatch):
        admin = await make_admin(db)
        text = make_license_text(vendor, renewal_key="rk_abcdefabcdefabcd")
        mock_store(
            monkeypatch,
            catalog=catalog_payload(),
            claim={"status": "applied", "license": text},
        )
        res = await client.post(
            "/api/v1/admin/extensions/store/claim",
            json={"token": "tok_1234567890abcdef"},
            headers=auth_headers(admin),
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["status"] == "applied"
        assert body["license"]["licensee"] == "ACME Corp"
        # The license is now the active one.
        res = await client.get("/api/v1/admin/extensions/license", headers=auth_headers(admin))
        assert res.status_code == 200

    async def test_claim_rejects_malformed_token(self, client, db, vendor, monkeypatch):
        admin = await make_admin(db)
        mock_store(monkeypatch, catalog=catalog_payload())
        res = await client.post(
            "/api/v1/admin/extensions/store/claim",
            json={"token": "short"},
            headers=auth_headers(admin),
        )
        assert res.status_code == 400

    async def test_claim_never_applies_a_foreign_signed_license(
        self, client, db, vendor, monkeypatch
    ):
        """A compromised store cannot push an untrusted license into the core."""
        admin = await make_admin(db)
        attacker, _ = make_keypair()
        forged = make_license_text(attacker)
        mock_store(
            monkeypatch,
            catalog=catalog_payload(),
            claim={"status": "applied", "license": forged},
        )
        res = await client.post(
            "/api/v1/admin/extensions/store/claim",
            json={"token": "tok_1234567890abcdef"},
            headers=auth_headers(admin),
        )
        assert res.status_code == 400
        assert "signature" in res.json()["detail"]

    async def test_refresh_applies_extended_license(self, client, db, vendor, monkeypatch):
        admin = await make_admin(db)
        near = (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
        far = (datetime.now(timezone.utc) + timedelta(days=370)).strftime("%Y-%m-%dT%H:%M:%SZ")
        # Active store license (has a renewal credential) close to expiry.
        await client.put(
            "/api/v1/admin/extensions/license",
            json={
                "text": make_license_text(
                    vendor, expires_at=near, renewal_key="rk_0123456789abcdef"
                )
            },
            headers=auth_headers(admin),
        )
        extended = make_license_text(vendor, expires_at=far, renewal_key="rk_0123456789abcdef")
        mock_store(monkeypatch, catalog=catalog_payload(), renew={"license": extended})

        res = await client.post(
            "/api/v1/admin/extensions/store/refresh-license", headers=auth_headers(admin)
        )
        assert res.status_code == 200
        assert res.json() == {"refreshed": True}
        res = await client.get("/api/v1/admin/extensions/license", headers=auth_headers(admin))
        assert res.json()["entitlements"][0]["expires_at"].startswith(far[:10])

    async def test_refresh_noop_for_manual_license(self, client, db, vendor, monkeypatch):
        admin = await make_admin(db)
        await client.put(
            "/api/v1/admin/extensions/license",
            json={"text": make_license_text(vendor)},  # no renewal_key
            headers=auth_headers(admin),
        )
        mock_store(monkeypatch, catalog=catalog_payload())
        res = await client.post(
            "/api/v1/admin/extensions/store/refresh-license", headers=auth_headers(admin)
        )
        assert res.status_code == 200
        assert res.json() == {"refreshed": False}


# ---------------------------------------------------------------------------
# Instance ID + license binding
# ---------------------------------------------------------------------------


class TestInstanceBinding:
    """Licenses are bound to the instance ID (TEA-XXXX-XXXX-XXXX)."""

    @pytest.fixture(autouse=True)
    def _instance(self):
        from app.services.extensions.instance_id import generate_instance_id, set_instance_id

        iid = generate_instance_id()
        set_instance_id(iid)
        yield iid
        set_instance_id(None)

    async def test_instance_endpoint_returns_id(self, client, db, vendor, _instance):
        admin = await make_admin(db)
        res = await client.get("/api/v1/admin/extensions/instance", headers=auth_headers(admin))
        assert res.status_code == 200
        assert res.json() == {"instance_id": _instance}

    async def test_matching_license_is_accepted(self, client, db, vendor, _instance):
        admin = await make_admin(db)
        res = await client.put(
            "/api/v1/admin/extensions/license",
            json={"text": make_license_text(vendor, instance_id=_instance)},
            headers=auth_headers(admin),
        )
        assert res.status_code == 200
        got = await client.get("/api/v1/admin/extensions/license", headers=auth_headers(admin))
        assert got.json()["problem"] is None

    async def test_mismatched_license_is_refused(self, client, db, vendor, _instance):
        from app.services.extensions.instance_id import generate_instance_id

        admin = await make_admin(db)
        other = generate_instance_id()
        res = await client.put(
            "/api/v1/admin/extensions/license",
            json={"text": make_license_text(vendor, instance_id=other)},
            headers=auth_headers(admin),
        )
        assert res.status_code == 400
        assert other in res.json()["detail"] and _instance in res.json()["detail"]

    async def test_unbound_license_refused_outside_development(
        self, client, db, vendor, _instance, monkeypatch
    ):
        admin = await make_admin(db)
        # In production the dev-key override is ignored, so trust the test key
        # via the baked-in map — the point here is binding, not provenance.
        import base64 as b64

        from cryptography.hazmat.primitives import serialization

        public_b64 = b64.b64encode(
            vendor.public_key().public_bytes(
                encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
            )
        ).decode()
        monkeypatch.setattr(
            "app.core.extension_signing.DEFAULT_VENDOR_PUBLIC_KEYS", {"vendor-1": public_b64}
        )
        monkeypatch.setattr(settings, "ENVIRONMENT", "production")
        res = await client.put(
            "/api/v1/admin/extensions/license",
            json={"text": make_license_text(vendor)},  # no instance_id
            headers=auth_headers(admin),
        )
        assert res.status_code == 400
        assert "instance" in res.json()["detail"].lower()

    async def test_stored_mismatch_soft_disables_with_problem(self, client, db, vendor, _instance):
        """A license applied before a re-install (new ID) stops being effective."""
        from app.services.extensions.instance_id import generate_instance_id, set_instance_id

        admin = await make_admin(db)
        await client.put(
            "/api/v1/admin/extensions/license",
            json={"text": make_license_text(vendor, instance_id=_instance)},
            headers=auth_headers(admin),
        )
        # Simulate the re-install: same DB row, different runtime instance ID.
        set_instance_id(generate_instance_id())
        await extension_registry.refresh_from_db(db)
        assert extension_registry.license is None
        assert extension_registry.license_problem is not None
        got = await client.get("/api/v1/admin/extensions/license", headers=auth_headers(admin))
        assert got.status_code == 200
        assert _instance in (got.json()["problem"] or "")
