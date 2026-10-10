"""The Architecture AI on the test database with ``call_ai`` scripted:
the landscape and context loaders, each phase's prompt and result, and
the Phase 3 post-processing that turns the model's answer into a
committable proposal."""

from __future__ import annotations

import uuid

import pytest

from app.models.ea_principle import EAPrinciple
from app.models.relation import Relation
from app.models.turbolens import TurboLensVendorAnalysis
from app.services.turbolens_architect import (
    ARCHITECT_PERSONA,
    _build_persona_with_principles,
    _deduplicate_existing_cards,
    _load_existing_cards_context,
    _load_metamodel_types_context,
    _load_objective_names,
    _load_objectives_context,
    _load_relation_types_context,
    load_landscape,
    phase1_questions,
    phase2_questions,
    phase3_capability_mapping,
    phase3_deps,
    phase3_gaps,
    phase3_options,
)
from tests.conftest import create_card, create_card_type, create_relation_type

LONG = "x" * 250


@pytest.fixture
async def landscape(db):
    for key in (
        "ITComponent",
        "Interface",
        "Provider",
        "BusinessCapability",
        "Objective",
        "DataObject",
    ):
        await create_card_type(db, key=key, label=key)
    await create_card_type(
        db, key="Application", label="Application", subtypes=[{"key": "saas", "label": "SaaS"}]
    )
    await create_card_type(db, key="Secret", label="Secret", is_hidden=True)
    for key, src, tgt, label, reverse in (
        ("relAppToProvider", "Application", "Provider", "is provided by", "provides"),
        ("relAppToBC", "Application", "BusinessCapability", "supports", "is supported by"),
        ("relObjectiveToBC", "Objective", "BusinessCapability", "improves", "is improved by"),
        ("relAppToITC", "Application", "ITComponent", "uses", "is used by"),
    ):
        await create_relation_type(
            db,
            key=key,
            label=label,
            source_type_key=src,
            target_type_key=tgt,
            reverse_label=reverse,
        )
    await create_relation_type(
        db,
        key="relHidden",
        label="h",
        source_type_key="Application",
        target_type_key="Interface",
        is_hidden=True,
    )
    sap = await create_card(db, card_type="Provider", name="SAP")
    billing = await create_card(
        db, card_type="Application", name="Billing", lifecycle={"phase": "active"}
    )
    crm = await create_card(db, card_type="Application", name="CRM")
    await create_card(db, card_type="ITComponent", name="Postgres")
    await create_card(db, card_type="Interface", name="Orders API")
    sales = await create_card(db, card_type="BusinessCapability", name="Sales")
    objective = await create_card(db, card_type="Objective", name="Grow revenue", description=LONG)
    await create_card(db, card_type="Application", name="Archived", status="ARCHIVED")
    db.add_all(
        [
            Relation(type="relAppToProvider", source_id=billing.id, target_id=sap.id),
            TurboLensVendorAnalysis(
                vendor_name="SAP", category="ERP & Finance", sub_category="ERP", app_count=1
            ),
            TurboLensVendorAnalysis(vendor_name="Microsoft", category="", app_count=0),
            EAPrinciple(title="Cloud first", description="Prefer SaaS", is_active=True),
        ]
    )
    await db.flush()
    return {"billing": billing, "crm": crm, "sales": sales, "objective": objective}


class TestLoadLandscape:
    async def test_shape(self, db, landscape):
        land = await load_landscape(db)
        assert land["vendorCount"] == 2 and land["appCount"] == 2 and land["totalTechFS"] == 4
        assert set(land["byCategory"]) == {"ERP & Finance", "Other"}  # an empty category is Other
        assert land["byCategory"]["ERP & Finance"] == [
            {"name": "SAP", "subCategory": "ERP", "appCount": 1}
        ]
        apps = {a["name"]: a for a in land["apps"]}
        assert set(apps) == {"Billing", "CRM", "Postgres", "Orders API"}
        assert apps["Billing"] == {
            "name": "Billing",
            "fs_type": "Application",
            "vendors": '["SAP"]',
            "lifecycle": "active",
        }
        assert apps["CRM"]["vendors"] == "[]" and apps["CRM"]["lifecycle"] is None
        assert {v["vendor_name"] for v in land["vendors"]} == {"SAP", "Microsoft"}

    async def test_empty_landscape(self, db):
        land = await load_landscape(db)
        assert land == {
            "byCategory": {},
            "apps": [],
            "appCount": 0,
            "vendorCount": 0,
            "totalTechFS": 0,
            "vendors": [],
        }


class TestContextLoaders:
    async def test_metamodel_types_context(self, db, landscape):
        ctx = await _load_metamodel_types_context(db)
        assert "=== METAMODEL CARD TYPES ===" in ctx
        assert "- Application: Application (subtypes: SaaS)" in ctx
        assert "- Provider: Provider" in ctx and "Secret" not in ctx

    async def test_relation_types_context(self, db, landscape):
        ctx = await _load_relation_types_context(db)
        assert "[Application] can relate to:" in ctx
        assert '  - relAppToBC: → BusinessCapability ("supports" / "is supported by")' in ctx
        assert "[Objective] can relate to:" in ctx and "relHidden" not in ctx

    async def test_existing_cards_context(self, db, landscape):
        ctx = await _load_existing_cards_context(db)
        assert "[Application]:" in ctx and f'  "{landscape["billing"].id}": Billing' in ctx
        assert "Grow revenue" not in ctx  # an Objective is not a lookup type
        assert "Archived" not in ctx

    async def test_empty_contexts_are_empty_strings(self, db):
        assert await _load_metamodel_types_context(db) == ""
        assert await _load_relation_types_context(db) == ""
        assert await _load_existing_cards_context(db) == ""

    async def test_objectives_context_and_names(self, db, landscape):
        obj = landscape["objective"]
        assert await _load_objectives_context(db, None) == ""
        assert await _load_objectives_context(db, ["not-a-uuid"]) == ""
        assert await _load_objectives_context(db, [str(uuid.uuid4())]) == ""
        ctx = await _load_objectives_context(db, [str(obj.id), "junk"])
        assert "=== SELECTED BUSINESS OBJECTIVES ===" in ctx
        assert f"- Grow revenue: {'x' * 200}\n" in ctx and "x" * 201 not in ctx
        assert await _load_objective_names(db, None) == {}
        assert await _load_objective_names(db, ["junk"]) == {}
        assert await _load_objective_names(db, [str(obj.id)]) == {str(obj.id): "Grow revenue"}

    async def test_persona_with_and_without_principles(self, db, landscape):
        persona = await _build_persona_with_principles(db)
        assert persona.startswith(ARCHITECT_PERSONA) and "Cloud first" in persona

    async def test_persona_alone(self, db):
        assert await _build_persona_with_principles(db) == ARCHITECT_PERSONA


class TestPhases:
    async def test_phase1_prompt_and_result(self, db, landscape, fake_call_ai):
        obj = landscape["objective"]
        fake_call_ai.queue({"summary": "s", "questions": [{"id": "q1"}]})
        out = await phase1_questions(
            db, "Build a Kafka event stream", [str(obj.id)], [{"name": "Sales"}]
        )
        assert out == {"summary": "s", "questions": [{"id": "q1"}]}
        prompt, max_tokens, system = fake_call_ai.calls[0]
        assert max_tokens == 2500
        assert system.startswith(ARCHITECT_PERSONA) and "Cloud first" in system
        assert '"Build a Kafka event stream"' in prompt
        assert "DETECTED ARCHITECTURE INTENT: event_driven" in prompt
        assert "=== SELECTED BUSINESS OBJECTIVES ===" in prompt and "Grow revenue" in prompt
        assert "=== TARGET BUSINESS CAPABILITIES ===" in prompt and "  - Sales" in prompt
        assert "=== EXISTING TECHNOLOGY LANDSCAPE ===" in prompt and "Billing" in prompt

    async def test_phase2_carries_the_phase1_answers(self, db, landscape, fake_call_ai):
        fake_call_ai.queue({"phase": 2})
        out = await phase2_questions(db, "req", [{"question": "Who?", "answer": "Sales team"}])
        assert out == {"phase": 2}
        prompt, max_tokens, _ = fake_call_ai.calls[0]
        assert max_tokens == 2800 and "Q: Who?\nA: Sales team" in prompt

    async def test_phase3_options_uses_the_compact_context(self, db, landscape, fake_call_ai):
        fake_call_ai.queue({"options": []})
        assert await phase3_options(db, "req", [{"question": "q", "answer": "a"}]) == {
            "options": []
        }
        prompt, max_tokens, _ = fake_call_ai.calls[0]
        assert max_tokens == 4000 and "Q1: q\nA: a" in prompt
        assert "=== METAMODEL CARD TYPES ===" in prompt and "=== EXISTING LANDSCAPE:" in prompt

    async def test_phase3_gaps_buy_versus_generic(self, db, landscape, fake_call_ai):
        fake_call_ai.default = '{"gaps": []}'
        out = await phase3_gaps(db, "req", [], {"approach": "BUY", "title": "Buy it"})
        assert out == {"gaps": []}
        buy_prompt, buy_tokens, _ = fake_call_ai.calls[0]
        assert buy_tokens == 6000 and "market" in buy_prompt
        assert "(evaluate product alignment)" in buy_prompt and "Cloud first" in buy_prompt
        assert "Title: Buy it" in buy_prompt

        await phase3_gaps(db, "req", [], {"approach": "extend", "title": "Extend it"})
        generic_prompt, generic_tokens, _ = fake_call_ai.calls[1]
        assert generic_tokens == 4000 and "identify ONLY the products" in generic_prompt
        assert "Title: Extend it" in generic_prompt and "marketPosition" not in generic_prompt

    async def test_phase3_deps_lists_the_picks(self, db, landscape, fake_call_ai):
        fake_call_ai.queue({"dependencies": []})
        picks = [
            {
                "name": "Salesforce",
                "vendor": "SFDC",
                "capability": "CRM",
                "pros": ["native D365"],
                "cons": ["cost"],
            },
            {"name": "Bare"},
        ]
        assert await phase3_deps(db, "req", [], {"title": "Buy"}, picks) == {"dependencies": []}
        prompt, max_tokens, _ = fake_call_ai.calls[0]
        assert max_tokens == 3000
        assert "  - Salesforce (SFDC) — for: CRM\n    Pros: native D365\n    Cons: cost" in prompt
        assert "  - Bare — for: ?" in prompt

    async def test_phase3_deps_without_picks(self, db, landscape, fake_call_ai):
        fake_call_ai.queue({})
        await phase3_deps(db, "req", [], {}, [])
        assert "The user has chosen these specific products:\n  (none)" in fake_call_ai.calls[0][0]


class TestCapabilityMapping:
    async def test_post_processing_guardrails(self, db, landscape, fake_call_ai):
        billing, crm = landscape["billing"], landscape["crm"]
        sales, obj = landscape["sales"], landscape["objective"]
        answer = {
            "summary": "impact",
            "capabilities": [
                {
                    "id": str(sales.id),
                    "name": "Sales",
                    "isNew": False,
                    "existingCardId": str(sales.id),
                },
                {"id": "new_cap_1", "name": "Lead Mgmt", "isNew": True, "rationale": "missing"},
            ],
            "proposedCards": [
                # "new", but a card of that name and type exists: becomes a reference
                {
                    "id": "new_app_1",
                    "name": " billing ",
                    "cardTypeKey": "Application",
                    "isNew": True,
                },
                # a second proposal for the same existing card: dropped, its edges remapped
                {"id": "new_app_2", "name": "Billing", "cardTypeKey": "Application", "isNew": True},
                {
                    "id": "new_app_3",
                    "name": "Lead Scorer",
                    "cardTypeKey": "Application",
                    "isNew": True,
                },
                {
                    "id": "new_itc_1",
                    "name": "Orphan Infra",
                    "cardTypeKey": "ITComponent",
                    "isNew": True,
                },
            ],
            "proposedRelations": [
                {"sourceId": "new_app_1", "targetId": str(sales.id), "relationType": "relAppToBC"},
                {"sourceId": "new_app_2", "targetId": "new_cap_1", "relationType": "relAppToBC"},
                # an existing card the model referenced without listing it
                {"sourceId": "new_app_3", "targetId": str(crm.id), "relationType": "relAppToITC"},
                {
                    "sourceId": "new_app_3",
                    "targetId": "nope-not-uuid",
                    "relationType": "relAppToITC",
                },
            ],
        }
        fake_call_ai.queue(answer)
        deps = {
            "nodes": [
                {"id": str(obj.id), "name": "Grow revenue", "type": "Objective"},
                {"id": str(sales.id), "name": "Sales", "type": "BusinessCapability"},
            ],
            "edges": [{"source": str(obj.id), "target": str(sales.id), "type": "relObjectiveToBC"}],
        }
        out = await phase3_capability_mapping(
            db,
            "Need lead scoring",
            [{"question": "q", "answer": "a"}],
            [str(obj.id)],
            deps,
            selected_option={"title": "Buy", "approach": "buy"},
            selected_recommendations=[
                {
                    "recommendation": "ZoomInfo",
                    "vendor": "ZI",
                    "capability": "Lead Mgmt",
                    "pros": ["p"],
                    "cons": ["c"],
                },
                {"recommendation": "MuleSoft", "role": "dependency", "capability": "integration"},
            ],
            selected_capabilities=[
                {"id": str(sales.id), "existingCardId": str(sales.id), "name": "Sales"}
            ],
        )

        prompt, max_tokens, _ = fake_call_ai.calls[0]
        assert max_tokens == 6000
        assert (
            "PRIMARY PRODUCTS (selected in gap analysis):\n  - ZoomInfo (ZI) — for: Lead Mgmt\n"
            "    Capabilities: p\n    Limitations: c"
        ) in prompt
        assert (
            "DEPENDENCY PRODUCTS (selected in dependency analysis):\n"
            "  - MuleSoft — for: integration"
        ) in prompt
        assert "Grow revenue --[relObjectiveToBC]--> Sales" in prompt
        assert f'  "{obj.id}": "Grow revenue" (Objective)' in prompt
        assert "Base the analysis on the SELECTED SOLUTION APPROACH above." in prompt
        assert "=== SELECTED SOLUTION APPROACH ===" in prompt and "Title: Buy" in prompt
        assert "=== METAMODEL RELATION TYPES" in prompt and "=== ALL EXISTING CARDS" in prompt

        assert out["existingDependencies"] == deps
        cards = {c["id"]: c for c in out["proposedCards"]}
        assert str(billing.id) in cards and "new_app_1" not in cards and "new_app_2" not in cards
        billing_card = cards[str(billing.id)]
        assert billing_card["isNew"] is False and billing_card["name"] == "Billing"
        assert billing_card["existingCardId"] == str(billing.id)
        crm_card = cards[str(crm.id)]
        assert crm_card["isNew"] is False and crm_card["cardTypeKey"] == "Application"
        assert crm_card["rationale"] == "Existing card referenced by proposed relations"
        assert (
            cards["new_cap_1"]["cardTypeKey"] == "BusinessCapability"
            and cards["new_cap_1"]["isNew"]
        )
        assert "new_itc_1" not in cards and "new_app_3" in cards

        rels = out["proposedRelations"]
        assert {
            "sourceId": str(billing.id),
            "targetId": str(sales.id),
            "relationType": "relAppToBC",
        } in rels
        assert {
            "sourceId": str(billing.id),
            "targetId": "new_cap_1",
            "relationType": "relAppToBC",
        } in rels
        assert {
            "sourceId": "new_app_3",
            "targetId": str(sales.id),
            "relationType": "relAppToBC",
            "label": "supports",
        } in rels
        assert {
            "sourceId": str(obj.id),
            "targetId": "new_cap_1",
            "relationType": "relObjectiveToBC",
            "label": "improves",
        } in rels

    async def test_without_dependencies_or_selections(self, db, landscape, fake_call_ai):
        fake_call_ai.queue(
            {"summary": "s", "capabilities": [], "proposedCards": [], "proposedRelations": []}
        )
        out = await phase3_capability_mapping(db, "req", [], [], {"nodes": [], "edges": []})
        prompt = fake_call_ai.calls[0][0]
        assert "(no existing dependencies found)" in prompt
        assert "USER-SELECTED PRODUCTS" not in prompt and "SELECTED SOLUTION APPROACH" not in prompt
        assert out["proposedCards"] == [] and out["proposedRelations"] == []


class TestDeduplicateExistingCards:
    """A card the model proposes as new but the landscape already holds becomes
    a reference to the existing card, and every edge follows it."""

    async def _existing(self, db):
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_card_type(db, key="Initiative", label="Initiative")
        crm = await create_card(db, card_type="Application", name="Salesforce CRM")
        await create_card(db, card_type="Application", name="Retired", status="ARCHIVED")
        await create_card(db, card_type="Initiative", name="Migration")
        return crm

    async def test_a_proposed_duplicate_becomes_the_existing_card(self, db):
        crm = await self._existing(db)
        parsed = {
            "proposedCards": [
                {
                    "id": "new-1",
                    "name": "  salesforce crm ",
                    "cardTypeKey": "Application",
                    "isNew": True,
                },
                {"id": "new-2", "name": "Gateway", "cardTypeKey": "ITComponent", "isNew": True},
            ],
            "proposedRelations": [
                {"sourceId": "new-1", "targetId": "new-2"},
                {"sourceId": "new-2", "targetId": "other"},
            ],
            "capabilities": [{"id": "new-1", "isNew": True}, {"id": "cap-9", "isNew": True}],
        }
        await _deduplicate_existing_cards(db, parsed)
        assert parsed["proposedCards"] == [
            {
                "id": str(crm.id),
                "name": "Salesforce CRM",
                "cardTypeKey": "Application",
                "isNew": False,
                "existingCardId": str(crm.id),
            },
            {"id": "new-2", "name": "Gateway", "cardTypeKey": "ITComponent", "isNew": True},
        ]
        assert parsed["proposedRelations"] == [
            {"sourceId": str(crm.id), "targetId": "new-2"},
            {"sourceId": "new-2", "targetId": "other"},
        ]
        assert parsed["capabilities"] == [
            {"id": str(crm.id), "isNew": False, "existingCardId": str(crm.id)},
            {"id": "cap-9", "isNew": True},
        ]

    async def test_a_second_proposal_of_the_same_card_is_dropped(self, db):
        crm = await self._existing(db)
        parsed = {
            "proposedCards": [
                {"id": "a", "name": "Salesforce CRM", "cardTypeKey": "Application", "isNew": True},
                {"id": "b", "name": "SALESFORCE CRM", "cardTypeKey": "Application", "isNew": True},
            ],
            "proposedRelations": [{"sourceId": "b", "targetId": "a"}],
        }
        await _deduplicate_existing_cards(db, parsed)
        assert [c["id"] for c in parsed["proposedCards"]] == [str(crm.id)]
        assert parsed["proposedRelations"] == [{"sourceId": str(crm.id), "targetId": str(crm.id)}]

    async def test_only_a_live_card_of_a_looked_up_type_and_the_same_type_matches(self, db):
        await self._existing(db)
        proposed = [
            {"id": "t", "name": "Salesforce CRM", "cardTypeKey": "ITComponent", "isNew": True},
            {"id": "r", "name": "Retired", "cardTypeKey": "Application", "isNew": True},
            {"id": "i", "name": "Migration", "cardTypeKey": "Initiative", "isNew": True},
            {"id": "o", "name": "Salesforce CRM", "cardTypeKey": "Application", "isNew": False},
        ]
        parsed = {
            "proposedCards": [dict(c) for c in proposed],
            "proposedRelations": [{"sourceId": "t", "targetId": "r"}],
        }
        await _deduplicate_existing_cards(db, parsed)
        assert parsed == {
            "proposedCards": proposed,
            "proposedRelations": [{"sourceId": "t", "targetId": "r"}],
        }

    async def test_a_proposal_labelled_with_an_existing_id_keeps_each_edge_on_its_card(self, db):
        crm = await self._existing(db)
        erp = await create_card(db, card_type="Application", name="SAP ERP")
        # The model labelled its second proposal with the CRM's own id. "x" is
        # the CRM and the CRM-labelled proposal is the ERP: each edge stays on
        # the card it was drawn to, rather than following x -> CRM -> ERP.
        parsed = {
            "proposedCards": [
                {"id": "x", "name": "Salesforce CRM", "cardTypeKey": "Application", "isNew": True},
                {"id": str(crm.id), "name": "SAP ERP", "cardTypeKey": "Application", "isNew": True},
            ],
            "proposedRelations": [
                {"sourceId": "x", "targetId": "y"},
                {"sourceId": str(crm.id), "targetId": "y"},
            ],
        }
        await _deduplicate_existing_cards(db, parsed)
        assert parsed["proposedRelations"] == [
            {"sourceId": str(crm.id), "targetId": "y"},
            {"sourceId": str(erp.id), "targetId": "y"},
        ]
