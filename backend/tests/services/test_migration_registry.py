"""Smoke tests for the source-adapter registry."""

from __future__ import annotations

import pytest

from app.services.migration.protocol import MigrationSource
from app.services.migration.registry import SOURCES, get_source, register_source
from app.services.migration.snapshot import MigrationSnapshot, SourceEntity


def test_leanix_source_is_registered_at_import_time() -> None:
    """``app.services.migration`` imports the leanix subpackage, which
    in turn calls ``register_source(LeanixSource())`` — so importing the
    registry is enough to see the built-in adapter."""
    assert "leanix" in SOURCES
    src = SOURCES["leanix"]
    assert isinstance(src, MigrationSource)
    assert src.label == "SAP LeanIX"
    assert src.accepted_extensions == (".xlsx",)


def test_leanix_source_exports_an_import_bundle() -> None:
    """The LeanIX adapter is the one that can also WRITE for its platform
    (``GET /migration/export``). The hook is duck-typed rather than part
    of the protocol, so the route and the sources listing both look for
    a callable ``export`` — pin its presence and shape."""
    src = SOURCES["leanix"]
    assert callable(getattr(src, "export", None))
    # An Integration API bundle, not the Full Snapshot workbook the
    # importer reads: LeanIX offers no self-service import of the latter.
    assert src.export_extension == ".zip"
    assert src.export_media_type == "application/zip"


def test_leanix_source_declares_auto_mapped_columns() -> None:
    """The "Map imported fields" UI reads the source-platform columns
    that the parser pulls into canonical SourceEntity slots from the
    adapter, so the frontend doesn't carry adapter-specific spelling.
    Make sure LeanIX still declares its list (and includes the LeanIX-
    specific ``displayName`` / ``qualitySeal`` columns that other
    adapters won't have)."""
    src = SOURCES["leanix"]
    auto = dict(src.auto_mapped_columns)
    # Common-across-EA-platforms columns.
    for col in ("name", "description", "status"):
        assert col in auto
    # LeanIX-specific columns — confirm the adapter is the source of
    # truth for these (used to be hardcoded in the frontend Alert).
    assert "displayName" in auto
    assert "qualitySeal" in auto
    assert auto["category"] == "subtype"
    assert auto["lifecycle:*"] == "lifecycle"


def test_get_source_unknown_raises() -> None:
    with pytest.raises(KeyError, match="Unknown migration source"):
        get_source("not-a-real-source")


def test_register_source_replaces_existing(snapshot_sources_registry) -> None:
    """Re-registering the same key replaces the entry — handy in tests
    that monkey-patch adapter behaviour."""

    class _DummySource:
        key = "leanix"  # collide intentionally
        label = "Dummy"
        accepted_extensions = (".dummy",)
        type_mapping: dict[str, str] = {}
        relation_mapping: dict[str, str] = {}
        flip_direction: frozenset[str] = frozenset()
        field_type_mapping: dict[str, str] = {}
        auto_mapped_columns: tuple[tuple[str, str], ...] = ()

        def validate_payload(self, head: bytes) -> bool:
            return True

        def parse(self, path):  # noqa: D401
            return MigrationSnapshot(
                version="dummy",
                entities=[],
                relations=[],
                subscriptions=[],
                tags=[],
                documents=[],
                comments=[],
                users=[],
                metamodel_types=[],
                metamodel_relation_types=[],
            )

        def post_build_card_payload(
            self, entity: SourceEntity, target_type: str, payload: dict
        ) -> None:
            return None

        def map_subscription_role(self, role_name: str | None, role_type: str | None) -> str:
            return "responsible"

    register_source(_DummySource())
    assert SOURCES["leanix"].label == "Dummy"


@pytest.fixture
def snapshot_sources_registry():
    """Snapshot and restore the global SOURCES dict around a test.

    Required because ``register_source`` mutates module-level state —
    without this fixture, tests that swap adapters would leak into the
    rest of the suite. The autouse pattern is intentionally avoided so
    only tests that explicitly need it pay the snapshot cost.
    """
    saved = dict(SOURCES)
    try:
        yield
    finally:
        SOURCES.clear()
        SOURCES.update(saved)
