"""Signed license files for the Extension Store.

A license is a small JSON envelope delivered out-of-band (typically by
email — the flow must work on air-gapped installs):

    {
      "schema": "turboea-license/1",
      "key_id": "vendor-1",
      "payload": "<base64 of the UTF-8 JSON payload bytes>",
      "signature": "<base64 Ed25519 signature over those exact bytes>"
    }

The payload is decoded and parsed only *after* the signature verifies:

    {
      "licensee": "ACME Corp",
      "customer_id": "cus_7f3a",
      "issued_at": "2026-07-01T00:00:00Z",
      "grace_days": 30,
      "entitlements": [
        {"extension_key": "capability-benchmarks",
         "expires_at": "2027-07-01T00:00:00Z"}
      ]
    }

Subscription semantics: an entitlement is ``active`` until
``expires_at``, then in ``grace`` for ``grace_days`` (warning banners,
everything keeps working), then ``expired`` (soft-disable — extension
surfaces refuse, data is never touched). ``expires_at: null`` means a
perpetual entitlement.
"""

from __future__ import annotations

import base64
import binascii
import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Literal

from app.core.extension_signing import trusted_public_keys, verify_with_trusted

LICENSE_SCHEMA = "turboea-license/1"

DEFAULT_GRACE_DAYS = 30

EntitlementState = Literal["active", "grace", "expired"]


class LicenseError(Exception):
    """Raised when a license envelope is malformed or its signature is invalid."""


@dataclass(frozen=True)
class Entitlement:
    extension_key: str
    expires_at: datetime | None = None  # None = perpetual


@dataclass(frozen=True)
class LicenseDocument:
    licensee: str
    customer_id: str
    issued_at: datetime | None
    grace_days: int
    entitlements: list[Entitlement] = field(default_factory=list)
    key_id: str = ""
    raw_text: str = ""
    # Optional store-issued renewal credential. When present (together with
    # customer_id), the instance may fetch a re-signed license from the
    # extension store after a subscription renewal — no manual re-paste.
    # Absent on manually issued (offline/enterprise) licenses.
    renewal_key: str = ""
    # The Turbo EA instance this license was issued for (TEA-XXXX-XXXX-XXXX).
    # Core BINDS on it: a mismatch is refused at apply time and soft-disables
    # at registry load (see instance_id.license_binding_problem). Empty only
    # on development licenses — production issuance always stamps it.
    instance_id: str = ""

    def entitlement_for(self, extension_key: str) -> Entitlement | None:
        for ent in self.entitlements:
            if ent.extension_key == extension_key:
                return ent
        return None


def _parse_datetime(value: object, label: str) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise LicenseError(f"Invalid license: {label} must be an ISO 8601 string")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise LicenseError(f"Invalid license: {label} is not a valid ISO 8601 date") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def parse_and_verify(text: str, *, public_key_b64: str | None = None) -> LicenseDocument:
    """Parse a license envelope, verify its signature, and return the document.

    Raises :class:`LicenseError` on any structural or cryptographic
    problem. The signature is checked against the deployment's trusted
    key set (selected by the envelope's ``key_id``, with try-all
    fallback); passing ``public_key_b64`` pins a single key — tests only.
    """
    trusted = {"test": public_key_b64} if public_key_b64 is not None else trusted_public_keys()
    if not trusted:
        raise LicenseError(
            "This build has no extension vendor key configured — licenses cannot be verified"
        )

    try:
        envelope = json.loads(text)
    except (json.JSONDecodeError, TypeError) as exc:
        raise LicenseError("Invalid license: not valid JSON") from exc
    if not isinstance(envelope, dict):
        raise LicenseError("Invalid license: envelope must be a JSON object")
    if envelope.get("schema") != LICENSE_SCHEMA:
        raise LicenseError("Invalid license: unsupported or missing schema")

    payload_b64 = envelope.get("payload")
    signature_b64 = envelope.get("signature")
    if not isinstance(payload_b64, str) or not isinstance(signature_b64, str):
        raise LicenseError("Invalid license: missing payload or signature")

    try:
        payload_bytes = base64.b64decode(payload_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise LicenseError("Invalid license: payload is not valid base64") from exc

    key_id = str(envelope.get("key_id") or "") or None
    if not verify_with_trusted(payload_bytes, signature_b64, key_id, trusted, artifact="license"):
        raise LicenseError("Invalid license: signature verification failed")

    # Signature is good — only now do we trust the payload enough to parse it.
    try:
        payload = json.loads(payload_bytes)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise LicenseError("Invalid license: payload is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise LicenseError("Invalid license: payload must be a JSON object")

    licensee = payload.get("licensee")
    if not isinstance(licensee, str) or not licensee.strip():
        raise LicenseError("Invalid license: missing licensee")

    grace_days_raw = payload.get("grace_days", DEFAULT_GRACE_DAYS)
    if (
        not isinstance(grace_days_raw, int)
        or isinstance(grace_days_raw, bool)
        or grace_days_raw < 0
    ):
        raise LicenseError("Invalid license: grace_days must be a non-negative integer")

    raw_entitlements = payload.get("entitlements", [])
    if not isinstance(raw_entitlements, list):
        raise LicenseError("Invalid license: entitlements must be a list")

    entitlements: list[Entitlement] = []
    for idx, raw in enumerate(raw_entitlements):
        if not isinstance(raw, dict):
            raise LicenseError(f"Invalid license: entitlement #{idx + 1} must be an object")
        ext_key = raw.get("extension_key")
        if not isinstance(ext_key, str) or not ext_key.strip():
            raise LicenseError(f"Invalid license: entitlement #{idx + 1} is missing extension_key")
        # Any legacy ``plan`` key in an already-signed license is simply ignored.
        entitlements.append(
            Entitlement(
                extension_key=ext_key.strip(),
                expires_at=_parse_datetime(
                    raw.get("expires_at"), f"entitlement #{idx + 1} expires_at"
                ),
            )
        )

    return LicenseDocument(
        licensee=licensee.strip(),
        customer_id=str(payload.get("customer_id") or ""),
        issued_at=_parse_datetime(payload.get("issued_at"), "issued_at"),
        grace_days=grace_days_raw,
        entitlements=entitlements,
        key_id=str(envelope.get("key_id") or ""),
        raw_text=text,
        renewal_key=str(payload.get("renewal_key") or ""),
        instance_id=str(payload.get("instance_id") or "").strip(),
    )


def grace_until(entitlement: Entitlement, grace_days: int) -> datetime | None:
    """End of the grace window, or ``None`` for perpetual entitlements."""
    if entitlement.expires_at is None:
        return None
    return entitlement.expires_at + timedelta(days=grace_days)


def entitlement_state(
    entitlement: Entitlement, grace_days: int, now: datetime | None = None
) -> EntitlementState:
    """Classify an entitlement as active / grace / expired at ``now``."""
    if entitlement.expires_at is None:
        return "active"
    moment = now or datetime.now(timezone.utc)
    if moment <= entitlement.expires_at:
        return "active"
    deadline = grace_until(entitlement, grace_days)
    if deadline is not None and moment <= deadline:
        return "grace"
    return "expired"
