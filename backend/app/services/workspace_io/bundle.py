"""Zip bundle packing/unpacking + workbook (de)serialisation helpers.

The exporter produces a ``.zip`` containing ``manifest.json``, ``workspace.xlsx``
and an ``assets/`` tree; the importer reverses it. Keeping the zip and workbook
plumbing here lets the exporter/importer focus on *what* data to move, not the
file format.
"""

from __future__ import annotations

import io
import json
import os
import uuid
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from openpyxl import Workbook, load_workbook

from app.services.workspace_io.schema import (
    ASSETS_DIR,
    MANIFEST_NAME,
    WORKBOOK_NAME,
)

# Excel caps a cell at 32,767 chars and openpyxl *silently truncates* beyond it,
# which corrupts large JSON blobs (e.g. a heavily-customised ``fields_schema``).
# Any cell longer than this is offloaded to an ``overflow/`` asset and replaced
# by a short token; ``parse_bundle`` restores it transparently before the
# appliers see it.
CELL_OVERFLOW_LIMIT = 30000
OVERFLOW_PREFIX = "@@WSIO_OVERFLOW@@:"


# A bundle is imported from disk and its assets are read one at a time, so
# neither cap below is about a legitimate workspace: they bound what a
# hand-crafted zip can make the importer allocate. The declared sizes in the
# central directory are authoritative here — CPython's ZipExtFile refuses to
# hand back more bytes than a member declares, so checking them really does
# bound memory.
MAX_ASSET_BYTES = 64 * 1024 * 1024  # one member; the largest legitimate one is a 20 MB attachment
MAX_BUNDLE_UNCOMPRESSED_BYTES = 20 * 1024**3  # everything inflated, ~10x the 2 GB upload cap


class BundleFormatError(ValueError):
    """Raised when an uploaded file isn't a valid workspace bundle."""


@runtime_checkable
class AssetStore(Protocol):
    """Read access to a bundle's ``assets/`` tree.

    A plain ``dict[str, bytes]`` satisfies this, which is what lets a content
    pack (``content_pack.build_content_bundle``) and the tests keep building
    bundles in memory while a real import reads from the zip on demand.
    """

    def get(self, name: str, default: bytes | None = None) -> bytes | None: ...

    def __contains__(self, name: object) -> bool: ...

    def keys(self) -> Iterable[str]: ...


class ZipAssetStore:
    """Read-through view of ``assets/`` — a member is read only when asked for.

    A workspace's assets are its file attachments, diagram XML and branding,
    which on a large instance is most of the bundle. Inflating all of them up
    front (what ``unpack`` does) is what made a big import a memory problem;
    the applier asks for one asset per row, so it never needs more than one in
    memory at a time.
    """

    def __init__(self, zf: zipfile.ZipFile) -> None:
        self._zf: zipfile.ZipFile | None = zf
        prefix = f"{ASSETS_DIR}/"
        self._members = {
            name[len(prefix) :]: name
            for name in zf.namelist()
            if name.startswith(prefix) and not name.endswith("/")
        }

    def get(self, name: str, default: bytes | None = None) -> bytes | None:
        member = self._members.get(name)
        if member is None:
            return default
        if self._zf is None:
            raise RuntimeError("bundle is closed — read its assets before closing it")
        return self._zf.read(member)

    def __contains__(self, name: object) -> bool:
        return name in self._members

    def keys(self) -> list[str]:
        return sorted(self._members)

    def close(self) -> None:
        if self._zf is not None:
            self._zf.close()
            self._zf = None


@dataclass
class WorkspaceBundle:
    """Parsed view of an uploaded bundle.

    ``sheets`` is always materialised; ``assets`` may be lazy (see
    :class:`ZipAssetStore`), so hold the bundle open for as long as the applier
    runs — ``with parse_bundle(path) as bundle:``.
    """

    manifest: dict[str, Any]
    sheets: dict[str, list[dict[str, Any]]]
    assets: AssetStore = field(default_factory=dict)
    parse_errors: list[str] = field(default_factory=list)

    def close(self) -> None:
        closer = getattr(self.assets, "close", None)
        if callable(closer):
            closer()

    def __enter__(self) -> WorkspaceBundle:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    @property
    def format_version(self) -> str:
        return str(self.manifest.get("format_version", ""))

    def rows(self, sheet: str) -> list[dict[str, Any]]:
        return self.sheets.get(sheet, [])


# ---------------------------------------------------------------------------
# JSON-in-cell helpers
# ---------------------------------------------------------------------------


def to_cell(value: Any, *, is_json: bool) -> Any:
    """Coerce a Python value into something openpyxl can write to a cell."""
    if is_json:
        # Always serialise JSON columns (even None) so the importer can round
        # trip an explicit empty dict/list vs a missing value.
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    if value is None:
        return None
    if isinstance(value, bool | int | float | str):
        return value
    # Dates, UUIDs, etc. — stringify defensively.
    return str(value)


def from_cell(value: Any, *, is_json: bool) -> Any:
    """Parse a cell value back into a Python value. Raises on bad JSON."""
    if is_json:
        if value is None or value == "":
            return None
        if isinstance(value, str):
            return json.loads(value)
        return value
    return value


# ---------------------------------------------------------------------------
# Workbook read/write
# ---------------------------------------------------------------------------


def write_sheet(
    wb: Workbook,
    name: str,
    columns: list[str],
    rows: list[dict[str, Any]],
    assets: dict[str, bytes] | None = None,
) -> None:
    """Append a sheet with a header row followed by ``rows``.

    ``rows`` values are assumed to already be cell-ready (callers run
    ``to_cell`` per column with the right ``is_json`` flag). When ``assets`` is
    provided, any string value over :data:`CELL_OVERFLOW_LIMIT` is offloaded to
    an ``overflow/`` asset and replaced by a token, so openpyxl's 32,767-char
    truncation can never corrupt a large JSON blob.
    """
    ws = wb.create_sheet(title=name[:31])
    ws.append(columns)
    for row in rows:
        cells: list[Any] = []
        for col in columns:
            v = row.get(col)
            if assets is not None and isinstance(v, str) and len(v) > CELL_OVERFLOW_LIMIT:
                key = f"overflow/{uuid.uuid4().hex}.txt"
                assets[key] = v.encode("utf-8")
                v = OVERFLOW_PREFIX + key
            cells.append(v)
        ws.append(cells)


def read_workbook(raw: bytes) -> dict[str, list[dict[str, Any]]]:
    """Read every sheet into ``{sheet_name: [row_dict, ...]}`` (header-keyed)."""
    try:
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001
        raise BundleFormatError(f"Could not read workbook: {exc}") from exc
    out: dict[str, list[dict[str, Any]]] = {}
    for ws in wb.worksheets:
        rows_iter = ws.iter_rows(values_only=True)
        try:
            header = next(rows_iter)
        except StopIteration:
            out[ws.title] = []
            continue
        cols = [str(h) if h is not None else "" for h in header]
        sheet_rows: list[dict[str, Any]] = []
        for raw_row in rows_iter:
            if raw_row is None or all(v is None for v in raw_row):
                continue
            sheet_rows.append({cols[i]: raw_row[i] for i in range(len(cols)) if i < len(raw_row)})
        out[ws.title] = sheet_rows
    wb.close()
    return out


# ---------------------------------------------------------------------------
# Zip pack/unpack
# ---------------------------------------------------------------------------


def pack(manifest: dict[str, Any], workbook_bytes: bytes, assets: dict[str, bytes]) -> bytes:
    """Build the ``.zip`` bundle in memory."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(MANIFEST_NAME, json.dumps(manifest, ensure_ascii=False, indent=2))
        zf.writestr(WORKBOOK_NAME, workbook_bytes)
        for rel_path, data in assets.items():
            zf.writestr(f"{ASSETS_DIR}/{rel_path}", data)
    return buf.getvalue()


def open_bundle(
    src: bytes | str | os.PathLike[str],
) -> tuple[zipfile.ZipFile, dict[str, Any], bytes]:
    """Open a bundle and return ``(zipfile, manifest, workbook_bytes)``.

    Given a path the zip is opened *on disk* and left open, so its members can
    be read one at a time; given bytes it is read from memory as before. The
    workbook is materialised either way — openpyxl needs a seekable buffer and
    its rows end up in ``sheets`` regardless, so it is not what a large import
    can be spared.

    The caller owns the returned :class:`zipfile.ZipFile` and must close it.
    Raises :class:`BundleFormatError` if the zip is malformed or is missing the
    workbook / manifest.
    """
    try:
        source: Any = io.BytesIO(src) if isinstance(src, bytes) else Path(src)
        zf = zipfile.ZipFile(source)
    except zipfile.BadZipFile as exc:
        raise BundleFormatError("Uploaded file is not a valid .zip bundle") from exc
    except OSError as exc:
        raise BundleFormatError(f"Could not read the bundle: {exc}") from exc

    try:
        _check_declared_sizes(zf)

        names = set(zf.namelist())
        if WORKBOOK_NAME not in names:
            raise BundleFormatError(f"Bundle is missing {WORKBOOK_NAME}")

        manifest: dict[str, Any] = {}
        if MANIFEST_NAME in names:
            try:
                manifest = json.loads(zf.read(MANIFEST_NAME).decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                raise BundleFormatError(f"Bundle {MANIFEST_NAME} is not valid JSON: {exc}") from exc

        workbook_bytes = zf.read(WORKBOOK_NAME)
    except Exception:
        zf.close()
        raise

    return zf, manifest, workbook_bytes


def _check_declared_sizes(zf: zipfile.ZipFile) -> None:
    """Refuse a bundle whose central directory declares implausible sizes.

    Walks the directory only — no member is read — so this costs one pass over
    the entry list however large the archive is.
    """
    total = 0
    for info in zf.infolist():
        if info.is_dir():
            continue
        if info.file_size > MAX_ASSET_BYTES:
            raise BundleFormatError(
                f"Bundle member {info.filename} declares {info.file_size} bytes; "
                f"the limit is {MAX_ASSET_BYTES // (1024 * 1024)} MB"
            )
        total += info.file_size
        if total > MAX_BUNDLE_UNCOMPRESSED_BYTES:
            raise BundleFormatError(
                "Bundle expands to more than "
                f"{MAX_BUNDLE_UNCOMPRESSED_BYTES // 1024**3} GB and was refused"
            )


def unpack(raw: bytes) -> tuple[dict[str, Any], bytes, dict[str, bytes]]:
    """Split a bundle into ``(manifest, workbook_bytes, assets)``, eagerly.

    Kept for callers that genuinely want every asset in memory at once. An
    import goes through :func:`parse_bundle` instead.
    """
    zf, manifest, workbook_bytes = open_bundle(raw)
    try:
        store = ZipAssetStore(zf)
        assets = {name: store.get(name) or b"" for name in store.keys()}
    finally:
        zf.close()
    return manifest, workbook_bytes, assets


def parse_bundle(src: bytes | str | os.PathLike[str]) -> WorkspaceBundle:
    """Read a bundle into a :class:`WorkspaceBundle`.

    Pass the uploaded file's **path** for an import: the zip is then held open
    and each asset is read only when the applier asks for it, which is what
    keeps a multi-gigabyte bundle off the heap. The returned bundle owns that
    open file, so use it as a context manager (``with parse_bundle(path) as
    bundle:``) or call ``close()`` when the apply is done. Bytes are still
    accepted, and then nothing needs closing.

    Overflow tokens written by :func:`write_sheet` are resolved back to their
    full string value from the ``overflow/`` assets, so callers never see a
    truncated cell.
    """
    zf, manifest, workbook_bytes = open_bundle(src)
    try:
        assets: AssetStore = ZipAssetStore(zf)
        sheets = read_workbook(workbook_bytes)
        for sheet_rows in sheets.values():
            for row in sheet_rows:
                for key, value in row.items():
                    if isinstance(value, str) and value.startswith(OVERFLOW_PREFIX):
                        path = value[len(OVERFLOW_PREFIX) :]
                        blob = assets.get(path)
                        if blob is not None:
                            row[key] = blob.decode("utf-8")
    except Exception:
        zf.close()
        raise
    return WorkspaceBundle(manifest=manifest, sheets=sheets, assets=assets)
