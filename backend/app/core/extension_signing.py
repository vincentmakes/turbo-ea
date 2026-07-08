"""Signature verification for the Extension Store (bundles + licenses).

Extensions and license files are signed offline by the vendor with an
Ed25519 private key; every Turbo EA instance verifies them with the
matching public key. Verification is fully local — no network, no
activation server — so signed extensions work identically on connected
and air-gapped installs.

Provenance is a hard requirement: only bundles signed by the vendor key
may be installed or loaded. The trust anchor is the baked-in
``DEFAULT_VENDOR_PUBLIC_KEY`` constant below. The
``EXTENSION_VENDOR_PUBLIC_KEY`` env override exists for development and
tests and is honored ONLY when ``ENVIRONMENT=development`` — a
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

# The vendor's Ed25519 public key (base64, raw 32 bytes). Empty in the
# open-source tree: an operator shipping commercial extensions generates a
# keypair with ``python -m extension_tools keygen`` (scripts/extension-tools)
# and bakes the public half here before building release images. While this
# is empty and no development override is active, every bundle and license
# is refused — the Extension Store is effectively dormant.
DEFAULT_VENDOR_PUBLIC_KEY = ""

# Identifier of the key above. Signed envelopes carry a ``key_id`` so a
# future core release can verify against several keys during a rotation
# window without an envelope-format break.
DEFAULT_VENDOR_KEY_ID = "vendor-1"


def vendor_public_key() -> str:
    """Return the trusted vendor public key for this deployment.

    The env override is only honored in development so provenance cannot
    be bypassed on production images. Returns ``""`` when no key is
    configured, which callers must treat as "refuse everything".
    """
    if settings.ENVIRONMENT == "development" and settings.EXTENSION_VENDOR_PUBLIC_KEY:
        return settings.EXTENSION_VENDOR_PUBLIC_KEY
    return DEFAULT_VENDOR_PUBLIC_KEY


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
