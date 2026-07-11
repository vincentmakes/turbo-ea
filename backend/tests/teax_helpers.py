"""Shared helpers for building signed ``.teax`` bundles in tests.

Mirrors what the ``teax pack`` CLI (scripts/extension-tools) does: compute
the per-file sha256 map, write ``manifest.json``, sign its raw bytes with
Ed25519, and zip everything up.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import zipfile
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.core import extension_signing


def trust_test_key(monkeypatch, public_b64: str, *, key_id: str = "test") -> None:
    """Make ``public_b64`` the sole trusted vendor key for the duration of a test.

    Replaces the baked-in trust map in-process (the same seam a fork edits in
    source). ``key_id`` defaults to a value with no role restriction (see
    ``extension_signing.KEY_ROLES``), so a test key can sign either bundles or
    licenses.
    """
    monkeypatch.setattr(extension_signing, "DEFAULT_VENDOR_PUBLIC_KEYS", {key_id: public_b64})


def make_keypair() -> tuple[Ed25519PrivateKey, str]:
    private = Ed25519PrivateKey.generate()
    public_b64 = base64.b64encode(
        private.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
    ).decode()
    return private, public_b64


def build_manifest(
    *,
    key: str = "sample-ext",
    name: str = "Sample Extension",
    version: str = "1.0.0",
    core_min: str = "0.0.1",
    core_max_exclusive: str | None = None,
    capabilities: list[str] | None = None,
    files: dict[str, bytes] | None = None,
    **extra: Any,
) -> dict[str, Any]:
    files = files or {}
    manifest: dict[str, Any] = {
        "schema": "turboea-extension/1",
        "key": key,
        "name": name,
        "version": version,
        "vendor": "Turbo EA",
        "core": {"min": core_min},
        "sdk_version": "1.0",
        "entitlement_key": key,
        "capabilities": capabilities if capabilities is not None else ["content"],
        "files": {path: hashlib.sha256(data).hexdigest() for path, data in files.items()},
    }
    if core_max_exclusive:
        manifest["core"]["max_exclusive"] = core_max_exclusive
    if "content" in manifest["capabilities"] and "content" not in extra:
        manifest["content"] = [p for p in files if p.startswith("content/")]
    manifest.update(extra)
    return manifest


def build_teax(
    private: Ed25519PrivateKey,
    *,
    files: dict[str, bytes] | None = None,
    manifest: dict[str, Any] | None = None,
    omit_signature: bool = False,
    tamper_manifest_after_signing: bool = False,
    extra_zip_files: dict[str, bytes] | None = None,
    **manifest_kwargs: Any,
) -> bytes:
    """Build a signed ``.teax`` zip in memory.

    ``manifest`` overrides the generated one entirely; ``manifest_kwargs``
    feed :func:`build_manifest`. Tamper switches produce deliberately
    broken bundles for negative tests.
    """
    files = files or {}
    if manifest is None:
        manifest = build_manifest(files=files, **manifest_kwargs)
    manifest_bytes = json.dumps(manifest, indent=2).encode()
    signature = base64.b64encode(private.sign(manifest_bytes)).decode()
    if tamper_manifest_after_signing:
        manifest_bytes = manifest_bytes.replace(b'"Sample Extension"', b'"Evil Extension"')

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", manifest_bytes)
        if not omit_signature:
            zf.writestr("manifest.sig", signature)
        for path, data in files.items():
            zf.writestr(path, data)
        for path, data in (extra_zip_files or {}).items():
            zf.writestr(path, data)
    return buf.getvalue()


def build_wheel(package: str, module_source: str, *, version: str = "1.0.0") -> bytes:
    """Build a minimal pure-Python wheel containing one package module."""
    buf = io.BytesIO()
    dist_info = f"{package}-{version}.dist-info"
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{package}/__init__.py", module_source)
        zf.writestr(
            f"{dist_info}/METADATA",
            f"Metadata-Version: 2.1\nName: {package}\nVersion: {version}\n",
        )
        zf.writestr(f"{dist_info}/WHEEL", "Wheel-Version: 1.0\nRoot-Is-Purelib: true\n")
        zf.writestr(f"{dist_info}/RECORD", "")
    return buf.getvalue()
