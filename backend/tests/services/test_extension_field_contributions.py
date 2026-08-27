"""Manifest field-section contributions: merge into card types, soft removal.

The whole point of this capability (vs a content-pack CardTypes row, which
overwrites the entire fields_schema column) is that it is ADDITIVE and
reversible: admin customisations are never clobbered, and disable/uninstall
strips the extension's fields while attribute values survive untouched.
"""

from __future__ import annotations

import json

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


def contribution(card_type="Application", section="ESG Metrics", fields=None):
    return {
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
