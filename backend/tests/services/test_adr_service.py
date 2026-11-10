"""The shared decision-record writer: one reference-number sequence for the
REST route, the analysis commit flow and the extension decisions bridge.

Helpers flush and never commit — the caller owns the transaction."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_card import ArchitectureDecisionCard
from app.models.architecture_decision_link import ArchitectureDecisionLink
from app.models.event import Event
from app.services import adr_service
from app.services import decision_standing as ds
from tests.conftest import create_card, create_card_type


async def _links(db, source_id):
    rows = await db.execute(
        select(
            ArchitectureDecisionLink.target_id,
            ArchitectureDecisionLink.kind,
            ArchitectureDecisionLink.note,
        ).where(ArchitectureDecisionLink.source_id == source_id)
    )
    return [tuple(r) for r in rows.all()]


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

    async def test_counts_numerically_past_three_digits(self, db):
        """``"ADR-999" > "ADR-1000"`` as strings; the sequence must still move on."""
        db.add_all(
            [
                ArchitectureDecision(reference_number="ADR-999", title="Last three-digit"),
                ArchitectureDecision(reference_number="ADR-1000", title="First four-digit"),
                ArchitectureDecision(reference_number="DEC-5000", title="Foreign format"),
            ]
        )
        await db.flush()
        assert await adr_service.next_reference_number(db) == "ADR-1001"


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

    async def test_carries_attributes_and_drops_a_dict_related_entry(self, db):
        adr = await adr_service.create_decision(
            db,
            title="With bag",
            attributes={"ext.sample-planner.scenario": "s1"},
            related_decisions=[{"type": "assessment", "id": "x"}],
        )
        assert adr.attributes == {"ext.sample-planner.scenario": "s1"}
        assert await _links(db, adr.id) == []

    async def test_related_strings_become_relates_links(self, db):
        first = await adr_service.create_decision(db, title="First", publish=False)
        adr = await adr_service.create_decision(
            db,
            title="Second",
            related_decisions=["ADR-001", str(first.id), "ADR-404", str(uuid.uuid4())],
            publish=False,
        )
        assert await _links(db, adr.id) == [(first.id, "relates", None)]

    async def test_dates_and_change_summary_are_stored(self, db):
        adr = await adr_service.create_decision(
            db,
            title="Dated",
            decided_on=date(2026, 1, 2),
            effective_from=date(2026, 2, 3),
            valid_until=date(2027, 3, 4),
            change_summary="Why",
            publish=False,
        )
        assert (adr.decided_on, adr.effective_from, adr.valid_until, adr.change_summary) == (
            date(2026, 1, 2),
            date(2026, 2, 3),
            date(2027, 3, 4),
            "Why",
        )

    async def test_created_event_carries_the_revision_number(self, db):
        adr = await adr_service.create_decision(db, title="Evented")
        [event] = (
            (await db.execute(select(Event).where(Event.event_type == "adr.created")))
            .scalars()
            .all()
        )
        assert event.data["adr_id"] == str(adr.id)
        assert event.data["revision_number"] == 1


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


# ---------------------------------------------------------------------------
# Pure helpers the decision routes share
# ---------------------------------------------------------------------------

TODAY = date(2026, 11, 10)
T0 = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)


def _row(n, ref, *, rev=1, status="signed", parent=None, effective_from=None, valid_until=None):
    return ds.DecisionRow(
        id=uuid.UUID(int=n),
        reference_number=ref,
        revision_number=rev,
        status=status,
        parent_id=uuid.UUID(int=parent) if parent else None,
        created_at=T0 + timedelta(minutes=n),
        title=f"Title {n}",
        effective_from=effective_from,
        valid_until=valid_until,
    )


def _ref(n, ref, rev=1):
    return {
        "id": str(uuid.UUID(int=n)),
        "reference_number": ref,
        "revision_number": rev,
        "title": f"Title {n}",
    }


class TestLabels:
    def test_revision_shows_only_from_two(self):
        assert adr_service.reference_label("ADR-012", 1) == "ADR-012"
        assert adr_service.reference_label("ADR-012", 2) == "ADR-012 · Rev 2"
        assert adr_service.reference_label("ADR-012", None) == "ADR-012"

    def test_decision_label_and_link(self):
        adr = ArchitectureDecision(reference_number="ADR-012", title="Use Kafka", revision_number=3)
        assert adr_service.decision_label(adr) == "ADR-012 · Rev 3 — Use Kafka"
        adr.revision_number = 1
        assert adr_service.decision_label(adr) == "ADR-012 — Use Kafka"
        assert adr_service.decision_link(uuid.UUID(int=5)) == f"/ea-delivery/adr/{uuid.UUID(int=5)}"


class TestStandingFields:
    def test_superseded_earlier_revision(self):
        register = ds.build_register(
            [_row(1, "ADR-001"), _row(2, "ADR-002", rev=2, parent=1)], [], today=TODAY
        )
        assert adr_service.standing_fields(register, uuid.UUID(int=1)) == {
            "standing": "superseded",
            "is_current": False,
            "is_earlier_revision": True,
            "superseded_by": _ref(2, "ADR-002", 2),
            "revoked_by": None,
            "amended_by": [],
            "open_revision": None,
            "upcoming": [],
            "consolidated_into": None,
        }

    def test_amended_current_with_an_upcoming_revision_and_an_open_draft(self):
        rows = [
            _row(1, "ADR-001"),
            _row(2, "ADR-002", rev=2, parent=1, effective_from=date(2026, 12, 1)),
            _row(3, "ADR-003"),
            _row(4, "ADR-004", rev=3, parent=2, status="draft"),
        ]
        links = [ds.LinkRow(uuid.UUID(int=3), uuid.UUID(int=1), "amends")]
        register = ds.build_register(rows, links, today=TODAY)
        fields = adr_service.standing_fields(register, uuid.UUID(int=1))
        assert fields["standing"] == "amended"
        assert fields["is_current"] is True
        assert fields["amended_by"] == [_ref(3, "ADR-003")]
        assert fields["open_revision"] == _ref(4, "ADR-004", 3)
        assert fields["upcoming"] == [
            {"kind": "revision", "by": _ref(2, "ADR-002", 2), "effective_from": "2026-12-01"}
        ]

    def test_revoked_and_consolidated(self):
        rows = [
            _row(1, "ADR-001"),
            _row(2, "ADR-002"),
            _row(3, "ADR-003"),
            _row(4, "ADR-004", rev=2, parent=1),
        ]
        links = [
            ds.LinkRow(uuid.UUID(int=2), uuid.UUID(int=3), "revokes"),
            ds.LinkRow(uuid.UUID(int=3), uuid.UUID(int=1), "amends"),
            ds.LinkRow(uuid.UUID(int=4), uuid.UUID(int=3), "consolidates"),
        ]
        register = ds.build_register(rows, links, today=TODAY)
        revoked = adr_service.standing_fields(register, uuid.UUID(int=3))
        assert revoked["standing"] == "revoked"
        assert revoked["revoked_by"] == _ref(2, "ADR-002")
        assert revoked["consolidated_into"] == _ref(4, "ADR-004", 2)

    def test_a_decision_outside_the_register_reads_as_a_lone_draft(self):
        register = ds.build_register([], [], today=TODAY)
        fields = adr_service.standing_fields(register, uuid.UUID(int=9))
        assert (fields["standing"], fields["is_current"], fields["is_earlier_revision"]) == (
            None,
            True,
            False,
        )
        assert adr_service.revisions_payload(register, uuid.UUID(int=9)) == []

    def test_revisions_payload_lists_the_chain_with_status_and_standing(self):
        register = ds.build_register(
            [_row(1, "ADR-001"), _row(2, "ADR-002", rev=2, parent=1, status="draft")],
            [],
            today=TODAY,
        )
        assert adr_service.revisions_payload(register, uuid.UUID(int=2)) == [
            {**_ref(1, "ADR-001"), "status": "signed", "standing": "in_force"},
            {**_ref(2, "ADR-002", 2), "status": "draft", "standing": None},
        ]

    def test_date_fields(self):
        adr = ArchitectureDecision(
            decided_on=date(2026, 1, 2),
            effective_from=None,
            valid_until=date(2027, 1, 1),
            recorded_at=datetime(2026, 1, 3, 8, 0, tzinfo=timezone.utc),
        )
        assert adr_service.date_fields(adr) == {
            "decided_on": "2026-01-02",
            "effective_from": None,
            "valid_until": "2027-01-01",
            "recorded_at": "2026-01-03T08:00:00+00:00",
        }
        assert adr_service.date_fields(ArchitectureDecision())["recorded_at"] is None


class TestLinkReferences:
    def test_each_kind_as_sorted_unique_references(self):
        rows = [_row(n, f"ADR-00{n}") for n in range(1, 6)]
        links = [
            ds.LinkRow(uuid.UUID(int=1), uuid.UUID(int=3), "replaces"),
            ds.LinkRow(uuid.UUID(int=1), uuid.UUID(int=2), "replaces"),
            ds.LinkRow(uuid.UUID(int=1), uuid.UUID(int=4), "amends"),
            ds.LinkRow(uuid.UUID(int=1), uuid.UUID(int=5), "relates"),
            ds.LinkRow(uuid.UUID(int=1), uuid.UUID(int=77), "revokes"),
        ]
        register = ds.build_register(rows, links, today=TODAY)
        assert adr_service.link_references(register, uuid.UUID(int=1)) == {
            "replaces": ["ADR-002", "ADR-003"],
            "amends": ["ADR-004"],
            "revokes": [],
            "consolidates": [],
        }
        assert adr_service.outgoing_targets(register, uuid.UUID(int=1), "relates") == [
            uuid.UUID(int=5)
        ]
        assert adr_service.reference_labels(
            register, [uuid.UUID(int=2), uuid.UUID(int=2), uuid.UUID(int=99)]
        ) == ["ADR-002"]


class TestListFilters:
    def test_parse_standing_filter(self):
        assert adr_service.parse_standing_filter(None) is None
        assert adr_service.parse_standing_filter(" , ") is None
        assert adr_service.parse_standing_filter("in_force, amended") == frozenset(
            {"in_force", "amended"}
        )
        with pytest.raises(HTTPException) as err:
            adr_service.parse_standing_filter("in_force,retired,signed")
        assert err.value.status_code == 400
        assert err.value.detail == {"error": "unknown_standing", "values": ["retired", "signed"]}

    def test_keep_in_list(self):
        register = ds.build_register(
            [
                _row(1, "ADR-001"),
                _row(2, "ADR-002", rev=2, parent=1),
                _row(3, "ADR-003", status="draft"),
            ],
            [],
            today=TODAY,
        )
        earlier, current, draft = (uuid.UUID(int=n) for n in (1, 2, 3))

        def keep(did, include_earlier=True, standings=None):
            return adr_service.keep_in_list(
                register, did, include_earlier=include_earlier, standings=standings
            )

        assert keep(earlier) is True
        assert keep(earlier, include_earlier=False) is False
        assert keep(current, include_earlier=False) is True
        assert keep(draft, include_earlier=False) is True
        assert keep(current, standings=frozenset({"in_force"})) is True
        assert keep(earlier, standings=frozenset({"in_force"})) is False
        assert keep(draft, standings=frozenset({"in_force"})) is False
        assert keep(uuid.UUID(int=9)) is True
        assert keep(uuid.UUID(int=9), include_earlier=False) is False
        assert keep(uuid.UUID(int=9), standings=frozenset({"in_force"})) is False


class TestDatesAndLocking:
    def test_check_dates(self):
        adr_service.check_dates(date(2026, 1, 1), date(2026, 2, 1), date(2026, 2, 1), today=TODAY)
        with pytest.raises(HTTPException) as err:
            adr_service.check_dates(None, date(2026, 2, 2), date(2026, 2, 1), today=TODAY)
        assert err.value.status_code == 400
        assert err.value.detail == {
            "error": "valid_until_before_effective",
            "problems": ["valid_until_before_effective"],
        }

    def _draft(self, **dates):
        adr = ArchitectureDecision(
            id=uuid.UUID(int=10), reference_number="ADR-010", title="Draft", **dates
        )
        return adr

    def _register(self, links=(), extra=()):
        rows = [
            _row(1, "ADR-001"),
            _row(2, "ADR-002", status="draft"),
            _row(10, "ADR-010", status="draft"),
            *extra,
        ]
        return ds.build_register(rows, list(links), today=TODAY)

    def test_a_clean_draft_may_lock(self):
        assert adr_service.lock_refusal(self._register(), self._draft()) is None

    def test_an_unsigned_target_is_named(self):
        links = [
            ds.LinkRow(uuid.UUID(int=10), uuid.UUID(int=1), "relates"),
            ds.LinkRow(uuid.UUID(int=10), uuid.UUID(int=2), "relates"),
        ]
        assert adr_service.lock_refusal(self._register(links), self._draft()) == {
            "error": "link_target_not_locked",
            "problems": ["link_target_not_locked"],
            "target_ids": [str(uuid.UUID(int=2))],
        }

    def test_dates_are_checked_with_the_signing_date_as_effective_from(self):
        register = self._register()
        assert adr_service.lock_refusal(register, self._draft(valid_until=TODAY)) is None
        assert adr_service.lock_refusal(
            register, self._draft(valid_until=TODAY - timedelta(days=1))
        ) == {
            "error": "valid_until_before_effective",
            "problems": ["valid_until_before_effective", "valid_until_past"],
        }
        assert adr_service.lock_refusal(register, self._draft(decided_on=TODAY)) is None
        assert adr_service.lock_refusal(
            register, self._draft(decided_on=TODAY + timedelta(days=1))
        ) == {"error": "decided_on_future", "problems": ["decided_on_future"]}
        assert adr_service.lock_refusal(
            register,
            self._draft(effective_from=date(2027, 1, 2), valid_until=date(2027, 1, 1)),
        ) == {
            "error": "valid_until_before_effective",
            "problems": ["valid_until_before_effective"],
        }

    def test_a_closed_chain_names_the_closer(self):
        rows = [
            _row(1, "ADR-001"),
            _row(2, "ADR-002", status="draft"),
            _row(3, "ADR-003"),
            _row(11, "ADR-011", rev=2, parent=1, status="draft"),
        ]
        links = [ds.LinkRow(uuid.UUID(int=3), uuid.UUID(int=1), "revokes")]
        register = ds.build_register(rows, links, today=TODAY)
        revision = ArchitectureDecision(id=uuid.UUID(int=11), reference_number="ADR-011", title="R")
        assert adr_service.lock_refusal(register, revision) == {
            "error": "chain_closed",
            "problems": ["chain_closed"],
            "by": _ref(3, "ADR-003"),
        }

    def test_apply_lock_dates_fills_only_empty_dates(self):
        adr = ArchitectureDecision()
        adr_service.apply_lock_dates(adr, TODAY)
        assert (adr.decided_on, adr.effective_from) == (TODAY, TODAY)
        kept = ArchitectureDecision(decided_on=date(2026, 1, 1), effective_from=date(2027, 1, 1))
        adr_service.apply_lock_dates(kept, TODAY)
        assert (kept.decided_on, kept.effective_from) == (date(2026, 1, 1), date(2027, 1, 1))

    def test_ref_payload_of_none(self):
        assert adr_service.ref_payload(None) is None


class TestCopyDecisionExtras:
    async def test_copies_relates_links_and_people(self, db):
        from app.services import decision_people_service

        target = await adr_service.create_decision(db, title="Target", publish=False)
        source = await adr_service.create_decision(
            db, title="Source", related_decisions=["ADR-001"], publish=False
        )
        await decision_people_service.replace_people(
            db, source, decision_makers=[{"name": "Board"}]
        )
        copy = await adr_service.create_decision(db, title="Copy", publish=False)

        await adr_service.copy_decision_extras(db, source.id, copy.id)

        assert await _links(db, copy.id) == [(target.id, "relates", None)]
        people = await decision_people_service.people_payload(db, [copy.id])
        assert people[copy.id]["decision_makers"] == [{"user_id": None, "display_name": "Board"}]
