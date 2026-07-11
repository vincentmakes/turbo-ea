"""Unit tests for signed extension license parsing + entitlement state (no DB)."""

from __future__ import annotations

import base64
import json
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.services.extensions.license import (
    LICENSE_SCHEMA,
    Entitlement,
    LicenseError,
    entitlement_state,
    grace_until,
    parse_and_verify,
)


def make_keypair() -> tuple[Ed25519PrivateKey, str]:
    private = Ed25519PrivateKey.generate()
    public_b64 = base64.b64encode(
        private.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
    ).decode()
    return private, public_b64


def make_license(private: Ed25519PrivateKey, payload: dict, *, schema: str = LICENSE_SCHEMA) -> str:
    payload_bytes = json.dumps(payload).encode()
    return json.dumps(
        {
            "schema": schema,
            "key_id": "vendor-1",
            "payload": base64.b64encode(payload_bytes).decode(),
            "signature": base64.b64encode(private.sign(payload_bytes)).decode(),
        }
    )


PAYLOAD = {
    "licensee": "ACME Corp",
    "customer_id": "cus_7f3a",
    "issued_at": "2026-07-01T00:00:00Z",
    "grace_days": 30,
    # `plan` is intentionally left on these entitlements: it is a removed field,
    # and a legacy signed license may still carry it — the parser must tolerate
    # (ignore) it, which test_valid_license_parses asserts.
    "entitlements": [
        {
            "extension_key": "capability-benchmarks",
            "plan": "enterprise",
            "expires_at": "2027-07-01T00:00:00Z",
        },
        {"extension_key": "sap-sync", "plan": "standard", "expires_at": None},
    ],
}


class TestParseAndVerify:
    def test_valid_license_parses(self):
        private, public_b64 = make_keypair()
        doc = parse_and_verify(make_license(private, PAYLOAD), public_key_b64=public_b64)
        assert doc.licensee == "ACME Corp"
        assert doc.customer_id == "cus_7f3a"
        assert doc.grace_days == 30
        assert doc.key_id == "vendor-1"
        assert doc.issued_at == datetime(2026, 7, 1, tzinfo=timezone.utc)
        assert len(doc.entitlements) == 2
        ent = doc.entitlement_for("capability-benchmarks")
        assert ent is not None
        # `plan` was removed; a legacy license carrying it parses fine but the
        # field is never surfaced.
        assert not hasattr(ent, "plan")
        assert ent.expires_at == datetime(2027, 7, 1, tzinfo=timezone.utc)
        # Perpetual entitlement
        assert doc.entitlement_for("sap-sync").expires_at is None
        assert doc.entitlement_for("unknown") is None
        assert doc.raw_text  # preserved byte-exact for storage/re-verification
        assert doc.instance_id == ""  # not stamped in this fixture

    def test_instance_id_is_surfaced(self):
        private, public_b64 = make_keypair()
        payload = dict(PAYLOAD, instance_id="TEA-0123-4567-89AB")
        doc = parse_and_verify(make_license(private, payload), public_key_b64=public_b64)
        assert doc.instance_id == "TEA-0123-4567-89AB"

    def test_tampered_payload_rejected(self):
        private, public_b64 = make_keypair()
        envelope = json.loads(make_license(private, PAYLOAD))
        forged = dict(PAYLOAD, licensee="Evil Corp")
        envelope["payload"] = base64.b64encode(json.dumps(forged).encode()).decode()
        with pytest.raises(LicenseError, match="signature"):
            parse_and_verify(json.dumps(envelope), public_key_b64=public_b64)

    def test_wrong_key_rejected(self):
        private, _ = make_keypair()
        _, other_public = make_keypair()
        with pytest.raises(LicenseError, match="signature"):
            parse_and_verify(make_license(private, PAYLOAD), public_key_b64=other_public)

    def test_no_vendor_key_configured_rejected(self, monkeypatch):
        """A build with an empty baked trust map refuses all licenses."""
        private, _ = make_keypair()
        monkeypatch.setattr("app.core.extension_signing.DEFAULT_VENDOR_PUBLIC_KEYS", {})
        with pytest.raises(LicenseError, match="vendor key"):
            parse_and_verify(make_license(private, PAYLOAD))

    @pytest.mark.parametrize(
        "text",
        [
            "not json",
            "[]",
            json.dumps({"schema": LICENSE_SCHEMA}),
            json.dumps({"schema": "turboea-license/999", "payload": "e30=", "signature": "AA=="}),
            json.dumps({"schema": LICENSE_SCHEMA, "payload": "!!!", "signature": "AA=="}),
        ],
    )
    def test_malformed_envelopes_rejected(self, text):
        _, public_b64 = make_keypair()
        with pytest.raises(LicenseError):
            parse_and_verify(text, public_key_b64=public_b64)

    @pytest.mark.parametrize(
        "payload",
        [
            {"customer_id": "x"},  # missing licensee
            dict(PAYLOAD, licensee="   "),
            dict(PAYLOAD, grace_days=-1),
            dict(PAYLOAD, grace_days="thirty"),
            dict(PAYLOAD, grace_days=True),
            dict(PAYLOAD, entitlements="all"),
            dict(PAYLOAD, entitlements=[{"plan": "gold"}]),  # missing extension_key
            dict(PAYLOAD, entitlements=[{"extension_key": "x", "expires_at": "someday"}]),
            dict(PAYLOAD, issued_at=12345),
        ],
    )
    def test_invalid_payloads_rejected(self, payload):
        private, public_b64 = make_keypair()
        with pytest.raises(LicenseError):
            parse_and_verify(make_license(private, payload), public_key_b64=public_b64)

    def test_signed_non_object_payload_rejected(self):
        private, public_b64 = make_keypair()
        payload_bytes = json.dumps(["not", "a", "dict"]).encode()
        text = json.dumps(
            {
                "schema": LICENSE_SCHEMA,
                "payload": base64.b64encode(payload_bytes).decode(),
                "signature": base64.b64encode(private.sign(payload_bytes)).decode(),
            }
        )
        with pytest.raises(LicenseError, match="object"):
            parse_and_verify(text, public_key_b64=public_b64)

    def test_grace_days_defaults_when_absent(self):
        private, public_b64 = make_keypair()
        payload = {k: v for k, v in PAYLOAD.items() if k != "grace_days"}
        doc = parse_and_verify(make_license(private, payload), public_key_b64=public_b64)
        assert doc.grace_days == 30


class TestEntitlementState:
    EXPIRES = datetime(2027, 7, 1, tzinfo=timezone.utc)
    ENT = Entitlement(extension_key="x", expires_at=EXPIRES)

    def test_before_expiry_is_active(self):
        assert entitlement_state(self.ENT, 30, now=self.EXPIRES - timedelta(days=1)) == "active"

    def test_at_expiry_is_still_active(self):
        assert entitlement_state(self.ENT, 30, now=self.EXPIRES) == "active"

    def test_within_grace_window(self):
        assert entitlement_state(self.ENT, 30, now=self.EXPIRES + timedelta(days=15)) == "grace"
        assert entitlement_state(self.ENT, 30, now=self.EXPIRES + timedelta(days=30)) == "grace"

    def test_past_grace_is_expired(self):
        moment = self.EXPIRES + timedelta(days=30, seconds=1)
        assert entitlement_state(self.ENT, 30, now=moment) == "expired"

    def test_zero_grace_goes_straight_to_expired(self):
        assert entitlement_state(self.ENT, 0, now=self.EXPIRES + timedelta(seconds=1)) == "expired"

    def test_perpetual_is_always_active(self):
        ent = Entitlement(extension_key="x", expires_at=None)
        assert entitlement_state(ent, 0, now=datetime(2099, 1, 1, tzinfo=timezone.utc)) == "active"
        assert grace_until(ent, 30) is None

    def test_grace_until(self):
        assert grace_until(self.ENT, 30) == self.EXPIRES + timedelta(days=30)
