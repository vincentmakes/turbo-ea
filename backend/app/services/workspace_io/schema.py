"""Shared schema authority for the workspace export/import bundle.

Both the exporter and the importer import from this module so the round-trip
contract — sheet names, column orders, the card/relation reference encoding —
lives in exactly one place. A single off-by-one in the escaping would silently
mis-parent cards on a cross-instance move, so this is deliberately centralised
and unit-tested.

Bundle layout (a ``.zip``)::

    workspace_export_<ts>.zip
    ├── manifest.json     # format_version, app_version, exported_at, source_url, sections
    ├── workspace.xlsx    # all structured data, one sheet per domain
    └── assets/           # unstructured assets (branding, diagrams, attachments)

The workbook is the source of truth for references; asset-owning sheets carry an
``asset_path`` column pointing into ``assets/``.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.models.calculation import Calculation
from app.models.compliance_regulation import ComplianceRegulation
from app.models.ea_principle import EAPrinciple
from app.models.resource_type import ResourceType
from app.models.role import Role
from app.models.stakeholder_role_definition import StakeholderRoleDefinition

# Bump when the on-disk shape changes incompatibly. The importer refuses a
# bundle whose major version it does not understand.
FORMAT_VERSION = "1"

WORKBOOK_NAME = "workspace.xlsx"
MANIFEST_NAME = "manifest.json"
ASSETS_DIR = "assets"

# Sheet names (Excel caps at 31 chars and forbids ``[]:*?/\\``).
SHEET_CARD_TYPES = "CardTypes"
SHEET_RELATION_TYPES = "RelationTypes"
SHEET_ROLES = "Roles"
SHEET_STAKEHOLDER_ROLES = "StakeholderRoles"
SHEET_TAG_GROUPS = "TagGroups"
SHEET_TAGS = "Tags"
SHEET_CALCULATIONS = "Calculations"
SHEET_PRINCIPLES = "Principles"
SHEET_COMPLIANCE_REGS = "ComplianceRegs"
SHEET_RESOURCE_TYPES = "ResourceTypes"
SHEET_SETTINGS = "Settings"
SHEET_USERS = "Users"
SHEET_CARDS = "Cards"
SHEET_RELATIONS = "Relations"
SHEET_CARD_TAGS = "CardTags"

LIFECYCLE_PHASES = ("plan", "phaseIn", "active", "phaseOut", "endOfLife")
MAX_PATH_DEPTH = 8
PATH_SEP = " / "


# ---------------------------------------------------------------------------
# Reference encoding — a faithful Python port of the TypeScript contract in
# frontend/src/features/inventory/excelExport.ts / excelImport.ts. Card names
# routinely contain ``/`` ("SAP S/4HANA") and ``\``; both are escaped so the
# importer can split a ``parent_path`` cell back into segments unambiguously.
# ---------------------------------------------------------------------------


def encode_path_segment(name: str) -> str:
    """Escape ``\\`` then ``/`` so a name survives ``PATH_SEP`` joining."""
    return name.replace("\\", "\\\\").replace("/", "\\/")


def encode_path(segments: list[str]) -> str:
    """Join already-ordered ancestor names (root→parent) into a path cell."""
    return PATH_SEP.join(encode_path_segment(s) for s in segments)


def split_escaped_path(path: str) -> list[str]:
    """Split a ``parent_path`` cell into raw segment names.

    Splits on ``PATH_SEP`` (`` / ``) while honouring ``\\/`` escapes, then
    unescapes ``\\\\``→``\\`` and ``\\/``→``/``. Inverse of ``encode_path``.
    """
    if not path or not path.strip():
        return []
    segments: list[str] = []
    buf: list[str] = []
    i = 0
    n = len(path)
    while i < n:
        ch = path[i]
        if ch == "\\" and i + 1 < n:
            # Keep the escape pair intact; unescaping happens after splitting.
            buf.append(ch)
            buf.append(path[i + 1])
            i += 2
            continue
        # Detect an unescaped separator " / ".
        if path[i : i + len(PATH_SEP)] == PATH_SEP:
            segments.append("".join(buf))
            buf = []
            i += len(PATH_SEP)
            continue
        buf.append(ch)
        i += 1
    segments.append("".join(buf))
    return [_unescape_segment(s.strip()) for s in segments if s.strip() != ""]


def _unescape_segment(seg: str) -> str:
    out: list[str] = []
    i = 0
    n = len(seg)
    while i < n:
        ch = seg[i]
        if ch == "\\" and i + 1 < n:
            out.append(seg[i + 1])
            i += 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def build_ref_string(parent_segments: list[str], name: str) -> str:
    """Build the ``CardResolver``-compatible ref (``parent / path / name``)."""
    return PATH_SEP.join(encode_path_segment(s) for s in [*parent_segments, name])


# ---------------------------------------------------------------------------
# Declarative registry for the "simple" config tables — a flat list of scalar
# and JSON columns upserted by a natural key. The metamodel, settings, users,
# tags, cards, and relations are NOT here: they need bespoke handling (built-in
# protection, secret stripping, FK remap, topo-sort) and live in the exporter /
# applier directly.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ConfigSection:
    sheet: str
    model: type
    natural_key: tuple[str, ...]
    columns: tuple[str, ...]
    json_columns: frozenset[str] = field(default_factory=frozenset)
    # Columns present on the model but never written to the bundle (instance-
    # local FKs, audit timestamps, derived state).
    skip_columns: frozenset[str] = field(default_factory=frozenset)


CONFIG_SECTIONS: tuple[ConfigSection, ...] = (
    ConfigSection(
        sheet=SHEET_ROLES,
        model=Role,
        natural_key=("key",),
        columns=(
            "key",
            "label",
            "description",
            "is_system",
            "is_default",
            "is_archived",
            "color",
            "permissions",
            "sort_order",
        ),
        json_columns=frozenset({"permissions"}),
        skip_columns=frozenset({"archived_by", "archived_at"}),
    ),
    ConfigSection(
        sheet=SHEET_STAKEHOLDER_ROLES,
        model=StakeholderRoleDefinition,
        natural_key=("card_type_key", "key"),
        columns=(
            "card_type_key",
            "key",
            "label",
            "description",
            "color",
            "permissions",
            "is_archived",
            "sort_order",
            "translations",
        ),
        json_columns=frozenset({"permissions", "translations"}),
        skip_columns=frozenset({"archived_by", "archived_at"}),
    ),
    ConfigSection(
        sheet=SHEET_CALCULATIONS,
        model=Calculation,
        natural_key=("target_type_key", "target_field_key", "name"),
        columns=(
            "name",
            "description",
            "target_type_key",
            "target_field_key",
            "formula",
            "is_active",
            "execution_order",
        ),
        skip_columns=frozenset({"created_by", "last_error", "last_run_at"}),
    ),
    ConfigSection(
        sheet=SHEET_PRINCIPLES,
        model=EAPrinciple,
        natural_key=("title",),
        columns=(
            "title",
            "description",
            "rationale",
            "implications",
            "is_active",
            "sort_order",
            "catalogue_id",
        ),
    ),
    ConfigSection(
        sheet=SHEET_COMPLIANCE_REGS,
        model=ComplianceRegulation,
        natural_key=("key",),
        columns=(
            "key",
            "label",
            "description",
            "is_enabled",
            "built_in",
            "sort_order",
            "translations",
        ),
        json_columns=frozenset({"translations"}),
    ),
    ConfigSection(
        sheet=SHEET_RESOURCE_TYPES,
        model=ResourceType,
        natural_key=("kind", "key"),
        columns=(
            "kind",
            "key",
            "label",
            "description",
            "icon",
            "is_enabled",
            "built_in",
            "sort_order",
            "translations",
        ),
        json_columns=frozenset({"translations"}),
    ),
)
