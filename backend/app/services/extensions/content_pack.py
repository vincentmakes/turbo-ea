"""Content packs — data-only extension payloads.

A content pack ships metamodel additions and seed data as JSON files
listed under ``manifest["content"]``. Each file is an object mapping
**workspace-transfer sheet names** to row lists::

    {
      "CardTypes": [ { "key": "EsgMetric", "label": "ESG Metric", ... } ],
      "TagGroups": [ ... ],
      "Cards": [ ... ],
      "Relations": [ ... ]
    }

Rows use exactly the shapes the workspace exporter produces
(``CARD_TYPE_COLUMNS`` etc.), so packs are applied through the proven
``workspace_io`` engine and inherit all of its guarantees for free:
idempotent upsert-by-natural-key, built-in-type protection, the
one-relation-type-per-pair rule, topo-sorted card creation, and dry-run
preview via savepoint rollback. Authoring workflow: build the content on
a staging instance, export the workspace, and copy the relevant sheets.

Only inventory/metamodel-shaped sheets are allowed — a content pack can
never smuggle users, roles, or settings into an instance.
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path
from typing import Any, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.workspace_io import ApplyResult, WorkspaceBundle, apply_selected
from app.services.workspace_io import schema as ws_schema

CONTENT_ALLOWED_SHEETS: tuple[str, ...] = (
    ws_schema.SHEET_CARD_TYPES,
    ws_schema.SHEET_RELATION_TYPES,
    ws_schema.SHEET_STAKEHOLDER_ROLES,
    ws_schema.SHEET_CALCULATIONS,
    ws_schema.SHEET_PRINCIPLES,
    ws_schema.SHEET_COMPLIANCE_REGS,
    ws_schema.SHEET_RESOURCE_TYPES,
    ws_schema.SHEET_TAG_GROUPS,
    ws_schema.SHEET_TAGS,
    ws_schema.SHEET_CARDS,
    ws_schema.SHEET_CARD_TAGS,
    ws_schema.SHEET_RELATIONS,
)


class ContentPackError(ValueError):
    """Raised when a content pack's JSON payloads are malformed."""


def load_content(ext_dir: Path, manifest: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Read + merge a pack's content files from an extracted extension dir."""

    def read(rel: str) -> bytes:
        return (ext_dir / rel).read_bytes()

    return _parse_content(manifest, read)


def load_content_from_zip(
    bundle_path: Path, manifest: dict[str, Any]
) -> dict[str, list[dict[str, Any]]]:
    """Read + merge a pack's content files straight from the ``.teax`` zip.

    Used by the preview job, which runs before anything is extracted onto
    the extensions volume.
    """
    with zipfile.ZipFile(bundle_path) as zf:

        def read(rel: str) -> bytes:
            return zf.read(rel)

        return _parse_content(manifest, read)


def _parse_content(
    manifest: dict[str, Any], read: Callable[[str], bytes]
) -> dict[str, list[dict[str, Any]]]:
    """Merge content files into ``{sheet: rows}``.

    Paths were already validated against the signed manifest hash map, so
    this only guards shape: unknown sheets and non-list sections are
    rejected outright rather than silently ignored.
    """
    sheets: dict[str, list[dict[str, Any]]] = {}
    for rel in manifest.get("content", []):
        try:
            payload = json.loads(read(str(rel)).decode("utf-8"))
        except (FileNotFoundError, KeyError) as exc:
            raise ContentPackError(f"Content file missing: {rel}") from exc
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ContentPackError(f"Content file {rel} is not valid JSON: {exc}") from exc
        if not isinstance(payload, dict):
            raise ContentPackError(f"Content file {rel} must be an object of sheet -> rows")
        for sheet, rows in payload.items():
            if sheet not in CONTENT_ALLOWED_SHEETS:
                raise ContentPackError(
                    f"Content file {rel} targets unsupported sheet '{sheet}' "
                    f"(allowed: {', '.join(CONTENT_ALLOWED_SHEETS)})"
                )
            if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
                raise ContentPackError(f"Sheet '{sheet}' in {rel} must be a list of row objects")
            sheets.setdefault(sheet, []).extend(rows)
    return sheets


def build_content_bundle(sheets: dict[str, list[dict[str, Any]]]) -> WorkspaceBundle:
    return WorkspaceBundle(manifest={"format_version": ws_schema.FORMAT_VERSION}, sheets=sheets)


async def preview_content(
    db: AsyncSession, sheets: dict[str, list[dict[str, Any]]], user: User
) -> ApplyResult:
    """Dry-run the pack — same engine, one savepoint, rolled back."""
    return await apply_selected(
        db, build_content_bundle(sheets), user, sheets=set(sheets), dry_run=True
    )


async def apply_content(
    db: AsyncSession, sheets: dict[str, list[dict[str, Any]]], user: User
) -> ApplyResult:
    """Apply the pack for real. Commits via the workspace engine."""
    return await apply_selected(
        db, build_content_bundle(sheets), user, sheets=set(sheets), dry_run=False
    )
