"""Tests for the shared hierarchy-level helpers (app.services.hierarchy)."""

from __future__ import annotations

from app.services.hierarchy import (
    HIERARCHY_LEVEL_KEY,
    backfill_hierarchy_levels,
    backfill_hierarchy_levels_for_type,
    compute_hierarchy_level,
    hierarchy_level_field_def,
)
from tests.conftest import create_card, create_card_type


def test_field_def_shape():
    fd = hierarchy_level_field_def()
    assert fd["key"] == "hierarchyLevel"
    assert fd["type"] == "number"
    assert fd["readonly"] is True
    assert fd["weight"] == 0
    # 9 non-English locales carried inline (English comes from `label`).
    assert set(fd["translations"]) == {"de", "fr", "es", "it", "pt", "zh", "ru", "da", "ar"}


class TestComputeHierarchyLevel:
    async def test_root_is_one(self, db):
        root = await create_card(db, card_type="Organization", name="Root")
        assert await compute_hierarchy_level(db, None) == 1
        assert await compute_hierarchy_level(db, root.parent_id) == 1

    async def test_depth_walks_up(self, db):
        root = await create_card(db, card_type="Organization", name="Root")
        child = await create_card(db, card_type="Organization", name="Child", parent_id=root.id)
        grandchild = await create_card(db, card_type="Organization", name="GC", parent_id=child.id)
        assert await compute_hierarchy_level(db, root.id) == 2
        assert await compute_hierarchy_level(db, child.id) == 3
        # exclude the node itself (as the sync does when computing for a card)
        assert await compute_hierarchy_level(db, grandchild.parent_id, exclude={grandchild.id}) == 3

    async def test_cycle_guard(self, db):
        # A self-referential cycle must terminate rather than loop forever.
        a = await create_card(db, card_type="Organization", name="A")
        b = await create_card(db, card_type="Organization", name="B", parent_id=a.id)
        a.parent_id = b.id
        await db.flush()
        # Should not hang; returns a finite depth.
        level = await compute_hierarchy_level(db, a.id)
        assert isinstance(level, int) and level >= 1


class TestBackfill:
    async def test_backfill_for_type(self, db):
        await create_card_type(db, key="Organization", has_hierarchy=True)
        root = await create_card(db, card_type="Organization", name="Root")
        child = await create_card(db, card_type="Organization", name="Child", parent_id=root.id)
        gc = await create_card(db, card_type="Organization", name="GC", parent_id=child.id)

        updated = await backfill_hierarchy_levels_for_type(db, "Organization")
        assert updated == 3
        await db.refresh(root)
        await db.refresh(child)
        await db.refresh(gc)
        assert root.attributes[HIERARCHY_LEVEL_KEY] == 1
        assert child.attributes[HIERARCHY_LEVEL_KEY] == 2
        assert gc.attributes[HIERARCHY_LEVEL_KEY] == 3

        # Idempotent — a second pass changes nothing.
        assert await backfill_hierarchy_levels_for_type(db, "Organization") == 0

    async def test_backfill_all_only_hierarchical_types(self, db):
        await create_card_type(db, key="Organization", has_hierarchy=True)
        await create_card_type(db, key="Provider", has_hierarchy=False)
        org = await create_card(db, card_type="Organization", name="Org")
        prov = await create_card(db, card_type="Provider", name="Prov")

        await backfill_hierarchy_levels(db)
        await db.refresh(org)
        await db.refresh(prov)
        assert org.attributes.get(HIERARCHY_LEVEL_KEY) == 1
        # Non-hierarchical type never receives the attribute.
        assert HIERARCHY_LEVEL_KEY not in (prov.attributes or {})
