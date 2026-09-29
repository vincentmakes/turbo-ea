"""SAP LeanIX source adapter — implements ``MigrationSource``.

Wraps the per-source mapping tables (``mappings.py``) and the xlsx
parser (``xlsx_parser.py``) behind the
:class:`~app.services.migration.protocol.MigrationSource` contract so
the generic staging + apply pipeline can drive a LeanIX import
without knowing anything LeanIX-specific.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.services.migration.snapshot import MigrationSnapshot, SourceEntity
from app.services.migration.sources.leanix import ldif_exporter, mappings, xlsx_parser


class LeanixSource:
    """SAP LeanIX workspace-snapshot adapter."""

    key: str = "leanix"
    label: str = "SAP LeanIX"
    accepted_extensions: tuple[str, ...] = (".xlsx",)

    # ---- Mapping tables (re-exported from mappings.py for protocol conformance) ----
    type_mapping: dict[str, str] = mappings.TYPE_MAPPING
    relation_mapping: dict[str, str] = mappings.RELATION_MAPPING
    flip_direction: frozenset[str] = mappings.FLIP_DIRECTION
    field_type_mapping: dict[str, str] = mappings.FIELD_TYPE_MAPPING
    subscription_role_mapping: dict[str, str] = mappings.SUBSCRIPTION_ROLE_MAPPING
    hierarchy_relations: frozenset[str] = mappings.HIERARCHY_RELATIONS

    # LeanIX export columns the xlsx parser pulls into canonical
    # ``SourceEntity`` slots before custom_fields is populated, so they
    # never reach the per-field mapping UI. Listed here verbatim so the
    # admin's "Map imported fields" tab can show what's already covered.
    # Pairs are ``(LeanIX column, Turbo EA target slot)``; the human
    # label on the right matches what the admin sees on a TEA card.
    auto_mapped_columns: tuple[tuple[str, str], ...] = (
        ("name", "name"),
        ("displayName", "name"),
        ("description", "description"),
        ("status", "status"),
        ("category", "subtype"),
        ("lifecycle:*", "lifecycle"),
        ("qualitySeal", "data quality"),
        ("completion", "data quality"),
    )

    # ---- Parsing ----
    def validate_payload(self, head: bytes) -> bool:
        return xlsx_parser.is_xlsx_payload(head)

    def parse(self, path: str | Path) -> MigrationSnapshot:
        return xlsx_parser.parse_xlsx_path(str(path))

    # ---- Export ----
    # The reverse direction. LeanIX cannot import its own Full Snapshot
    # workbook (SAP restores snapshots on request), so the export is an
    # **Integration API bundle**: a zip with the LDIF data, the processor
    # configuration that imports it, and a README — the one bulk import
    # a LeanIX admin can run alone. Deliberately duck-typed rather than
    # part of ``MigrationSource`` — the route checks ``hasattr(source, "export")``.
    export_extension: str = ".zip"
    export_media_type: str = "application/zip"

    def export(self, snapshot: MigrationSnapshot) -> bytes:
        return ldif_exporter.build_bundle(snapshot)

    # ---- Extension hooks ----
    def post_build_card_payload(
        self,
        entity: SourceEntity,
        target_type: str,
        payload: dict[str, Any],
    ) -> None:
        """Apply LeanIX-specific quirks to the generic card payload.

        Currently: ``UserGroup → Organization`` force-tags ``subtype="team"``
        and writes a ``source_origin`` attribute so the admin can find
        and re-classify these post-import. The legacy ``leanix_origin``
        attribute is kept in parallel for backwards compatibility with
        existing imported data.
        """
        if entity.type == "UserGroup" and target_type == "Organization":
            payload["subtype"] = "team"
            attrs = payload.setdefault("attributes", {})
            attrs["source_origin"] = f"{self.key}:UserGroup"
            # Legacy attribute name — kept so old reports / filters that
            # key off ``leanix_origin`` still work.
            attrs["leanix_origin"] = "UserGroup"

    def map_subscription_role(
        self,
        role_name: str | None,
        role_type: str | None,
    ) -> str:
        """Translate a LeanIX subscription to a Turbo EA stakeholder-role key.

        Falls back to ``responsible`` for RESPONSIBLE / ACCOUNTABLE
        subscriptions and ``observer`` for OBSERVER subscriptions when
        the free-form ``role_name`` isn't recognised, matching what most
        customers expect from LeanIX.
        """
        if role_name:
            hit = self.subscription_role_mapping.get(role_name.strip().lower())
            if hit is not None:
                return hit
        if role_type and role_type.upper() == "OBSERVER":
            return "observer"
        return "responsible"
