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

- ``vendor-1`` — the primary vendor key used for signing extension
  bundles and manually issued licenses,
- ``store-1``  — a second license-signing key, kept separate from
  ``vendor-1`` so licenses can be issued without ever touching the
  bundle-signing key. Compromise of one key is contained to its key id
  and rotated with a core release.

Having two independent keys lets the vendor sign licenses and bundles
with different keys and rotate either without a format change; the
private halves and their custody are the vendor's concern and live
outside this repo.

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

# The vendor's trusted Ed25519 public keys (base64, raw 32 bytes), keyed by
# ``key_id``. Public keys only *verify* — they are safe to publish — so the
# vendor's own keys are baked in here and ship in every release image. An
# operator shipping their *own* commercial extensions from a fork generates
# keypairs with ``python scripts/extension-tools/teax.py keygen`` and replaces
# these. If this map is emptied, every bundle and license is refused — the
# Extension Store is dormant.
DEFAULT_VENDOR_PUBLIC_KEYS: dict[str, str] = {
    # Primary vendor key — signs .teax bundles + manually issued licenses.
    "vendor-1": "y+L5r+Pj6K0oc4mSA3dVWtGhW+PMoRkjCvEJkTryijg=",
    # Secondary license-signing key, kept separate from vendor-1; never signs
    # bundles. Rotates with a core release.
    "store-1": "rfjoGjveWUvMnmwo72N2nufua1iEkpPcH/xd1gg/ZDQ=",
}

# Key id assumed for signed envelopes that carry no ``key_id`` of their own.
DEFAULT_VENDOR_KEY_ID = "vendor-1"

# Which artifact types each baked-in key is permitted to sign. This is what
# makes the "store-1 never signs bundles" separation real: even though the
# public key verifies any Ed25519 signature, a bundle signed with ``store-1``
# is refused because ``store-1`` is not a bundle-signing key. A key id absent
# from this map (a custom key a fork or test supplies) is permissive — it may
# sign any artifact — so only the vendor's own keys carry the tighter grant.
KEY_ROLES: dict[str, frozenset[str]] = {
    "vendor-1": frozenset({"bundle", "license"}),
    "store-1": frozenset({"license"}),
}


def _key_allows(key_id: str, artifact: str | None) -> bool:
    """True when ``key_id`` may sign ``artifact`` (or no artifact is required)."""
    if artifact is None:
        return True
    roles = KEY_ROLES.get(key_id)
    return roles is None or artifact in roles


def trusted_public_keys() -> dict[str, str]:
    """Return the ``key_id`` → public-key map trusted by this deployment.

    The trust anchor is the baked-in :data:`DEFAULT_VENDOR_PUBLIC_KEYS`.
    Returns ``{}`` only if that map is empty, which callers must treat as
    "refuse everything".
    """
    return dict(DEFAULT_VENDOR_PUBLIC_KEYS)


def vendor_public_key() -> str:
    """Backward-compatible single-key accessor.

    Returns the primary baked-in key (or the first available). Prefer
    :func:`trusted_public_keys` + :func:`verify_with_trusted` in new code.
    """
    keys = trusted_public_keys()
    if not keys:
        return ""
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
    *,
    artifact: str | None = None,
) -> bool:
    """Verify ``payload`` against the trusted key set.

    When the envelope names a ``key_id`` that is trusted, that key is
    tried first; otherwise every trusted key is tried (the set is tiny —
    at most a handful of keys — and this keeps envelopes signed before a
    key rotation, or without a key_id at all, verifying). Fail closed.

    ``artifact`` (``"bundle"`` / ``"license"``) restricts which keys are
    even considered to those permitted to sign that artifact type (see
    :data:`KEY_ROLES`), so a license-only key cannot validate a bundle.
    """
    keys = trusted_public_keys() if trusted is None else trusted
    candidates = {k: v for k, v in keys.items() if _key_allows(k, artifact)}
    if not candidates:
        return False
    ordered: list[str] = []
    if key_id and key_id in candidates:
        ordered.append(candidates[key_id])
    ordered.extend(v for k, v in candidates.items() if not (key_id and k == key_id))
    return any(verify_bytes(payload, signature_b64, key) for key in ordered)
