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

# Sheet name of the Survey EntitySection (declared in workspace_io.sections).
# A pack may ship *surveys* (landed as drafts — see _enforce_survey_draft) but
# never survey *responses*.
SHEET_SURVEYS = "Surveys"

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
    SHEET_SURVEYS,
)


def _enforce_survey_draft(sheets: dict[str, list[dict[str, Any]]]) -> None:
    """Guardrail: a pack-shipped survey always lands as a reviewable DRAFT.

    An extension must never be able to install a survey that is already
    ``active`` — that would blast emails to card subscribers on install. We
    clamp ``status`` to ``draft`` and clear the send/close timestamps in-place,
    so the admin explicitly targets and sends it (the fields it ships arrive
    pre-selected in the builder). Applied on both preview and apply so the
    dry-run reflects exactly what lands.
    """
    for row in sheets.get(SHEET_SURVEYS, []):
        if isinstance(row, dict):
            row["status"] = "draft"
            row["sent_at"] = None
            row["closed_at"] = None


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
    # Chokepoint for both preview and apply: pack surveys are forced to draft.
    _enforce_survey_draft(sheets)
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


async def set_content_visibility(
    db: AsyncSession, ext_dir: Path, manifest: dict[str, Any], hidden: bool
) -> int:
    """Hide or unhide the metamodel entries a content pack declares.

    Disabling or uninstalling a content pack must visibly deactivate it
    without destroying anything: the pack's card types and relation types
    are flipped to ``is_hidden`` (the metamodel's soft-delete, exactly what
    Admin → Metamodel delete does), while cards and every other row stay
    untouched. Enabling or reinstalling flips them back. Only non-built-in
    rows matching the pack's declared keys are affected, so a pack can
    never hide a core type. Returns the number of rows flipped; quietly
    returns 0 when the pack files are already gone.
    """
    from sqlalchemy import update

    from app.models.card_type import CardType
    from app.models.relation_type import RelationType

    try:
        sheets = load_content(ext_dir, manifest)
    except (ContentPackError, OSError):
        return 0  # no content files (code-only extension) or already removed

    flipped = 0
    card_keys = [
        str(row["key"])
        for row in sheets.get(ws_schema.SHEET_CARD_TYPES, [])
        if isinstance(row, dict) and row.get("key")
    ]
    if card_keys:
        res = await db.execute(
            update(CardType)
            .where(CardType.key.in_(card_keys), CardType.built_in == False)  # noqa: E712
            .values(is_hidden=hidden)
        )
        flipped += getattr(res, "rowcount", 0) or 0

    rel_keys = [
        str(row["key"])
        for row in sheets.get(ws_schema.SHEET_RELATION_TYPES, [])
        if isinstance(row, dict) and row.get("key")
    ]
    if rel_keys:
        res = await db.execute(
            update(RelationType)
            .where(RelationType.key.in_(rel_keys), RelationType.built_in == False)  # noqa: E712
            .values(is_hidden=hidden)
        )
        flipped += getattr(res, "rowcount", 0) or 0

    await db.flush()
    return flipped
