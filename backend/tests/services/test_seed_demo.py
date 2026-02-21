"""Smoke tests for the demo seed services.

Verifies that seed_demo_data() and seed_bpm_demo_data() can run against a
clean database without errors and produce the expected counts. These tests
exercise ~6,400 lines of static data definitions to catch FK mismatches,
typos, and structural issues.

Integration tests requiring a PostgreSQL test database.
"""

from __future__ import annotations

from sqlalchemy import func, select

from app.models.card import Card
from app.models.relation import Relation
from app.models.tag import TagGroup
from app.services.seed import seed_metamodel
from app.services.seed_demo import seed_demo_data


class TestSeedDemoData:
    async def test_smoke_creates_cards(self, db):
        """seed_demo_data inserts cards without errors."""
        await seed_metamodel(db)
        result = await seed_demo_data(db)

        assert "cards" in result
        assert result["cards"] > 0

        count = await db.execute(select(func.count(Card.id)))
        assert count.scalar() == result["cards"]

    async def test_smoke_creates_relations(self, db):
        """seed_demo_data inserts relations between cards."""
        await seed_metamodel(db)
        result = await seed_demo_data(db)

        assert "relations" in result
        assert result["relations"] > 0

        count = await db.execute(select(func.count(Relation.id)))
        assert count.scalar() == result["relations"]

    async def test_smoke_creates_tag_groups(self, db):
        """seed_demo_data inserts tag groups and tags."""
        await seed_metamodel(db)
        result = await seed_demo_data(db)

        assert "tag_groups" in result
        assert result["tag_groups"] > 0

        count = await db.execute(select(func.count(TagGroup.id)))
        assert count.scalar() == result["tag_groups"]

    async def test_skips_when_data_exists(self, db):
        """Re-running seed_demo_data returns skipped."""
        await seed_metamodel(db)
        await seed_demo_data(db)

        result = await seed_demo_data(db)
        assert result.get("skipped") is True
        assert "reason" in result

    async def test_all_card_types_present(self, db):
        """Demo data includes cards of multiple types."""
        await seed_metamodel(db)
        await seed_demo_data(db)

        result = await db.execute(select(Card.type).distinct())
        types = {row[0] for row in result.all()}
        expected = {
            "Organization",
            "BusinessCapability",
            "Application",
            "ITComponent",
        }
        assert expected.issubset(types)

    async def test_data_quality_computed(self, db):
        """Seeded cards should have data_quality scores > 0."""
        await seed_metamodel(db)
        await seed_demo_data(db)

        result = await db.execute(select(func.avg(Card.data_quality)).where(Card.data_quality > 0))
        avg_quality = result.scalar()
        assert avg_quality is not None
        assert avg_quality > 0

    async def test_parent_child_hierarchy(self, db):
        """Some seeded cards should have parent_id set."""
        await seed_metamodel(db)
        await seed_demo_data(db)

        result = await db.execute(select(func.count(Card.id)).where(Card.parent_id.isnot(None)))
        count = result.scalar()
        assert count > 0


class TestSeedBpmDemoData:
    async def test_smoke_creates_processes(self, db):
        """seed_bpm_demo_data inserts BusinessProcess cards."""
        from app.models.user import User

        await seed_metamodel(db)
        await seed_demo_data(db)

        # BPM seed requires an admin user for assessor_id
        from app.core.security import hash_password

        admin = User(
            email="admin@test.com",
            display_name="Admin",
            password_hash=hash_password("Test1234"),
            role="admin",
            is_active=True,
            auth_provider="local",
        )
        db.add(admin)
        await db.flush()

        from app.services.seed_demo_bpm import seed_bpm_demo_data

        result = await seed_bpm_demo_data(db)

        assert "cards" in result
        assert result["cards"] > 0

    async def test_bpm_skips_when_processes_exist(self, db):
        """Re-running seed_bpm_demo_data returns skipped."""
        from app.models.user import User

        await seed_metamodel(db)
        await seed_demo_data(db)

        from app.core.security import hash_password

        admin = User(
            email="admin@test.com",
            display_name="Admin",
            password_hash=hash_password("Test1234"),
            role="admin",
            is_active=True,
            auth_provider="local",
        )
        db.add(admin)
        await db.flush()

        from app.services.seed_demo_bpm import seed_bpm_demo_data

        await seed_bpm_demo_data(db)
        result = await seed_bpm_demo_data(db)
        assert result.get("skipped") is True
