"""Tests for the ArchiMate metamodel seed service."""

from __future__ import annotations

from sqlalchemy import func, select

from app.models.card_type import CardType
from app.models.relation_type import RelationType
from app.plugins.archimate.seed import seed_archimate_metamodel


class TestArchiMateSeedCardTypes:
    async def test_seeds_all_61_element_types(self, db):
        await seed_archimate_metamodel(db)
        result = await db.execute(
            select(func.count(CardType.key)).where(CardType.plugin_id == "archimate")
        )
        assert result.scalar() == 61

    async def test_all_types_have_arch_prefix(self, db):
        await seed_archimate_metamodel(db)
        result = await db.execute(select(CardType.key).where(CardType.plugin_id == "archimate"))
        keys = [row[0] for row in result.all()]
        assert all(k.startswith("arch_") for k in keys)

    async def test_all_types_have_archimate_category_prefix(self, db):
        await seed_archimate_metamodel(db)
        result = await db.execute(
            select(CardType.category).where(CardType.plugin_id == "archimate")
        )
        categories = [row[0] for row in result.all()]
        assert all(c.startswith("ArchiMate:") for c in categories)

    async def test_all_types_are_not_built_in(self, db):
        await seed_archimate_metamodel(db)
        result = await db.execute(select(CardType).where(CardType.plugin_id == "archimate"))
        for ct in result.scalars().all():
            assert ct.built_in is False

    async def test_business_layer_has_13_types(self, db):
        await seed_archimate_metamodel(db)
        result = await db.execute(
            select(func.count(CardType.key)).where(
                CardType.plugin_id == "archimate",
                CardType.category == "ArchiMate:Business",
            )
        )
        assert result.scalar() == 13

    async def test_application_layer_has_9_types(self, db):
        await seed_archimate_metamodel(db)
        result = await db.execute(
            select(func.count(CardType.key)).where(
                CardType.plugin_id == "archimate",
                CardType.category == "ArchiMate:Application",
            )
        )
        assert result.scalar() == 9

    async def test_technology_layer_has_13_types(self, db):
        await seed_archimate_metamodel(db)
        result = await db.execute(
            select(func.count(CardType.key)).where(
                CardType.plugin_id == "archimate",
                CardType.category == "ArchiMate:Technology",
            )
        )
        assert result.scalar() == 13

    async def test_motivation_layer_has_10_types(self, db):
        await seed_archimate_metamodel(db)
        result = await db.execute(
            select(func.count(CardType.key)).where(
                CardType.plugin_id == "archimate",
                CardType.category == "ArchiMate:Motivation",
            )
        )
        assert result.scalar() == 10

    async def test_strategy_layer_has_4_types(self, db):
        await seed_archimate_metamodel(db)
        result = await db.execute(
            select(func.count(CardType.key)).where(
                CardType.plugin_id == "archimate",
                CardType.category == "ArchiMate:Strategy",
            )
        )
        assert result.scalar() == 4

    async def test_implementation_layer_has_5_types(self, db):
        await seed_archimate_metamodel(db)
        result = await db.execute(
            select(func.count(CardType.key)).where(
                CardType.plugin_id == "archimate",
                CardType.category == "ArchiMate:Implementation",
            )
        )
        assert result.scalar() == 5

    async def test_physical_layer_has_4_types(self, db):
        await seed_archimate_metamodel(db)
        result = await db.execute(
            select(func.count(CardType.key)).where(
                CardType.plugin_id == "archimate",
                CardType.category == "ArchiMate:Physical",
            )
        )
        assert result.scalar() == 4

    async def test_composite_layer_has_3_types(self, db):
        await seed_archimate_metamodel(db)
        result = await db.execute(
            select(func.count(CardType.key)).where(
                CardType.plugin_id == "archimate",
                CardType.category == "ArchiMate:Composite",
            )
        )
        assert result.scalar() == 3

    async def test_all_types_have_translations(self, db):
        await seed_archimate_metamodel(db)
        result = await db.execute(
            select(CardType.key, CardType.translations).where(CardType.plugin_id == "archimate")
        )
        locales = ["de", "fr", "es", "it", "pt", "zh", "ru"]
        for key, translations in result.all():
            label_t = (translations or {}).get("label", {})
            for locale in locales:
                assert locale in label_t, f"{key} missing translation for {locale}"

    async def test_seed_is_idempotent(self, db):
        await seed_archimate_metamodel(db)
        await seed_archimate_metamodel(db)
        result = await db.execute(
            select(func.count(CardType.key)).where(CardType.plugin_id == "archimate")
        )
        assert result.scalar() == 61

    async def test_existing_core_types_unchanged(self, db):
        from app.services.seed import seed_metamodel

        await seed_metamodel(db)
        await seed_archimate_metamodel(db)
        result = await db.execute(
            select(func.count(CardType.key)).where(CardType.plugin_id.is_(None))
        )
        core_count = result.scalar()
        assert core_count >= 13, "Core card types should still exist"


class TestArchiMateSeedRelationTypes:
    async def test_seeds_11_relation_types(self, db):
        await seed_archimate_metamodel(db)
        result = await db.execute(
            select(func.count(RelationType.key)).where(RelationType.plugin_id == "archimate")
        )
        assert result.scalar() == 11

    async def test_all_relations_have_arch_rel_prefix(self, db):
        await seed_archimate_metamodel(db)
        result = await db.execute(
            select(RelationType.key).where(RelationType.plugin_id == "archimate")
        )
        keys = [row[0] for row in result.all()]
        assert all(k.startswith("arch_rel_") for k in keys)

    async def test_key_relations_exist(self, db):
        await seed_archimate_metamodel(db)
        result = await db.execute(
            select(RelationType.key).where(RelationType.plugin_id == "archimate")
        )
        keys = {row[0] for row in result.all()}
        assert "arch_rel_Composition" in keys
        assert "arch_rel_Assignment" in keys
        assert "arch_rel_Serving" in keys

    async def test_all_relations_have_translations(self, db):
        await seed_archimate_metamodel(db)
        result = await db.execute(
            select(RelationType.key, RelationType.translations).where(
                RelationType.plugin_id == "archimate"
            )
        )
        locales = ["de", "fr", "es", "it", "pt", "zh", "ru"]
        for key, translations in result.all():
            label_t = (translations or {}).get("label", {})
            for locale in locales:
                assert locale in label_t, f"Relation {key} missing translation for {locale}"

    async def test_relation_seed_is_idempotent(self, db):
        await seed_archimate_metamodel(db)
        await seed_archimate_metamodel(db)
        result = await db.execute(
            select(func.count(RelationType.key)).where(RelationType.plugin_id == "archimate")
        )
        assert result.scalar() == 11
