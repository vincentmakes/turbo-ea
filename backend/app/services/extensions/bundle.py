"""Signed ``.teax`` extension-bundle verification.

A ``.teax`` bundle is a zip::

    my-extension-1.2.0.teax
    ├── manifest.json    # identity, core compat, capabilities, per-file sha256
    ├── manifest.sig     # base64 Ed25519 signature over the RAW manifest.json bytes
    ├── wheels/          # optional backend wheels (py3-none-any only)
    ├── frontend/        # optional prebuilt ESM bundle(s)
    ├── content/         # optional data payloads (workspace-section shaped JSON)
    └── docs/            # optional, not verified against files map exemption

Verification order is strict and fail-closed:

1. the signature over the exact ``manifest.json`` bytes must verify
   against the vendor public key (provenance — nothing else is even
   parsed before this),
2. the manifest schema must be understood,
3. every zip member must appear in ``manifest["files"]`` with a matching
   sha256 (and every listed file must exist) — no unsigned bytes can
   ride along,
4. member names must be safe (no absolute paths, no ``..`` — zip-slip),
5. the running core version must satisfy the declared compat range.
"""

from __future__ import annotations

import hashlib
import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO

from app.config import APP_VERSION
from app.core.extension_signing import trusted_public_keys, verify_with_trusted
from app.services.catalogue_common import version_tuple

TEAX_SCHEMA = "turboea-extension/1"
MANIFEST_NAME = "manifest.json"
SIGNATURE_NAME = "manifest.sig"

VALID_CAPABILITIES = frozenset({"content", "backend", "frontend", "metamodel"})

# Core capability / data-scope strings a manifest may declare under ``grants``.
# The authoring-affordance grants unlock admin UI features
# (``metamodel.*`` — see api/v1/metamodel.py), the ``core.*`` grants unlock
# SDK bridge access (todos bridge + event subscriptions since SDK 1.2, the
# read-only users bridge since SDK 1.3, the decisions bridge since SDK 1.8 —
# evaluated at call/delivery time via
# registry.grants_for). An unknown grant is a hard BundleError: a signed
# manifest carrying a typo'd scope would otherwise be silently inert. Keep in
# sync with VALID_GRANTS in scripts/extension-tools/teax.py (deliberately
# duplicated — teax is stdlib-vendorable).
VALID_GRANTS = frozenset(
    {
        "metamodel.field_help",
        "metamodel.custom_field_types",
        "core.todos.read",
        "core.todos.write",
        "core.events.todo",
        "core.users.read",
        "core.cards.read",
        "core.cards.write",
        "core.events.card",
        "core.notifications.channel",
        "core.adr.read",
        "core.adr.write",
    }
)

# fields_schema field types an extension may contribute: the built-in set, or
# a custom type namespaced under the extension's own key (ext.{key}.*).
_BUILTIN_FIELD_TYPES = frozenset(
    {
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
)
KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")

# Artwork an extension may ship as its own logo, shown on the Store and
# Installed tabs. Raster or SVG; the suffix allowlist is what stops a manifest
# nominating `manifest.json` or a wheel as its "logo" and thereby making it
# readable through the unauthenticated asset route. Keep in sync with
# LOGO_EXTENSIONS / MAX_LOGO_BYTES in scripts/extension-tools/teax.py
# (deliberately duplicated — teax is stdlib-vendorable).
# Where a contributed field section lands in a card type's stored section order
# (``section_config["__order"]``) the first time anything places it.
#
# Core holds NO opinion beyond the default: an extension says where its own
# section belongs, because "just above Relations" is right for a regulatory
# attribute block and wrong for, say, a post-decision summary meant to read
# last. Grammar: ``start``, ``end``, ``before:<anchor>`` or ``after:<anchor>``.
#
# Anchors are the built-in section keys only. ``custom:N`` is deliberately not
# addressable: it is a POSITIONAL index into the target type's fields_schema,
# so it means a different section on every install.
SECTION_ANCHORS = frozenset(
    {
        "description",
        "eol",
        "lifecycle",
        "hierarchy",
        "successors",
        "tags",
        "relations",
    }
)

# Applied when a contribution declares no placement — which every bundle built
# before the key existed does. Keeps a contributed section with the card's own
# content, matching where custom sections render when no order is stored.
DEFAULT_SECTION_PLACEMENT = "before:relations"


def placement_error(value: object) -> str | None:
    """``None`` when ``value`` is a usable placement, else why it is not.

    Shared by the bundle verifier and (mirrored) by ``teax lint`` so an
    extension cannot pass lint and then fail verify.
    """
    if not isinstance(value, str) or not value.strip():
        return "placement must be a non-empty string"
    spec = value.strip()
    if spec in ("start", "end"):
        return None
    prefix, _, anchor = spec.partition(":")
    if prefix not in ("before", "after") or not anchor:
        return f"placement {spec!r} must be 'start', 'end', 'before:<section>' or 'after:<section>'"
    if anchor not in SECTION_ANCHORS:
        return (
            f"placement {spec!r} anchors on unknown section {anchor!r} "
            f"(one of: {', '.join(sorted(SECTION_ANCHORS))})"
        )
    return None


LOGO_EXTENSIONS = frozenset({".png", ".svg", ".webp", ".jpg", ".jpeg"})
MAX_LOGO_BYTES = 512 * 1024

# Largest single file we will read into memory while hashing (bundle members and
# on-disk re-verification). Bounds the zip-bomb / tampered-file blast radius; no
# legitimate extension member approaches this.
MAX_HASHED_FILE_BYTES = 64 * 1024 * 1024


class BundleError(ValueError):
    """Raised when a ``.teax`` bundle is unsigned, tampered, or malformed."""


@dataclass(frozen=True)
class VerifiedBundle:
    """A bundle whose signature, hashes, and manifest all checked out."""

    manifest: dict[str, Any]
    path: Path

    @property
    def key(self) -> str:
        return str(self.manifest["key"])

    @property
    def version(self) -> str:
        return str(self.manifest["version"])

    @property
    def capabilities(self) -> list[str]:
        return list(self.manifest.get("capabilities", []))

    @property
    def free(self) -> bool:
        """Whether this extension runs without a license entitlement."""
        return self.manifest.get("free") is True

    @property
    def logo(self) -> str | None:
        """Relative path of the bundle's own logo artwork, if it ships one."""
        return extension_logo_path(self.manifest)


def extension_logo_path(manifest: dict[str, Any]) -> str | None:
    """The manifest's declared logo as a validated relative path, or ``None``.

    Pure and total — an absent, malformed or ineligible ``logo`` yields
    ``None`` rather than raising, so the serving path can ask without a
    try/except while :func:`_validate_manifest` turns "declared but invalid"
    into a hard :class:`BundleError`. Having exactly one implementation of the
    rules is the point: the validator, the API layer and the asset route must
    agree on what the logo path *is*, or the route would serve something the
    validator never approved.
    """
    raw = manifest.get("logo")
    if not isinstance(raw, str):
        return None
    rel = raw.strip()
    if not rel or not _safe_member_name(rel):
        return None
    if PurePosixPath(rel).suffix.lower() not in LOGO_EXTENSIONS:
        return None
    return rel


def _safe_member_name(name: str) -> bool:
    """Reject absolute paths, drive letters, backslashes, and ``..`` segments."""
    if not name or name.endswith("/"):
        return False
    if "\\" in name or name.startswith("/"):
        return False
    parts = PurePosixPath(name).parts
    return bool(parts) and ".." not in parts and not PurePosixPath(name).is_absolute()


def verify_files_on_disk(manifest: dict[str, Any], base_dir: Path) -> None:
    """Re-hash every file in the signed ``files`` map against ``base_dir``.

    The at-rest counterpart to the in-zip check in :func:`_verify_zip`: the
    manifest signature only pins the *manifest* bytes, and the manifest in
    turn pins each file's sha256 — so re-hashing the extracted files is what
    makes tampering with code on the extensions volume detectable at boot.
    Raises :class:`BundleError` on any missing file, unsafe path, oversized
    member, or hash mismatch.
    """
    files = manifest.get("files")
    if not isinstance(files, dict):
        raise BundleError("Bundle manifest is missing the files hash map")
    for member, expected in files.items():
        if not isinstance(member, str) or not _safe_member_name(member):
            raise BundleError(f"Bundle manifest lists an unsafe path: {member}")
        target = base_dir / member
        if not target.is_file():
            raise BundleError(f"Installed extension is missing a signed file: {member}")
        if target.stat().st_size > MAX_HASHED_FILE_BYTES:
            raise BundleError(f"Installed extension file is implausibly large: {member}")
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if digest != expected:
            raise BundleError(f"Installed extension file hash mismatch (tampered?): {member}")


def _validate_manifest(manifest: dict[str, Any], core_version: str) -> None:
    if manifest.get("schema") != TEAX_SCHEMA:
        raise BundleError("Bundle manifest has an unsupported or missing schema")

    key = manifest.get("key")
    if not isinstance(key, str) or not KEY_PATTERN.match(key):
        raise BundleError("Bundle key must be 2-64 chars of lowercase letters, digits, and hyphens")
    for field_name in ("name", "version"):
        if not isinstance(manifest.get(field_name), str) or not manifest[field_name].strip():
            raise BundleError(f"Bundle manifest is missing {field_name}")

    capabilities = manifest.get("capabilities")
    if not isinstance(capabilities, list) or not capabilities:
        raise BundleError("Bundle manifest must declare at least one capability")
    unknown = set(capabilities) - VALID_CAPABILITIES
    if unknown:
        raise BundleError(f"Bundle declares unknown capabilities: {sorted(unknown)}")

    # Optional ``free`` flag: a free extension needs no license entitlement to
    # run. Orthogonal to capabilities. When present it must be a real boolean.
    if "free" in manifest and not isinstance(manifest["free"], bool):
        raise BundleError("Bundle manifest field `free` must be a boolean")

    # Optional ``grants``: core capability / data-scope strings. Hard-fail on
    # unknowns — a typo'd scope in a signed manifest must surface at
    # install/verify time, not sit silently inert until a bridge call 403s.
    if "grants" in manifest:
        grants = manifest["grants"]
        if not isinstance(grants, list) or not all(isinstance(g, str) for g in grants):
            raise BundleError("Bundle manifest field `grants` must be a list of strings")
        unknown_grants = set(grants) - VALID_GRANTS
        if unknown_grants:
            raise BundleError(f"Bundle declares unknown grants: {sorted(unknown_grants)}")

    # Optional ``sdk_version``: when present it must be major.minor. The
    # loader's compatibility check reads the code attribute, but a malformed
    # manifest value is still an authoring error worth failing early.
    if "sdk_version" in manifest and not re.fullmatch(r"\d+\.\d+", str(manifest["sdk_version"])):
        raise BundleError("Bundle manifest field `sdk_version` must look like `1.2`")

    if "content" in capabilities and not manifest.get("content"):
        raise BundleError("Bundle declares the content capability but lists no content files")
    if "backend" in capabilities:
        backend = manifest.get("backend") or {}
        if not isinstance(backend, dict) or not backend.get("entrypoint"):
            raise BundleError("Bundle declares the backend capability but no entrypoint")
    if "frontend" in capabilities:
        frontend = manifest.get("frontend") or {}
        if not isinstance(frontend, dict) or not frontend.get("entry"):
            raise BundleError("Bundle declares the frontend capability but no entry file")
    if "metamodel" in capabilities:
        _validate_metamodel_block(manifest, key)
    elif manifest.get("metamodel"):
        raise BundleError(
            "Bundle carries a metamodel block but does not declare the metamodel capability"
        )

    files = manifest.get("files")
    if not isinstance(files, dict):
        raise BundleError("Bundle manifest is missing the files hash map")

    if "logo" in manifest:
        logo = extension_logo_path(manifest)
        if logo is None:
            raise BundleError(
                "Bundle manifest field `logo` must be a relative path inside the bundle "
                f"ending in one of {sorted(LOGO_EXTENSIONS)}"
            )
        if logo not in files:
            # The whole security story in one line: the logo is served
            # unauthenticated, so it must be covered by manifest.sig and by the
            # per-boot on-disk re-hash. A file dropped onto the volume beside a
            # signed manifest is never served — it quarantines the extension.
            raise BundleError(f"Bundle logo is not covered by the signed files map: {logo}")

    core = manifest.get("core") or {}
    if not isinstance(core, dict) or not core.get("min"):
        raise BundleError("Bundle manifest is missing the core compatibility range")
    running = version_tuple(core_version)
    if running < version_tuple(str(core["min"])):
        raise BundleError(
            f"Extension requires Turbo EA >= {core['min']} (this instance runs {core_version})"
        )
    max_exclusive = core.get("max_exclusive")
    if max_exclusive and running >= version_tuple(str(max_exclusive)):
        raise BundleError(
            f"Extension supports Turbo EA < {max_exclusive} (this instance runs {core_version})"
        )


def _validate_metamodel_block(manifest: dict[str, Any], ext_key: str) -> None:
    """Shape-check ``manifest["metamodel"]["field_sections"]``.

    Contributed field types must be built-in or namespaced under THIS
    extension (``ext.{key}.*``) so one extension can never squat on
    another's custom types.
    """
    block = manifest.get("metamodel")
    if not isinstance(block, dict):
        raise BundleError("metamodel capability requires a metamodel object in the manifest")
    sections = block.get("field_sections")
    subtype_rows = block.get("subtypes")
    if (not isinstance(sections, list) or not sections) and (
        not isinstance(subtype_rows, list) or not subtype_rows
    ):
        raise BundleError(
            "metamodel block must declare a non-empty field_sections and/or subtypes list"
        )
    if subtype_rows is not None:
        if not isinstance(subtype_rows, list):
            raise BundleError("metamodel.subtypes must be a list")
        for i, contrib in enumerate(subtype_rows):
            where = f"metamodel.subtypes[{i}]"
            if not isinstance(contrib, dict):
                raise BundleError(f"{where} must be an object")
            if not isinstance(contrib.get("card_type"), str) or not contrib["card_type"].strip():
                raise BundleError(f"{where} is missing card_type")
            rows = contrib.get("subtypes")
            if not isinstance(rows, list) or not rows:
                raise BundleError(f"{where} must declare a non-empty subtypes list")
            for j, s in enumerate(rows):
                sw = f"{where}.subtypes[{j}]"
                if not isinstance(s, dict):
                    raise BundleError(f"{sw} must be an object")
                for req in ("key", "label"):
                    if not isinstance(s.get(req), str) or not s[req].strip():
                        raise BundleError(f"{sw} is missing {req}")
    for i, contrib in enumerate(sections or []):
        where = f"metamodel.field_sections[{i}]"
        if not isinstance(contrib, dict):
            raise BundleError(f"{where} must be an object")
        for req in ("card_type", "section"):
            if not isinstance(contrib.get(req), str) or not contrib[req].strip():
                raise BundleError(f"{where} is missing {req}")
        if "placement" in contrib:
            problem = placement_error(contrib["placement"])
            if problem:
                raise BundleError(f"{where}: {problem}")
        fields = contrib.get("fields")
        if not isinstance(fields, list) or not fields:
            raise BundleError(f"{where} must declare a non-empty fields list")
        for j, f in enumerate(fields):
            fw = f"{where}.fields[{j}]"
            if not isinstance(f, dict):
                raise BundleError(f"{fw} must be an object")
            for req in ("key", "label", "type"):
                if not isinstance(f.get(req), str) or not f[req].strip():
                    raise BundleError(f"{fw} is missing {req}")
            ftype = f["type"]
            if ftype not in _BUILTIN_FIELD_TYPES and not ftype.startswith(f"ext.{ext_key}."):
                raise BundleError(
                    f"{fw}: type {ftype!r} must be a built-in field type or "
                    f"namespaced ext.{ext_key}.*"
                )


def _verify_zip(zf: zipfile.ZipFile, *, core_version: str) -> dict[str, Any]:
    names = zf.namelist()
    # Duplicate entry names let a bundle carry two members with the same path;
    # namelist() reports both while read(name) returns the last, so verify and
    # extract could otherwise be tricked into disagreeing. Reject outright.
    if len(names) != len(set(names)):
        raise BundleError("Bundle contains duplicate entry names")
    if MANIFEST_NAME not in names:
        raise BundleError(f"Bundle is missing {MANIFEST_NAME}")
    if SIGNATURE_NAME not in names:
        raise BundleError(f"Bundle is missing {SIGNATURE_NAME} — refusing unsigned extension")

    trusted = trusted_public_keys()
    if not trusted:
        raise BundleError(
            "This build has no extension vendor key configured — bundles cannot be verified"
        )

    # Bound the manifest's decompressed size before reading it — the manifest is
    # the one member read pre-verification, so cap the deflate-bomb surface.
    if zf.getinfo(MANIFEST_NAME).file_size > MAX_HASHED_FILE_BYTES:
        raise BundleError("Bundle manifest is implausibly large")
    manifest_bytes = zf.read(MANIFEST_NAME)
    signature_b64 = zf.read(SIGNATURE_NAME).decode("ascii", errors="replace").strip()
    # key_id lives inside the (not yet trusted) manifest; it is only a key
    # SELECTOR — a wrong or forged value just makes verification fail. Only keys
    # permitted to sign *bundles* are considered, so a license-only key (store-1)
    # can never validate installable code.
    if not verify_with_trusted(manifest_bytes, signature_b64, None, trusted, artifact="bundle"):
        raise BundleError(
            "Bundle signature verification failed — this extension was not signed by "
            "a trusted vendor key"
        )

    # Signature verified — the manifest bytes are now trusted input.
    try:
        manifest = json.loads(manifest_bytes)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise BundleError("Bundle manifest is not valid JSON") from exc
    if not isinstance(manifest, dict):
        raise BundleError("Bundle manifest must be a JSON object")

    _validate_manifest(manifest, core_version)

    # The manifest carries hashes, not sizes, so the logo's size is checked
    # here where the zip entry is at hand. Once verified it is pinned by its
    # hash, so no per-request size check is ever needed.
    logo_rel = extension_logo_path(manifest)
    if logo_rel is not None and zf.getinfo(logo_rel).file_size > MAX_LOGO_BYTES:
        raise BundleError(f"Bundle logo is larger than {MAX_LOGO_BYTES // 1024} KB: {logo_rel}")

    files: dict[str, str] = manifest["files"]
    members = [n for n in names if n not in (MANIFEST_NAME, SIGNATURE_NAME) and not n.endswith("/")]
    for member in members:
        if not _safe_member_name(member):
            raise BundleError(f"Bundle contains an unsafe path: {member}")
        expected = files.get(member)
        if expected is None:
            raise BundleError(
                f"Bundle contains a file not covered by the signed manifest: {member}"
            )
        digest = hashlib.sha256(zf.read(member)).hexdigest()
        if digest != expected:
            raise BundleError(f"Bundle file hash mismatch (tampered?): {member}")
    missing = set(files) - set(members)
    if missing:
        raise BundleError(f"Bundle is missing files listed in the manifest: {sorted(missing)}")

    return manifest


def read_bundle(path: Path, *, core_version: str = APP_VERSION) -> VerifiedBundle:
    """Open, verify, and describe a ``.teax`` bundle on disk.

    Raises :class:`BundleError` on any provenance, integrity, schema, or
    compatibility problem. Never extracts anything.
    """
    try:
        with zipfile.ZipFile(path) as zf:
            manifest = _verify_zip(zf, core_version=core_version)
    except zipfile.BadZipFile as exc:
        raise BundleError("Uploaded file is not a valid .teax bundle (bad zip)") from exc
    return VerifiedBundle(manifest=manifest, path=Path(path))


def read_bundle_fileobj(fileobj: BinaryIO, *, core_version: str = APP_VERSION) -> dict[str, Any]:
    """Verify a bundle from an open binary stream and return its manifest."""
    try:
        with zipfile.ZipFile(fileobj) as zf:
            return _verify_zip(zf, core_version=core_version)
    except zipfile.BadZipFile as exc:
        raise BundleError("Uploaded file is not a valid .teax bundle (bad zip)") from exc
