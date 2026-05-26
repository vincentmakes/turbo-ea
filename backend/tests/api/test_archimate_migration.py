"""Tests for migration 093: plugin_id column on card_types and relation_types."""

from __future__ import annotations

from sqlalchemy import text


class TestPluginIdMigration:
    async def test_card_types_has_plugin_id_column(self, db):
        result = await db.execute(
            text(
                "SELECT column_name, is_nullable, data_type "
                "FROM information_schema.columns "
                "WHERE table_name = 'card_types' AND column_name = 'plugin_id'"
            )
        )
        row = result.fetchone()
        assert row is not None, "plugin_id column missing from card_types"
        assert row.is_nullable == "YES", "plugin_id should be nullable"

    async def test_relation_types_has_plugin_id_column(self, db):
        result = await db.execute(
            text(
                "SELECT column_name, is_nullable, data_type "
                "FROM information_schema.columns "
                "WHERE table_name = 'relation_types' AND column_name = 'plugin_id'"
            )
        )
        row = result.fetchone()
        assert row is not None, "plugin_id column missing from relation_types"
        assert row.is_nullable == "YES", "plugin_id should be nullable"

    async def test_existing_card_types_have_null_plugin_id(self, db):

        result = await db.execute(
            text("SELECT COUNT(*) FROM card_types WHERE plugin_id IS NOT NULL")
        )
        count = result.scalar()
        # Before seeding ArchiMate, no card types should have a plugin_id
        assert count == 0, f"Expected 0 rows with plugin_id set, got {count}"

    async def test_card_type_model_has_plugin_id(self, db):
        from app.models.card_type import CardType

        ct = CardType(
            key="test_plugin_type",
            label="Test",
            plugin_id="test_plugin",
        )
        db.add(ct)
        await db.flush()
        await db.refresh(ct)
        assert ct.plugin_id == "test_plugin"

    async def test_relation_type_model_has_plugin_id(self, db):
        from app.models.relation_type import RelationType

        rt = RelationType(
            key="test_plugin_rel",
            label="Test Relation",
            reverse_label="Reverse",
            source_type_key="test_src",
            target_type_key="test_tgt",
            plugin_id="test_plugin",
        )
        db.add(rt)
        await db.flush()
        await db.refresh(rt)
        assert rt.plugin_id == "test_plugin"
