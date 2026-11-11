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
from tests.conftest import create_card, create_card_type, create_user


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

    async def test_a_reference_shared_by_several_revisions_counts_once(self, db):
        first = ArchitectureDecision(reference_number="ADR-004", title="Rev 1", status="signed")
        db.add(first)
        await db.flush()
        db.add_all(
            [
                ArchitectureDecision(
                    reference_number="ADR-004", title="Rev 2", revision_number=2, parent_id=first.id
                ),
                ArchitectureDecision(reference_number="ADR-002", title="Other"),
            ]
        )
        await db.flush()
        assert await adr_service.next_reference_number(db) == "ADR-005"


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
            "problems": ["valid_until_before_effective"],
        }
        assert adr_service.lock_refusal(
            register, self._draft(valid_until=TODAY - timedelta(days=2))
        ) == {
            "error": "valid_until_before_effective",
            "problems": ["valid_until_before_effective", "valid_until_past"],
        }
        assert adr_service.lock_refusal(register, self._draft(decided_on=TODAY)) is None
        assert (
            adr_service.lock_refusal(register, self._draft(decided_on=TODAY + timedelta(days=1)))
            is None
        )
        assert adr_service.lock_refusal(
            register, self._draft(decided_on=TODAY + timedelta(days=2))
        ) == {"error": "decided_on_future", "problems": ["decided_on_future"]}

    def test_valid_until_yesterday_with_an_explicit_start_may_lock(self):
        register = self._register()
        yesterday = TODAY - timedelta(days=1)
        assert (
            adr_service.lock_refusal(
                register, self._draft(effective_from=yesterday, valid_until=yesterday)
            )
            is None
        )
        two_days_ago = TODAY - timedelta(days=2)
        assert adr_service.lock_refusal(
            register, self._draft(effective_from=two_days_ago, valid_until=two_days_ago)
        ) == {"error": "valid_until_past", "problems": ["valid_until_past"]}
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

    def test_completes_signatures(self):
        def sig(uid, status):
            return {"user_id": uid, "status": status}

        done = adr_service.completes_signatures
        assert done([sig("u1", "pending")], "u1") is True
        assert done([sig("u1", "pending"), sig("u2", "signed")], "u1") is True
        assert done([sig("u1", "pending"), sig("u2", "pending")], "u1") is False
        assert done([sig("u1", "signed"), sig("u2", "signed")], "u1") is False
        assert done([sig("u2", "signed")], "u1") is False
        assert done([], "u1") is False

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


class TestCheckEditable:
    def _code(self, current, new=None, fields=()):
        try:
            adr_service.check_editable(current, new, fields)
        except HTTPException as exc:
            return exc.status_code, exc.detail
        return None

    def test_a_draft_takes_any_field(self):
        assert self._code("draft", None, {"title", "links", "attributes"}) is None
        assert self._code("draft", "draft", {"status"}) is None

    def test_a_signed_decision_is_403_before_any_status_check(self):
        assert self._code("signed", "in_review", {"status"}) == (
            403,
            "Cannot edit a signed decision. Create a new revision instead.",
        )
        assert self._code("signed", None, {"linked_card_ids"})[0] == 403

    def test_workflow_statuses_are_400_whatever_the_state(self):
        assert self._code("draft", "signed", {"status"}) == (
            400,
            "Use the sign endpoint to sign a decision",
        )
        assert self._code("in_review", "in_review", {"status", "title"}) == (
            400,
            "Use the request-signatures endpoint to send for review",
        )
        assert self._code("in_review", "draft", {"status", "title"}) == (
            400,
            "Use the recall-signatures endpoint to reset to draft",
        )

    def test_in_review_only_card_links_pass(self):
        assert self._code("in_review", None, {"linked_card_ids"}) is None
        assert self._code("in_review", None, set()) is None
        locked = (403, "Cannot edit a decision in review. Recall the signatures to edit it.")
        assert self._code("in_review", None, {"linked_card_ids", "title"}) == locked
        assert self._code("in_review", "archived", {"status"}) == locked
        assert self._code("in_review", None, {"attributes"}) == locked


class TestReviseRefusal:
    def _register(self, rows, links=()):
        return ds.build_register(rows, list(links), today=TODAY)

    def _adr(self, n):
        return ArchitectureDecision(id=uuid.UUID(int=n), reference_number="ADR-001", title="T")

    def test_the_latest_signed_revision_may_be_revised(self):
        register = self._register([_row(1, "ADR-001"), _row(2, "ADR-001", rev=2, parent=1)])
        assert adr_service.revise_refusal_detail(register, self._adr(2)) is None

    def test_an_open_revision_is_named(self):
        register = self._register(
            [
                _row(1, "ADR-001"),
                _row(2, "ADR-001", rev=2, parent=1, status="draft"),
            ]
        )
        assert adr_service.revise_refusal_detail(register, self._adr(1)) == {
            "error": "open_revision_exists",
            "revision_id": str(uuid.UUID(int=2)),
        }

    def test_a_superseded_revision_is_not_the_latest(self):
        register = self._register([_row(1, "ADR-001"), _row(2, "ADR-001", rev=2, parent=1)])
        assert adr_service.revise_refusal_detail(register, self._adr(1)) == {
            "error": "not_revisable",
            "reason": "not_latest",
        }

    def test_a_closed_chain_names_its_closer_and_an_expired_one_stays_revisable(self):
        rows = [
            _row(1, "ADR-001"),
            _row(3, "ADR-003"),
            _row(4, "ADR-004", valid_until=TODAY - timedelta(days=1)),
        ]
        links = [ds.LinkRow(uuid.UUID(int=3), uuid.UUID(int=1), "replaces")]
        register = self._register(rows, links)
        assert adr_service.revise_refusal_detail(register, self._adr(1)) == {
            "error": "not_revisable",
            "by": _ref(3, "ADR-003"),
        }
        assert register[uuid.UUID(int=4)].standing == "expired"
        assert adr_service.revise_refusal_detail(register, self._adr(4)) is None


class TestCreateRevision:
    async def test_flushes_without_commit_and_numbers_from_the_chain(self, db, cards):
        source = await adr_service.create_decision(
            db,
            title="Source",
            context="ctx",
            decision="dec",
            consequences="cons",
            alternatives_considered="alt",
            attributes={"ext.x.k": 1},
            linked_card_ids=[cards["b"].id, cards["a"].id],
            valid_until=date(2099, 1, 1),
            decided_on=date(2026, 1, 2),
            effective_from=date(2026, 1, 3),
            change_summary="old summary",
            publish=False,
        )
        source.status = "signed"
        await db.flush()

        revision = await adr_service.create_revision(
            db,
            source,
            created_by=None,
            register=await ds.load_register(db),
            change_summary="new summary",
        )

        assert (
            revision.reference_number,
            revision.revision_number,
            revision.parent_id,
            revision.status,
        ) == (source.reference_number, 2, source.id, "draft")
        assert (
            revision.title,
            revision.context,
            revision.decision,
            revision.consequences,
            revision.alternatives_considered,
            revision.attributes,
        ) == ("Source", "ctx", "dec", "cons", "alt", {"ext.x.k": 1})
        assert (
            revision.valid_until,
            revision.decided_on,
            revision.effective_from,
            revision.change_summary,
        ) == (date(2099, 1, 1), None, None, "new summary")
        linked = await db.execute(
            select(ArchitectureDecisionCard.card_id)
            .where(ArchitectureDecisionCard.architecture_decision_id == revision.id)
            .order_by(ArchitectureDecisionCard.card_id)
        )
        assert linked.scalars().all() == sorted([cards["a"].id, cards["b"].id])
        event = (
            await db.execute(
                select(Event).where(
                    Event.event_type == "adr.created",
                    Event.data["adr_id"].astext == str(revision.id),
                )
            )
        ).scalar_one()
        assert event.data["revision_of"] == str(source.id)
        assert sorted(event.data["linked_card_ids"]) == sorted(
            [str(cards["a"].id), str(cards["b"].id)]
        )

    async def test_a_carried_relates_to_the_amender_becomes_the_consolidation(self, db):
        source = await adr_service.create_decision(db, title="Amended", publish=False)
        source.status = "signed"
        amender = await adr_service.create_decision(db, title="Amender", publish=False)
        amender.status = "signed"
        await db.flush()
        db.add_all(
            [
                ArchitectureDecisionLink(source_id=amender.id, target_id=source.id, kind="amends"),
                ArchitectureDecisionLink(source_id=source.id, target_id=amender.id, kind="relates"),
            ]
        )
        await db.flush()

        revision = await adr_service.create_revision(
            db,
            source,
            created_by=None,
            register=await ds.load_register(db),
            consolidates=[str(amender.id)],
        )

        assert await _links(db, revision.id) == [(amender.id, "consolidates", None)]

    async def test_the_same_amender_twice_is_a_duplicate_target(self, db):
        source = await adr_service.create_decision(db, title="Amended", publish=False)
        source.status = "signed"
        amender = await adr_service.create_decision(db, title="Amender", publish=False)
        amender.status = "signed"
        await db.flush()
        db.add(ArchitectureDecisionLink(source_id=amender.id, target_id=source.id, kind="amends"))
        await db.flush()

        with pytest.raises(HTTPException) as exc:
            await adr_service.create_revision(
                db,
                source,
                created_by=None,
                register=await ds.load_register(db),
                consolidates=[str(amender.id), amender.reference_number],
            )
        assert exc.value.status_code == 400
        assert exc.value.detail["error"] == "duplicate_target"


class TestDuplicateDecision:
    async def test_new_reference_no_parent_one_event(self, db, cards):
        original = await adr_service.create_decision(
            db,
            title="Original",
            attributes={"ext.x.k": 2},
            linked_card_ids=[cards["a"].id],
            valid_until=date(2099, 1, 1),
            decided_on=date(2026, 1, 2),
            publish=False,
        )

        dup = await adr_service.duplicate_decision(db, original, created_by=None)

        assert (dup.reference_number, dup.revision_number, dup.parent_id, dup.title) == (
            "ADR-002",
            1,
            None,
            "Original (copy)",
        )
        assert (dup.attributes, dup.valid_until, dup.decided_on) == (
            {"ext.x.k": 2},
            date(2099, 1, 1),
            None,
        )
        events = (
            (await db.execute(select(Event).where(Event.event_type == "adr.created")))
            .scalars()
            .all()
        )
        assert [(e.data["adr_id"], e.data["linked_card_ids"]) for e in events] == [
            (str(dup.id), [str(cards["a"].id)])
        ]


class TestAuthorship:
    """Who made a decision, a revision or a duplicate is stored and evented."""

    async def _created_event(self, db, adr_id):
        return (
            await db.execute(
                select(Event).where(
                    Event.event_type == "adr.created",
                    Event.data["adr_id"].astext == str(adr_id),
                )
            )
        ).scalar_one()

    async def test_create_decision_events_its_author(self, db):
        author = await create_user(db, email="adr-author@test.com")
        adr = await adr_service.create_decision(db, title="Authored", created_by=author.id)
        assert adr.created_by == author.id
        assert (await self._created_event(db, adr.id)).user_id == author.id

    async def test_create_revision_stores_and_events_its_author(self, db):
        author = await create_user(db, email="rev-author@test.com")
        source = await adr_service.create_decision(db, title="Source", publish=False)
        source.status = "signed"
        await db.flush()

        revision = await adr_service.create_revision(
            db, source, created_by=author.id, register=await ds.load_register(db)
        )

        assert revision.created_by == author.id
        assert (await self._created_event(db, revision.id)).user_id == author.id

    async def test_duplicate_copies_the_text_and_names_its_author(self, db):
        author = await create_user(db, email="dup-author@test.com")
        original = await adr_service.create_decision(
            db,
            title="Original",
            context="ctx",
            decision="dec",
            consequences="cons",
            alternatives_considered="alt",
            publish=False,
        )

        dup = await adr_service.duplicate_decision(db, original, created_by=author.id)

        assert (
            dup.context,
            dup.decision,
            dup.consequences,
            dup.alternatives_considered,
            dup.created_by,
        ) == ("ctx", "dec", "cons", "alt", author.id)
        assert (await self._created_event(db, dup.id)).user_id == author.id


class TestCopyCardLinks:
    async def test_returns_the_card_ids_in_id_order_whatever_the_insert_order(self, db, cards):
        source = await adr_service.create_decision(db, title="Source", publish=False)
        target = await adr_service.create_decision(db, title="Target", publish=False)
        low, high = sorted([cards["a"].id, cards["b"].id])
        for card_id in (high, low):
            db.add(ArchitectureDecisionCard(architecture_decision_id=source.id, card_id=card_id))
            await db.flush()

        assert await adr_service.copy_card_links(db, source.id, target.id) == [low, high]


class TestParentDecidedOn:
    def test_a_parent_outside_the_register_has_no_date(self):
        register = ds.build_register([_row(1, "ADR-001")], [], today=TODAY)
        orphan = ArchitectureDecision(
            id=uuid.UUID(int=5), reference_number="ADR-005", title="T", parent_id=uuid.UUID(int=7)
        )
        assert adr_service.parent_decided_on(register, orphan) is None
        child = ArchitectureDecision(
            id=uuid.UUID(int=6), reference_number="ADR-001", title="T", parent_id=uuid.UUID(int=1)
        )
        assert adr_service.parent_decided_on(register, child) is None


class TestReviseRefusalNamesTheOpenRevision:
    def test_a_signed_revision_after_the_open_one_is_not_named(self):
        register = ds.build_register(
            [
                _row(1, "ADR-001"),
                _row(2, "ADR-001", rev=2, parent=1, status="draft"),
                _row(3, "ADR-001", rev=3, parent=2),
            ],
            [],
            today=TODAY,
        )
        source = ArchitectureDecision(id=uuid.UUID(int=1), reference_number="ADR-001", title="T")
        assert adr_service.revise_refusal_detail(register, source) == {
            "error": "open_revision_exists",
            "revision_id": str(uuid.UUID(int=2)),
        }


class TestDuplicateConsolidationTarget:
    async def test_the_duplicate_target_is_named(self, db):
        source = await adr_service.create_decision(db, title="Amended", publish=False)
        source.status = "signed"
        amender = await adr_service.create_decision(db, title="Amender", publish=False)
        amender.status = "signed"
        await db.flush()
        db.add(ArchitectureDecisionLink(source_id=amender.id, target_id=source.id, kind="amends"))
        await db.flush()

        with pytest.raises(HTTPException) as exc:
            await adr_service.create_revision(
                db,
                source,
                created_by=None,
                register=await ds.load_register(db),
                consolidates=[str(amender.id), amender.reference_number],
            )
        assert exc.value.detail["target_id"] == str(amender.id)


class TestNotifyStandingChanged:
    async def test_counts_the_notices_and_never_tells_the_actor(self, db):
        actor = await create_user(db, email="locker@test.com")
        other = await create_user(db, email="old-author@test.com")
        mine = await adr_service.create_decision(
            db, title="Mine", created_by=actor.id, publish=False
        )
        theirs = await adr_service.create_decision(
            db, title="Theirs", created_by=other.id, publish=False
        )
        new = await adr_service.create_decision(db, title="New", publish=False)
        lone = await adr_service.create_decision(db, title="Lone", publish=False)
        for target in (mine, theirs):
            target.status = "signed"
            db.add(ArchitectureDecisionLink(source_id=new.id, target_id=target.id, kind="replaces"))
        await db.flush()
        register = await ds.load_register(db)

        assert await adr_service.notify_standing_changed(db, lone, register, actor_id=actor.id) == 0
        assert await adr_service.notify_standing_changed(db, new, register, actor_id=actor.id) == 1
