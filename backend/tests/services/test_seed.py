"""Integration tests for the default metamodel seed service.

These tests require a PostgreSQL test database — they verify that
seed_metamodel creates card types, relation types, and RBAC roles.
"""

from __future__ import annotations

from sqlalchemy import func, select

from app.models.card_type import CardType
from app.models.relation_type import RelationType
from app.models.role import Role
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.services.seed import RELATIONS, TYPES, seed_metamodel

# ---------------------------------------------------------------------------
# Card types
# ---------------------------------------------------------------------------


class TestSeedCardTypes:
    async def test_creates_all_card_types(self, db):
        await seed_metamodel(db)

        result = await db.execute(select(func.count(CardType.key)))
        count = result.scalar()
        assert count >= len(TYPES)

    async def test_expected_type_keys_present(self, db):
        await seed_metamodel(db)

        result = await db.execute(select(CardType.key))
        keys = {row[0] for row in result.all()}
        expected = {t["key"] for t in TYPES}
        assert expected.issubset(keys)

    async def test_card_types_are_built_in(self, db):
        await seed_metamodel(db)

        result = await db.execute(select(CardType))
        for ct in result.scalars().all():
            assert ct.built_in is True


# ---------------------------------------------------------------------------
# Relation types
# ---------------------------------------------------------------------------


class TestSeedRelationTypes:
    async def test_creates_relation_types(self, db):
        await seed_metamodel(db)

        result = await db.execute(select(func.count(RelationType.key)))
        count = result.scalar()
        assert count > 0

    async def test_expected_relation_keys_present(self, db):
        await seed_metamodel(db)

        result = await db.execute(select(RelationType.key))
        keys = {row[0] for row in result.all()}
        expected = {r["key"] for r in RELATIONS}
        assert expected.issubset(keys)


# ---------------------------------------------------------------------------
# RBAC roles
# ---------------------------------------------------------------------------


class TestSeedRoles:
    async def test_creates_standard_roles(self, db):
        await seed_metamodel(db)

        result = await db.execute(select(Role.key))
        keys = {row[0] for row in result.all()}
        assert "admin" in keys
        assert "member" in keys
        assert "viewer" in keys

    async def test_admin_has_wildcard_permissions(self, db):
        await seed_metamodel(db)

        result = await db.execute(select(Role).where(Role.key == "admin"))
        admin = result.scalar_one()
        assert admin.permissions.get("*") is True


# ---------------------------------------------------------------------------
# Stakeholder role definitions
# ---------------------------------------------------------------------------


class TestSeedStakeholderRoles:
    async def test_creates_stakeholder_role_definitions(self, db):
        await seed_metamodel(db)

        result = await db.execute(select(func.count(StakeholderRoleDefinition.id)))
        count = result.scalar()
        assert count > 0

    async def test_application_has_extra_roles(self, db):
        await seed_metamodel(db)

        result = await db.execute(
            select(StakeholderRoleDefinition.key).where(
                StakeholderRoleDefinition.card_type_key == "Application"
            )
        )
        keys = {row[0] for row in result.all()}
        assert "technical_application_owner" in keys
        assert "business_application_owner" in keys


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------


class TestSeedIdempotency:
    async def test_running_twice_does_not_duplicate(self, db):
        await seed_metamodel(db)

        result = await db.execute(select(func.count(CardType.key)))
        count_first = result.scalar()

        result = await db.execute(select(func.count(Role.key)))
        roles_first = result.scalar()

        # Run seed a second time
        await seed_metamodel(db)

        result = await db.execute(select(func.count(CardType.key)))
        count_second = result.scalar()

        result = await db.execute(select(func.count(Role.key)))
        roles_second = result.scalar()

        assert count_first == count_second
        assert roles_first == roles_second
