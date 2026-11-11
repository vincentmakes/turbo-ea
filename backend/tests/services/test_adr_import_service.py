"""The decision-record spreadsheet import engine and its export helper.

Called directly, so each outcome field and each written column is pinned
without the route around it. DB-backed: skipped locally without PostgreSQL,
run in CI.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import select

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_card import ArchitectureDecisionCard
from app.models.architecture_decision_link import ArchitectureDecisionLink
from app.models.event import Event
from app.services import adr_import_service as svc
from app.services import adr_service
from app.services.adr_import_service import DecisionImportRow as Row
from app.services.decision_standing import DecisionRow, build_register, load_register
from tests.conftest import create_card, create_card_type, create_user


async def _decisions(db) -> dict[str, ArchitectureDecision]:
    rows = (await db.execute(select(ArchitectureDecision))).scalars().all()
    return {d.reference_number: d for d in rows}


async def _relates(db, source_id) -> list[uuid.UUID]:
    rows = await db.execute(
        select(ArchitectureDecisionLink.target_id)
        .where(
            ArchitectureDecisionLink.source_id == source_id,
            ArchitectureDecisionLink.kind == "relates",
        )
        .order_by(ArchitectureDecisionLink.created_at, ArchitectureDecisionLink.target_id)
    )
    return list(rows.scalars().all())


async def _created_events(db) -> list[Event]:
    result = await db.execute(select(Event).where(Event.event_type == "adr.created"))
    return list(result.scalars().all())


async def test_publish_false_writes_no_event_and_true_writes_one(db):
    user = await create_user(db, email="adr-import@test.com", role="admin")

    await svc.import_decision_rows(
        db, [Row(row_index=0, title="Quiet")], created_by=user.id, publish=False
    )
    assert await _created_events(db) == []

    await svc.import_decision_rows(db, [Row(row_index=0, title="Loud")], created_by=user.id)
    [event] = await _created_events(db)
    assert event.data["title"] == "Loud"


async def test_every_section_is_stored_trimmed_and_a_blank_one_as_null(db):
    outcome, _ = await svc.import_decision_rows(
        db,
        [
            Row(
                row_index=2,
                title="  Sections  ",
                context=" <p>c</p> ",
                decision="<p>d</p>",
                consequences="<p>q</p>",
                alternatives_considered="<p>a</p>",
            ),
            Row(row_index=3, title="Blank", context="   "),
        ],
        created_by=None,
    )

    adr = (await _decisions(db))["ADR-001"]
    assert (outcome.status, outcome.row_index, outcome.id) == ("created", 2, str(adr.id))
    assert (
        adr.title,
        adr.status,
        adr.context,
        adr.decision,
        adr.consequences,
        adr.alternatives_considered,
    ) == ("Sections", "draft", "<p>c</p>", "<p>d</p>", "<p>q</p>", "<p>a</p>")
    assert (await _decisions(db))["ADR-002"].context is None


async def test_a_skipped_row_names_the_existing_decision_and_later_rows_still_import(db):
    existing = await adr_service.create_decision(db, title="Existing", publish=False)

    skipped, created = await svc.import_decision_rows(
        db,
        [
            Row(row_index=0, reference_number=" adr-001 ", title="Ignored"),
            Row(row_index=1, title="After"),
        ],
        created_by=None,
    )

    assert (skipped.status, skipped.id, skipped.reference_number) == (
        "skipped",
        str(existing.id),
        "ADR-001",
    )
    assert (created.status, created.reference_number) == ("created", "ADR-002")


async def test_a_title_of_exactly_the_limit_is_accepted(db):
    [outcome] = await svc.import_decision_rows(
        db, [Row(row_index=0, title="x" * 500)], created_by=None
    )
    assert outcome.status == "created"


async def test_rows_without_a_reference_are_not_duplicates_of_each_other(db):
    outcomes = await svc.import_decision_rows(
        db,
        [Row(row_index=0, title="One"), Row(row_index=1, title="Two")],
        created_by=None,
    )
    assert [o.status for o in outcomes] == ["created", "created"]


def test_revision_of_reads_the_cell():
    assert svc.revision_of(None) == 0
    assert svc.revision_of(3) == 3
    assert svc.revision_of(-2) == 0
    assert svc.revision_of(True) == 0
    assert svc.revision_of(" 12 ") == 12
    assert svc.revision_of("") == 0
    assert svc.revision_of("Rev 2") == 0
    assert svc.revision_of("²") == 0


def test_chosen_rows_keeps_the_highest_revision_per_reference():
    rows = [
        Row(row_index=0, reference_number="ADR-1", title="a", revision_number=2),
        Row(row_index=1, reference_number="adr-1", title="b", revision_number=1),
        Row(row_index=2, reference_number="ADR-2", title="c"),
        Row(row_index=3, reference_number="ADR-2", title="d"),
        Row(row_index=4, title="no reference"),
        Row(row_index=5, title="no reference either"),
        Row(row_index=6, reference_number="ADR-3", title="e", revision_number=3),
        Row(row_index=7, reference_number="ADR-3", title="f", revision_number=3),
        Row(row_index=8, reference_number="ADR-9", title="g", revision_number=1),
        Row(row_index=9, reference_number="ADR-9", title="h", revision_number=2),
    ]
    # ADR-1: rev 2 (first row); ADR-2: no numbers, the last row; ADR-3: tie,
    # the last row; ADR-9 is on the instance, so every row is the caller's.
    assert svc.chosen_rows(rows, {"ADR-9"}) == {0, 3, 4, 5, 7, 8, 9}
    assert svc.chosen_rows(rows) == {0, 3, 4, 5, 7, 9}


def test_earlier_revision_warning():
    assert svc.earlier_revision_warning("ADR-012") == "Earlier revision of ADR-012 skipped"


async def test_repeated_reference_imports_one_row_whatever_the_order(db):
    rows = [
        Row(row_index=0, reference_number="OLD-1", title="Rev 2", revision_number=2),
        Row(row_index=1, reference_number="OLD-1", title="Rev 1", revision_number="1"),
        Row(row_index=2, title="Refers", related_references=["old-1"]),
    ]

    kept, earlier, refers = await svc.import_decision_rows(db, rows, created_by=None)

    assert (kept.status, kept.warnings) == ("created", [])
    assert (earlier.status, earlier.id, earlier.reference_number, earlier.error) == (
        "skipped",
        kept.id,
        "OLD-1",
        None,
    )
    assert earlier.warnings == ["Earlier revision of OLD-1 skipped"]
    decisions = await _decisions(db)
    assert sorted(d.title for d in decisions.values()) == ["Refers", "Rev 2"]
    assert await _relates(db, uuid.UUID(refers.id)) == [uuid.UUID(kept.id)]


async def test_an_earlier_revision_of_a_failed_row_names_no_decision(db):
    rows = [
        Row(row_index=0, reference_number="OLD-2", title="Rev 1", revision_number=1),
        Row(row_index=1, reference_number="OLD-2", title=" ", revision_number=2),
    ]

    earlier, failed = await svc.import_decision_rows(db, rows, created_by=None)

    assert (failed.status, failed.error) == ("failed", "Title is required")
    assert (earlier.status, earlier.id, earlier.warnings) == (
        "skipped",
        None,
        ["Earlier revision of OLD-2 skipped"],
    )


async def test_a_reference_on_the_instance_skips_all_its_rows_without_warning(db):
    existing = await adr_service.create_decision(db, title="Existing", publish=False)
    rows = [
        Row(row_index=0, reference_number="ADR-001", title="A", revision_number=1),
        Row(row_index=1, reference_number="ADR-001", title="B", revision_number=2),
    ]

    outcomes = await svc.import_decision_rows(db, rows, created_by=None)

    assert [(o.status, o.id, o.warnings) for o in outcomes] == [
        ("skipped", str(existing.id), []),
        ("skipped", str(existing.id), []),
    ]
    assert list(await _decisions(db)) == ["ADR-001"]


async def test_one_related_decision_spelled_two_ways_links_once(db):
    existing = await adr_service.create_decision(db, title="Existing", publish=False)

    [outcome] = await svc.import_decision_rows(
        db,
        [Row(row_index=0, title="Linked", related_references=["ADR-001", "adr-001", " "])],
        created_by=None,
    )

    adr = (await _decisions(db))[outcome.reference_number]
    assert await _relates(db, adr.id) == [existing.id]
    assert outcome.warnings == []


async def test_a_row_with_no_related_decisions_links_nothing(db):
    [outcome] = await svc.import_decision_rows(
        db, [Row(row_index=0, title="Alone")], created_by=None
    )
    assert await _relates(db, (await _decisions(db))[outcome.reference_number].id) == []


async def test_an_existing_reference_skips_to_its_chain_current_revision(db):
    signed = ArchitectureDecision(
        reference_number="ADR-001", title="Rev 1", status="signed", revision_number=1
    )
    db.add(signed)
    await db.flush()
    current = ArchitectureDecision(
        reference_number="ADR-002",
        title="Rev 2",
        status="signed",
        revision_number=2,
        parent_id=signed.id,
    )
    db.add(current)
    await db.flush()

    [skipped] = await svc.import_decision_rows(
        db, [Row(row_index=0, title="Again", reference_number="adr-001")], created_by=None
    )

    assert (skipped.status, skipped.id, skipped.reference_number) == (
        "skipped",
        str(current.id),
        "ADR-001",
    )


async def test_a_reference_shared_by_a_chain_resolves_to_its_current_revision(db):
    """Revisions keep their decision's reference: a file row naming it is
    skipped onto the current revision, and a related reference links to it."""
    rev1 = ArchitectureDecision(
        reference_number="ADR-001", title="Rev 1", status="signed", revision_number=1
    )
    db.add(rev1)
    await db.flush()
    rev2 = ArchitectureDecision(
        reference_number="ADR-001",
        title="Rev 2",
        status="signed",
        revision_number=2,
        parent_id=rev1.id,
    )
    db.add(rev2)
    await db.flush()
    draft = ArchitectureDecision(
        reference_number="ADR-001",
        title="Rev 3",
        status="draft",
        revision_number=3,
        parent_id=rev2.id,
    )
    db.add(draft)
    await db.flush()

    skipped, created = await svc.import_decision_rows(
        db,
        [
            Row(row_index=0, title="Again", reference_number="ADR-001"),
            Row(row_index=1, title="New", related_references=["adr-001"]),
        ],
        created_by=None,
    )

    assert (skipped.status, skipped.id, skipped.reference_number) == (
        "skipped",
        str(rev2.id),
        "ADR-001",
    )
    assert (created.status, created.reference_number, created.warnings) == (
        "created",
        "ADR-002",
        [],
    )
    assert await _relates(db, uuid.UUID(created.id)) == [rev2.id]


async def test_cards_link_once_and_unknown_names_warn(db):
    await create_card_type(db, key="Application", label="Application")
    billing = await create_card(db, card_type="Application", name="Billing")

    [outcome] = await svc.import_decision_rows(
        db,
        [Row(row_index=0, title="Cards", card_names=["Billing", " Billing ", "Nowhere"])],
        created_by=None,
    )

    assert outcome.warnings == ["Card not found: Nowhere"]
    adr = (await _decisions(db))[outcome.reference_number]
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
    assert links == [billing.id]


async def test_related_labels_are_the_relates_links_as_references(db):
    first = await adr_service.create_decision(db, title="First", publish=False)
    second = await adr_service.create_decision(db, title="Second", publish=False)
    holder = await adr_service.create_decision(
        db,
        title="Holder",
        related_decisions=[str(second.id), "adr-001", {"type": "assessment", "id": "x"}],
        publish=False,
    )
    # A hard link is not a related decision.
    db.add(ArchitectureDecisionLink(source_id=first.id, target_id=second.id, kind="replaces"))
    await db.flush()

    register = await load_register(db)

    assert svc.related_reference_labels(register, holder.id) == ["ADR-001", "ADR-002"]
    assert svc.related_reference_labels(register, first.id) == []


def test_existing_references_map_to_the_chain_current_revision():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    root = DecisionRow(
        id=uuid.UUID(int=1),
        reference_number="ADR-001",
        revision_number=1,
        status="signed",
        parent_id=None,
        created_at=now,
        title="Root",
    )
    rev = DecisionRow(
        id=uuid.UUID(int=2),
        reference_number="ADR-002",
        revision_number=2,
        status="signed",
        parent_id=root.id,
        created_at=now,
        title="Rev",
    )
    other = DecisionRow(
        id=uuid.UUID(int=3),
        reference_number="adr-003",
        revision_number=1,
        status="draft",
        parent_id=None,
        created_at=now,
        title="Other",
    )
    register = build_register([root, rev, other], [], today=date(2026, 6, 1))

    assert svc.existing_references(register) == {
        "ADR-001": rev.id,
        "ADR-002": rev.id,
        "ADR-003": other.id,
    }


async def test_an_archived_namesake_is_neither_ambiguous_nor_linked(db):
    await create_card_type(db, key="Application", label="Application")
    live = await create_card(db, card_type="Application", name="Portal")
    await create_card(db, card_type="Application", name="Portal", status="ARCHIVED")
    await create_card(db, card_type="Application", name="Retired", status="ARCHIVED")

    [outcome] = await svc.import_decision_rows(
        db,
        [Row(row_index=0, title="Links", card_names=["Portal", "Retired"])],
        created_by=None,
    )

    assert outcome.warnings == ["Card not found: Retired"]
    adr = (await _decisions(db))[outcome.reference_number]
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
    assert links == [live.id]


async def test_two_live_cards_with_one_name_are_ambiguous(db):
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="Initiative", label="Initiative")
    await create_card(db, card_type="Application", name="Portal")
    await create_card(db, card_type="Initiative", name="Portal")

    [outcome] = await svc.import_decision_rows(
        db, [Row(row_index=0, title="Links", card_names=["Portal"])], created_by=None
    )

    assert outcome.warnings == ["Card name is ambiguous: Portal"]


def _lone(n: int, reference: str, revision: int) -> DecisionRow:
    return DecisionRow(
        id=uuid.UUID(int=n),
        reference_number=reference,
        revision_number=revision,
        status="signed",
        parent_id=None,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        title=f"T{n}",
    )


def test_a_reference_shared_by_two_chains_maps_to_the_lowest_revision_first():
    """Two unrelated chains carry one reference: the row with the lower
    revision number wins, whatever the ids."""
    register = build_register(
        [_lone(5, "ADR-007", 1), _lone(3, "ADR-007", 2)], [], today=date(2026, 6, 1)
    )
    assert svc.existing_references(register) == {"ADR-007": uuid.UUID(int=5)}


def test_a_reference_shared_on_one_revision_number_maps_to_the_lowest_id():
    register = build_register(
        [_lone(5, "ADR-007", 1), _lone(3, "ADR-007", 1)], [], today=date(2026, 6, 1)
    )
    assert svc.existing_references(register) == {"ADR-007": uuid.UUID(int=3)}


async def test_the_importers_read_scope_reaches_the_decision_it_creates(monkeypatch):
    """No database: the register is empty and ``create_decision`` is a spy."""

    class _CreatedError(Exception):
        pass

    async def empty_register(db, **_kw):
        return build_register([], [])

    seen: dict = {}

    async def spy(db, **kwargs):
        seen.update(kwargs)
        raise _CreatedError

    monkeypatch.setattr(svc.ds, "load_register", empty_register)
    monkeypatch.setattr(svc.adr_service, "create_decision", spy)
    scope = object()
    with pytest.raises(_CreatedError):
        await svc.import_decision_rows(
            object(), [Row(row_index=0, title="T")], created_by=None, read_scope=scope
        )
    assert seen["read_scope"] is scope
    assert seen["title"] == "T"
