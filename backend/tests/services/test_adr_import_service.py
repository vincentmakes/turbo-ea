"""The decision-record spreadsheet import engine and its export helper.

Called directly, so each outcome field and each written column is pinned
without the route around it. DB-backed: skipped locally without PostgreSQL,
run in CI.
"""

from __future__ import annotations

from sqlalchemy import select

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_card import ArchitectureDecisionCard
from app.models.event import Event
from app.services import adr_import_service as svc
from app.services import adr_service
from app.services.adr_import_service import DecisionImportRow as Row
from tests.conftest import create_card, create_card_type, create_user


async def _decisions(db) -> dict[str, ArchitectureDecision]:
    rows = (await db.execute(select(ArchitectureDecision))).scalars().all()
    return {d.reference_number: d for d in rows}


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


async def test_one_related_decision_spelled_two_ways_links_once(db):
    existing = await adr_service.create_decision(db, title="Existing", publish=False)

    [outcome] = await svc.import_decision_rows(
        db,
        [Row(row_index=0, title="Linked", related_references=["ADR-001", "adr-001", " "])],
        created_by=None,
    )

    adr = (await _decisions(db))[outcome.reference_number]
    assert adr.related_decisions == [str(existing.id)]
    assert outcome.warnings == []


async def test_a_row_with_no_related_decisions_keeps_an_empty_list(db):
    [outcome] = await svc.import_decision_rows(
        db, [Row(row_index=0, title="Alone")], created_by=None
    )
    assert (await _decisions(db))[outcome.reference_number].related_decisions == []


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


async def test_related_labels_resolve_ids_and_references_and_drop_the_rest(db):
    first = await adr_service.create_decision(db, title="First", publish=False)
    second = await adr_service.create_decision(db, title="Second", publish=False)
    holder = await adr_service.create_decision(
        db,
        title="Holder",
        related_decisions=[
            str(second.id),
            "adr-001",
            str(first.id),  # the same decision again, by id
            {"type": "assessment", "id": "x"},
            "  ",
            "ADR-404",
            "00000000-0000-0000-0000-000000000000",
        ],
        publish=False,
    )
    ids_only = await adr_service.create_decision(
        db, title="Ids only", related_decisions=[str(first.id)], publish=False
    )

    labels = await svc.related_reference_labels(db, [holder, ids_only, first])

    assert labels[holder.id] == ["ADR-002", "ADR-001"]
    assert labels[ids_only.id] == ["ADR-001"]
    assert labels[first.id] == []


async def test_related_labels_of_nothing_is_empty_per_decision(db):
    adr = await adr_service.create_decision(db, title="Plain", publish=False)
    assert await svc.related_reference_labels(db, [adr]) == {adr.id: []}


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
