"""TurboLens duplicate detection and modernization assessment on the test
database with ``call_ai`` scripted (``fake_call_ai``)."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.ea_principle import EAPrinciple
from app.models.relation import Relation
from app.models.turbolens import TurboLensDuplicateCluster, TurboLensModernization
from app.services.turbolens_duplicates import (
    _load_cards_by_type,
    _merge_overlapping_clusters,
    assess_modernization,
    detect_duplicates,
)
from tests.conftest import create_card, create_card_type, create_relation_type


@pytest.fixture
async def landscape(db):
    for key, label in (
        ("Application", "Application"),
        ("ITComponent", "IT Component"),
        ("Interface", "Interface"),
        ("Provider", "Provider"),
    ):
        await create_card_type(db, key=key, label=label)
    await create_relation_type(
        db,
        key="relAppToProvider",
        label="p",
        source_type_key="Application",
        target_type_key="Provider",
    )
    sap = await create_card(db, card_type="Provider", name="SAP")
    a1 = await create_card(db, card_type="Application", name="A1")
    a1.lifecycle = {"phase": "active"}
    a1.attributes = {"technicalFit": 4}
    a1.description = "Customer records"
    a2 = await create_card(db, card_type="Application", name="A2")
    a2.lifecycle = [{"phase": "plan"}, {"phase": "retire"}]
    a3 = await create_card(db, card_type="Application", name="A3")
    i1 = await create_card(db, card_type="ITComponent", name="I1")
    await create_card(db, card_type="Application", name="Old", status="ARCHIVED")
    db.add_all(
        [
            Relation(type="relAppToProvider", source_id=a1.id, target_id=sap.id),
            Relation(type="relAppToProvider", source_id=a1.id, target_id=sap.id),
            EAPrinciple(
                title="Cloud first", description="Prefer SaaS", is_active=True, sort_order=1
            ),
            EAPrinciple(title="Inactive principle", is_active=False, sort_order=0),
        ]
    )
    await db.flush()
    return {"a1": a1, "a2": a2, "a3": a3, "i1": i1}


async def _clusters(db) -> list[TurboLensDuplicateCluster]:
    return (await db.execute(select(TurboLensDuplicateCluster))).scalars().all()


async def _assessments(db) -> dict[str, TurboLensModernization]:
    rows = (await db.execute(select(TurboLensModernization))).scalars().all()
    return {r.card_name: r for r in rows}


class TestMergeOverlappingClusters:
    def test_overlapping_and_chained_clusters_merge(self):
        clusters = [
            {
                "cluster_name": "CRM",
                "member_ids": ["a", "b"],
                "member_names": ["A", "B"],
                "card_type": "Application",
            },
            {
                "cluster_name": "Sales",
                "member_ids": ["b", "c"],
                "member_names": ["B", "C"],
                "card_type": "Application",
            },
            {"cluster_name": "Other", "member_ids": ["x", "y"], "member_names": ["X", "Y"]},
            {"cluster_name": "Empty", "member_ids": []},
            {"cluster_name": "Chain", "member_ids": ["c", "d"], "member_names": ["C", "D"]},
        ]
        merged = {m["cluster_name"]: m for m in _merge_overlapping_clusters(clusters)}
        assert set(merged) == {"CRM", "Other"}
        assert sorted(merged["CRM"]["member_ids"]) == ["a", "b", "c", "d"]
        assert sorted(merged["CRM"]["member_names"]) == ["A", "B", "C", "D"]
        assert merged["CRM"]["card_type"] == "Application"  # the first cluster's fields win
        assert sorted(merged["Other"]["member_ids"]) == ["x", "y"]

    def test_nothing_in_nothing_out(self):
        assert _merge_overlapping_clusters([]) == []


class TestLoadCardsByType:
    async def test_items_carry_vendors_lifecycle_and_fit(self, db, landscape):
        type_map = await _load_cards_by_type(db, ["Application", "ITComponent", "Interface"])
        apps = {i["name"]: i for i in type_map["Application"]}
        assert set(apps) == {"A1", "A2", "A3"}  # the archived card is out
        assert apps["A1"]["vendors"] == ["SAP"]  # named once despite two relations
        assert apps["A1"]["lifecycle"] == "active" and apps["A1"]["tech_fit"] == 4
        assert apps["A1"]["description"] == "Customer records"
        assert apps["A2"]["lifecycle"] == "retire"  # the last phase of a list
        assert apps["A3"]["lifecycle"] is None and apps["A3"]["vendors"] == []
        assert [i["name"] for i in type_map["ITComponent"]] == ["I1"]
        assert "Interface" not in type_map


class TestDetectDuplicates:
    async def test_persists_merged_clusters_per_type(self, db, landscape, fake_call_ai):
        db.add(
            TurboLensDuplicateCluster(
                cluster_name="Stale", card_type="Application", card_ids=[], card_names=[]
            )
        )
        await db.flush()
        a1, a2, a3 = (str(landscape[k].id) for k in ("a1", "a2", "a3"))
        fake_call_ai.route(
            contains="Items to analyse (Application)",
            text=[
                {
                    "cluster_name": "CRM",
                    "functional_domain": "crm",
                    "member_ids": [a1, a2],
                    "member_names": ["A1", "A2"],
                    "evidence": "same purpose",
                    "recommendation": "keep A1",
                },
                {"cluster_name": "Solo", "member_ids": [a3], "member_names": ["A3"]},  # dropped
                {"cluster_name": "Overlap", "member_ids": [a2, a3], "member_names": ["A2", "A3"]},
            ],
        )
        fake_call_ai.route(contains="Items to analyse (ITComponent)", text={"not": "a list"})

        assert await detect_duplicates(db) == {"clusters": 1}
        (cluster,) = await _clusters(db)
        assert cluster.cluster_name == "CRM" and cluster.card_type == "Application"
        assert cluster.status == "pending" and cluster.functional_domain == "crm"
        assert sorted(cluster.card_ids) == sorted([a1, a2, a3])
        assert sorted(cluster.card_names) == ["A1", "A2", "A3"]
        assert cluster.evidence == "same purpose" and cluster.recommendation == "keep A1"

        assert len(fake_call_ai.calls) == 2  # Interface has no cards: no call for it
        prompt, max_tokens, system = fake_call_ai.calls[0]
        assert max_tokens == 3000 and "Return only valid JSON" in system
        assert "=== ORGANISATION EA PRINCIPLES ===" in prompt and "Cloud first" in prompt
        assert "Inactive principle" not in prompt
        assert '"vendors": ["SAP"]' in prompt and '"techFit": 4' in prompt

    async def test_a_failed_batch_is_skipped_and_old_clusters_still_cleared(
        self, db, landscape, fake_call_ai
    ):
        db.add(
            TurboLensDuplicateCluster(
                cluster_name="Stale", card_type="Application", card_ids=[], card_names=[]
            )
        )
        await db.flush()
        fake_call_ai.route(contains="(Application)", raises=RuntimeError("down"))
        fake_call_ai.route(contains="(ITComponent)", text=[])
        assert await detect_duplicates(db, ["Application", "ITComponent"]) == {"clusters": 0}
        assert await _clusters(db) == []


class TestAssessModernization:
    async def test_no_cards_means_no_call(self, db, fake_call_ai):
        await create_card_type(db, key="Application", label="Application")
        out = await assess_modernization(db, "Application")
        assert out == {"assessments": 0, "targetType": "Application"}
        assert fake_call_ai.calls == []

    async def test_persists_assessments_and_clears_only_the_target_type(
        self, db, landscape, fake_call_ai
    ):
        db.add(TurboLensModernization(target_type="Application", card_name="Stale"))
        db.add(TurboLensModernization(target_type="ITComponent", card_name="Keep"))
        await db.flush()
        a1 = landscape["a1"]
        fake_call_ai.queue(
            [
                {
                    "fs_id": str(a1.id),
                    "fs_name": "A1",
                    "current_tech": "COBOL",
                    "modernization_type": "cloud",
                    "recommendation": "move",
                    "effort": "high",
                    "priority": "critical",
                    "rationale": "old",
                },
                {"fs_id": "nope", "fs_name": "Ghost", "recommendation": "x"},
            ]
        )
        out = await assess_modernization(db, "Application", "cloud")
        assert out == {"assessments": 2, "targetType": "Application"}

        rows = await _assessments(db)
        assert set(rows) == {"A1", "Ghost", "Keep"}
        assert rows["A1"].card_id == a1.id and rows["A1"].status == "pending"
        assert (rows["A1"].current_tech, rows["A1"].effort, rows["A1"].priority) == (
            "COBOL",
            "high",
            "critical",
        )
        assert rows["Ghost"].card_id is None and rows["Ghost"].effort == "medium"
        assert isinstance(rows["A1"].card_id, uuid.UUID)

        prompt, max_tokens, system = fake_call_ai.calls[0]
        assert max_tokens == 3000 and "senior enterprise architect" in system
        assert "Focus: cloud" in prompt and "Cloud-native migration" in prompt
        assert "(advisory)" in prompt and "Cloud first" in prompt

    async def test_a_failed_batch_still_clears_the_old_rows(self, db, landscape, fake_call_ai):
        db.add(TurboLensModernization(target_type="Application", card_name="Stale"))
        await db.flush()
        fake_call_ai.route(raises=RuntimeError("down"))
        assert await assess_modernization(db, "Application") == {
            "assessments": 0,
            "targetType": "Application",
        }
        assert await _assessments(db) == {}

    async def test_the_type_decides_the_technology_context(self, db, landscape, fake_call_ai):
        fake_call_ai.queue([])
        await assess_modernization(db, "ITComponent")
        assert "Cloud PaaS" in fake_call_ai.calls[0][0]
