"""Manifest field-section contributions: merge into card types, soft removal.

The whole point of this capability (vs a content-pack CardTypes row, which
overwrites the entire fields_schema column) is that it is ADDITIVE and
reversible: admin customisations are never clobbered, and disable/uninstall
strips the extension's fields while attribute values survive untouched.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest

from app.services.extensions.bundle import BundleError, read_bundle
from app.services.extensions.field_contributions import (
    _sanitize_field,
    apply_field_contributions,
    remove_field_contributions,
)
from tests.conftest import create_card, create_card_type
from tests.teax_helpers import build_manifest, build_teax, make_keypair, trust_test_key

EXT = "esg-pack"


def manifest_with(sections):
    return {"metamodel": {"field_sections": sections}}


def contribution(card_type="Application", section="ESG Metrics", fields=None, placement=None):
    row = {
        "card_type": card_type,
        "section": section,
        "columns": 1,
        "translations": {"de": "ESG-Kennzahlen"},
        "fields": fields
        if fields is not None
        else [
            {
                "key": "esgRating",
                "label": "ESG Rating",
                "type": f"ext.{EXT}.rating",
                "config": {"min": 1, "max": 5},
                "weight": 1,
            },
            {"key": "esgAudited", "label": "ESG Audited", "type": "boolean"},
        ],
    }
    if placement is not None:
        row["placement"] = placement
    return row


def section_named(ct, name):
    return next((s for s in (ct.fields_schema or []) if s.get("section") == name), None)


class TestSanitizeField:
    def test_badge_props_survive_and_are_stamped(self):
        out = _sanitize_field(
            EXT,
            {
                "key": "quickField",
                "label": "Quick Field",
                "type": "single_select",
                "badge": "Quick",
                "badgeTranslations": {"de": "Schnell", "fr": "Rapide"},
            },
        )
        assert out["badge"] == "Quick"
        assert out["badgeTranslations"] == {"de": "Schnell", "fr": "Rapide"}
        assert out["ext"] == EXT

    def test_unknown_props_are_dropped(self):
        out = _sanitize_field(EXT, {"key": "f", "label": "F", "type": "text", "evil": "x"})
        assert "evil" not in out


class TestApply:
    async def test_apply_appends_stamped_section(self, db):
        ct = await create_card_type(
            db,
            key="Application",
            label="Application",
            fields_schema=[
                {
                    "section": "Core",
                    "fields": [{"key": "hosting", "label": "Hosting", "type": "text"}],
                }
            ],
        )
        n = await apply_field_contributions(db, EXT, manifest_with([contribution()]))
        assert n == 2
        sec = section_named(ct, "ESG Metrics")
        assert sec is not None and sec["ext"] == EXT
        assert [f["key"] for f in sec["fields"]] == ["esgRating", "esgAudited"]
        assert all(f["ext"] == EXT for f in sec["fields"])
        # Admin's existing section untouched.
        assert section_named(ct, "Core")["fields"][0] == {
            "key": "hosting",
            "label": "Hosting",
            "type": "text",
        }

    async def test_apply_copies_group_translations_onto_section(self, db):
        ct = await create_card_type(db, key="Application", label="Application")
        contrib = contribution(
            fields=[{"key": "d1", "label": "D1", "type": "text", "group": "Dimension One"}]
        )
        contrib["groupTranslations"] = {"Dimension One": {"de": "Dimension Eins"}}
        await apply_field_contributions(db, EXT, manifest_with([contrib]))
        sec = section_named(ct, "ESG Metrics")
        assert sec["groupTranslations"] == {"Dimension One": {"de": "Dimension Eins"}}

    async def test_apply_is_idempotent(self, db):
        ct = await create_card_type(db, key="Application", label="Application")
        m = manifest_with([contribution()])
        await apply_field_contributions(db, EXT, m)
        before = json.dumps(ct.fields_schema, sort_keys=True)
        await apply_field_contributions(db, EXT, m)
        assert json.dumps(ct.fields_schema, sort_keys=True) == before
        assert len([s for s in ct.fields_schema if s.get("ext") == EXT]) == 1

    async def test_update_replaces_ext_fields_keeps_admin_fields(self, db):
        ct = await create_card_type(db, key="Application", label="Application")
        await apply_field_contributions(db, EXT, manifest_with([contribution()]))
        # Admin adds their own field inside the contributed section.
        sec = section_named(ct, "ESG Metrics")
        sec["fields"].append({"key": "adminNote", "label": "Note", "type": "text"})
        # v2 of the extension drops esgAudited and renames the rating label.
        v2 = contribution(
            fields=[{"key": "esgRating", "label": "ESG Score", "type": f"ext.{EXT}.rating"}]
        )
        await apply_field_contributions(db, EXT, manifest_with([v2]))
        sec = section_named(ct, "ESG Metrics")
        keys = [f["key"] for f in sec["fields"]]
        assert "adminNote" in keys  # admin field preserved
        assert "esgAudited" not in keys  # dropped ext field gone
        rating = next(f for f in sec["fields"] if f["key"] == "esgRating")
        assert rating["label"] == "ESG Score"

    async def test_conflicting_field_key_is_skipped(self, db):
        ct = await create_card_type(
            db,
            key="Application",
            label="Application",
            fields_schema=[
                {
                    "section": "Core",
                    "fields": [{"key": "esgRating", "label": "Theirs", "type": "number"}],
                }
            ],
        )
        n = await apply_field_contributions(db, EXT, manifest_with([contribution()]))
        assert n == 1  # only esgAudited landed
        core = section_named(ct, "Core")
        assert core["fields"][0]["label"] == "Theirs"  # never hijacked
        sec = section_named(ct, "ESG Metrics")
        assert [f["key"] for f in sec["fields"]] == ["esgAudited"]

    async def test_missing_card_type_is_skipped(self, db):
        n = await apply_field_contributions(
            db, EXT, manifest_with([contribution(card_type="Nope")])
        )
        assert n == 0

    async def test_retargeting_cleans_the_old_type(self, db):
        app = await create_card_type(db, key="Application", label="Application")
        itc = await create_card_type(db, key="ITComponent", label="IT Component")
        await apply_field_contributions(db, EXT, manifest_with([contribution()]))
        assert section_named(app, "ESG Metrics") is not None
        await apply_field_contributions(
            db, EXT, manifest_with([contribution(card_type="ITComponent")])
        )
        assert section_named(app, "ESG Metrics") is None
        assert section_named(itc, "ESG Metrics") is not None


class TestRemove:
    async def test_remove_strips_fields_but_preserves_values(self, db):
        ct = await create_card_type(db, key="Application", label="Application")
        await apply_field_contributions(db, EXT, manifest_with([contribution()]))
        card = await create_card(
            db, card_type="Application", name="NexaCore ERP", attributes={"esgRating": 4}
        )
        removed = await remove_field_contributions(db, EXT)
        assert removed == 2
        assert section_named(ct, "ESG Metrics") is None
        # THE invariant: the value survives the removal untouched.
        assert card.attributes == {"esgRating": 4}
        # Re-apply (re-enable / reinstall) brings the schema back — the stored
        # value is renderable again with zero migration.
        await apply_field_contributions(db, EXT, manifest_with([contribution()]))
        assert section_named(ct, "ESG Metrics") is not None

    async def test_remove_keeps_section_with_admin_fields(self, db):
        ct = await create_card_type(db, key="Application", label="Application")
        await apply_field_contributions(db, EXT, manifest_with([contribution()]))
        sec = section_named(ct, "ESG Metrics")
        sec["fields"].append({"key": "adminNote", "label": "Note", "type": "text"})
        await remove_field_contributions(db, EXT)
        sec = section_named(ct, "ESG Metrics")
        assert sec is not None  # survives because the admin owns a field in it
        assert [f["key"] for f in sec["fields"]] == ["adminNote"]

    async def test_remove_never_touches_other_extensions(self, db):
        ct = await create_card_type(db, key="Application", label="Application")
        await apply_field_contributions(db, EXT, manifest_with([contribution()]))
        await apply_field_contributions(
            db,
            "other-ext",
            manifest_with(
                [
                    contribution(
                        section="Other",
                        fields=[{"key": "otherField", "label": "Other", "type": "text"}],
                    )
                ]
            ),
        )
        await remove_field_contributions(db, EXT)
        assert section_named(ct, "ESG Metrics") is None
        assert section_named(ct, "Other") is not None


class TestSectionPlacement:
    """A contributed section belongs with the card's own content, above Relations.

    ``custom:N`` is a POSITIONAL index into ``fields_schema`` minus the magic
    ``__description`` section, and card detail appends any ``custom:N`` missing
    from a stored ``__order`` to the very END — i.e. below Relations, unlike
    ``tags``/``successors``, which are spliced in before it. So a type with a
    stored order needs the new key inserted; a type without one already renders
    custom sections high and must be left alone.
    """

    async def test_new_section_lands_before_relations(self, db):
        ct = await create_card_type(
            db,
            key="Application",
            label="Application",
            fields_schema=[
                {"section": "__description", "fields": []},
                {"section": "Core", "fields": [{"key": "hosting", "label": "H", "type": "text"}]},
            ],
            section_config={
                "__order": ["description", "custom:0", "hierarchy", "relations", "tags"]
            },
        )
        await apply_field_contributions(db, EXT, manifest_with([contribution()]))
        # __description is filtered out, so Core is custom:0 and ours is custom:1.
        assert ct.section_config["__order"] == [
            "description",
            "custom:0",
            "hierarchy",
            "custom:1",
            "relations",
            "tags",
        ]

    async def test_order_without_relations_appends(self, db):
        ct = await create_card_type(
            db,
            key="Application",
            label="Application",
            fields_schema=[{"section": "Core", "fields": []}],
            section_config={"__order": ["description", "custom:0"]},
        )
        await apply_field_contributions(db, EXT, manifest_with([contribution()]))
        assert ct.section_config["__order"] == ["description", "custom:0", "custom:1"]

    async def test_no_stored_order_stays_unwritten(self, db):
        """That path already renders custom sections above Relations; writing an
        order here would freeze a layout the admin never chose."""
        ct = await create_card_type(db, key="Application", label="Application")
        await apply_field_contributions(db, EXT, manifest_with([contribution()]))
        assert not (ct.section_config or {}).get("__order")

    async def test_placement_is_the_extensions_call_not_cores(self, db):
        """Core supplies a default and no opinion beyond it. "Just above
        Relations" suits a regulatory attribute block and not, say, a
        post-decision summary meant to read last."""
        for placement, expected in [
            (None, ["description", "custom:0", "custom:1", "relations", "tags"]),
            ("before:relations", ["description", "custom:0", "custom:1", "relations", "tags"]),
            ("end", ["description", "custom:0", "relations", "tags", "custom:1"]),
            ("start", ["custom:1", "description", "custom:0", "relations", "tags"]),
            ("after:description", ["description", "custom:1", "custom:0", "relations", "tags"]),
            ("before:tags", ["description", "custom:0", "relations", "custom:1", "tags"]),
        ]:
            ct = await create_card_type(
                db,
                key=f"Application{placement or 'default'}".replace(":", ""),
                label="Application",
                fields_schema=[{"section": "Core", "fields": []}],
                section_config={"__order": ["description", "custom:0", "relations", "tags"]},
            )
            await apply_field_contributions(
                db, EXT, manifest_with([contribution(card_type=ct.key, placement=placement)])
            )
            assert ct.section_config["__order"] == expected, placement

    async def test_unknown_anchor_falls_back_to_the_default_not_the_bottom(self, db):
        """`eol` and `successors` exist on some card types and not others, and
        one contribution can target several. An author who asked for a high
        position must not get the one outcome they were avoiding."""
        ct = await create_card_type(
            db,
            key="Application",
            label="Application",
            fields_schema=[{"section": "Core", "fields": []}],
            section_config={"__order": ["description", "custom:0", "relations"]},
        )
        await apply_field_contributions(
            db, EXT, manifest_with([contribution(placement="after:eol")])
        )
        assert ct.section_config["__order"] == [
            "description",
            "custom:0",
            "custom:1",
            "relations",
        ]

    async def test_a_manifest_edit_never_rehomes_a_placed_section(self, db):
        """Placement is a starting point, not a policy — the same guard that
        protects an admin's drag protects them from a vendor changing its mind."""
        ct = await create_card_type(
            db,
            key="Application",
            label="Application",
            fields_schema=[{"section": "Core", "fields": []}],
            section_config={"__order": ["description", "custom:0", "relations"]},
        )
        await apply_field_contributions(
            db, EXT, manifest_with([contribution(placement="before:relations")])
        )
        before = list(ct.section_config["__order"])
        await apply_field_contributions(db, EXT, manifest_with([contribution(placement="end")]))
        assert ct.section_config["__order"] == before

    async def test_reapply_places_a_section_that_was_never_placed(self, db):
        """The upgrade path: an install whose contributed section already exists
        but is absent from ``__order`` (it predates this rule, or the order was
        saved before the section existed). Placement therefore runs on EVERY
        apply — a first-creation-only call left those instances rendering the
        section below Relations forever, with no reinstall able to fix it."""
        ct = await create_card_type(
            db,
            key="Application",
            label="Application",
            fields_schema=[{"section": "Core", "fields": []}],
            section_config={"__order": ["description", "custom:0", "relations"]},
        )
        m = manifest_with([contribution()])
        await apply_field_contributions(db, EXT, m)
        # Rewind to the pre-rule state: the section exists, the order forgets it.
        ct.section_config = {"__order": ["description", "custom:0", "relations"]}
        await apply_field_contributions(db, EXT, m)
        assert ct.section_config["__order"] == [
            "description",
            "custom:0",
            "custom:1",
            "relations",
        ]

    async def test_reapply_never_moves_a_section_the_admin_dragged(self, db):
        ct = await create_card_type(
            db,
            key="Application",
            label="Application",
            fields_schema=[{"section": "Core", "fields": []}],
            section_config={"__order": ["description", "custom:0", "relations"]},
        )
        m = manifest_with([contribution()])
        await apply_field_contributions(db, EXT, m)
        # Admin drags our section to the very bottom.
        ct.section_config = {"__order": ["description", "custom:0", "relations", "custom:1"]}
        await apply_field_contributions(db, EXT, m)
        assert ct.section_config["__order"] == [
            "description",
            "custom:0",
            "relations",
            "custom:1",
        ]

    async def test_removal_reindexes_later_sections(self, db):
        """Dropping our section shifts every later one down by one — a stored
        order that is not rewritten silently starts addressing the wrong ones."""
        ct = await create_card_type(
            db,
            key="Application",
            label="Application",
            fields_schema=[{"section": "Core", "fields": []}],
            section_config={"__order": ["description", "custom:0", "relations"]},
        )
        await apply_field_contributions(db, EXT, manifest_with([contribution()]))
        # Admin adds a section of their own AFTER ours and orders it last.
        ct.fields_schema = [*ct.fields_schema, {"section": "Ops", "fields": []}]
        ct.section_config = {
            "__order": ["description", "custom:0", "custom:1", "custom:2", "relations"]
        }
        await remove_field_contributions(db, EXT)
        # Ours (custom:1) is gone; Ops slides from custom:2 down to custom:1.
        assert [s["section"] for s in ct.fields_schema] == ["Core", "Ops"]
        assert ct.section_config["__order"] == [
            "description",
            "custom:0",
            "custom:1",
            "relations",
        ]

    async def test_removal_keeps_order_when_the_section_survives(self, db):
        """The removal loop rebuilds every EDITED section as a new dict, so an
        identity-based reindex would read them all as removed and drop their
        order entries. Here only our fields go; the section stays."""
        ct = await create_card_type(
            db,
            key="Application",
            label="Application",
            fields_schema=[{"section": "Core", "fields": []}],
            section_config={"__order": ["description", "custom:0", "custom:1", "relations"]},
        )
        await apply_field_contributions(db, EXT, manifest_with([contribution()]))
        section_named(ct, "ESG Metrics")["fields"].append(
            {"key": "adminNote", "label": "Note", "type": "text"}
        )
        await remove_field_contributions(db, EXT)
        assert section_named(ct, "ESG Metrics") is not None
        assert ct.section_config["__order"] == [
            "description",
            "custom:0",
            "custom:1",
            "relations",
        ]


class TestBundleValidation:
    """Manifest shape checks run at signature-verification time."""

    @pytest.fixture
    def keypair(self, monkeypatch):
        private, public_b64 = make_keypair()
        trust_test_key(monkeypatch, public_b64)
        return private

    def bundle(self, tmp_path, keypair, **extra):
        content = json.dumps({"CardTypes": []}).encode()
        files = {"content/pack.json": content}
        manifest = build_manifest(
            key=EXT,
            capabilities=extra.pop("capabilities", ["content", "metamodel"]),
            files=files,
            **extra,
        )
        raw = build_teax(keypair, files=files, manifest=manifest)
        path = tmp_path / "b.teax"
        path.write_bytes(raw)
        return path

    def test_valid_metamodel_block_passes(self, tmp_path, keypair):
        path = self.bundle(tmp_path, keypair, metamodel={"field_sections": [contribution()]})
        assert read_bundle(path).key == EXT

    def test_block_without_capability_rejected(self, tmp_path, keypair):
        path = self.bundle(
            tmp_path,
            keypair,
            capabilities=["content"],
            metamodel={"field_sections": [contribution()]},
        )
        with pytest.raises(BundleError, match="metamodel capability"):
            read_bundle(path)

    def test_capability_without_block_rejected(self, tmp_path, keypair):
        path = self.bundle(tmp_path, keypair)
        with pytest.raises(BundleError, match="metamodel object"):
            read_bundle(path)

    def test_foreign_ext_type_namespace_rejected(self, tmp_path, keypair):
        bad = contribution(fields=[{"key": "x", "label": "X", "type": "ext.other-ext.rating"}])
        path = self.bundle(tmp_path, keypair, metamodel={"field_sections": [bad]})
        with pytest.raises(BundleError, match="namespaced"):
            read_bundle(path)

    def test_missing_field_key_rejected(self, tmp_path, keypair):
        bad = contribution(fields=[{"label": "X", "type": "text"}])
        path = self.bundle(tmp_path, keypair, metamodel={"field_sections": [bad]})
        with pytest.raises(BundleError, match="missing key"):
            read_bundle(path)


# ---------------------------------------------------------------------------
# Subtype contributions — same merge/strip lifecycle on card_types.subtypes
# ---------------------------------------------------------------------------

from app.services.extensions.field_contributions import (  # noqa: E402
    apply_subtype_contributions,
    remove_subtype_contributions,
)


def subtype_manifest(card_type="Organization", subtypes=None):
    return {
        "metamodel": {
            "subtypes": [
                {
                    "card_type": card_type,
                    "subtypes": subtypes
                    if subtypes is not None
                    else [
                        {
                            "key": "branch",
                            "label": "Branch",
                            "translations": {"de": "Zweigniederlassung"},
                        }
                    ],
                }
            ]
        }
    }


class TestSubtypeContributions:
    async def test_apply_appends_stamped_subtype(self, db):
        ct = await create_card_type(
            db,
            key="Organization",
            label="Organization",
            subtypes=[{"key": "legalEntity", "label": "Legal Entity"}],
        )
        applied = await apply_subtype_contributions(db, EXT, subtype_manifest())
        assert applied == 1
        keys = [s["key"] for s in ct.subtypes]
        assert keys == ["legalEntity", "branch"]
        branch = ct.subtypes[-1]
        assert branch["ext"] == EXT
        assert branch["translations"]["de"] == "Zweigniederlassung"
        # Idempotent: re-applying changes nothing.
        assert await apply_subtype_contributions(db, EXT, subtype_manifest()) == 1
        assert [s["key"] for s in ct.subtypes] == ["legalEntity", "branch"]

    async def test_existing_subtype_is_never_hijacked(self, db):
        ct = await create_card_type(
            db,
            key="Organization",
            label="Organization",
            subtypes=[{"key": "branch", "label": "Admin's Branch"}],
        )
        applied = await apply_subtype_contributions(db, EXT, subtype_manifest())
        assert applied == 0
        assert ct.subtypes == [{"key": "branch", "label": "Admin's Branch"}]

    async def test_remove_strips_stamped_but_card_values_survive(self, db):
        ct = await create_card_type(db, key="Organization", label="Organization", subtypes=[])
        await apply_subtype_contributions(db, EXT, subtype_manifest())
        card = await create_card(db, type="Organization", name="Berlin office", subtype="branch")
        removed = await remove_subtype_contributions(db, EXT)
        assert removed == 1
        assert ct.subtypes == []
        assert card.subtype == "branch"  # value untouched — rendering degrades
        # Re-applying restores the label for the surviving value.
        await apply_subtype_contributions(db, EXT, subtype_manifest())
        assert ct.subtypes[0]["key"] == "branch"

    async def test_retargeted_contribution_cleans_old_type(self, db):
        org = await create_card_type(db, key="Organization", label="Organization", subtypes=[])
        prov = await create_card_type(db, key="Provider", label="Provider", subtypes=[])
        await apply_subtype_contributions(db, EXT, subtype_manifest("Organization"))
        assert [s["key"] for s in org.subtypes] == ["branch"]
        await apply_subtype_contributions(db, EXT, subtype_manifest("Provider"))
        assert org.subtypes == []
        assert [s["key"] for s in prov.subtypes] == ["branch"]

    async def test_missing_card_type_is_skipped(self, db):
        assert await apply_subtype_contributions(db, EXT, subtype_manifest("NoSuchType")) == 0

    async def test_unknown_props_are_dropped_and_stamped(self, db):
        ct = await create_card_type(db, key="Organization", label="Organization", subtypes=[])
        await apply_subtype_contributions(
            db,
            EXT,
            subtype_manifest(
                subtypes=[{"key": "branch", "label": "Branch", "evil": "x", "color": "#123456"}]
            ),
        )
        branch = ct.subtypes[0]
        assert "evil" not in branch
        assert branch["color"] == "#123456"
        assert branch["ext"] == EXT


class TestSubtypeBundleValidation(TestBundleValidation):
    """metamodel.subtypes shape checks at signature-verification time."""

    def test_subtypes_only_metamodel_block_accepted(self, tmp_path, keypair):
        path = self.bundle(
            tmp_path,
            keypair,
            metamodel={
                "subtypes": [
                    {
                        "card_type": "Organization",
                        "subtypes": [{"key": "branch", "label": "Branch"}],
                    }
                ]
            },
        )
        bundle = read_bundle(path)
        assert bundle.manifest["metamodel"]["subtypes"][0]["card_type"] == "Organization"

    def test_subtype_missing_label_rejected(self, tmp_path, keypair):
        path = self.bundle(
            tmp_path,
            keypair,
            metamodel={
                "subtypes": [{"card_type": "Organization", "subtypes": [{"key": "branch"}]}]
            },
        )
        with pytest.raises(BundleError, match="missing label"):
            read_bundle(path)

    def test_subtype_row_missing_card_type_rejected(self, tmp_path, keypair):
        path = self.bundle(
            tmp_path,
            keypair,
            metamodel={"subtypes": [{"subtypes": [{"key": "branch", "label": "Branch"}]}]},
        )
        with pytest.raises(BundleError, match="missing card_type"):
            read_bundle(path)


# ---------------------------------------------------------------------------
# Self-heal: contributions_missing / heal_contributions
# ---------------------------------------------------------------------------

HEAL_EXT = "sample-ext"


def heal_manifest(card_type="Gadget"):
    return {
        "metamodel": {
            "field_sections": [
                {
                    "card_type": card_type,
                    "section": "Sample",
                    "fields": [
                        {"key": "h1", "label": "H1", "type": "number", "weight": 1},
                        {"key": "h2", "label": "H2", "type": "text"},
                    ],
                }
            ],
            "subtypes": [{"card_type": card_type, "subtypes": [{"key": "sub", "label": "Sub"}]}],
        }
    }


INTACT_SECTION = {
    "section": "Sample",
    "ext": HEAL_EXT,
    "fields": [
        {"key": "h1", "label": "H1", "type": "number", "weight": 1, "ext": HEAL_EXT},
        {"key": "h2", "label": "H2", "type": "text", "ext": HEAL_EXT},
    ],
}
INTACT_SUBTYPES = [{"key": "sub", "label": "Sub", "ext": HEAL_EXT}]


async def heal_type(db, *, fields_schema=None, subtypes=None):
    return await create_card_type(
        db,
        key="Gadget",
        label="Gadget",
        fields_schema=fields_schema
        if fields_schema is not None
        else [{"section": "Core", "fields": []}, json.loads(json.dumps(INTACT_SECTION))],
        subtypes=subtypes if subtypes is not None else json.loads(json.dumps(INTACT_SUBTYPES)),
    )


async def extension_row(db, key=HEAL_EXT, *, manifest=None, **kw):
    from app.models.extension import Extension

    row = Extension(
        key=key,
        name=key,
        version="1.0.0",
        manifest=manifest if manifest is not None else heal_manifest(),
        capabilities=["metamodel"],
        status=kw.get("status", "installed"),
        enabled=kw.get("enabled", True),
    )
    db.add(row)
    await db.flush()
    return row


def section(name, ext=None, fields=()):
    out = {"section": name, "fields": [dict(f) if isinstance(f, dict) else f for f in fields]}
    if ext:
        out["ext"] = ext
    return out


class TestFieldSectionsMissing:
    """The pure check, on in-memory card types (a truth table)."""

    @staticmethod
    def types(schema, subtypes=()):
        from app.models.card_type import CardType

        return {"Gadget": CardType(key="Gadget", fields_schema=schema, subtypes=list(subtypes))}

    def test_truth_table(self):
        from app.services.extensions.field_contributions import field_sections_missing

        h1 = {"key": "h1", "ext": HEAL_EXT}
        h2 = {"key": "h2", "ext": HEAL_EXT}
        cases = [
            ([section("Sample", HEAL_EXT, [h1, h2])], False),  # intact
            ([], True),  # section and fields gone
            ([section("Sample", HEAL_EXT, [h1])], True),  # one field gone
            # Field-centric: every key is on the type, wherever it sits.
            ([section("Sample", None, [h1, h2])], False),  # section unstamped
            ([section("Renamed", HEAL_EXT, [h1, h2])], False),  # renamed section
            ([section("Sample", "other", [h1, h2])], False),  # someone else's section
            ([section("Mine", None, [h1]), section("Sample", HEAL_EXT, [h2])], False),  # moved
            ([section("Mine", None, [h1])], True),  # moved one, the other gone
            ([{"section": "Odd", "fields": "junk"}, section("S", None, [h1, h2])], False),
            # A key someone else holds is never taken over, so never missing.
            ([section("Sample", HEAL_EXT, [h1]), section("Core", None, [{"key": "h2"}])], False),
            ([section("Core", None, [{"key": "h1"}, {"key": "h2", "ext": "o"}])], False),
            (["junk", section("Sample", HEAL_EXT, [h1, h2, "junk"])], False),
        ]
        for schema, expected in cases:
            assert field_sections_missing(self.types(schema), HEAL_EXT, heal_manifest()) is (
                expected
            ), schema

    def test_a_missing_target_type_or_no_contributions_is_not_missing(self):
        from app.services.extensions.field_contributions import field_sections_missing

        assert field_sections_missing({}, HEAL_EXT, heal_manifest()) is False
        assert field_sections_missing(self.types([]), HEAL_EXT, {}) is False
        assert field_sections_missing(self.types([]), HEAL_EXT, None) is False
        malformed = {
            "metamodel": {
                "field_sections": [
                    "junk",
                    {"card_type": "Gadget", "fields": [{"key": "h1"}]},  # no section
                    {"card_type": "Gadget", "section": "S", "fields": ["junk", {"label": "x"}]},
                ]
            }
        }
        assert field_sections_missing(self.types([]), HEAL_EXT, malformed) is False

    def test_subtypes_truth_table(self):
        from app.services.extensions.field_contributions import subtypes_missing

        m = heal_manifest()
        assert subtypes_missing(self.types([], INTACT_SUBTYPES), HEAL_EXT, m) is False
        assert subtypes_missing(self.types([], []), HEAL_EXT, m) is True
        # Present outside the extension: apply never takes it, never missing.
        assert subtypes_missing(self.types([], [{"key": "sub"}]), HEAL_EXT, m) is False
        assert subtypes_missing(self.types([], ["junk"]), HEAL_EXT, m) is True
        assert subtypes_missing({}, HEAL_EXT, m) is False
        no_label = {
            "metamodel": {
                "subtypes": [
                    "junk",
                    {"card_type": "Gadget", "subtypes": [{"key": "sub"}, {"label": "L"}, "junk"]},
                    {"card_type": "Gadget", "subtypes": "x"},
                ]
            }
        }
        assert subtypes_missing(self.types([], []), HEAL_EXT, no_label) is False


class TestContributionsMissing:
    async def test_reads_the_target_types(self, db):
        from app.services.extensions.field_contributions import contributions_missing

        await heal_type(db)
        assert await contributions_missing(db, HEAL_EXT, heal_manifest()) is False
        assert await contributions_missing(db, HEAL_EXT, heal_manifest("Nope")) is False
        assert await contributions_missing(db, HEAL_EXT, {}) is False

    async def test_a_missing_section_or_subtype_each_counts(self, db):
        from app.services.extensions.field_contributions import contributions_missing

        ct = await heal_type(db, fields_schema=[])
        assert await contributions_missing(db, HEAL_EXT, heal_manifest()) is True
        ct.fields_schema = [json.loads(json.dumps(INTACT_SECTION))]
        ct.subtypes = []
        await db.flush()
        assert await contributions_missing(db, HEAL_EXT, heal_manifest()) is True


class TestHealContributions:
    @pytest.fixture
    def spies(self, monkeypatch):
        from unittest.mock import AsyncMock

        from app.services.extensions import field_contributions as fc

        recompute = AsyncMock()
        flagged: list = []
        real_flag = fc.flag_modified
        monkeypatch.setattr(fc, "_recompute_data_quality", recompute)
        monkeypatch.setattr(
            fc, "flag_modified", lambda obj, key: (flagged.append(key), real_flag(obj, key))
        )
        return recompute, flagged

    async def test_restores_a_wiped_section_and_subtype(self, db, spies):
        from app.services.extensions.field_contributions import heal_contributions

        recompute, flagged = spies
        ct = await heal_type(db, fields_schema=[{"section": "Core", "fields": []}], subtypes=[])
        await extension_row(db)
        assert await heal_contributions(db) == [HEAL_EXT]
        assert ct.fields_schema == [{"section": "Core", "fields": []}, INTACT_SECTION]
        assert ct.subtypes == INTACT_SUBTYPES
        assert recompute.await_count == 1
        assert recompute.await_args.args[1] == {"Gadget"}
        assert flagged == ["fields_schema", "subtypes"]

    async def test_only_the_missing_half_is_applied(self, db, spies):
        from app.services.extensions.field_contributions import heal_contributions

        recompute, flagged = spies
        ct = await heal_type(db, subtypes=[])
        await extension_row(db)
        assert await heal_contributions(db) == [HEAL_EXT]
        assert ct.subtypes == INTACT_SUBTYPES
        assert recompute.await_count == 0
        assert flagged == ["subtypes"]

    async def test_intact_is_a_strict_no_op(self, db, spies):
        from app.services.extensions.field_contributions import heal_contributions

        recompute, flagged = spies
        ct = await heal_type(db)
        await extension_row(db)
        before = (json.dumps(ct.fields_schema), json.dumps(ct.subtypes))
        assert await heal_contributions(db) == []
        assert recompute.await_count == 0
        assert flagged == []
        assert (json.dumps(ct.fields_schema), json.dumps(ct.subtypes)) == before
        assert ct not in db.dirty

    async def test_disabled_and_removed_extensions_are_left_alone(self, db, spies):
        from app.services.extensions.field_contributions import heal_contributions

        recompute, flagged = spies
        ct = await heal_type(db, fields_schema=[], subtypes=[])
        await extension_row(db, "off-ext", enabled=False)
        await extension_row(db, "dis-ext", status="disabled")
        await extension_row(db, "gone-ext", status="removed")
        assert await heal_contributions(db) == []
        assert ct.fields_schema == [] and ct.subtypes == []
        assert recompute.await_count == 0 and flagged == []

    async def test_heals_whatever_the_licence_and_in_key_order(self, db, spies):
        from app.services.extensions.field_contributions import heal_contributions
        from app.services.extensions.registry import extension_registry

        extension_registry.clear()  # no licence anywhere
        await heal_type(db, fields_schema=[], subtypes=[])
        await extension_row(db, "z-ext", status="failed", manifest=heal_manifest())
        await extension_row(db, HEAL_EXT, status="needs_restart", manifest={})
        await extension_row(
            db,
            "a-ext",
            manifest={
                "metamodel": {
                    "subtypes": [{"card_type": "Gadget", "subtypes": [{"key": "a", "label": "A"}]}]
                }
            },
        )
        assert await heal_contributions(db) == ["a-ext", "z-ext"]


class TestApplyKeepsWhatAnAdminMoved:
    """An admin may move a contributed field into a section of their own, or
    rename the contributed section. Apply re-syncs the field where it stands
    and never adopts, renames or restamps an admin's (unstamped) section, nor
    adds a key a second time."""

    MANIFEST = heal_manifest()

    async def test_fields_in_an_unstamped_section_are_resynced_in_place(self, db):
        holder = {
            "section": "Sample",
            "fields": [
                {"key": "h1", "label": "Old", "type": "text", "ext": HEAL_EXT},
                {"key": "mine", "label": "Mine", "type": "text"},
                {"key": "h2", "label": "H2", "type": "text", "ext": HEAL_EXT},
            ],
        }
        ct = await heal_type(
            db,
            fields_schema=[
                {"section": "Core", "fields": [{"key": "h9", "ext": "other"}]},
                json.loads(json.dumps(holder)),
            ],
        )
        assert await apply_field_contributions(db, HEAL_EXT, self.MANIFEST) == 2
        assert ct.fields_schema == [
            {"section": "Core", "fields": [{"key": "h9", "ext": "other"}]},
            {
                "section": "Sample",
                "fields": [
                    INTACT_SECTION["fields"][0],
                    {"key": "mine", "label": "Mine", "type": "text"},
                    INTACT_SECTION["fields"][1],
                ],
            },
        ]

    async def test_a_moved_field_is_not_added_again_to_the_contributed_section(self, db):
        moved = dict(INTACT_SECTION["fields"][0], label="Renamed by admin")
        ct = await heal_type(
            db,
            fields_schema=[
                {"section": "Mine", "fields": [{"key": "a", "label": "A", "type": "text"}, moved]},
                {
                    "section": "Sample",
                    "ext": HEAL_EXT,
                    "fields": [json.loads(json.dumps(INTACT_SECTION["fields"][1]))],
                },
            ],
        )
        await apply_field_contributions(db, HEAL_EXT, self.MANIFEST)
        assert ct.fields_schema == [
            {
                "section": "Mine",
                "fields": [{"key": "a", "label": "A", "type": "text"}, INTACT_SECTION["fields"][0]],
            },
            INTACT_SECTION | {"fields": [INTACT_SECTION["fields"][1]]},
        ]

    async def test_a_duplicate_left_by_an_older_apply_is_folded_away(self, db):
        h1 = INTACT_SECTION["fields"][0]
        ct = await heal_type(
            db,
            fields_schema=[
                {"section": "Mine", "fields": [dict(h1)]},
                json.loads(json.dumps(INTACT_SECTION)),
            ],
        )
        await apply_field_contributions(db, HEAL_EXT, self.MANIFEST)
        assert ct.fields_schema == [
            {"section": "Mine", "fields": [h1]},
            INTACT_SECTION | {"fields": [INTACT_SECTION["fields"][1]]},
        ]

    async def test_all_fields_moved_and_section_deleted_creates_nothing(self, db):
        fields = json.loads(json.dumps(INTACT_SECTION["fields"]))
        ct = await heal_type(db, fields_schema=[{"section": "Mine", "fields": fields}])
        assert await apply_field_contributions(db, HEAL_EXT, self.MANIFEST) == 2
        assert ct.fields_schema == [{"section": "Mine", "fields": INTACT_SECTION["fields"]}]

    async def test_junk_sections_are_passed_over(self, db):
        ct = await heal_type(db, fields_schema=["junk", {"section": "Odd", "fields": "x"}])
        await apply_field_contributions(db, HEAL_EXT, self.MANIFEST)
        assert ct.fields_schema == ["junk", {"section": "Odd", "fields": "x"}, INTACT_SECTION]


class TestHealLeavesAdminArrangementsAlone:
    async def test_moved_fields_and_a_renamed_section_trigger_no_heal(self, db, monkeypatch):
        from app.services.extensions import field_contributions as fc

        apply = AsyncMock()
        monkeypatch.setattr(fc, "apply_field_contributions", apply)
        renamed = json.loads(json.dumps(INTACT_SECTION)) | {"section": "Renamed"}
        await heal_type(db, fields_schema=[renamed])
        await extension_row(db)
        assert await fc.heal_contributions(db) == []

        other = await create_card_type(
            db,
            key="Other",
            label="Other",
            fields_schema=[{"section": "Mine", "fields": INTACT_SECTION["fields"]}],
        )
        fields_only = {
            "metamodel": {"field_sections": heal_manifest("Other")["metamodel"]["field_sections"]}
        }
        await extension_row(db, "b-ext", manifest=fields_only)
        assert await fc.heal_contributions(db) == []
        assert apply.await_count == 0
        assert other.fields_schema == [{"section": "Mine", "fields": INTACT_SECTION["fields"]}]


class TestHealIsolation:
    async def test_one_failing_extension_does_not_stop_the_others(self, db, monkeypatch, caplog):
        import logging

        from app.services.extensions import field_contributions as fc

        real = fc.apply_field_contributions

        async def apply(session, key, manifest):
            if key == "a-ext":
                raise RuntimeError("bad row")
            return await real(session, key, manifest)

        monkeypatch.setattr(fc, "apply_field_contributions", apply)
        monkeypatch.setattr(fc, "_recompute_data_quality", AsyncMock())
        ct = await heal_type(db, fields_schema=[], subtypes=json.loads(json.dumps(INTACT_SUBTYPES)))
        await extension_row(db, "a-ext")
        await extension_row(db, "b-ext", manifest={"metamodel": "junk"})
        await extension_row(db, HEAL_EXT)
        with caplog.at_level(logging.ERROR, logger="app.services.extensions.field_contributions"):
            assert await fc.heal_contributions(db) == [HEAL_EXT]
        assert ct.fields_schema == [INTACT_SECTION]
        assert [r.getMessage() for r in caplog.records if r.levelname == "ERROR"] == [
            "Extension a-ext: restoring its metamodel contributions failed",
            "Extension b-ext: restoring its metamodel contributions failed",
        ]
        assert "bad row" in caplog.text


class TestSubtypeApplyKeepsAdminProps:
    async def test_admin_properties_survive_and_manifest_ones_resync(self, db):
        from app.services.extensions.field_contributions import apply_subtype_contributions

        ct = await heal_type(
            db,
            subtypes=[
                {"key": "own", "label": "Own"},
                {
                    "key": "sub",
                    "label": "Edited",
                    "color": "#000000",
                    "ext": HEAL_EXT,
                    "hidden_fields": ["h1"],
                    "optional_relations": ["relX"],
                },
                {"key": "dropped", "label": "Dropped", "ext": HEAL_EXT},
            ],
        )
        assert await apply_subtype_contributions(db, HEAL_EXT, heal_manifest()) == 1
        assert ct.subtypes == [
            {"key": "own", "label": "Own"},
            {
                "key": "sub",
                "label": "Sub",
                "ext": HEAL_EXT,
                "hidden_fields": ["h1"],
                "optional_relations": ["relX"],
            },
        ]

    async def test_an_unchanged_list_is_not_written(self, db, monkeypatch):
        from app.services.extensions import field_contributions as fc

        flagged: list = []
        monkeypatch.setattr(fc, "flag_modified", lambda obj, key: flagged.append(key))
        ct = await heal_type(db)
        assert await fc.apply_subtype_contributions(db, HEAL_EXT, heal_manifest()) == 1
        assert ct.subtypes == INTACT_SUBTYPES
        assert flagged == []


class TestTwoSectionsOfOneManifest:
    """One extension, two contributed sections on one type (S1[x], S2[y])."""

    MANIFEST = {
        "metamodel": {
            "field_sections": [
                {"card_type": "Gadget", "section": "S1", "fields": [{"key": "x", "label": "X"}]},
                {"card_type": "Gadget", "section": "S2", "fields": [{"key": "y", "label": "Y"}]},
            ]
        }
    }
    X = {"key": "x", "label": "X", "ext": HEAL_EXT}
    Y = {"key": "y", "label": "Y", "ext": HEAL_EXT}

    async def test_a_field_moved_into_the_sibling_section_is_kept_and_resynced(self, db):
        from app.services.extensions.field_contributions import field_sections_missing

        ct = await heal_type(
            db,
            fields_schema=[
                section("S1", HEAL_EXT),
                section(
                    "S2",
                    HEAL_EXT,
                    [self.Y, {"key": "x", "label": "Old X", "ext": HEAL_EXT}, {"key": "a"}],
                ),
            ],
            subtypes=[],
        )
        assert await apply_field_contributions(db, HEAL_EXT, self.MANIFEST) == 2
        assert ct.fields_schema == [
            section("S1", HEAL_EXT),
            section("S2", HEAL_EXT, [self.X, {"key": "a"}, self.Y]),
        ]
        assert field_sections_missing({"Gadget": ct}, HEAL_EXT, self.MANIFEST) is False

    async def test_the_sibling_order_does_not_matter(self, db):
        ct = await heal_type(
            db,
            fields_schema=[
                section("S1", HEAL_EXT, [self.X, {"key": "y", "label": "Old", "ext": HEAL_EXT}]),
                section("S2", HEAL_EXT),
            ],
            subtypes=[],
        )
        await apply_field_contributions(db, HEAL_EXT, self.MANIFEST)
        assert ct.fields_schema == [
            section("S1", HEAL_EXT, [self.Y, self.X]),
            section("S2", HEAL_EXT),
        ]

    async def test_a_key_the_manifest_dropped_is_still_dropped(self, db):
        ct = await heal_type(
            db,
            fields_schema=[
                section("S1", HEAL_EXT, [self.X]),
                section("S2", HEAL_EXT, [self.Y, {"key": "gone", "ext": HEAL_EXT}]),
            ],
            subtypes=[],
        )
        await apply_field_contributions(db, HEAL_EXT, self.MANIFEST)
        assert ct.fields_schema == [
            section("S1", HEAL_EXT, [self.X]),
            section("S2", HEAL_EXT, [self.Y]),
        ]


class TestResyncKeepsTheAdminsLayout:
    async def test_column_and_group_of_a_moved_field_are_the_admins(self, db):
        manifest = {
            "metamodel": {
                "field_sections": [
                    {
                        "card_type": "Gadget",
                        "section": "Sample",
                        "fields": [
                            {"key": "h1", "label": "H1", "column": 0, "group": "Theirs"},
                            {"key": "h2", "label": "H2", "column": 1, "group": "Theirs"},
                        ],
                    }
                ]
            }
        }
        ct = await heal_type(
            db,
            fields_schema=[
                {
                    "section": "Mine",
                    "columns": 2,
                    "fields": [
                        {
                            "key": "h1",
                            "label": "Old",
                            "column": 1,
                            "group": "Mine",
                            "ext": HEAL_EXT,
                        },
                        {"key": "h2", "label": "Old", "column": 0, "ext": HEAL_EXT},
                    ],
                }
            ],
            subtypes=[],
        )
        await apply_field_contributions(db, HEAL_EXT, manifest)
        assert ct.fields_schema == [
            {
                "section": "Mine",
                "columns": 2,
                "fields": [
                    {"key": "h1", "label": "H1", "column": 1, "group": "Mine", "ext": HEAL_EXT},
                    {"key": "h2", "label": "H2", "column": 0, "ext": HEAL_EXT},
                ],
            }
        ]


class TestRenamesAndLabelsAcrossHealAndApply:
    """A renamed contributed section and an edited field label survive a heal
    with nothing missing (a restart), and are re-synced from the manifest by
    an apply (an update or a re-enable)."""

    @staticmethod
    def edited():
        out = json.loads(json.dumps(INTACT_SECTION)) | {"section": "Renamed"}
        out["fields"][0]["label"] = "My label"
        return out

    async def test_a_heal_with_nothing_missing_keeps_them(self, db):
        from app.services.extensions.field_contributions import heal_contributions

        ct = await heal_type(db, fields_schema=[self.edited()])
        await extension_row(db)
        assert await heal_contributions(db) == []
        assert ct.fields_schema == [self.edited()]

    async def test_an_apply_resyncs_them(self, db):
        ct = await heal_type(db, fields_schema=[self.edited()])
        await apply_field_contributions(db, HEAL_EXT, heal_manifest())
        assert ct.fields_schema == [INTACT_SECTION]


# ---------------------------------------------------------------------------
# Malformed manifests and schemas: each entry is judged on its own
# ---------------------------------------------------------------------------


class TestPureHelpersOnMalformedInput:
    def test_manifest_field_keys_reads_every_contribution_to_the_type(self):
        from app.services.extensions.field_contributions import _manifest_field_keys

        contributions = [
            "junk",
            {"card_type": "Other", "fields": [{"key": "o"}]},
            {"card_type": "Gadget", "fields": None},
            {"card_type": "Gadget", "fields": ["junk", {"key": ""}, {"key": 5}, {"key": "a"}]},
            {"card_type": "Gadget", "fields": [{"key": "b"}]},
        ]
        assert _manifest_field_keys(contributions, "Gadget") == {"a", "b"}

    def test_merge_subtypes_keeps_everything_after_a_dropped_one(self):
        from app.services.extensions.field_contributions import _merge_subtypes

        existing = [
            {"key": "old", "label": "Old", "ext": HEAL_EXT},
            {"key": "a", "label": "A", "ext": HEAL_EXT, "hidden_fields": ["x"]},
            {"key": "z", "label": "Z"},
        ]
        stamped = [{"key": "a", "label": "A2", "ext": HEAL_EXT}]
        assert _merge_subtypes(existing, stamped, HEAL_EXT) == [
            {"key": "a", "label": "A2", "ext": HEAL_EXT, "hidden_fields": ["x"]},
            {"key": "z", "label": "Z"},
        ]

    def test_type_field_keys_on_a_type_without_a_schema(self):
        from app.models.card_type import CardType
        from app.services.extensions.field_contributions import _type_field_keys

        assert _type_field_keys(CardType(key="Gadget", fields_schema=None)) == set()
        schema = [section("S", None, [{"key": "a"}, {"key": ""}, {"key": 5}])]
        assert _type_field_keys(CardType(key="Gadget", fields_schema=schema)) == {"a"}

    def test_a_skipped_contribution_does_not_stop_the_missing_check(self):
        from app.models.card_type import CardType
        from app.services.extensions.field_contributions import (
            field_sections_missing,
            subtypes_missing,
        )

        types = {"Gadget": CardType(key="Gadget", fields_schema=[], subtypes=[])}
        field_row = {"card_type": "Gadget", "section": "S", "fields": [{"key": "h1"}]}
        sub_row = {"card_type": "Gadget", "subtypes": [{"key": "s", "label": "S"}]}
        for skipped in ("junk", {"card_type": "Nope", "section": "S", "fields": [{"key": "n"}]}):
            manifest = {"metamodel": {"field_sections": [skipped, field_row]}}
            assert field_sections_missing(types, HEAL_EXT, manifest) is True, skipped
        for skipped in ("junk", {"card_type": "Nope", "subtypes": [{"key": "n", "label": "N"}]}):
            manifest = {"metamodel": {"subtypes": [skipped, sub_row]}}
            assert subtypes_missing(types, HEAL_EXT, manifest) is True, skipped

    def test_target_type_keys_take_only_string_card_types(self):
        from app.services.extensions.field_contributions import _target_type_keys

        manifest = {
            "metamodel": {
                "field_sections": ["junk", {"card_type": 5}, {"card_type": "A"}],
                "subtypes": [{"no": "type"}, {"card_type": "B"}],
            }
        }
        assert _target_type_keys(manifest) == {"A", "B"}


class TestApplyOnMalformedInput:
    async def test_each_bad_contribution_is_skipped_and_the_rest_applied(self, db):
        ct = await heal_type(db, fields_schema=[])
        valid = heal_manifest()["metamodel"]["field_sections"][0]
        manifest = manifest_with(
            [
                "junk",
                {"card_type": "Gadget", "fields": [{"key": "n", "label": "N"}]},  # no section
                {"card_type": "Gadget", "section": "Bad", "fields": 5},
                valid,
            ]
        )
        assert await apply_field_contributions(db, HEAL_EXT, manifest) == 2
        assert ct.fields_schema == [INTACT_SECTION]

    async def test_sections_without_a_field_list_are_passed_over(self, db):
        ct = await heal_type(
            db, fields_schema=[{"section": "Odd"}, {"section": "Sample", "ext": HEAL_EXT}]
        )
        assert await apply_field_contributions(db, HEAL_EXT, heal_manifest()) == 2
        assert ct.fields_schema == [{"section": "Odd"}, INTACT_SECTION]

    async def test_a_sibling_contributions_section_is_never_adopted(self, db):
        second = {
            "card_type": "Gadget",
            "section": "Second",
            "fields": [{"key": "s1", "label": "S1", "type": "text"}],
        }
        manifest = manifest_with([heal_manifest()["metamodel"]["field_sections"][0], second])
        ct = await heal_type(db, fields_schema=[json.loads(json.dumps(INTACT_SECTION))])
        assert await apply_field_contributions(db, HEAL_EXT, manifest) == 3
        assert ct.fields_schema == [
            INTACT_SECTION,
            {
                "section": "Second",
                "ext": HEAL_EXT,
                "fields": [{"key": "s1", "label": "S1", "type": "text", "ext": HEAL_EXT}],
            },
        ]

    async def test_a_contribution_living_elsewhere_does_not_stop_the_next(self, db):
        second = {
            "card_type": "Gadget",
            "section": "Second",
            "fields": [{"key": "s1", "label": "S1", "type": "text"}],
        }
        manifest = manifest_with([heal_manifest()["metamodel"]["field_sections"][0], second])
        moved = json.loads(json.dumps(INTACT_SECTION["fields"]))
        ct = await heal_type(db, fields_schema=[{"section": "Mine", "fields": moved}])
        assert await apply_field_contributions(db, HEAL_EXT, manifest) == 3
        assert ct.fields_schema == [
            {"section": "Mine", "fields": INTACT_SECTION["fields"]},
            {
                "section": "Second",
                "ext": HEAL_EXT,
                "fields": [{"key": "s1", "label": "S1", "type": "text", "ext": HEAL_EXT}],
            },
        ]

    async def test_the_touched_types_are_rescored(self, db, monkeypatch):
        from app.services import data_quality

        rescored: list = []

        async def rescore(session, type_key):
            rescored.append(type_key)
            return 0

        monkeypatch.setattr(data_quality, "rescore_card_type", rescore)
        await heal_type(db, fields_schema=[])
        await apply_field_contributions(db, HEAL_EXT, heal_manifest())
        assert rescored == ["Gadget"]
        await remove_field_contributions(db, HEAL_EXT)
        assert rescored == ["Gadget", "Gadget"]


class TestRemoveWithADescriptionSection:
    async def test_the_description_section_takes_no_custom_slot(self, db):
        ct = await heal_type(
            db,
            fields_schema=[
                {"section": "__description", "fields": []},
                json.loads(json.dumps(INTACT_SECTION)),
                {"section": "Ops", "fields": []},
            ],
        )
        ct.section_config = {"__order": ["description", "custom:1", "relations"]}
        assert await remove_field_contributions(db, HEAL_EXT) == 2
        assert ct.fields_schema == [
            {"section": "__description", "fields": []},
            {"section": "Ops", "fields": []},
        ]
        assert ct.section_config == {"__order": ["description", "custom:0", "relations"]}
