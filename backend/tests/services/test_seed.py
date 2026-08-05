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

    async def test_app_to_interface_has_flow_direction(self, db):
        """relAppToInterface declares the single-select `flowDirection`
        attribute so the UI can capture which Application is the
        Provider vs. Consumer of the Interface (bidirectional = both)."""
        await seed_metamodel(db)

        result = await db.execute(
            select(RelationType).where(RelationType.key == "relAppToInterface")
        )
        rt = result.scalar_one()
        schema = rt.attributes_schema or []
        flow_fields = [f for f in schema if f.get("key") == "flowDirection"]
        assert len(flow_fields) == 1, "relAppToInterface missing flowDirection attribute"
        field = flow_fields[0]
        assert field["type"] == "single_select"
        option_keys = {opt["key"] for opt in field.get("options", [])}
        assert option_keys == {"bidirectional", "forward", "reverse"}

    async def test_interface_to_dataobj_has_no_flow_direction(self, db):
        """A DataObject is the payload an Interface carries, not a
        direction-bearing endpoint, so relInterfaceToDataObj must NOT
        declare flowDirection."""
        await seed_metamodel(db)

        result = await db.execute(
            select(RelationType).where(RelationType.key == "relInterfaceToDataObj")
        )
        rt = result.scalar_one()
        schema = rt.attributes_schema or []
        assert all(f.get("key") != "flowDirection" for f in schema), (
            "relInterfaceToDataObj should not carry flowDirection"
        )


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
        assert "technicalApplicationOwner" in keys
        assert "businessApplicationOwner" in keys


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


# ---------------------------------------------------------------------------
# Re-seed must preserve admin translations
#
# `seed_metamodel` runs on EVERY backend start. It used to merge the seed's
# translations over the row's (`{**existing, **seed}`), so every translation an
# admin entered through the Translations dialog on a built-in type — and every
# rename, since translations shadow the `label` column — silently reverted on the
# next restart. The seed fills gaps; re-asserting a changed built-in default is
# what a guarded migration is for.
# ---------------------------------------------------------------------------


async def _built_in_type(db, key: str) -> CardType:
    result = await db.execute(select(CardType).where(CardType.key == key))
    return result.scalar_one()


class TestSeedPreservesAdminTranslations:
    async def test_card_type_label_translation_survives_reseed(self, db):
        await seed_metamodel(db)
        app_type = await _built_in_type(db, "Application")
        translations = dict(app_type.translations)
        translations["label"] = {**translations.get("label", {}), "de": "Fachanwendung"}
        app_type.translations = translations
        await db.flush()

        await seed_metamodel(db)

        app_type = await _built_in_type(db, "Application")
        assert app_type.translations["label"]["de"] == "Fachanwendung"

    async def test_card_type_rename_survives_reseed(self, db):
        """A rename lives in `label` + `translations.label.en`; both must stick."""
        await seed_metamodel(db)
        app_type = await _built_in_type(db, "Application")
        app_type.label = "Business System"
        app_type.translations = {
            **app_type.translations,
            "label": {**app_type.translations.get("label", {}), "en": "Business System"},
        }
        await db.flush()

        await seed_metamodel(db)

        app_type = await _built_in_type(db, "Application")
        assert app_type.label == "Business System"
        assert app_type.translations["label"]["en"] == "Business System"

    async def test_missing_locale_is_still_backfilled(self, db):
        """Existing-wins must still ADD a locale the row does not carry."""
        await seed_metamodel(db)
        app_type = await _built_in_type(db, "Application")
        seeded_de = app_type.translations["label"]["de"]
        app_type.translations = {
            **app_type.translations,
            "label": {k: v for k, v in app_type.translations["label"].items() if k != "de"},
        }
        await db.flush()

        await seed_metamodel(db)

        app_type = await _built_in_type(db, "Application")
        assert app_type.translations["label"]["de"] == seeded_de

    async def test_subtype_field_and_option_translations_survive_reseed(self, db):
        await seed_metamodel(db)
        app_type = await _built_in_type(db, "Application")

        subtypes = [dict(s) for s in app_type.subtypes]
        subtypes[0]["translations"] = {**subtypes[0].get("translations", {}), "de": "Mein Subtyp"}
        app_type.subtypes = subtypes

        schema = [dict(sec) for sec in app_type.fields_schema]
        target_sec = next(sec for sec in schema if sec.get("fields"))
        target_sec["translations"] = {**target_sec.get("translations", {}), "de": "Mein Abschnitt"}
        fields = [dict(f) for f in target_sec["fields"]]
        fields[0]["translations"] = {**fields[0].get("translations", {}), "de": "Mein Feld"}
        opt_field = next((f for f in fields if f.get("options")), None)
        if opt_field:
            options = [dict(o) for o in opt_field["options"]]
            options[0]["translations"] = {
                **options[0].get("translations", {}),
                "de": "Meine Option",
            }
            opt_field["options"] = options
        target_sec["fields"] = fields
        app_type.fields_schema = schema
        await db.flush()

        await seed_metamodel(db)

        app_type = await _built_in_type(db, "Application")
        assert app_type.subtypes[0]["translations"]["de"] == "Mein Subtyp"
        saved_sec = next(
            sec for sec in app_type.fields_schema if sec["section"] == target_sec["section"]
        )
        assert saved_sec["translations"]["de"] == "Mein Abschnitt"
        assert saved_sec["fields"][0]["translations"]["de"] == "Mein Feld"
        if opt_field:
            saved_field = next(f for f in saved_sec["fields"] if f["key"] == opt_field["key"])
            assert saved_field["options"][0]["translations"]["de"] == "Meine Option"

    async def test_relation_verb_translation_survives_reseed(self, db):
        await seed_metamodel(db)
        result = await db.execute(
            select(RelationType).where(RelationType.key == RELATIONS[0]["key"])
        )
        rel = result.scalar_one()
        rel.translations = {
            **rel.translations,
            "label": {**rel.translations.get("label", {}), "de": "eigene Formulierung"},
        }
        await db.flush()

        await seed_metamodel(db)

        result = await db.execute(
            select(RelationType).where(RelationType.key == RELATIONS[0]["key"])
        )
        assert result.scalar_one().translations["label"]["de"] == "eigene Formulierung"

    async def test_relation_missing_locale_is_backfilled(self, db):
        """Relation rows were never merged at all, so an install seeded before a
        locale existed (Danish, Arabic) never received its verbs."""
        await seed_metamodel(db)
        key = RELATIONS[0]["key"]
        result = await db.execute(select(RelationType).where(RelationType.key == key))
        rel = result.scalar_one()
        rel.built_in = True
        seeded_da = rel.translations["label"]["da"]
        rel.translations = {
            **rel.translations,
            "label": {k: v for k, v in rel.translations["label"].items() if k != "da"},
        }
        await db.flush()

        await seed_metamodel(db)

        result = await db.execute(select(RelationType).where(RelationType.key == key))
        assert result.scalar_one().translations["label"]["da"] == seeded_da
