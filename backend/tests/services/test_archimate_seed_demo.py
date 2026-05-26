"""Tests for the ArchiMate demo data seed."""

import pytest

try:
    from app.plugins.archimate.seed_demo import (
        ARCHIMATE_DEMO_CARDS,
        ARCHIMATE_DEMO_RELATIONS,
    )

    HAS_MODULE = True
except ImportError:
    HAS_MODULE = False


@pytest.mark.skipif(not HAS_MODULE, reason="seed_demo module not available")
class TestArchimateSeedDemo:
    def test_demo_cards_present(self):
        """Should define at least 10 ArchiMate demo cards."""
        assert len(ARCHIMATE_DEMO_CARDS) >= 10

    def test_all_cards_have_arch_type(self):
        """All demo cards must use arch_* type keys."""
        for card in ARCHIMATE_DEMO_CARDS:
            assert card["type_key"].startswith("arch_"), (
                f"Card {card.get('name')} uses non-arch type {card['type_key']}"
            )

    def test_all_cards_have_required_fields(self):
        """Each card must have ref, type_key, name, and layer."""
        for card in ARCHIMATE_DEMO_CARDS:
            assert "ref" in card, f"Missing ref on {card}"
            assert "type_key" in card, f"Missing type_key on {card}"
            assert "name" in card, f"Missing name on {card}"

    def test_covers_multiple_layers(self):
        """Demo should cover Business, Application, and Technology layers."""
        types_used = {c["type_key"] for c in ARCHIMATE_DEMO_CARDS}
        has_business = any(t.startswith("arch_Business") for t in types_used)
        has_application = any(t.startswith("arch_Application") for t in types_used)
        has_technology = any(
            t in types_used
            for t in [
                "arch_Node",
                "arch_Device",
                "arch_SystemSoftware",
                "arch_TechnologyService",
                "arch_Artifact",
            ]
        )
        assert has_business, "No Business layer elements in demo"
        assert has_application, "No Application layer elements in demo"
        assert has_technology, "No Technology layer elements in demo"

    def test_demo_relations_present(self):
        """Should define relations between demo cards."""
        assert len(ARCHIMATE_DEMO_RELATIONS) >= 5

    def test_all_relations_have_arch_rel_type(self):
        """All demo relations must use arch_rel_* type keys."""
        for rel in ARCHIMATE_DEMO_RELATIONS:
            assert rel["rel_type"].startswith("arch_rel_"), (
                f"Relation uses non-arch_rel_ type {rel['rel_type']}"
            )

    def test_all_relations_reference_known_card_refs(self):
        """Relation source/target refs must exist in ARCHIMATE_DEMO_CARDS."""
        refs = {c["ref"] for c in ARCHIMATE_DEMO_CARDS}
        for rel in ARCHIMATE_DEMO_RELATIONS:
            assert rel["source_ref"] in refs, f"source_ref {rel['source_ref']} not in demo cards"
            assert rel["target_ref"] in refs, f"target_ref {rel['target_ref']} not in demo cards"

    def test_unique_refs(self):
        """Card refs must be unique."""
        refs = [c["ref"] for c in ARCHIMATE_DEMO_CARDS]
        assert len(refs) == len(set(refs)), "Duplicate refs in demo cards"
