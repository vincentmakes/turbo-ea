"""The demo decision register: every standing on a fresh demo seed.

The demo seed shows the decision register as a review board reads it: a
two-revision chain, a replaced decision, an amendment consolidated into a
revision, an open amendment, a revocation, an expired waiver, a scheduled
decision and a decision recorded as decided. These tests build the register
from the seeded rows with ``decision_standing.load_register`` — the same
derivation the API uses — so a seed row that breaks a register rule fails here,
not on a demo instance.

The register's relative dates count from the day the seed runs, so the
standings are asserted for two seeding days years apart: the demo must not rot.
"""

from __future__ import annotations

from collections import Counter
from datetime import date

import pytest
from sqlalchemy import select

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_link import ArchitectureDecisionLink
from app.models.architecture_decision_person import ArchitectureDecisionPerson
from app.services import decision_standing as ds
from app.services.adr_service import next_reference_number
from app.services.seed import seed_metamodel
from app.services.seed_demo import (
    DEMO_ADMIN_PERSON,
    DEMO_ADR_PEOPLE,
    DEMO_ADR_REGISTER,
    DEMO_ADR_REGISTER_LINKS,
    DEMO_ADRS,
    DEMO_ADRS_EXTRA,
    _id,
    demo_adr_people,
    demo_register_decisions,
    demo_relates_links,
    seed_demo_data,
    with_lock_dates,
)
from tests.conftest import create_user

pytestmark = pytest.mark.asyncio

SEEDED_ON = date(2026, 11, 10)

# (reference, revision) -> (status, standing) on any seeding day.
EXPECTED = {
    ("ADR-001", 1): ("signed", "in_force"),
    ("ADR-002", 1): ("signed", "superseded"),
    ("ADR-002", 2): ("signed", "in_force"),
    ("ADR-003", 1): ("draft", None),
    ("ADR-004", 1): ("signed", "superseded"),
    ("ADR-004", 2): ("signed", "in_force"),
    ("ADR-005", 1): ("signed", "amended"),
    ("ADR-006", 1): ("in_review", None),
    ("ADR-007", 1): ("draft", None),
    ("ADR-008", 1): ("signed", "superseded"),
    ("ADR-009", 1): ("signed", "in_force"),
    ("ADR-010", 1): ("signed", "in_force"),
    ("ADR-011", 1): ("signed", "in_force"),
    ("ADR-012", 1): ("signed", "revoked"),
    ("ADR-013", 1): ("signed", "in_force"),
    ("ADR-014", 1): ("signed", "expired"),
    ("ADR-015", 1): ("signed", "scheduled"),
    ("ADR-016", 1): ("signed", "in_force"),
}


async def _seed(db, today: date = SEEDED_ON) -> ds.Register:
    await seed_metamodel(db)
    await seed_demo_data(db, today=today)
    return await ds.load_register(db, today=today)


async def _decisions(db) -> dict[tuple[str, int], ArchitectureDecision]:
    rows = (await db.execute(select(ArchitectureDecision))).scalars().all()
    return {(r.reference_number, r.revision_number): r for r in rows}


def _key(register: ds.Register, decision_id) -> tuple[str, int]:
    row = register.row(decision_id)
    return (row.reference_number, row.revision_number)


@pytest.mark.parametrize("today", [SEEDED_ON, date(2031, 6, 30)])
async def test_every_standing_is_on_the_seeded_register(db, today):
    register = await _seed(db, today)

    seen = {
        _key(register, i): (register.row(i).status, register[i].standing) for i in register.ids()
    }
    assert seen == EXPECTED
    assert {s for _, s in seen.values()} >= {
        ds.SCHEDULED,
        ds.IN_FORCE,
        ds.AMENDED,
        ds.SUPERSEDED,
        ds.REVOKED,
        ds.EXPIRED,
    }


async def test_who_closes_or_amends_each_decision(db):
    register = await _seed(db)
    by_key = {_key(register, i): i for i in register.ids()}

    def ref(key):
        return register[by_key[key]]

    # A revision supersedes the one before it; a replacing decision supersedes its target.
    assert ref(("ADR-002", 1)).superseded_by.id == by_key[("ADR-002", 2)]
    assert ref(("ADR-008", 1)).superseded_by.id == by_key[("ADR-009", 1)]
    assert ref(("ADR-012", 1)).revoked_by.id == by_key[("ADR-013", 1)]
    assert [r.id for r in ref(("ADR-005", 1)).amended_by] == [by_key[("ADR-011", 1)]]
    # The consolidated amendment: ADR-010 is folded into ADR-004 Rev 2, which
    # therefore reads in force with no open amendment.
    assert ref(("ADR-010", 1)).consolidated_into.id == by_key[("ADR-004", 2)]
    assert ref(("ADR-004", 2)).amended_by == ()
    assert ref(("ADR-011", 1)).consolidated_into is None


async def test_two_revisions_share_a_reference_with_one_current(db):
    register = await _seed(db)
    rows = await _decisions(db)
    first, second = rows[("ADR-002", 1)], rows[("ADR-002", 2)]

    assert second.parent_id == first.id
    assert second.change_summary.startswith("Extends the gateway")
    assert first.change_summary is None
    assert [register[r.id].is_current for r in (first, second)] == [False, True]
    assert [register[r.id].is_earlier_revision for r in (first, second)] == [True, False]
    # Every chain has exactly one current revision.
    currents = Counter(
        register.row(i).reference_number for i in register.ids() if register[i].is_current
    )
    assert set(currents.values()) == {1}
    assert len(currents) == len({register.row(i).reference_number for i in register.ids()})


async def test_dates_follow_the_seeding_day(db):
    await _seed(db)
    rows = await _decisions(db)

    scheduled = rows[("ADR-015", 1)]
    assert scheduled.signed_at.date() == date(2026, 11, 3)
    assert scheduled.decided_on == date(2026, 11, 3)
    assert scheduled.effective_from == date(2026, 12, 10)
    expired = rows[("ADR-014", 1)]
    assert expired.valid_until == date(2026, 10, 26)
    assert expired.effective_from == date(2026, 3, 15)
    # A legacy decision gains its signing day as decided / effective date.
    legacy = rows[("ADR-001", 1)]
    assert (legacy.decided_on, legacy.effective_from) == (date(2025, 9, 15), date(2025, 9, 15))
    # A draft gains none.
    draft = rows[("ADR-003", 1)]
    assert (draft.decided_on, draft.effective_from) == (None, None)
    # Every signed decision carries a decided-on day no later than its signing day.
    for key, row in rows.items():
        if row.status == "signed" and row.signed_at is not None:
            assert row.decided_on == row.signed_at.date(), key
            assert row.effective_from >= row.decided_on, key


async def test_the_recorded_decision_has_makers_and_no_signatures(db):
    admin = await create_user(db, role="admin", display_name="Demo Admin")
    await _seed(db)
    rows = await _decisions(db)

    recorded = [r for r in rows.values() if r.recorded_at is not None]
    assert [(r.reference_number, r.revision_number) for r in recorded] == [("ADR-016", 1)]
    row = recorded[0]
    assert (row.status, row.signed_at, row.signatories) == ("signed", None, [])
    assert row.recorded_by == admin.id
    assert row.decided_on == row.effective_from == date(2025, 5, 20)

    people = (
        (
            await db.execute(
                select(ArchitectureDecisionPerson)
                .where(ArchitectureDecisionPerson.architecture_decision_id == row.id)
                .order_by(ArchitectureDecisionPerson.part, ArchitectureDecisionPerson.position)
            )
        )
        .scalars()
        .all()
    )
    assert [(p.part, p.position, p.user_id, p.name) for p in people] == [
        ("decision_maker", 0, None, "Executive Board"),
        ("decision_maker", 1, None, "Chief Financial Officer"),
        ("participant", 0, admin.id, "Demo Admin"),
        ("participant", 1, None, "CTO Office"),
    ]


async def test_people_without_an_admin_are_free_text_only(db):
    await _seed(db)
    people = (await db.execute(select(ArchitectureDecisionPerson))).scalars().all()
    assert {p.user_id for p in people} == {None}
    assert len(people) == sum(1 for *_, name in DEMO_ADR_PEOPLE if name != DEMO_ADMIN_PERSON)


async def test_every_seeded_link_obeys_the_register_rules(db):
    register = await _seed(db)

    links = (await db.execute(select(ArchitectureDecisionLink))).scalars().all()
    assert sorted((lk.source_id, lk.target_id, lk.kind) for lk in links) == sorted(
        [(s, t, ds.RELATES) for s, t in demo_relates_links(DEMO_ADRS + DEMO_ADRS_EXTRA)]
        + [(_id(s), _id(t), kind) for s, t, kind, _ in DEMO_ADR_REGISTER_LINKS]
    )
    assert {lk.kind for lk in links} == set(ds.LINK_KINDS)
    for lk in links:
        source, target = register.row(lk.source_id), register.row(lk.target_id)
        # Saving it would be accepted: known kind, other chain, consolidates
        # only from a revision toward a decision amending its chain.
        assert ds.validate_link_draft(register, lk.source_id, lk.target_id, lk.kind) == [], lk.kind
        assert register.chain(lk.source_id) is not register.chain(lk.target_id)
        # No locked decision points at an unlocked one.
        if source.status == "signed":
            assert target.status == "signed", (source.reference_number, target.reference_number)

    for decision_id in register.ids():
        row = register.row(decision_id)
        assert (
            ds.validate_dates(
                row.decided_on, row.effective_from, row.valid_until, today=SEEDED_ON, at_lock=False
            )
            == []
        )
        if row.status == "signed":
            assert ds.LINK_TARGET_NOT_LOCKED not in ds.validate_lock(register, decision_id)
    # Only the revoked and the replaced decision read as closed chains.
    closed = sorted(
        _key(register, i) for i in register.ids() if ds.chain_closed_by(register, i) is not None
    )
    assert closed == [("ADR-008", 1), ("ADR-012", 1)]


async def test_references_are_unique_per_revision_and_numbering_continues(db):
    await _seed(db)
    rows = (await db.execute(select(ArchitectureDecision))).scalars().all()
    pairs = [(r.reference_number, r.revision_number) for r in rows]
    assert len(pairs) == len(set(pairs)) == len(DEMO_ADRS + DEMO_ADRS_EXTRA + DEMO_ADR_REGISTER)
    assert await next_reference_number(db) == "ADR-017"


def test_register_rows_are_built_from_the_seeding_day():
    rows = {r["id"]: r for r in demo_register_decisions(date(2030, 1, 31))}
    scheduled = rows[_id("adr_as2_edi")]
    assert (scheduled["decided_on"], scheduled["effective_from"]) == (
        date(2030, 1, 24),
        date(2030, 3, 2),
    )
    assert scheduled["signatories"][0]["signed_at"] == "2030-01-24T10:00:00Z"
    assert scheduled["signed_at"].isoformat() == "2030-01-24T10:00:00+00:00"
    assert rows[_id("adr_ws2012_waiver")]["valid_until"] == date(2030, 1, 16)
    assert rows[_id("adr_saas_threshold")]["valid_until"] is None
    # An old decision keeps its fixed day.
    assert rows[_id("adr_onprem_vmware")]["decided_on"] == date(2025, 3, 14)
    revision = rows[_id("adr_zero_trust_r2")]
    assert (revision["parent_id"], revision["revision_number"]) == (_id("adr_zero_trust"), 2)
    assert rows[_id("adr_edge_hci")]["parent_id"] is None
    assert rows[_id("adr_edge_hci")]["revision_number"] == 1


def test_lock_dates_fill_only_a_signed_decision_without_them():
    from datetime import datetime, timezone

    signed_at = datetime(2025, 9, 15, 23, 30, tzinfo=timezone.utc)
    assert with_lock_dates({"status": "signed", "signed_at": signed_at}) == {
        "status": "signed",
        "signed_at": signed_at,
        "decided_on": date(2025, 9, 15),
        "effective_from": date(2025, 9, 15),
    }
    kept = {
        "status": "signed",
        "signed_at": signed_at,
        "decided_on": date(2025, 9, 1),
        "effective_from": date(2025, 10, 1),
    }
    assert with_lock_dates(kept) == kept
    assert with_lock_dates({"status": "in_review", "signed_at": signed_at}) == {
        "status": "in_review",
        "signed_at": signed_at,
    }
    assert with_lock_dates({"status": "signed", "signed_at": None}) == {
        "status": "signed",
        "signed_at": None,
    }


def test_admin_placeholder_becomes_the_admin_or_is_dropped():
    class Admin:
        id = _id("adr_test_admin")
        display_name = "Ada Admin"

    with_admin = demo_adr_people(Admin())
    without = demo_adr_people(None)
    placeholders = sum(1 for *_, name in DEMO_ADR_PEOPLE if name == DEMO_ADMIN_PERSON)
    assert placeholders > 0
    assert len(with_admin) == len(without) + placeholders == len(DEMO_ADR_PEOPLE)
    assert ("adr_azure_primary", "participant", (Admin.id, "Ada Admin")) in with_admin
    assert ("adr_azure_primary", "participant", (None, "CTO Office")) in without
    assert all(user_id is None for *_, (user_id, _) in without)
