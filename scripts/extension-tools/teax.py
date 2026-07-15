#!/usr/bin/env python3
"""teax — build, sign, and verify Turbo EA extension bundles and licenses.

Self-contained on purpose (stdlib + the `cryptography` package only) so it
can be vendored into private extension repos and run in CI or on an
air-gapped operator machine. The formats match the verifiers in
`backend/app/services/extensions/` exactly:

- bundles: Ed25519 signature over the RAW manifest.json bytes (manifest.sig)
  plus a per-file sha256 map inside the signed manifest,
- licenses: envelope {schema, key_id, payload: b64(json), signature}.

Commands
--------
  keygen                            Generate an Ed25519 keypair (base64 raw)
  pack <dir> --key <priv>          Build + sign a .teax bundle from a source dir
  verify <bundle> --pubkey <pub>   Verify a bundle offline
  sign-license <payload.json> --key <priv>   Produce a signed license file
  verify-license <file> --pubkey <pub>       Verify a license file
  lint <dir>                        Sanity-check an extension source dir

The source dir layout expected by `pack`/`lint`:

  my-extension/
    extension.json    # manifest WITHOUT schema/files (added by pack)
    content/*.json    # optional content-pack payloads
    wheels/*.whl      # optional backend wheels (py3-none-any only)
    frontend/*.js     # optional UI bundle(s)
    docs/**           # optional

Keys: pass private keys via --key-file or the TEAX_SIGNING_KEY env var in
CI; --key on the command line is fine for local use.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import re
import sys
import zipfile
from pathlib import Path, PurePosixPath

try:
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (
        Ed25519PrivateKey,
        Ed25519PublicKey,
    )
except ImportError:  # pragma: no cover
    print(
        "teax requires the 'cryptography' package: pip install cryptography",
        file=sys.stderr,
    )
    sys.exit(2)

TEAX_SCHEMA = "turboea-extension/1"
LICENSE_SCHEMA = "turboea-license/1"
MANIFEST_NAME = "manifest.json"
SIGNATURE_NAME = "manifest.sig"
SOURCE_MANIFEST = "extension.json"
VALID_CAPABILITIES = {"content", "backend", "frontend", "metamodel"}
BUILTIN_FIELD_TYPES = {
    "text",
    "multiline_text",
    "number",
    "cost",
    "boolean",
    "date",
    "url",
    "single_select",
    "multiple_select",
}
KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
CONTENT_SHEETS = {
    "CardTypes",
    "RelationTypes",
    "StakeholderRoles",
    "Calculations",
    "Principles",
    "ComplianceRegs",
    "ResourceTypes",
    "TagGroups",
    "Tags",
    "Cards",
    "CardTags",
    "Relations",
    "Surveys",
}


def _fail(message: str) -> "sys.NoReturn":
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def _load_private_key(args) -> Ed25519PrivateKey:
    raw = None
    if getattr(args, "key", None):
        raw = args.key
    elif getattr(args, "key_file", None):
        raw = Path(args.key_file).read_text().strip()
    elif os.environ.get("TEAX_SIGNING_KEY"):
        raw = os.environ["TEAX_SIGNING_KEY"].strip()
    if not raw:
        _fail("no signing key: pass --key, --key-file, or set TEAX_SIGNING_KEY")
    try:
        return Ed25519PrivateKey.from_private_bytes(base64.b64decode(raw))
    except (ValueError, TypeError) as exc:
        _fail(f"invalid private key: {exc}")


def _b64_public(private: Ed25519PrivateKey) -> str:
    return base64.b64encode(
        private.public_key().public_bytes(
            encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
        )
    ).decode()


def _safe_member(name: str) -> bool:
    if not name or name.endswith("/") or "\\" in name or name.startswith("/"):
        return False
    parts = PurePosixPath(name).parts
    return bool(parts) and ".." not in parts


# ---------------------------------------------------------------------------
# keygen
# ---------------------------------------------------------------------------


def cmd_keygen(_args) -> int:
    private = Ed25519PrivateKey.generate()
    private_b64 = base64.b64encode(
        private.private_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PrivateFormat.Raw,
            encryption_algorithm=serialization.NoEncryption(),
        )
    ).decode()
    print("# Keep the private key OFFLINE (or in a protected CI environment secret).")
    print("# Bake the public key into backend/app/core/extension_signing.py")
    print("# (DEFAULT_VENDOR_PUBLIC_KEYS, keyed by key id) before building release images.")
    print(f"TEAX_PRIVATE_KEY={private_b64}")
    print(f"TEAX_PUBLIC_KEY={_b64_public(private)}")
    return 0


# ---------------------------------------------------------------------------
# lint / pack
# ---------------------------------------------------------------------------


def _collect_files(src: Path) -> dict[str, Path]:
    files: dict[str, Path] = {}
    for path in sorted(src.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(src).as_posix()
        if rel in (SOURCE_MANIFEST, MANIFEST_NAME, SIGNATURE_NAME) or rel.startswith("."):
            continue
        files[rel] = path
    return files


def _lint_source(src: Path) -> tuple[dict, dict[str, Path], list[str], list[str]]:
    problems: list[str] = []
    warnings: list[str] = []
    manifest_path = src / SOURCE_MANIFEST
    if not manifest_path.is_file():
        _fail(f"{src} has no {SOURCE_MANIFEST}")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        _fail(f"{SOURCE_MANIFEST} is not valid JSON: {exc}")

    key = manifest.get("key", "")
    if not isinstance(key, str) or not KEY_PATTERN.match(key):
        problems.append("key must be 2-64 chars of lowercase letters, digits, hyphens")
    for field in ("name", "version"):
        if not str(manifest.get(field, "")).strip():
            problems.append(f"manifest is missing {field}")
    capabilities = manifest.get("capabilities") or []
    unknown = set(capabilities) - VALID_CAPABILITIES
    if not capabilities:
        problems.append("manifest must declare at least one capability")
    if unknown:
        problems.append(f"unknown capabilities: {sorted(unknown)}")
    core = manifest.get("core") or {}
    if not core.get("min"):
        problems.append("manifest is missing core.min (compatibility range)")
    if core.get("max_exclusive"):
        warnings.append(
            "core.max_exclusive is set — an upper bound makes this extension "
            "self-disable on Turbo EA "
            f"{core['max_exclusive']} and every later release, even when the "
            "extension contract did not change. Prefer core.min only, and raise "
            "it when you adopt a new capability. Keep a ceiling ONLY for a known "
            "incompatibility."
        )

    files = _collect_files(src)

    if "content" in capabilities:
        content = manifest.get("content") or [p for p in files if p.startswith("content/")]
        if not content:
            problems.append("content capability declared but no content/*.json present")
        for rel in content:
            if rel not in files:
                problems.append(f"content file listed but missing: {rel}")
                continue
            try:
                payload = json.loads(files[rel].read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                problems.append(f"{rel} is not valid JSON: {exc}")
                continue
            if not isinstance(payload, dict):
                problems.append(f"{rel} must be an object of sheet -> rows")
                continue
            for sheet in payload:
                if sheet not in CONTENT_SHEETS:
                    problems.append(f"{rel} targets unsupported sheet {sheet!r}")
        manifest["content"] = content

    if "backend" in capabilities:
        backend = manifest.get("backend") or {}
        entrypoint = str(backend.get("entrypoint", ""))
        if ":" not in entrypoint:
            problems.append('backend capability needs backend.entrypoint "pkg.module:attr"')
        wheels = backend.get("wheels") or [p for p in files if p.startswith("wheels/")]
        if not wheels:
            problems.append("backend capability declared but no wheels/*.whl present")
        for rel in wheels:
            if rel not in files:
                problems.append(f"wheel listed but missing: {rel}")
            elif not rel.endswith("py3-none-any.whl"):
                problems.append(f"{rel}: only pure-Python py3-none-any wheels are installable")
        backend["wheels"] = wheels
        manifest["backend"] = backend

    if "frontend" in capabilities:
        frontend = manifest.get("frontend") or {}
        entry = str(frontend.get("entry", ""))
        if not entry:
            candidates = [p for p in files if p.startswith("frontend/") and p.endswith(".js")]
            entry = candidates[0] if len(candidates) == 1 else ""
        if not entry or entry not in files:
            problems.append("frontend capability needs frontend.entry pointing at a bundled file")
        else:
            frontend["entry"] = entry
            manifest["frontend"] = frontend

    if "metamodel" in capabilities:
        block = manifest.get("metamodel") or {}
        sections = block.get("field_sections")
        if not isinstance(sections, list) or not sections:
            problems.append("metamodel capability needs metamodel.field_sections")
        for i, contrib in enumerate(sections or []):
            where = f"metamodel.field_sections[{i}]"
            if not isinstance(contrib, dict):
                problems.append(f"{where} must be an object")
                continue
            for req in ("card_type", "section"):
                if not str(contrib.get(req, "")).strip():
                    problems.append(f"{where} is missing {req}")
            flds = contrib.get("fields")
            if not isinstance(flds, list) or not flds:
                problems.append(f"{where} needs a non-empty fields list")
                continue
            for j, f in enumerate(flds):
                fw = f"{where}.fields[{j}]"
                if not isinstance(f, dict):
                    problems.append(f"{fw} must be an object")
                    continue
                for req in ("key", "label", "type"):
                    if not str(f.get(req, "")).strip():
                        problems.append(f"{fw} is missing {req}")
                ftype = str(f.get("type", ""))
                if (
                    ftype
                    and ftype not in BUILTIN_FIELD_TYPES
                    and not ftype.startswith(f"ext.{key}.")
                ):
                    problems.append(f"{fw}: type {ftype!r} must be built-in or ext.{key}.*")
    elif manifest.get("metamodel"):
        problems.append("manifest has a metamodel block but no metamodel capability declared")

    permissions = manifest.get("permissions") or {}
    for perm in permissions:
        if not str(perm).startswith(f"ext.{key}."):
            problems.append(f"permission {perm!r} must be namespaced ext.{key}.*")

    if "free" in manifest and not isinstance(manifest["free"], bool):
        problems.append("free must be a boolean (true = no license required to run)")

    for rel in files:
        if not _safe_member(rel):
            problems.append(f"unsafe file path: {rel}")

    return manifest, files, problems, warnings


def cmd_lint(args) -> int:
    _, files, problems, warnings = _lint_source(Path(args.source_dir))
    for w in warnings:
        print(f"lint: warning: {w}")
    for p in problems:
        print(f"lint: {p}")
    print(
        f"{len(files)} file(s) scanned, {len(problems)} problem(s), {len(warnings)} warning(s)"
    )
    return 1 if problems else 0


def cmd_pack(args) -> int:
    src = Path(args.source_dir)
    manifest, files, problems, warnings = _lint_source(src)
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
    if problems:
        for p in problems:
            print(f"lint: {p}", file=sys.stderr)
        _fail("fix the problems above before packing")

    private = _load_private_key(args)

    manifest = {
        "schema": TEAX_SCHEMA,
        **{k: v for k, v in manifest.items() if k not in ("schema", "files")},
    }
    manifest.setdefault("entitlement_key", manifest["key"])
    manifest.setdefault("sdk_version", "1.0")
    if args.key_id:
        manifest["key_id"] = args.key_id
    manifest["files"] = {
        rel: hashlib.sha256(path.read_bytes()).hexdigest() for rel, path in files.items()
    }

    manifest_bytes = json.dumps(manifest, indent=2, ensure_ascii=False).encode()
    signature = base64.b64encode(private.sign(manifest_bytes)).decode()

    out = Path(args.out or f"{manifest['key']}-{manifest['version']}.teax")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(MANIFEST_NAME, manifest_bytes)
        zf.writestr(SIGNATURE_NAME, signature)
        for rel, path in files.items():
            zf.writestr(rel, path.read_bytes())
    out.write_bytes(buf.getvalue())
    print(
        f"packed {out} ({len(files)} file(s), signed with key id "
        f"{manifest.get('key_id', 'default')})"
    )
    print(f"public key for this signature: {_b64_public(private)}")
    return 0


# ---------------------------------------------------------------------------
# verify (bundle)
# ---------------------------------------------------------------------------


def _verify_signature(payload: bytes, signature_b64: str, public_b64: str) -> bool:
    try:
        public = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_b64))
        public.verify(base64.b64decode(signature_b64), payload)
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


def cmd_verify(args) -> int:
    path = Path(args.bundle)
    try:
        zf = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as exc:
        _fail(f"not a readable .teax bundle: {exc}")
    names = set(zf.namelist())
    if MANIFEST_NAME not in names or SIGNATURE_NAME not in names:
        _fail("bundle is missing manifest.json or manifest.sig")
    manifest_bytes = zf.read(MANIFEST_NAME)
    signature = zf.read(SIGNATURE_NAME).decode("ascii", errors="replace").strip()
    if not _verify_signature(manifest_bytes, signature, args.pubkey):
        _fail("signature verification FAILED — bundle was not signed by this key")
    manifest = json.loads(manifest_bytes)
    if manifest.get("schema") != TEAX_SCHEMA:
        _fail(f"unsupported schema {manifest.get('schema')!r}")
    file_hashes: dict[str, str] = manifest.get("files") or {}
    members = [n for n in names if n not in (MANIFEST_NAME, SIGNATURE_NAME) and not n.endswith("/")]
    for member in members:
        if not _safe_member(member):
            _fail(f"unsafe path in bundle: {member}")
        expected = file_hashes.get(member)
        if expected is None:
            _fail(f"file not covered by the signed manifest: {member}")
        if hashlib.sha256(zf.read(member)).hexdigest() != expected:
            _fail(f"hash mismatch (tampered?): {member}")
    missing = set(file_hashes) - set(members)
    if missing:
        _fail(f"files listed in manifest but missing from bundle: {sorted(missing)}")
    print(
        f"OK: {manifest.get('key')} {manifest.get('version')} — signature valid, "
        f"{len(members)} file(s) intact, core compat "
        f">= {((manifest.get('core') or {}).get('min'))}"
    )
    return 0


# ---------------------------------------------------------------------------
# licenses
# ---------------------------------------------------------------------------


def _validate_instance_id(value: str) -> bool:
    """TEA-XXXX-XXXX-XXXX, Crockford base32, last char a weighted mod-32
    checksum — mirrors app/services/extensions/instance_id.py exactly."""
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    parts = value.split("-")
    if len(parts) != 4 or parts[0] != "TEA" or any(len(p) != 4 for p in parts[1:]):
        return False
    body = "".join(parts[1:])
    if any(ch not in alphabet for ch in body):
        return False
    total = sum((idx + 1) * alphabet.index(ch) for idx, ch in enumerate(body[:11]))
    return alphabet[total % 32] == body[-1]


def cmd_sign_license(args) -> int:
    payload_path = Path(args.payload)
    try:
        payload = json.loads(payload_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        _fail(f"cannot read license payload: {exc}")
    if not str(payload.get("licensee", "")).strip():
        _fail("license payload needs a licensee")
    for idx, ent in enumerate(payload.get("entitlements", [])):
        if not str(ent.get("extension_key", "")).strip():
            _fail(f"entitlement #{idx + 1} is missing extension_key")

    # Licenses are BOUND to a Turbo EA instance — an unbound file is refused
    # by production cores, so refuse to produce one here in the first place.
    instance_id = str(getattr(args, "instance_id", None) or payload.get("instance_id") or "")
    if not instance_id:
        _fail("license payload needs an instance_id — pass --instance-id TEA-XXXX-XXXX-XXXX")
    if not _validate_instance_id(instance_id):
        _fail(f"invalid instance id {instance_id!r} (bad format or checksum)")
    payload["instance_id"] = instance_id

    private = _load_private_key(args)
    payload_bytes = json.dumps(payload, ensure_ascii=False).encode()
    envelope = {
        "schema": LICENSE_SCHEMA,
        "key_id": args.key_id,
        "payload": base64.b64encode(payload_bytes).decode(),
        "signature": base64.b64encode(private.sign(payload_bytes)).decode(),
    }
    text = json.dumps(envelope, indent=2)
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
        print(f"wrote {args.out}")
    else:
        print(text)
    return 0


def cmd_verify_license(args) -> int:
    try:
        envelope = json.loads(Path(args.license).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        _fail(f"cannot read license: {exc}")
    if envelope.get("schema") != LICENSE_SCHEMA:
        _fail("unsupported license schema")
    try:
        payload_bytes = base64.b64decode(envelope["payload"], validate=True)
    except (KeyError, ValueError) as exc:
        _fail(f"bad license payload: {exc}")
    if not _verify_signature(payload_bytes, envelope.get("signature", ""), args.pubkey):
        _fail("license signature verification FAILED")
    payload = json.loads(payload_bytes)
    print(f"OK: licensed to {payload.get('licensee')} (grace {payload.get('grace_days', 30)}d)")
    for ent in payload.get("entitlements", []):
        expires = ent.get("expires_at") or "perpetual"
        print(f"  - {ent.get('extension_key')} until {expires}")
    return 0


# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="teax", description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("keygen", help="generate an Ed25519 keypair")

    p = sub.add_parser("pack", help="build + sign a .teax bundle from a source dir")
    p.add_argument("source_dir")
    p.add_argument("--key", help="base64 raw Ed25519 private key")
    p.add_argument("--key-file", help="file containing the base64 private key")
    p.add_argument("--key-id", default="vendor-1", help="trusted key id this bundle is signed with")
    p.add_argument("--out", help="output path (default: <key>-<version>.teax)")

    p = sub.add_parser("verify", help="verify a .teax bundle offline")
    p.add_argument("bundle")
    p.add_argument("--pubkey", required=True, help="base64 raw Ed25519 public key")

    p = sub.add_parser("sign-license", help="sign a license payload JSON")
    p.add_argument("payload")
    p.add_argument("--key", help="base64 raw Ed25519 private key")
    p.add_argument("--key-file", help="file containing the base64 private key")
    p.add_argument("--key-id", default="vendor-1")
    p.add_argument(
        "--instance-id",
        help="Turbo EA instance this license is bound to (TEA-XXXX-XXXX-XXXX); "
        "required unless the payload JSON already carries instance_id",
    )
    p.add_argument("--out", help="write the license file here (default: stdout)")

    p = sub.add_parser("verify-license", help="verify a signed license file")
    p.add_argument("license")
    p.add_argument("--pubkey", required=True)

    p = sub.add_parser("lint", help="sanity-check an extension source dir")
    p.add_argument("source_dir")

    args = parser.parse_args(argv)
    handlers = {
        "keygen": cmd_keygen,
        "pack": cmd_pack,
        "verify": cmd_verify,
        "sign-license": cmd_sign_license,
        "verify-license": cmd_verify_license,
        "lint": cmd_lint,
    }
    return handlers[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
