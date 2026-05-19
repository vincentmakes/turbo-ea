"""LeanIX workspace-snapshot parser.

A LeanIX workspace snapshot is a gzipped JSON document intended for
tenant-to-tenant cloning. The schema is **undocumented** by SAP/LeanIX —
this parser handles the shapes seen in real-world snapshots (see
``tests/fixtures/leanix/`` for samples) and falls back gracefully on
fields it does not recognise so a single unknown attribute does not
abort a whole import.

The parser is **streaming**: ``ijson.items()`` walks the top-level
collection without holding the whole document in memory, so 10k+
fact-sheet workspaces stay well under a sensible RAM budget. Each
recognised section is normalised into a typed dataclass; everything
else is preserved verbatim as ``raw`` for later inspection.

Two entry points are exposed:

- :func:`parse_snapshot` — parse from an already-open gzipped file
  handle. Suitable for tests where the snapshot is small.
- :func:`parse_snapshot_path` — parse from an on-disk path; opens the
  file in streaming mode.

The supported snapshot-version allowlist lives in
:data:`SUPPORTED_SNAPSHOT_VERSIONS`. An unrecognised version is logged
but does not raise — the staging layer surfaces it as a warning to the
admin.
"""

from __future__ import annotations

import gzip
import io
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, BinaryIO, Iterable

import ijson  # type: ignore[import-untyped]

logger = logging.getLogger(__name__)

# Snapshot ``version`` strings observed in real exports. Allowlist is
# advisory only — unknown versions parse with best effort.
SUPPORTED_SNAPSHOT_VERSIONS: set[str] = {"1.0", "2.0", "unknown"}


# ---------------------------------------------------------------------------
# Typed payloads
# ---------------------------------------------------------------------------


@dataclass
class FactSheet:
    leanix_id: str
    type: str  # LeanIX FS type, e.g. "Application"
    name: str
    display_name: str | None = None
    category: str | None = None  # LeanIX "subtype" equivalent
    description: str | None = None
    lifecycle: dict[str, str] = field(default_factory=dict)  # phase -> ISO date
    tags: list[str] = field(default_factory=list)  # tag ids
    parent_id: str | None = None  # resolved via relToParent / relToChild
    custom_fields: dict[str, Any] = field(default_factory=dict)
    quality_seal: str | None = None
    completion: float | None = None
    status: str | None = None  # LeanIX FS-level status (ACTIVE / ARCHIVED)
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class Relation:
    leanix_id: str
    type: str  # e.g. "relApplicationToITComponent"
    source_id: str
    target_id: str
    attributes: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class Subscription:
    leanix_id: str
    fact_sheet_id: str
    user_email: str | None
    user_display_name: str | None
    role_name: str | None  # e.g. "Application Owner"
    role_type: str | None  # RESPONSIBLE | ACCOUNTABLE | OBSERVER
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class Tag:
    leanix_id: str
    name: str
    group_name: str | None
    group_mode: str | None  # SINGLE | MULTIPLE
    color: str | None = None


@dataclass
class Document:
    leanix_id: str
    fact_sheet_id: str
    name: str
    url: str | None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class Comment:
    leanix_id: str
    fact_sheet_id: str
    author_email: str | None
    body: str
    created_at: datetime | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class UserRef:
    leanix_id: str
    email: str
    display_name: str | None = None


@dataclass
class MetamodelField:
    type_name: str  # LeanIX FS type the field is attached to
    key: str
    label: str
    data_type: str  # LeanIX STRING / SINGLE_SELECT / FACT_SHEET_REFERENCE / ...
    options: list[dict[str, Any]] = field(default_factory=list)
    translations: dict[str, str] = field(default_factory=dict)
    is_custom: bool = True  # False if it's a known LeanIX default field


@dataclass
class MetamodelType:
    name: str
    is_custom: bool
    fields: list[MetamodelField] = field(default_factory=list)
    subtypes: list[str] = field(default_factory=list)


@dataclass
class MetamodelRelationType:
    name: str
    source_type: str
    target_type: str
    label: str | None = None
    attributes_schema: list[dict[str, Any]] = field(default_factory=list)
    is_custom: bool = True


@dataclass
class LeanixSnapshot:
    version: str
    fact_sheets: list[FactSheet]
    relations: list[Relation]
    subscriptions: list[Subscription]
    tags: list[Tag]
    documents: list[Document]
    comments: list[Comment]
    users: list[UserRef]
    metamodel_types: list[MetamodelType]
    metamodel_relation_types: list[MetamodelRelationType]
    parse_errors: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Top-level entry points
# ---------------------------------------------------------------------------


def parse_snapshot_path(path: str) -> LeanixSnapshot:
    """Parse a LeanIX export from a path.

    Three formats are accepted:

    1. ``.xlsx`` workbook (LeanIX "Full Export" download) — dispatched to
       :mod:`leanix_xlsx_parser`. Detected by ZIP magic ``PK\\x03\\x04``.
    2. Gzipped JSON tenant-cloning snapshot — detected by magic ``\\x1f\\x8b``.
    3. Plain JSON snapshot.

    Detection is by **file content**, not extension, so a misnamed file
    still routes to the right parser.
    """
    with open(path, "rb") as fh:
        head = fh.read(4)
    if len(head) >= 4 and head[:4] == b"PK\x03\x04":
        # xlsx (ZIP) — import lazily so a JSON-only consumer doesn't pay
        # the openpyxl import cost on every snapshot.
        from app.services.leanix_xlsx_parser import parse_xlsx_path

        return parse_xlsx_path(path)
    if path.endswith(".gz") or head[:2] == b"\x1f\x8b":
        with gzip.open(path, "rb") as fh:
            return parse_snapshot(fh)  # type: ignore[arg-type]
    with open(path, "rb") as fh:
        return parse_snapshot(fh)


def parse_snapshot(stream: BinaryIO) -> LeanixSnapshot:
    """Parse a LeanIX snapshot from an open binary stream.

    The stream may be plain JSON or gzip-compressed — the gzip magic
    bytes ``1f 8b`` are detected from the first two bytes and the
    stream is transparently inflated.

    The stream is read once. For workspaces over ~50 MB prefer
    :func:`parse_snapshot_path`, which streams from disk and never
    pulls the full payload into RAM.
    """
    # The snapshot's top-level shape is undocumented. The safe strategy
    # is to buffer the bytes into a BytesIO so we can use ``ijson`` with
    # multiple prefix passes — each section is a separate top-level key
    # and ijson cannot re-wind a non-seekable stream.
    raw = stream.read()
    if raw[:2] == b"\x1f\x8b":  # gzip magic
        raw = gzip.decompress(raw)
    stream = io.BytesIO(raw)

    errors: list[str] = []

    # ---- version sniff ----
    version = _sniff_version(stream, errors)
    if version not in SUPPORTED_SNAPSHOT_VERSIONS:
        logger.warning("leanix snapshot version %r not in allowlist", version)

    fact_sheets = list(_parse_fact_sheets(stream, errors))
    relations = list(_parse_relations(stream, errors))
    subscriptions = list(_parse_subscriptions(stream, errors))
    tags = list(_parse_tags(stream, errors))
    documents = list(_parse_documents(stream, errors))
    comments = list(_parse_comments(stream, errors))
    users = list(_parse_users(stream, errors))
    metamodel_types, metamodel_relation_types = _parse_metamodel(stream, errors)

    # Hierarchy is encoded as relToParent / relToChild relations in
    # LeanIX rather than as a parent_id column on the FS. Resolve it in
    # one pass so downstream code can just read FactSheet.parent_id.
    _resolve_hierarchy(fact_sheets, relations)

    return LeanixSnapshot(
        version=version,
        fact_sheets=fact_sheets,
        relations=relations,
        subscriptions=subscriptions,
        tags=tags,
        documents=documents,
        comments=comments,
        users=users,
        metamodel_types=metamodel_types,
        metamodel_relation_types=metamodel_relation_types,
        parse_errors=errors,
    )


# ---------------------------------------------------------------------------
# Section parsers
# ---------------------------------------------------------------------------


def _sniff_version(stream: BinaryIO, errors: list[str]) -> str:
    """Pull a top-level ``version`` field (if any) without loading the body."""
    stream.seek(0)
    try:
        for prefix, _, value in ijson.parse(stream):
            if prefix == "version":
                return str(value)
            # Most snapshots put the version as the first scalar; bail
            # the moment we see the first complex section open.
            if prefix.endswith(".item") or prefix.endswith(".item.start_map"):
                break
    except (ijson.JSONError, ValueError) as exc:
        errors.append(f"version sniff failed: {exc}")
    return "unknown"


def _section_items(stream: BinaryIO, *prefixes: str) -> Iterable[dict[str, Any]]:
    """Yield every item under any of ``prefixes`` (first non-empty wins)."""
    for prefix in prefixes:
        stream.seek(0)
        try:
            yielded = False
            for item in ijson.items(stream, prefix):
                yielded = True
                if isinstance(item, dict):
                    yield item
            if yielded:
                return
        except (ijson.JSONError, ValueError):
            continue


def _parse_fact_sheets(stream: BinaryIO, errors: list[str]) -> Iterable[FactSheet]:
    # Real LeanIX exports place fact sheets under either ``factSheets.item``
    # (snapshot format 2.0) or ``data.allFactSheets.edges.item.node`` (the
    # GraphQL-style export). Try both.
    for raw in _section_items(stream, "factSheets.item", "data.allFactSheets.edges.item.node"):
        try:
            yield _build_fact_sheet(raw)
        except Exception as exc:  # noqa: BLE001 — collect and continue
            errors.append(f"fact_sheet parse error: {exc}")


def _build_fact_sheet(raw: dict[str, Any]) -> FactSheet:
    leanix_id = str(raw.get("id") or raw.get("ID") or raw.get("factSheetId") or "")
    if not leanix_id:
        raise ValueError("fact sheet without id")
    fs_type = str(raw.get("type") or "")
    name = str(raw.get("name") or raw.get("displayName") or "")
    return FactSheet(
        leanix_id=leanix_id,
        type=fs_type,
        name=name,
        display_name=raw.get("displayName"),
        category=raw.get("category") or raw.get("subType"),
        description=raw.get("description"),
        lifecycle=_lifecycle_from_raw(raw),
        tags=[str(t.get("id") or t) for t in (raw.get("tags") or []) if t],
        parent_id=None,  # resolved in second pass
        custom_fields=_custom_fields_from_raw(raw),
        quality_seal=raw.get("qualitySeal"),
        completion=_float_or_none(raw.get("completion")),
        status=raw.get("status"),
        raw=raw,
    )


def _lifecycle_from_raw(raw: dict[str, Any]) -> dict[str, str]:
    lc = raw.get("lifecycle")
    out: dict[str, str] = {}
    if isinstance(lc, dict):
        for phase in lc.get("phases") or []:
            if not isinstance(phase, dict):
                continue
            key = phase.get("phase") or phase.get("name")
            start = phase.get("startDate") or phase.get("start")
            if key and start:
                out[str(key)] = str(start)
    return out


# LeanIX-native fields we know are NOT custom — anything else on the
# raw fact-sheet payload is treated as a custom attribute and surfaced
# in the metamodel-diff preview.
_LX_KNOWN_FIELDS = frozenset(
    {
        "id",
        "ID",
        "factSheetId",
        "type",
        "name",
        "displayName",
        "category",
        "subType",
        "description",
        "lifecycle",
        "tags",
        "qualitySeal",
        "completion",
        "subscriptions",
        "documents",
        "comments",
        "relations",
        "permittedReadACL",
        "permittedWriteACL",
        "createdAt",
        "updatedAt",
        "status",
    }
)


def _custom_fields_from_raw(raw: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in raw.items() if k not in _LX_KNOWN_FIELDS}


def _parse_relations(stream: BinaryIO, errors: list[str]) -> Iterable[Relation]:
    for raw in _section_items(stream, "relations.item", "data.allRelations.edges.item.node"):
        try:
            src = raw.get("source") or raw.get("from")
            tgt = raw.get("target") or raw.get("to")
            src_id = str(src.get("id") if isinstance(src, dict) else src or "")
            tgt_id = str(tgt.get("id") if isinstance(tgt, dict) else tgt or "")
            if not (src_id and tgt_id):
                continue
            yield Relation(
                leanix_id=str(raw.get("id") or f"{src_id}-{tgt_id}"),
                type=str(raw.get("type") or raw.get("relationType") or ""),
                source_id=src_id,
                target_id=tgt_id,
                attributes={
                    k: v
                    for k, v in raw.items()
                    if k not in {"id", "type", "relationType", "source", "target", "from", "to"}
                },
                raw=raw,
            )
        except Exception as exc:  # noqa: BLE001
            errors.append(f"relation parse error: {exc}")


def _parse_subscriptions(stream: BinaryIO, errors: list[str]) -> Iterable[Subscription]:
    for raw in _section_items(stream, "subscriptions.item"):
        try:
            user = raw.get("user") or {}
            role = raw.get("role") or {}
            fs_id = str(raw.get("factSheetId") or (raw.get("factSheet") or {}).get("id") or "")
            if not fs_id:
                continue
            yield Subscription(
                leanix_id=str(raw.get("id") or ""),
                fact_sheet_id=fs_id,
                user_email=user.get("email"),
                user_display_name=user.get("displayName") or user.get("name"),
                role_name=role.get("name") if isinstance(role, dict) else None,
                role_type=raw.get("type") or (role.get("type") if isinstance(role, dict) else None),
                raw=raw,
            )
        except Exception as exc:  # noqa: BLE001
            errors.append(f"subscription parse error: {exc}")


def _parse_tags(stream: BinaryIO, errors: list[str]) -> Iterable[Tag]:
    for raw in _section_items(stream, "tags.item"):
        try:
            group = raw.get("tagGroup") or {}
            yield Tag(
                leanix_id=str(raw.get("id") or ""),
                name=str(raw.get("name") or ""),
                group_name=group.get("name") if isinstance(group, dict) else None,
                group_mode=group.get("mode") if isinstance(group, dict) else None,
                color=raw.get("color"),
            )
        except Exception as exc:  # noqa: BLE001
            errors.append(f"tag parse error: {exc}")


def _parse_documents(stream: BinaryIO, errors: list[str]) -> Iterable[Document]:
    for raw in _section_items(stream, "documents.item"):
        try:
            fs_id = str(raw.get("factSheetId") or (raw.get("factSheet") or {}).get("id") or "")
            if not fs_id:
                continue
            yield Document(
                leanix_id=str(raw.get("id") or ""),
                fact_sheet_id=fs_id,
                name=str(raw.get("name") or raw.get("displayName") or ""),
                url=raw.get("url") or raw.get("documentUrl"),
                raw=raw,
            )
        except Exception as exc:  # noqa: BLE001
            errors.append(f"document parse error: {exc}")


def _parse_comments(stream: BinaryIO, errors: list[str]) -> Iterable[Comment]:
    for raw in _section_items(stream, "comments.item"):
        try:
            fs_id = str(raw.get("factSheetId") or (raw.get("factSheet") or {}).get("id") or "")
            if not fs_id:
                continue
            author = raw.get("author") or raw.get("user") or {}
            yield Comment(
                leanix_id=str(raw.get("id") or ""),
                fact_sheet_id=fs_id,
                author_email=author.get("email") if isinstance(author, dict) else None,
                body=str(raw.get("message") or raw.get("body") or ""),
                created_at=_iso_or_none(raw.get("createdAt") or raw.get("created")),
                raw=raw,
            )
        except Exception as exc:  # noqa: BLE001
            errors.append(f"comment parse error: {exc}")


def _parse_users(stream: BinaryIO, errors: list[str]) -> Iterable[UserRef]:
    seen: set[str] = set()
    for raw in _section_items(stream, "users.item"):
        try:
            email = (raw.get("email") or "").strip().lower()
            if not email or email in seen:
                continue
            seen.add(email)
            yield UserRef(
                leanix_id=str(raw.get("id") or email),
                email=email,
                display_name=raw.get("displayName") or raw.get("name"),
            )
        except Exception as exc:  # noqa: BLE001
            errors.append(f"user parse error: {exc}")


def _parse_metamodel(
    stream: BinaryIO,
    errors: list[str],
) -> tuple[list[MetamodelType], list[MetamodelRelationType]]:
    """Pull custom field/type/relation definitions from the snapshot's metamodel section.

    LeanIX stores per-tenant metamodel extensions under one of two
    keys. Default-tenant snapshots may have no extensions, in which
    case both lists are empty.
    """
    types: list[MetamodelType] = []
    relation_types: list[MetamodelRelationType] = []
    stream.seek(0)
    try:
        raw_root = json.loads(stream.read().decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        # Try again with gzip decoding in case the caller passed a path
        # but we got handed the compressed bytes by accident.
        errors.append(f"metamodel parse: cannot decode body as utf-8 JSON ({exc})")
        return types, relation_types

    mm = raw_root.get("metamodel") or raw_root.get("dataModel") or {}
    for ft in mm.get("factSheetTypes") or mm.get("types") or []:
        if not isinstance(ft, dict):
            continue
        name = str(ft.get("name") or "")
        if not name:
            continue
        fields_out: list[MetamodelField] = []
        for f in ft.get("fields") or []:
            if not isinstance(f, dict):
                continue
            fields_out.append(
                MetamodelField(
                    type_name=name,
                    key=str(f.get("key") or f.get("name") or ""),
                    label=str(f.get("label") or f.get("key") or ""),
                    data_type=str(f.get("type") or f.get("dataType") or "STRING").upper(),
                    options=list(f.get("values") or f.get("options") or []),
                    translations=dict(f.get("translations") or {}),
                    is_custom=bool(f.get("isCustom", True)),
                )
            )
        types.append(
            MetamodelType(
                name=name,
                is_custom=bool(ft.get("isCustom", False)),
                fields=fields_out,
                subtypes=[str(s) for s in (ft.get("subtypes") or ft.get("categories") or [])],
            )
        )

    for rt in mm.get("relationTypes") or []:
        if not isinstance(rt, dict):
            continue
        relation_types.append(
            MetamodelRelationType(
                name=str(rt.get("name") or ""),
                source_type=str(rt.get("from") or rt.get("source") or ""),
                target_type=str(rt.get("to") or rt.get("target") or ""),
                label=rt.get("label"),
                attributes_schema=list(rt.get("attributes") or []),
                is_custom=bool(rt.get("isCustom", True)),
            )
        )

    return types, relation_types


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _resolve_hierarchy(fact_sheets: list[FactSheet], relations: list[Relation]) -> None:
    """Set ``FactSheet.parent_id`` from ``relToParent`` / ``relToChild`` edges."""
    by_id = {fs.leanix_id: fs for fs in fact_sheets}
    for rel in relations:
        if rel.type == "relToParent" and rel.source_id in by_id:
            by_id[rel.source_id].parent_id = rel.target_id
        elif rel.type == "relToChild" and rel.target_id in by_id:
            by_id[rel.target_id].parent_id = rel.source_id


def _iso_or_none(raw: Any) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None


def _float_or_none(raw: Any) -> float | None:
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None
