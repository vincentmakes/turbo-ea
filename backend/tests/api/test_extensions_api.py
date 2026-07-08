"""API tests for the Extension Store (license, bundle install lifecycle, RBAC)."""

from __future__ import annotations

import base64
import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.api.v1 import extensions as ext_api
from app.config import settings
from app.models.card_type import CardType
from app.models.extension import Extension, ExtensionInstall
from app.services.extensions import installer as ext_installer
from app.services.extensions.registry import extension_registry
from tests.conftest import auth_headers, create_role, create_user
from tests.teax_helpers import build_teax, make_keypair

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
    monkeypatch.setattr(settings, "EXTENSION_VENDOR_PUBLIC_KEY", public_b64)
    monkeypatch.setattr(ext_api, "_UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(ext_installer, "EXTENSIONS_DIR", tmp_path / "extensions")
    # Background jobs open their own session outside the test savepoint —
    # neuter them; tests drive run_verify_and_preview / run_apply directly.
    monkeypatch.setattr(ext_api, "_verify_and_preview_job", _noop_job)
    monkeypatch.setattr(ext_api, "_apply_job", _noop_job)
    return private


async def _noop_job(*args, **kwargs):
    return None


def make_license_text(private, *, extension_key="sample-ext", expires_at=EXPIRES) -> str:
    payload = {
        "licensee": "ACME Corp",
        "customer_id": "cus_1",
        "issued_at": "2026-01-01T00:00:00Z",
        "grace_days": 30,
        "entitlements": [
            {"extension_key": extension_key, "plan": "enterprise", "expires_at": expires_at}
        ],
    }
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

    async def test_uninstall_keeps_data(self, client, db, vendor):
        admin = await make_admin(db)
        await self._install(client, db, admin, vendor)
        res = await client.delete(
            "/api/v1/admin/extensions/sample-ext", headers=auth_headers(admin)
        )
        assert res.status_code == 200
        assert res.json()["status"] == "removed"
        # Content-pack data survives the uninstall
        ct = (
            await db.execute(select(CardType).where(CardType.key == "EsgMetric"))
        ).scalar_one_or_none()
        assert ct is not None
        # And the list no longer shows the extension
        res = await client.get("/api/v1/admin/extensions", headers=auth_headers(admin))
        assert res.json() == []

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
            {"key": "sample-ext", "version": "1.0.0", "entitlement_state": "active"}
        ]

    async def test_status_requires_auth(self, client, db, vendor):
        res = await client.get("/api/v1/extensions/status")
        assert res.status_code == 401
