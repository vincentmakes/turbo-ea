"""Signature verification for the Extension Store (bundles + licenses).

Extensions and license files are signed offline by the vendor with an
Ed25519 private key; every Turbo EA instance verifies them with the
matching public key. Verification is fully local — no network, no
activation server — so signed extensions work identically on connected
and air-gapped installs.

Provenance is a hard requirement: only bundles signed by a trusted
vendor key may be installed or loaded. The trust anchor is the baked-in
``DEFAULT_VENDOR_PUBLIC_KEYS`` map below (``key_id`` → public key). Two
key ids are reserved by convention:

- ``vendor-1`` — the offline vendor key used for manually issued
  bundles/licenses (enterprise deals, air-gapped customers),
- ``store-1``  — the online store's issuing key, held by the hosted
  store service so it can sign licenses after Stripe checkout without
  ever touching the offline key. Compromise of the store key is
  contained to that key id and rotated with a core release.

The ``EXTENSION_VENDOR_PUBLIC_KEY`` env override exists for development
and tests and is honored ONLY when ``ENVIRONMENT=development`` — a
production deployment cannot be repointed at a foreign signing key
without forking and rebuilding the image.

Keys are base64 of the raw 32-byte Ed25519 public key; signatures are
base64 of the raw signature — the same encoding ``ops_auth.py`` uses.
Signatures always cover the *exact bytes as shipped* (raw
``manifest.json`` bytes for bundles, the base64-decoded payload bytes
for licenses); there is deliberately no JSON canonicalization step.
"""

from __future__ import annotations

import base64

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from app.config import settings

# The vendor's trusted Ed25519 public keys (base64, raw 32 bytes), keyed by
# ``key_id``. Empty in the open-source tree: an operator shipping commercial
# extensions generates keypairs with ``python -m extension_tools keygen``
# (scripts/extension-tools) and bakes the public halves here before building
# release images. While this is empty and no development override is active,
# every bundle and license is refused — the Extension Store is dormant.
DEFAULT_VENDOR_PUBLIC_KEYS: dict[str, str] = {
    # "vendor-1": "<base64 raw 32-byte Ed25519 public key>",
    # "store-1": "<base64 raw 32-byte Ed25519 public key>",
}

# Key id assumed for signed envelopes that carry no ``key_id`` of their own.
DEFAULT_VENDOR_KEY_ID = "vendor-1"

# Key id used for the development env override.
DEV_OVERRIDE_KEY_ID = "dev"


def trusted_public_keys() -> dict[str, str]:
    """Return the ``key_id`` → public-key map trusted by this deployment.

    The env override is only honored in development so provenance cannot
    be bypassed on production images. Returns ``{}`` when no key is
    configured, which callers must treat as "refuse everything".
    """
    if settings.ENVIRONMENT == "development" and settings.EXTENSION_VENDOR_PUBLIC_KEY:
        return {DEV_OVERRIDE_KEY_ID: settings.EXTENSION_VENDOR_PUBLIC_KEY}
    return dict(DEFAULT_VENDOR_PUBLIC_KEYS)


def vendor_public_key() -> str:
    """Backward-compatible single-key accessor.

    Returns the development override or the first baked-in key. Prefer
    :func:`trusted_public_keys` + :func:`verify_with_trusted` in new code.
    """
    keys = trusted_public_keys()
    if not keys:
        return ""
    if DEV_OVERRIDE_KEY_ID in keys:
        return keys[DEV_OVERRIDE_KEY_ID]
    return keys.get(DEFAULT_VENDOR_KEY_ID) or next(iter(keys.values()))


def verify_bytes(payload: bytes, signature_b64: str, public_key_b64: str) -> bool:
    """Verify an Ed25519 signature over ``payload``. Fail closed on any error."""
    if not public_key_b64:
        return False
    try:
        public = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64))
        public.verify(base64.b64decode(signature_b64), payload)
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


def verify_with_trusted(
    payload: bytes,
    signature_b64: str,
    key_id: str | None = None,
    trusted: dict[str, str] | None = None,
) -> bool:
    """Verify ``payload`` against the trusted key set.

    When the envelope names a ``key_id`` that is trusted, that key is
    tried first; otherwise every trusted key is tried (the set is tiny —
    at most a handful of keys — and this keeps envelopes signed before a
    key rotation, or without a key_id at all, verifying). Fail closed.
    """
    keys = trusted_public_keys() if trusted is None else trusted
    if not keys:
        return False
    ordered: list[str] = []
    if key_id and key_id in keys:
        ordered.append(keys[key_id])
    ordered.extend(v for k, v in keys.items() if not (key_id and k == key_id))
    return any(verify_bytes(payload, signature_b64, key) for key in ordered)
