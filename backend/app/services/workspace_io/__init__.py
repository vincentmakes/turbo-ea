"""Full-workspace export/import (Admin → Workspace Transfer).

Moves a whole Turbo EA workspace — metamodel, configuration, settings, users,
and inventory — between instances as a single ``.zip`` bundle. Secrets are never
exported; the importer upserts idempotently after a dry-run preview.
"""

from app.services.workspace_io.applier import (
    ApplyResult,
    SectionResult,
    apply_bundle,
    apply_selected,
    diff_bundle,
)
from app.services.workspace_io.bundle import (
    BundleFormatError,
    WorkspaceBundle,
    parse_bundle,
)
from app.services.workspace_io.exporter import build_bundle
from app.services.workspace_io.schema import FORMAT_VERSION

__all__ = [
    "FORMAT_VERSION",
    "ApplyResult",
    "SectionResult",
    "BundleFormatError",
    "WorkspaceBundle",
    "apply_bundle",
    "apply_selected",
    "diff_bundle",
    "parse_bundle",
    "build_bundle",
]
