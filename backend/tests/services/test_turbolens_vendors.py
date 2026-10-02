"""TurboLens vendor analysis and resolution on the test database, with
``call_ai`` scripted (``fake_call_ai``): the vendor map built from Provider
relations, the batch prompt, the per-vendor fallback, the upsert and the
canonical hierarchy rebuild."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.relation import Relation
from app.models.turbolens import TurboLensVendorAnalysis, TurboLensVendorHierarchy
from app.services.turbolens_vendors import (
    _load_cards_with_vendors,
    analyse_vendors,
    resolve_vendors,
)
from tests.conftest import create_card, create_card_type, create_relation_type


@pytest.fixture
async def landscape(db):
    for key, label in (
        ("Application", "Application"),
        ("ITComponent", "IT Component"),
        ("Provider", "Provider"),
    ):
        await create_card_type(db, key=key, label=label)
    for key, src, tgt in (
        ("relAppToProvider", "Application", "Provider"),
        ("relAppToProviderAlt", "Application", "Provider"),
        ("relProviderToITC", "Provider", "ITComponent"),
    ):
        await create_relation_type(db, key=key, label=key, source_type_key=src, target_type_key=tgt)

    sap = await create_card(db, card_type="Provider", name="SAP")
    sap.description = "German ERP vendor"
    microsoft = await create_card(db, card_type="Provider", name="Microsoft")
    lonely = await create_card(db, card_type="Provider", name="Lonely")
    lonely.description = "Nobody uses it"
    a = await create_card(db, card_type="Application", name="App A")
    a.attributes = {"costTotalAnnual": 100}
    a.description = "Finance"
    b = await create_card(db, card_type="Application", name="App B")
    b.attributes = {"costTotalAnnual": 50}
    c = await create_card(db, card_type="ITComponent", name="Comp C")
    d = await create_card(db, card_type="Application", name="App D")
    old = await create_card(db, card_type="Application", name="Old E", status="ARCHIVED")
    db.add_all(
        [
            Relation(type="relAppToProvider", source_id=a.id, target_id=sap.id),
            # App B reaches SAP through two relation types: one vendor, not two.
            Relation(type="relAppToProvider", source_id=b.id, target_id=sap.id),
            Relation(type="relAppToProviderAlt", source_id=b.id, target_id=sap.id),
            # The Provider on the source side of the relation.
            Relation(type="relProviderToITC", source_id=microsoft.id, target_id=c.id),
            Relation(type="relAppToProvider", source_id=old.id, target_id=sap.id),
        ]
    )
    await db.flush()
    return {"a": a, "b": b, "c": c, "d": d, "sap": sap}


async def _analysis_rows(db) -> dict[str, TurboLensVendorAnalysis]:
    rows = (await db.execute(select(TurboLensVendorAnalysis))).scalars().all()
    return {r.vendor_name: r for r in rows}


async def _hierarchy_rows(db) -> dict[str, TurboLensVendorHierarchy]:
    rows = (await db.execute(select(TurboLensVendorHierarchy))).scalars().all()
    return {r.canonical_name: r for r in rows}


class TestLoadCardsWithVendors:
    async def test_rows_name_each_vendor_once_and_skip_archived(self, db, landscape):
        rows, providers = await _load_cards_with_vendors(db)
        by_name = {r["name"]: r for r in rows}
        assert set(by_name) == {"App A", "App B", "Comp C", "App D"}
        assert by_name["App A"] == {
            "id": str(landscape["a"].id),
            "name": "App A",
            "type": "Application",
            "description": "Finance",
            "vendors": ["SAP"],
            "annual_cost": 100,
        }
        assert by_name["App B"]["vendors"] == ["SAP"]
        assert by_name["Comp C"]["vendors"] == ["Microsoft"]
        assert by_name["App D"]["vendors"] == [] and by_name["App D"]["annual_cost"] == 0
        assert {p["name"] for p in providers} == {"SAP", "Microsoft", "Lonely"}
        sap = next(p for p in providers if p["name"] == "SAP")
        assert sap["description"] == "German ERP vendor" and sap["annual_cost"] == 0


class TestAnalyseVendors:
    async def test_no_cards_is_a_warning_and_no_call(self, db, fake_call_ai):
        await create_card_type(db, key="Application", label="Application")
        out = await analyse_vendors(db)
        assert out["analysed"] == 0 and "No vendor relationships" in out["warning"]
        assert fake_call_ai.calls == []

    async def test_categorises_a_batch_and_falls_back_per_vendor(self, db, landscape, fake_call_ai):
        fake_call_ai.queue(
            [
                {
                    "name": "SAP",
                    "category": "ERP & Finance",
                    "sub_category": "ERP",
                    "reasoning": "r1",
                },
                {
                    "name": "Microsoft",
                    "category": "Nonsense",
                    "sub_category": "",
                    "reasoning": "r2",
                },
                {"name": "Ghost", "category": "Other"},  # not one of ours: ignored
            ]
        )
        fake_call_ai.route(
            max_tokens=256,
            text={
                "name": "Lonely",
                "category": "Search Engine",
                "sub_category": "x",
                "reasoning": "s",
            },
        )
        out = await analyse_vendors(db)
        assert out == {"analysed": 3, "total": 3}

        rows = await _analysis_rows(db)
        assert set(rows) == {"SAP", "Microsoft", "Lonely"}
        sap = rows["SAP"]
        assert (sap.category, sap.sub_category, sap.reasoning) == ("ERP & Finance", "ERP", "r1")
        assert sap.app_count == 2 and sap.total_cost == 150
        assert sorted(sap.app_list) == ["App A", "App B"]  # row order is not fixed
        assert rows["Microsoft"].category == "Other"  # an unknown category lands as Other
        assert rows["Microsoft"].app_count == 1 and rows["Microsoft"].app_list == ["Comp C"]
        assert rows["Lonely"].category == "Search Engine" and rows["Lonely"].app_count == 0

        batch_prompt, max_tokens, _ = fake_call_ai.calls[0]
        assert max_tokens == 1600 and "Vendors (1–3 of 3)" in batch_prompt
        assert '"name": "SAP"' in batch_prompt and "Finance" in batch_prompt
        # A Provider's own description rides along only for a vendor no card
        # links to; SAP's context is its linked applications.
        assert '"providerInfo": "Nobody uses it"' in batch_prompt
        assert '"providerInfo": null' in batch_prompt
        single_prompt, single_tokens, _ = fake_call_ai.calls[1]
        assert single_tokens == 256
        assert 'Vendor: "Lonely"' in single_prompt and "No linked applications" in single_prompt
        assert "Provider description: Nobody uses it" in single_prompt
        assert len(fake_call_ai.calls) == 2

    async def test_a_failing_fallback_lands_the_vendor_as_other(self, db, landscape, fake_call_ai):
        fake_call_ai.queue([])  # the batch names nobody
        fake_call_ai.route(max_tokens=256, raises=RuntimeError("down"))
        assert await analyse_vendors(db) == {"analysed": 3, "total": 3}
        rows = await _analysis_rows(db)
        assert all(
            r.category == "Other" and r.reasoning == "Categorisation failed" for r in rows.values()
        )
        assert len(fake_call_ai.calls) == 4

    async def test_a_failing_batch_call_uses_the_per_vendor_fallback(
        self, db, landscape, fake_call_ai
    ):
        fake_call_ai.route(max_tokens=1600, raises=RuntimeError("batch down"))
        fake_call_ai.route(
            contains='Vendor: "SAP"',
            text=(
                '```json\n{"name":"SAP","category":"ERP & Finance",'
                '"sub_category":"","reasoning":"s"}\n```'
            ),
        )
        fake_call_ai.route(
            contains='Vendor: "Microsoft"',
            text={"name": "Microsoft", "category": "Cloud Hosting & Infrastructure"},
        )
        fake_call_ai.route(contains='Vendor: "Lonely"', text="no json at all")
        assert await analyse_vendors(db) == {"analysed": 3, "total": 3}
        rows = await _analysis_rows(db)
        assert rows["SAP"].category == "ERP & Finance"
        assert rows["Microsoft"].category == "Cloud Hosting & Infrastructure"
        assert rows["Lonely"].reasoning == "Categorisation failed"

    async def test_existing_rows_are_updated_in_place(self, db, landscape, fake_call_ai):
        stale = TurboLensVendorAnalysis(vendor_name="SAP", category="Other", app_count=0)
        db.add(stale)
        await db.flush()
        fake_call_ai.queue([{"name": "SAP", "category": "ERP & Finance"}])
        fake_call_ai.route(max_tokens=256, text={"name": "Nobody", "category": "Other"})
        assert await analyse_vendors(db) == {"analysed": 1, "total": 3}
        rows = await _analysis_rows(db)
        assert list(rows) == ["SAP"]  # answers naming no vendor of ours land nothing
        assert rows["SAP"].id == stale.id
        assert rows["SAP"].category == "ERP & Finance" and rows["SAP"].app_count == 2
        assert rows["SAP"].sub_category == ""
        assert sorted(rows["SAP"].app_list) == ["App A", "App B"]  # row order is not fixed

    async def test_a_cut_off_batch_still_lands_what_it_carried(self, db, landscape, fake_call_ai):
        # The first vendor is complete, the second is cut mid-string: the answer
        # must still read as a list, and the missing vendors fall back.
        fake_call_ai.queue(
            '[{"name":"SAP","category":"ERP & Finance","sub_category":"","reasoning":"r"},'
            '{"name":"Micro',
            truncated=True,
        )
        fake_call_ai.route(max_tokens=256, raises=RuntimeError("no fallback"))
        assert await analyse_vendors(db) == {"analysed": 3, "total": 3}
        rows = await _analysis_rows(db)
        assert rows["SAP"].category == "ERP & Finance" and rows["SAP"].reasoning == "r"
        assert rows["Microsoft"].reasoning == "Categorisation failed"

    async def test_a_lone_object_answer_is_one_entry(self, db, landscape, fake_call_ai):
        fake_call_ai.queue({"name": "SAP", "category": "Search Engine"})
        fake_call_ai.route(max_tokens=256, raises=RuntimeError("no fallback"))
        assert await analyse_vendors(db) == {"analysed": 3, "total": 3}
        assert (await _analysis_rows(db))["SAP"].category == "Search Engine"


class TestResolveVendors:
    async def test_no_names_is_a_no_op(self, db, fake_call_ai):
        await create_card_type(db, key="Application", label="Application")
        assert await resolve_vendors(db) == {"saved": 0, "rawCount": 0}
        assert fake_call_ai.calls == []

    async def test_builds_the_canonical_hierarchy(self, db, landscape, fake_call_ai):
        db.add(
            TurboLensVendorAnalysis(vendor_name="SAP", category="ERP & Finance", sub_category="ERP")
        )
        db.add(
            TurboLensVendorAnalysis(vendor_name="SAP AG", category="Other")
        )  # analysis-only name
        db.add(TurboLensVendorHierarchy(canonical_name="Stale", vendor_type="vendor"))
        await db.flush()
        fake_call_ai.queue(
            [
                {
                    "raw_name": "SAP",
                    "canonical_name": "SAP SE",
                    "vendor_type": "vendor",
                    "parent_canonical": None,
                    "confidence": 1.0,
                },
                {
                    "raw_name": "SAP AG",
                    "canonical_name": "SAP SE",
                    "vendor_type": "vendor",
                    "parent_canonical": None,
                    "confidence": 0.8,
                },
                {
                    "raw_name": "Microsoft",
                    "canonical_name": "Microsoft",
                    "vendor_type": "vendor",
                    "parent_canonical": None,
                    "confidence": 0.9,
                },
                {
                    "raw_name": "Lonely",
                    "canonical_name": "Lonely Inc",
                    "vendor_type": "product",
                    "parent_canonical": "Lonely",
                    "confidence": 0.5,
                },
            ]
        )
        assert await resolve_vendors(db) == {"saved": 3, "rawCount": 4}

        rows = await _hierarchy_rows(db)
        assert set(rows) == {"SAP SE", "Microsoft", "Lonely Inc"}  # the stale row is gone
        sap = rows["SAP SE"]
        assert sorted(sap.aliases) == ["SAP", "SAP AG"] and sap.vendor_type == "vendor"
        assert sap.app_count == 2 and sap.itc_count == 0 and sap.total_cost == 150
        assert sap.category == "ERP & Finance" and sap.sub_category == "ERP"  # via the alias
        assert sap.confidence == 0.9
        assert sorted(sap.linked_fs) == sorted([str(landscape["a"].id), str(landscape["b"].id)])
        microsoft = rows["Microsoft"]
        assert microsoft.aliases == [] and microsoft.app_count == 1 and microsoft.category is None
        lonely = rows["Lonely Inc"]
        assert lonely.vendor_type == "product" and lonely.app_count == 0
        assert lonely.confidence == 0.5 and lonely.aliases == ["Lonely"]

        prompt, max_tokens, system = fake_call_ai.calls[0]
        assert max_tokens == 3000 and "Raw names (1–4 of 4)" in prompt
        assert '"SAP AG"' in prompt and "Return only valid JSON arrays" in system

    async def test_a_failed_batch_keeps_every_name_as_itself(self, db, landscape, fake_call_ai):
        fake_call_ai.route(raises=RuntimeError("down"))
        assert await resolve_vendors(db) == {"saved": 3, "rawCount": 3}
        rows = await _hierarchy_rows(db)
        assert set(rows) == {"SAP", "Microsoft", "Lonely"}
        assert rows["SAP"].vendor_type == "unknown" and rows["SAP"].confidence == 0.5
        assert rows["SAP"].aliases == [] and rows["SAP"].app_count == 2

    async def test_an_answer_that_is_not_an_array(self, db, landscape, fake_call_ai):
        fake_call_ai.queue({"raw_name": "SAP", "canonical_name": "SAP SE", "confidence": 1.0})
        assert await resolve_vendors(db) == {
            "saved": 1,
            "rawCount": 3,
        }  # a lone object is one entry
        assert set(await _hierarchy_rows(db)) == {"SAP SE"}

        fake_call_ai.queue("42")  # not a JSON structure at all: the batch failed
        assert await resolve_vendors(db) == {"saved": 3, "rawCount": 3}
        assert set(await _hierarchy_rows(db)) == {"SAP", "Microsoft", "Lonely"}
