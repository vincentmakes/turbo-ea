"""Integration tests for the default metamodel seed service.

These tests require a PostgreSQL test database — they verify that
seed_metamodel creates card types, relation types, and RBAC roles.
"""

from __future__ import annotations

import copy

from sqlalchemy import func, select

from app.models.card_type import CardType
from app.models.relation_type import RelationType
from app.models.role import Role
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.services.hierarchy import HIERARCHY_LEVEL_KEY
from app.services.seed import (
    _APP_ROLES,
    _DEFAULT_ROLES,
    RELATIONS,
    TYPES,
    _nonblank_translations,
    seed_metamodel,
)

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
# Built-in role descriptions: filled where missing, never overwritten
# ---------------------------------------------------------------------------


def _seed_role(roles: list[dict], key: str) -> dict:
    return next(r for r in roles if r["key"] == key)


async def _srd(db, type_key: str, key: str) -> StakeholderRoleDefinition:
    result = await db.execute(
        select(StakeholderRoleDefinition).where(
            StakeholderRoleDefinition.card_type_key == type_key,
            StakeholderRoleDefinition.key == key,
        )
    )
    return result.scalar_one()


class TestSeedStakeholderRoleDescriptions:
    async def test_a_fresh_install_gets_the_seeded_description(self, db):
        await seed_metamodel(db)

        for key in ("responsible", "observer", "technicalApplicationOwner"):
            row = await _srd(db, "Application", key)
            assert row.description == _seed_role(_APP_ROLES, key)["description"]
        initiative_pm = await _srd(db, "Initiative", "itProjectManager")
        assert initiative_pm.description and initiative_pm.description.startswith("Runs the")
        process_owner = await _srd(db, "BusinessProcess", "processOwner")
        assert process_owner.description and process_owner.description.startswith("Owns the")

    async def test_a_blank_description_receives_the_seed_text_on_reseed(self, db):
        await seed_metamodel(db)
        for description in (None, "   "):
            row = await _srd(db, "Application", "responsible")
            row.description = description
            await db.flush()

            await seed_metamodel(db)

            row = await _srd(db, "Application", "responsible")
            assert row.description == _seed_role(_DEFAULT_ROLES, "responsible")["description"]

    async def test_an_admin_description_is_kept_on_reseed(self, db):
        await seed_metamodel(db)
        row = await _srd(db, "Application", "businessApplicationOwner")
        row.description = "Our own wording."
        await db.flush()

        await seed_metamodel(db)

        row = await _srd(db, "Application", "businessApplicationOwner")
        assert row.description == "Our own wording."

    async def test_a_missing_description_locale_is_filled(self, db):
        await seed_metamodel(db)
        row = await _srd(db, "Application", "observer")
        row.translations = {
            "label": dict(row.translations["label"]),
            "description": {"fr": "Suit la fiche."},
        }
        await db.flush()

        await seed_metamodel(db)

        row = await _srd(db, "Application", "observer")
        seed_desc = _seed_role(_DEFAULT_ROLES, "observer")["translations"]["description"]
        assert set(row.translations["description"]) == set(seed_desc)
        assert row.translations["description"]["de"] == seed_desc["de"]

    async def test_a_present_locale_is_kept(self, db):
        """Existing wins for description and label locales alike (it used to be
        seed-wins for the label, which reverted an admin's translation)."""
        await seed_metamodel(db)
        row = await _srd(db, "Application", "observer")
        row.translations = {
            "label": {**row.translations["label"], "de": "Zuschauer"},
            "description": {**row.translations.get("description", {}), "de": "Liest mit."},
        }
        await db.flush()

        await seed_metamodel(db)

        row = await _srd(db, "Application", "observer")
        assert row.translations["description"]["de"] == "Liest mit."
        assert row.translations["label"]["de"] == "Zuschauer"
        # The other locales the row carried are untouched.
        assert row.translations["label"]["fr"] == "Observateur"


class TestNonblankSeedTranslations:
    """A blank seed locale must never reach a row: the merge is existing-wins,
    so a stored ``""`` would block the real text forever."""

    def test_blank_locales_are_dropped_per_property(self):
        trans = {
            "label": {"de": "Beobachter", "fr": "", "es": "   ", "it": None},
            "description": {"de": "", "fr": "Suit la fiche."},
        }
        assert _nonblank_translations(trans) == {
            "label": {"de": "Beobachter"},
            "description": {"fr": "Suit la fiche."},
        }

    def test_other_properties_are_untouched(self):
        trans = {"label": {"de": "X"}, "note": "", "order": 3}
        assert _nonblank_translations(trans) == {"label": {"de": "X"}, "note": "", "order": 3}

    def test_input_is_not_mutated_and_empty_input_gives_empty_map(self):
        trans = {"label": {"de": "", "fr": "Y"}}
        _nonblank_translations(trans)
        assert trans == {"label": {"de": "", "fr": "Y"}}
        assert _nonblank_translations(None) == {}
        assert _nonblank_translations({}) == {}

    async def test_a_blank_seed_locale_is_not_inserted(self, db, monkeypatch):
        role = _seed_role(_DEFAULT_ROLES, "observer")
        trans = copy.deepcopy(role["translations"])
        trans["label"]["de"] = ""
        trans["description"]["fr"] = "  "
        monkeypatch.setitem(role, "translations", trans)

        await seed_metamodel(db)

        row = await _srd(db, "Application", "observer")
        assert "de" not in row.translations["label"]
        assert "fr" not in row.translations["description"]
        # Non-blank seed locales are inserted as usual.
        assert row.translations["label"]["fr"] == trans["label"]["fr"]
        assert row.translations["description"]["de"] == trans["description"]["de"]

    async def test_a_blank_seed_locale_is_not_merged(self, db, monkeypatch):
        await seed_metamodel(db)
        row = await _srd(db, "Application", "observer")
        row.translations = {"label": {"en": "Observer"}, "description": {}}
        await db.flush()

        role = _seed_role(_DEFAULT_ROLES, "observer")
        trans = copy.deepcopy(role["translations"])
        trans["label"]["de"] = ""
        trans["description"]["fr"] = ""
        monkeypatch.setitem(role, "translations", trans)

        await seed_metamodel(db)

        row = await _srd(db, "Application", "observer")
        assert "de" not in row.translations["label"]
        assert "fr" not in row.translations["description"]
        # A non-blank seed locale fills the gap, and the row's own text stays.
        assert row.translations["label"]["fr"] == trans["label"]["fr"]
        assert row.translations["label"]["en"] == "Observer"
        assert row.translations["description"]["de"] == trans["description"]["de"]


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
# The seed injects into copies, never into the module constants
#
# `seed_metamodel` stamps the hierarchyLevel field and the English labels onto
# every type and relation it writes. It used to do that to TYPES / RELATIONS
# themselves, so every later reader in the same process (the demo seeders,
# test_alembic_101's seed-layout check) saw the injected copy — which test ran
# first decided whether that check passed, and mutmut's test order failed it.
# ---------------------------------------------------------------------------


class TestSeedLeavesModuleConstantsAlone:
    async def test_types_and_relations_are_unchanged(self, db):
        types_before = copy.deepcopy(TYPES)
        relations_before = copy.deepcopy(RELATIONS)

        await seed_metamodel(db)

        assert TYPES == types_before
        assert RELATIONS == relations_before

    async def test_the_rows_still_carry_the_injections(self, db):
        await seed_metamodel(db)

        app = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
        field_keys = [f["key"] for s in app.fields_schema for f in s["fields"]]
        assert field_keys.count(HIERARCHY_LEVEL_KEY) == 1
        assert app.fields_schema[0]["translations"]["en"] == app.fields_schema[0]["section"]

        rel = (
            await db.execute(select(RelationType).where(RelationType.key == RELATIONS[0]["key"]))
        ).scalar_one()
        assert rel.translations["label"]["en"] == RELATIONS[0]["label"]


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

    async def test_relation_attribute_translations_are_backfilled(self, db):
        """Business Process → Application's Usage attribute shipped with no
        translations (#1327); a restart fills them in without touching what the
        admin set — a hidden value, a custom value — or the attribute's order."""
        await seed_metamodel(db)
        result = await db.execute(select(RelationType).where(RelationType.key == "relProcessToApp"))
        rel = result.scalar_one()
        # As an install seeded before the fix stores it, plus the admin's edits.
        stored = copy.deepcopy(rel.attributes_schema)
        usage = stored[0]
        usage.pop("translations")
        for opt in usage["options"]:
            opt.pop("translations")
        usage["options"][3]["hidden"] = True
        usage["options"].append({"key": "approves", "label": "Approves", "built_in": False})
        rel.attributes_schema = stored
        await db.flush()

        await seed_metamodel(db)

        result = await db.execute(select(RelationType).where(RelationType.key == "relProcessToApp"))
        usage = result.scalar_one().attributes_schema[0]
        assert usage["translations"]["de"]
        assert [o["key"] for o in usage["options"]] == [
            "creates",
            "reads",
            "updates",
            "deletes",
            "orchestrates",
            "approves",
        ]
        assert all(o["translations"]["de"] for o in usage["options"][:5])
        assert usage["options"][3]["hidden"] is True
        assert usage["options"][5] == {"key": "approves", "label": "Approves", "built_in": False}
