"""``metamodel_strings``: database labels as the ``metamodel`` namespace of a
custom language.

The pure half (keys, slots, the seed's share map, the phase-help overlay)
needs no database; the round-trip half writes through the ORM into real rows
and proves that nothing but the custom code's entry moved.
"""

from __future__ import annotations

import copy

import pytest
from sqlalchemy import select

from app.models.app_settings import AppSettings
from app.models.card_type import CardType
from app.models.card_type_category import CardTypeCategory
from app.models.compliance_regulation import ComplianceRegulation
from app.models.dashboard import Dashboard
from app.models.relation_type import RelationType
from app.models.resource_type import ResourceType
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.services import language_pack as lp
from app.services import metamodel_strings as mm
from tests.conftest import create_card_type, create_relation_type, create_stakeholder_role_def

DE = {"de": "Deutsch"}

FIELDS_SCHEMA = [
    {"section": "__description", "fields": []},
    {
        "section": "Cost v1.0 & more",
        "translations": {"en": "Cost v1.0 & more", "de": "Kosten"},
        "groupTranslations": {"Run 50%": {"de": "Betrieb"}},
        "fields": [
            {
                "key": "costTotal",
                "label": "Total cost",
                "type": "cost",
                "group": "Run 50%",
                "help": "All costs",
                "helpTranslations": {"de": "Alle Kosten"},
                "badge": "New",
                "translations": {"en": "Total cost", "de": "Gesamtkosten"},
            },
            {
                "key": "tier",
                "label": "Tier",
                "type": "single_select",
                "options": [
                    {"key": "gold", "label": "Gold", "translations": {"de": "Gold"}},
                    {"key": "", "label": "No key"},
                ],
            },
        ],
    },
]


def widget_record() -> dict:
    return {
        "key": "Widget",
        "label": "Widget",
        "description": "A widget.",
        "translations": {"label": {"en": "Widget EN", "de": "Dings"}},
        "subtypes": [{"key": "small", "label": "Small", "translations": {"de": "Klein"}}],
        "hierarchy_labels": [{"key": "part", "label": "Part of"}],
        "fields_schema": copy.deepcopy(FIELDS_SCHEMA),
    }


# ---------------------------------------------------------------------------
# Pure
# ---------------------------------------------------------------------------


class TestKeys:
    def test_escaping_round_trips(self):
        key = mm.make_key("type", "A", "section", "v1.0 50% & co")
        assert key == "type.A.section.v1%2E0 50%25 & co"
        assert mm.split_key(key) == ["type", "A", "section", "v1.0 50% & co"]

    def test_a_literal_percent_2e_is_not_a_dot(self):
        key = mm.make_key("category", "a%2Eb")
        assert key == "category.a%252Eb"
        assert mm.split_key(key) == ["category", "a%2Eb"]

    def test_plain_segments_are_unchanged(self):
        assert mm.make_key("type", "Application", "label") == "type.Application.label"
        assert mm.make_key("category", "Strategy & Transformation") == (
            "category.Strategy & Transformation"
        )


class TestSlots:
    def test_every_card_type_label(self):
        slots = {s.key: s for s in mm.card_type_slots(widget_record())}
        sec = mm.make_key("type", "Widget", "section", "Cost v1.0 & more")
        assert {k: s.english for k, s in slots.items()} == {
            "type.Widget.label": "Widget EN",
            "type.Widget.description": "A widget.",
            "type.Widget.subtype.small": "Small",
            "type.Widget.hierarchy.part": "Part of",
            sec: "Cost v1.0 & more",
            f"{sec}.group.Run 50%25": "Run 50%",
            "type.Widget.field.costTotal": "Total cost",
            "type.Widget.field.costTotal.help": "All costs",
            "type.Widget.field.costTotal.badge": "New",
            "type.Widget.field.tier": "Tier",
            "type.Widget.field.tier.option.gold": "Gold",
        }
        assert slots["type.Widget.label"].column == "translations"
        assert slots["type.Widget.label"].path == ("label",)
        assert slots["type.Widget.subtype.small"].path == (0, "translations")
        assert slots["type.Widget.field.costTotal.help"].path == (
            1,
            "fields",
            0,
            "helpTranslations",
        )
        assert slots[f"{sec}.group.Run 50%25"].path == (1, "groupTranslations", "Run 50%")
        assert slots["type.Widget.field.tier.option.gold"].path == (
            1,
            "fields",
            1,
            "options",
            0,
            "translations",
        )

    def test_empty_labels_make_no_slot(self):
        rec = {"key": "T", "label": "  ", "description": None, "fields_schema": [None, {}]}
        assert mm.card_type_slots(rec) == []

    def test_role_and_relation_slots(self):
        role = {
            "card_type_key": "Widget",
            "key": "owner",
            "label": "Owner",
            "description": "Owns it",
            "translations": {"label": {"en": "Owner EN"}},
        }
        assert [(s.key, s.english, s.path) for s in mm.role_slots(role)] == [
            ("role.Widget.owner.label", "Owner EN", ("label",)),
            ("role.Widget.owner.description", "Owns it", ("description",)),
        ]
        rel = {
            "key": "relWidget",
            "label": "uses",
            "reverse_label": None,
            "translations": {},
            "attributes_schema": [
                {"key": "mode", "label": "Mode", "options": [{"key": "r", "label": "Read"}]}
            ],
        }
        assert [(s.key, s.english, s.column) for s in mm.relation_slots(rel)] == [
            ("relation.relWidget.label", "uses", "translations"),
            ("relation.relWidget.attr.mode", "Mode", "attributes_schema"),
            ("relation.relWidget.attr.mode.option.r", "Read", "attributes_schema"),
        ]

    def test_flat_records(self):
        assert [s.key for s in mm.category_slots({"key": "A & B", "label": "A & B"})] == [
            "category.A & B"
        ]
        assert mm.dashboard_slots({"key": None, "name": "x"}) == []
        assert mm.dashboard_slots({"key": "home", "name": "Home"})[0].path == ()
        assert mm.regulation_slots({"key": "gdpr", "label": "GDPR"})[0].key == "regulation.gdpr"
        assert (
            mm.resource_slots({"kind": "link_type", "key": "wiki", "label": "Wiki"})[0].key
            == "resource.link_type.wiki"
        )


class TestLifecycle:
    def test_defaults_give_every_phase(self):
        english = mm.lifecycle_english({})
        assert list(english) == [
            "lifecycle.plan",
            "lifecycle.phaseIn",
            "lifecycle.active",
            "lifecycle.phaseOut",
            "lifecycle.endOfLife",
        ]
        assert english["lifecycle.plan"].startswith("Planned or under evaluation")

    def test_a_saved_setting_wins_and_an_empty_phase_has_no_entry(self):
        english = mm.lifecycle_english(
            {"lifecyclePhaseHelp": {"plan": {"en": "Our plan"}, "active": {"de": "nur de"}}}
        )
        assert english == {"lifecycle.plan": "Our plan"}

    def test_overlay_only_where_english_exists(self):
        help_ = {"plan": {"en": "Plan", "de": "Plan DE"}, "active": {"de": "nur de"}}
        out = mm.overlay_phase_help(
            help_,
            {
                "nl": {"lifecycle.plan": "Gepland", "lifecycle.active": "Actief"},
                "he": {"lifecycle.plan": " "},
            },
        )
        assert out == {
            "plan": {"en": "Plan", "de": "Plan DE", "nl": "Gepland"},
            "active": {"de": "nur de"},
        }
        assert help_["plan"] == {"en": "Plan", "de": "Plan DE"}


class TestSeedShareMap:
    def test_built_in_labels_are_in_it(self):
        seed = mm.seed_english()
        assert seed["type.Application.label"] == "Application"
        assert seed["category.Strategy & Transformation"] == "Strategy & Transformation"
        assert seed["dashboard.overview"] == "Overview"
        assert seed["relation.relObjectiveToBC.label"] == "improves"
        assert seed["role.Application.responsible.label"] == "Responsible"
        assert seed["lifecycle.plan"].startswith("Planned")
        assert any(k.startswith("type.Objective.field.objectiveType.option.") for k in seed)

    def test_regulations_and_resource_types_are_not(self):
        seed = mm.seed_english()
        assert not any(k.startswith(("regulation.", "resource.")) for k in seed)


class TestNamespace:
    def test_only_its_own_keys_exist(self):
        items = [
            mm.Entry("type.X.field.n_other", "Items", None, False),
            mm.Entry("type.X.label", "X", "Iks", False),
        ]
        ns = mm.namespace_of(items)
        assert ns.name == "metamodel"
        assert ns.source_key("type.X.field.n_few") is None
        assert ns.source_key("type.X.label") == "type.X.label"
        assert ns.hashes["type.X.label"] == lp.source_hash("X")
        assert mm.values_of(items) == {"type.X.label": "Iks"}


# ---------------------------------------------------------------------------
# Database round trip
# ---------------------------------------------------------------------------


@pytest.fixture
async def records(db):
    rec = widget_record()
    ct = await create_card_type(
        db,
        key="Widget",
        label="Widget",
        fields_schema=rec["fields_schema"],
        subtypes=rec["subtypes"],
        hierarchy_labels=rec["hierarchy_labels"],
        translations=rec["translations"],
        built_in=True,
    )
    ct.description = "A widget."
    role = await create_stakeholder_role_def(
        db,
        card_type_key="Widget",
        key="owner",
        label="Owner",
        description="Owns it",
        translations={"label": dict(DE)},
    )
    rel = await create_relation_type(
        db,
        key="relWidget",
        label="uses",
        reverse_label="is used by",
        source_type_key="Widget",
        target_type_key="Widget",
        built_in=True,
        attributes_schema=[
            {
                "key": "mode",
                "label": "Mode",
                "built_in": True,
                "translations": dict(DE),
                "options": [{"key": "r", "label": "Read", "built_in": True}],
            }
        ],
    )
    cat = CardTypeCategory(key="A & B", label="A & B", built_in=True, translations=dict(DE))
    dash = Dashboard(key="home", name="Home", built_in=True, translations={})
    reg = ComplianceRegulation(key="gdpr", label="GDPR", translations=dict(DE))
    res = ResourceType(kind="link_type", key="wiki", label="Wiki", translations={})
    db.add_all([cat, dash, reg, res])
    await db.flush()
    return {"ct": ct, "role": role, "rel": rel, "cat": cat, "dash": dash, "reg": reg, "res": res}


def _without(value, code):
    """``value`` with every ``code`` key removed from every dict in it, and the
    locale maps that leaves empty dropped (applied to both sides of a
    comparison, so a map the write had to create compares equal)."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if k == code:
                continue
            inner = _without(v, code)
            if inner != {}:
                out[k] = inner
        return out
    if isinstance(value, list):
        return [_without(v, code) for v in value]
    return value


COLUMNS = {
    "ct": ("translations", "subtypes", "hierarchy_labels", "fields_schema", "label"),
    "role": ("translations", "label", "description"),
    "rel": ("translations", "attributes_schema", "label", "reverse_label"),
    "cat": ("translations", "label"),
    "dash": ("translations", "name"),
    "reg": ("translations", "label"),
    "res": ("translations", "label"),
}


def _snapshot(records) -> dict:
    return {
        name: {col: copy.deepcopy(getattr(records[name], col)) for col in cols}
        for name, cols in COLUMNS.items()
    }


class TestRoundTrip:
    async def test_collect_lists_every_record_kind_untranslated(self, db, records):
        found = {e.key: e for e in await mm.collect(db, "nl")}
        for key in (
            "type.Widget.label",
            "type.Widget.description",
            "type.Widget.subtype.small",
            "type.Widget.hierarchy.part",
            "type.Widget.field.costTotal.help",
            "type.Widget.field.tier.option.gold",
            "role.Widget.owner.label",
            "role.Widget.owner.description",
            "relation.relWidget.label",
            "relation.relWidget.reverse_label",
            "relation.relWidget.attr.mode",
            "relation.relWidget.attr.mode.option.r",
            "category.A & B",
            "dashboard.home",
            "regulation.gdpr",
            "resource.link_type.wiki",
            "lifecycle.plan",
        ):
            assert key in found, key
            assert found[key].value is None
        assert found["type.Widget.label"].english == "Widget EN"
        assert found["role.Widget.owner.label"].english == "Owner"
        assert found["relation.relWidget.reverse_label"].english == "is used by"
        assert found["type.Widget.label"].built_in is False
        assert found["lifecycle.plan"].built_in is True

    async def test_apply_touches_only_the_custom_code(self, db, records):
        before = _snapshot(records)
        sec = mm.make_key("type", "Widget", "section", "Cost v1.0 & more")
        changes = {
            "type.Widget.label": "וידג'ט",
            "type.Widget.description": "एक विजेट",
            "type.Widget.subtype.small": "เล็ก",
            "type.Widget.hierarchy.part": "Deel van",
            sec: "Kosten NL",
            f"{sec}.group.Run 50%25": "Draaien",
            "type.Widget.field.costTotal": "Totaal",
            "type.Widget.field.costTotal.help": "Alle kosten",
            "type.Widget.field.costTotal.badge": "Nieuw",
            "type.Widget.field.tier.option.gold": "Goud",
            "role.Widget.owner.label": "Eigenaar",
            "relation.relWidget.reverse_label": "wordt gebruikt door",
            "relation.relWidget.attr.mode": "Modus",
            "relation.relWidget.attr.mode.option.r": "Lezen",
            "category.A & B": "A en B",
            "dashboard.home": "Start",
            "regulation.gdpr": "AVG",
            "resource.link_type.wiki": "Wiki NL",
            "lifecycle.plan": "Gepland",
        }
        rest = await mm.apply(db, "nl", changes)
        assert rest == {"lifecycle.plan": "Gepland"}
        for obj in records.values():
            await db.refresh(obj)

        after = _snapshot(records)
        assert _without(after, "nl") == _without(before, "nl")
        assert after != before

        ct = records["ct"]
        assert ct.translations == {
            "label": {"en": "Widget EN", "de": "Dings", "nl": "וידג'ט"},
            "description": {"nl": "एक विजेट"},
        }
        assert ct.subtypes[0]["translations"] == {"de": "Klein", "nl": "เล็ก"}
        assert ct.hierarchy_labels[0]["translations"] == {"nl": "Deel van"}
        section = ct.fields_schema[1]
        assert section["translations"]["nl"] == "Kosten NL"
        assert section["groupTranslations"]["Run 50%"] == {"de": "Betrieb", "nl": "Draaien"}
        field = section["fields"][0]
        assert field["helpTranslations"] == {"de": "Alle Kosten", "nl": "Alle kosten"}
        assert field["badgeTranslations"] == {"nl": "Nieuw"}
        assert section["fields"][1]["options"][0]["translations"]["nl"] == "Goud"
        assert records["rel"].attributes_schema[0]["options"][0]["translations"] == {"nl": "Lezen"}
        assert records["rel"].attributes_schema[0]["built_in"] is True
        assert records["cat"].translations == {"de": "Deutsch", "nl": "A en B"}
        assert records["dash"].translations == {"nl": "Start"}
        assert records["reg"].translations == {"de": "Deutsch", "nl": "AVG"}

        found = {e.key: e.value for e in await mm.collect(db, "nl")}
        for key, value in changes.items():
            if key != "lifecycle.plan":
                assert found[key] == value, key
        assert found["lifecycle.plan"] is None
        with_pack = {e.key: e.value for e in await mm.collect(db, "nl", rest)}
        assert with_pack["lifecycle.plan"] == "Gepland"

    async def test_none_clears_and_other_codes_stay(self, db, records):
        await mm.apply(db, "nl", {"category.A & B": "A en B", "regulation.gdpr": "AVG"})
        await mm.apply(db, "nl", {"category.A & B": None, "dashboard.home": None})
        await db.refresh(records["cat"])
        assert records["cat"].translations == {"de": "Deutsch"}
        found = {e.key: e.value for e in await mm.collect(db, "nl")}
        assert found["category.A & B"] is None
        assert found["regulation.gdpr"] == "AVG"
        assert {e.key: e.value for e in await mm.collect(db, "he")}["regulation.gdpr"] is None

    async def test_an_unknown_key_writes_nothing(self, db, records):
        before = _snapshot(records)
        assert await mm.apply(db, "nl", {"type.Nope.label": "x"}) == {}
        assert _snapshot(records) == before

    async def test_saved_phase_help_drives_the_lifecycle_keys(self, db):
        db.add(
            AppSettings(
                id="default",
                general_settings={"lifecyclePhaseHelp": {"phaseOut": {"en": "Going away"}}},
            )
        )
        await db.flush()
        snap = await mm.load(db)
        assert snap.lifecycle == {"lifecycle.phaseOut": "Going away"}

    async def test_load_reads_every_model(self, db, records):
        snap = await mm.load(db)
        kinds = {type(obj) for obj, _ in snap.records}
        assert kinds >= {
            CardType,
            StakeholderRoleDefinition,
            RelationType,
            CardTypeCategory,
            Dashboard,
            ComplianceRegulation,
            ResourceType,
        }
        rows = (await db.execute(select(CardType.key))).scalars().all()
        assert "Widget" in rows
