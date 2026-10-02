"""The pure helpers of the Architecture AI: intent detection, the prompt
context builders and the Phase 3 post-processing guardrails. No database."""

from __future__ import annotations

import json

from app.services.turbolens_architect import (
    _build_buy_prompt,
    _build_capabilities_context,
    _build_compact_context,
    _build_generic_prompt,
    _build_landscape_context,
    _build_option_context,
    _build_principles_context,
    _detect_intent_patterns,
    _enforce_mandatory_relations,
    _merge_new_capabilities_into_proposed,
    _remove_orphan_nodes,
)


class TestIntentPatterns:
    def test_detects_several_patterns(self):
        found = set(_detect_intent_patterns("Build a Kafka event stream for checkout orders"))
        assert {"event_driven", "ecommerce"} <= found
        assert "general" not in found

    def test_single_patterns(self):
        assert _detect_intent_patterns("Add SSO") == ["identity_access"]
        assert _detect_intent_patterns("Expose a REST API gateway") == ["api_integration"]

    def test_nothing_recognised_is_general(self):
        assert _detect_intent_patterns("Hello there") == ["general"]


def _landscape(vendors_per_cat=3, apps=3):
    return {
        "byCategory": {
            "ERP": [
                {"name": f"V{i}", "subCategory": "core" if i == 0 else "", "appCount": i}
                for i in range(vendors_per_cat)
            ],
            "Empty": [],
        },
        "apps": [
            {
                "name": f"App {i}",
                "fs_type": "Application",
                "vendors": json.dumps(["SAP", "Oracle", "IBM", "Dell"]) if i == 0 else "not json",
                "lifecycle": "active" if i == 0 else None,
            }
            for i in range(apps)
        ],
        "vendorCount": vendors_per_cat,
        "appCount": apps,
        "totalTechFS": apps,
    }


class TestContextBuilders:
    def test_landscape_context_lists_vendors_and_apps(self):
        ctx = _build_landscape_context(_landscape())
        assert "3 categorised vendors | 3 applications | 3 total technical cards" in ctx
        assert "[ERP]" in ctx and "[Empty]" not in ctx
        assert "• V0 (core) — used by 0 app(s)" in ctx
        assert "[Application] (3 total)" in ctx
        assert "• App 0 [SAP, Oracle, IBM] [active]" in ctx  # three vendors, lifecycle
        assert "• App 1\n" in ctx  # unparseable vendor JSON degrades to nothing

    def test_landscape_context_truncates_long_lists(self):
        ctx = _build_landscape_context(_landscape(vendors_per_cat=17, apps=22))
        assert "... and 2 more in this category" in ctx
        assert "... and 2 more\n" in ctx

    def test_landscape_context_without_vendors(self):
        land = _landscape(vendors_per_cat=0)
        land["byCategory"] = {}
        ctx = _build_landscape_context(land)
        assert "VENDORS BY CATEGORY" not in ctx and "APPLICATIONS & TECHNICAL COMPONENTS" in ctx

    def test_compact_context(self):
        ctx = _build_compact_context(_landscape(vendors_per_cat=9, apps=11))
        assert ctx.startswith("=== EXISTING LANDSCAPE: 9 vendors | 11 apps | 11 tech items ===")
        assert "[ERP]: V0, V1, V2, V3, V4, V5, V6, V7 (+1 more)" in ctx
        assert "[Application]: " in ctx and "(+1 more)" in ctx.splitlines()[-1]
        assert "[Empty]" not in ctx

    def test_capabilities_context(self):
        assert _build_capabilities_context(None) == ""
        assert _build_capabilities_context([]) == ""
        ctx = _build_capabilities_context(
            [{"name": "Billing"}, {"name": "Lead Mgmt", "isNew": True}, {"isNew": True}]
        )
        assert "Existing capabilities to IMPROVE:\n  - Billing" in ctx
        assert "New capabilities to INTRODUCE:\n  - Lead Mgmt\n  - ?" in ctx

    def test_option_context(self):
        option = {
            "title": "Buy CRM",
            "approach": "buy",
            "summary": "s",
            "impactPreview": {
                "newComponents": [
                    {"name": "Salesforce", "cardTypeKey": "Application", "role": "CRM"}
                ],
                "modifiedComponents": [{"name": "SAP", "change": "new interface"}],
                "newIntegrations": [{"from": "Salesforce", "to": "SAP", "protocol": "REST"}],
                "retiredComponents": [{"name": "Old CRM"}],
            },
        }
        ctx = _build_option_context(option)
        assert "Title: Buy CRM" in ctx and "Approach: buy" in ctx
        assert "Estimated Cost: N/A" in ctx
        assert "  + ADD: Salesforce [Application] — CRM" in ctx
        assert "  ~ MODIFY: SAP [Application] — new interface" in ctx
        assert "  > INTEGRATE: Salesforce → SAP (REST)" in ctx
        assert "  - RETIRE: Old CRM []" in ctx
        assert "(no impact details)" in _build_option_context({"title": "Bare"})

    def test_principles_context(self):
        assert _build_principles_context([]) == ""
        ctx = _build_principles_context(
            [{"title": "Cloud first", "description": "d", "implications": "i"}, {"title": "Bare"}]
        )
        assert "  P1. Cloud first\n      d\n      Implications: i" in ctx
        assert "  P2. Bare" in ctx

    def test_buy_and_generic_prompts(self):
        common = dict(
            requirement="Need a CRM",
            patterns=["customer_portal"],
            objectives_ctx="OBJ",
            caps_ctx="CAPS",
            option_ctx="OPT",
            answers_text="Q1: a\nA: b",
            num_qa=1,
            ctx="LAND",
            metamodel_ctx="META",
        )
        buy = _build_buy_prompt(**common, principles_ctx="PRINCIPLES")
        assert 'REQUIREMENT: "Need a CRM"' in buy and "PATTERNS: customer_portal" in buy
        assert "market" in buy and "PRINCIPLES" in buy and "marketPosition" in buy
        generic = _build_generic_prompt(**common)
        assert "identify ONLY the products" in generic and "marketPosition" not in generic
        for text in (buy, generic):
            assert "OBJ" in text and "CAPS" in text and "OPT" in text and "LAND" in text
            assert "META" in text and "ALL REQUIREMENTS (1 questions answered)" in text


class TestMergeNewCapabilities:
    def test_new_capabilities_land_in_proposed_cards_once(self):
        parsed = {
            "capabilities": [
                {"id": "new_cap_1", "name": "Billing", "isNew": True, "rationale": "r"},
                {"id": "u1", "isNew": False, "existingCardId": "u1"},
                {"id": "new_cap_2", "name": "Dup", "isNew": True},
                {"id": "x", "name": "ByExisting", "isNew": True, "existingCardId": "u9"},
            ],
            "proposedCards": [
                {
                    "id": "new_cap_2",
                    "name": "Already",
                    "cardTypeKey": "BusinessCapability",
                    "isNew": True,
                },
                {"id": "app", "existingCardId": "u9", "isNew": False},
            ],
        }
        _merge_new_capabilities_into_proposed(parsed)
        assert [c["id"] for c in parsed["proposedCards"]] == ["new_cap_2", "app", "new_cap_1"]
        added = parsed["proposedCards"][-1]
        assert added == {
            "id": "new_cap_1",
            "name": "Billing",
            "cardTypeKey": "BusinessCapability",
            "isNew": True,
            "rationale": "r",
        }
        _merge_new_capabilities_into_proposed(parsed)  # idempotent
        assert len(parsed["proposedCards"]) == 3

    def test_missing_proposed_cards_key_is_created(self):
        parsed = {"capabilities": [{"id": "c", "isNew": True}]}
        _merge_new_capabilities_into_proposed(parsed)
        assert parsed["proposedCards"][0]["id"] == "c"


class TestEnforceMandatoryRelations:
    def _parsed(self):
        return {
            "capabilities": [
                {"id": "new_cap_1", "name": "Billing", "isNew": True},
                {"id": "cap_x", "existingCardId": "CAP-UUID", "isNew": False},
            ],
            "proposedCards": [
                {"id": "new_app_1", "name": "App", "cardTypeKey": "Application", "isNew": True},
                {"id": "new_app_2", "cardTypeKey": "Application", "isNew": True},
                {"id": "new_itc_1", "cardTypeKey": "ITComponent", "isNew": True},
                {"id": "EXIST-APP", "cardTypeKey": "Application", "isNew": False},
            ],
            "proposedRelations": [
                # Linked in the reverse direction still counts as linked.
                {"sourceId": "CAP-UUID", "targetId": "new_app_2", "relationType": "relAppToBC"}
            ],
        }

    def test_links_new_apps_and_capabilities_and_adds_the_objective(self):
        parsed = self._parsed()
        _enforce_mandatory_relations(
            parsed,
            selected_capabilities=[{"id": "sel_1", "existingCardId": "SEL-UUID"}],
            objective_ids=["OBJ-1"],
            dep_nodes=[],
            objective_names={"OBJ-1": "Grow revenue"},
        )
        rels = parsed["proposedRelations"]
        assert {
            "sourceId": "new_app_1",
            "targetId": "SEL-UUID",  # the user's own selection comes first
            "relationType": "relAppToBC",
            "label": "supports",
        } in rels
        assert {
            "sourceId": "OBJ-1",
            "targetId": "new_cap_1",
            "relationType": "relObjectiveToBC",
            "label": "improves",
        } in rels
        assert len(rels) == 3  # new_app_2 was linked already; ITC and existing untouched
        objective = parsed["proposedCards"][-1]
        assert objective["id"] == "OBJ-1" and objective["name"] == "Grow revenue"
        assert objective["isNew"] is False and objective["cardTypeKey"] == "Objective"

        before = len(rels)
        _enforce_mandatory_relations(
            parsed, [{"existingCardId": "SEL-UUID"}], ["OBJ-1"], [], {"OBJ-1": "Grow revenue"}
        )
        assert len(parsed["proposedRelations"]) == before  # idempotent
        assert len(parsed["proposedCards"]) == 5

    def test_falls_back_to_the_output_capabilities_and_skips_known_objectives(self):
        parsed = self._parsed()
        _enforce_mandatory_relations(
            parsed, [], ["OBJ-1"], dep_nodes=[{"id": "OBJ-1", "name": "Grow"}]
        )
        added = next(r for r in parsed["proposedRelations"] if r["sourceId"] == "new_app_1")
        assert added["targetId"] == "new_cap_1"  # the first capability in the output
        assert all(c["id"] != "OBJ-1" for c in parsed["proposedCards"])

    def test_a_link_the_model_already_made_is_not_added_again(self):
        # The model linked the new app to the user's selected capability, which
        # is not echoed in the output's "capabilities" list. One link, not two.
        parsed = {
            "capabilities": [{"id": "new_cap_1", "isNew": True}],
            "proposedCards": [{"id": "new_app_1", "cardTypeKey": "Application", "isNew": True}],
            "proposedRelations": [
                {"sourceId": "new_app_1", "targetId": "SEL-UUID", "relationType": "relAppToBC"}
            ],
        }
        _enforce_mandatory_relations(parsed, [{"existingCardId": "SEL-UUID"}], [], [])
        app_links = [r for r in parsed["proposedRelations"] if r["sourceId"] == "new_app_1"]
        assert len(app_links) == 1

    def test_without_any_capability_nothing_is_added_for_apps(self):
        parsed = {
            "capabilities": [],
            "proposedCards": [{"id": "a", "cardTypeKey": "Application", "isNew": True}],
        }
        _enforce_mandatory_relations(parsed, [], [], [])
        assert parsed["proposedRelations"] == []


class TestRemoveOrphanNodes:
    def test_only_unconnected_new_cards_are_dropped(self):
        parsed = {
            "proposedRelations": [{"sourceId": "a", "targetId": "b"}],
            "existingDependencies": {"edges": [{"source": "c", "target": "d"}]},
            "capabilities": [{"id": "cap", "existingCardId": "CAPU"}],
            "proposedCards": [
                {"id": "a", "isNew": True},
                {"id": "b", "isNew": True},
                {"id": "c", "isNew": True},
                {"id": "orphan", "name": "Lonely", "cardTypeKey": "ITComponent", "isNew": True},
                {"id": "keep", "isNew": False},
                {"id": "cap", "isNew": True},
                {"id": "x", "existingCardId": "CAPU", "isNew": True},
            ],
        }
        _remove_orphan_nodes(parsed)
        assert [c["id"] for c in parsed["proposedCards"]] == ["a", "b", "c", "keep", "cap", "x"]

    def test_empty_input(self):
        parsed = {}
        _remove_orphan_nodes(parsed)
        assert parsed == {"proposedCards": []}
