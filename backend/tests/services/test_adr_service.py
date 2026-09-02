"""The shared decision-record writer: one reference-number sequence for the
REST route, the analysis commit flow and the extension decisions bridge.

Helpers flush and never commit — the caller owns the transaction."""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_card import ArchitectureDecisionCard
from app.services import adr_service
from tests.conftest import create_card, create_card_type


@pytest.fixture
async def cards(db):
    await create_card_type(db, key="Application", label="Application")
    a = await create_card(db, card_type="Application", name="Billing")
    b = await create_card(db, card_type="Application", name="Auth")
    return {"a": a, "b": b}


class TestReferenceNumbers:
    async def test_starts_at_001(self, db):
        assert await adr_service.next_reference_number(db) == "ADR-001"

    async def test_increments_past_the_max(self, db):
        db.add(ArchitectureDecision(reference_number="ADR-007", title="Seven"))
        await db.flush()
        assert await adr_service.next_reference_number(db) == "ADR-008"


class TestCreateDecision:
    async def test_flushes_row_and_links_without_commit(self, db, cards):
        adr = await adr_service.create_decision(
            db,
            title="Consolidate billing",
            decision="Keep Billing, retire Auth",
            linked_card_ids=[cards["a"].id, cards["b"].id],
        )
        # Visible in the same session (flushed) …
        row = (
            await db.execute(select(ArchitectureDecision).where(ArchitectureDecision.id == adr.id))
        ).scalar_one()
        assert row.status == "draft"
        assert row.reference_number == "ADR-001"
        assert row.created_by is None
        assert row.attributes == {}
        links = (
            (
                await db.execute(
                    select(ArchitectureDecisionCard.card_id).where(
                        ArchitectureDecisionCard.architecture_decision_id == adr.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert set(links) == {cards["a"].id, cards["b"].id}

    async def test_dedupes_linked_card_ids(self, db, cards):
        adr = await adr_service.create_decision(
            db, title="Twice", linked_card_ids=[cards["a"].id, cards["a"].id]
        )
        links = (
            (
                await db.execute(
                    select(ArchitectureDecisionCard).where(
                        ArchitectureDecisionCard.architecture_decision_id == adr.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(links) == 1

    async def test_carries_attributes_and_related_decisions(self, db):
        adr = await adr_service.create_decision(
            db,
            title="With bag",
            attributes={"ext.sample-planner.scenario": "s1"},
            related_decisions=[{"type": "assessment", "id": "x"}],
        )
        assert adr.attributes == {"ext.sample-planner.scenario": "s1"}
        assert adr.related_decisions == [{"type": "assessment", "id": "x"}]


class TestResolveCardIds:
    async def test_malformed_is_400_and_missing_is_404(self, db, cards):
        with pytest.raises(HTTPException) as bad:
            await adr_service.resolve_card_ids(db, ["not-a-uuid"])
        assert bad.value.status_code == 400
        with pytest.raises(HTTPException) as missing:
            await adr_service.resolve_card_ids(db, [str(uuid.uuid4())])
        assert missing.value.status_code == 404

    async def test_dedupes_preserving_order(self, db, cards):
        ids = [str(cards["b"].id), str(cards["a"].id), str(cards["b"].id)]
        assert await adr_service.resolve_card_ids(db, ids) == [cards["b"].id, cards["a"].id]
