"""Decision makers and participants (``app/services/decision_people_service.py``)."""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import event as sa_event
from sqlalchemy import select

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_person import ArchitectureDecisionPerson
from app.services import decision_people_service as svc
from tests.conftest import create_user


async def _decision(db, ref: str = "ADR-001") -> ArchitectureDecision:
    adr = ArchitectureDecision(reference_number=ref, title=f"Decision {ref}")
    db.add(adr)
    await db.flush()
    return adr


async def _rows(db, decision_id) -> list[tuple]:
    rows = await db.execute(
        select(
            ArchitectureDecisionPerson.id,
            ArchitectureDecisionPerson.part,
            ArchitectureDecisionPerson.user_id,
            ArchitectureDecisionPerson.name,
            ArchitectureDecisionPerson.position,
        )
        .where(ArchitectureDecisionPerson.architecture_decision_id == decision_id)
        .order_by(ArchitectureDecisionPerson.part, ArchitectureDecisionPerson.position)
    )
    return [tuple(r) for r in rows.all()]


class TestPlanPeople:
    def test_users_take_their_display_name_and_text_is_trimmed(self):
        uid = uuid.UUID(int=1)
        rows = svc.plan_people(
            [{"user_id": str(uid)}, {"name": "  Ada Lovelace "}], {uid: "Grace Hopper"}
        )
        assert rows == [(uid, "Grace Hopper"), (None, "Ada Lovelace")]

    def test_duplicates_collapse_at_their_first_place(self):
        uid = uuid.UUID(int=1)
        rows = svc.plan_people(
            [
                {"name": "Board"},
                {"user_id": str(uid)},
                {"name": " board "},
                {"user_id": str(uid)},
                {"name": "Committee"},
            ],
            {uid: "Grace"},
        )
        assert rows == [(None, "Board"), (uid, "Grace"), (None, "Committee")]

    def test_a_blank_name_is_a_400(self):
        with pytest.raises(HTTPException) as err:
            svc.plan_people([{"name": "   "}], {})
        assert err.value.status_code == 400
        assert err.value.detail == "A person needs a user or a name"

    def test_a_name_of_exactly_the_limit_passes_and_one_more_is_a_400(self):
        assert svc.plan_people([{"name": "x" * 255}], {}) == [(None, "x" * 255)]
        with pytest.raises(HTTPException) as err:
            svc.plan_people([{"name": "x" * 256}], {})
        assert err.value.status_code == 400
        assert err.value.detail == "A person's name is longer than 255 characters"

    def test_reads_attribute_style_entries(self):
        class Entry:
            user_id = None
            name = "From a model"

        assert svc.plan_people([Entry()], {}) == [(None, "From a model")]


class TestReplacePeople:
    async def test_round_trip_keeps_order_and_parts(self, db):
        grace = await create_user(db, email="grace@test.com", role="admin")
        adr = await _decision(db)

        await svc.replace_people(
            db,
            adr,
            decision_makers=[{"user_id": str(grace.id)}, {"name": "Architecture Board"}],
            participants=[{"name": "Ops"}],
        )

        rows = await _rows(db, adr.id)
        assert [(p, u, n, pos) for _, p, u, n, pos in rows] == [
            ("decision_maker", grace.id, grace.display_name, 0),
            ("decision_maker", None, "Architecture Board", 1),
            ("participant", None, "Ops", 0),
        ]
        payload = await svc.people_payload(db, [adr.id])
        assert payload == {
            adr.id: {
                "decision_makers": [
                    {"user_id": str(grace.id), "display_name": grace.display_name},
                    {"user_id": None, "display_name": "Architecture Board"},
                ],
                "participants": [{"user_id": None, "display_name": "Ops"}],
            }
        }

    async def test_none_leaves_a_part_alone_and_rows_are_reused(self, db):
        adr = await _decision(db)
        await svc.replace_people(
            db, adr, decision_makers=[{"name": "A"}, {"name": "B"}], participants=[{"name": "P"}]
        )
        before = {(p, n): pid for pid, p, _, n, _ in await _rows(db, adr.id)}

        await svc.replace_people(db, adr, decision_makers=[{"name": "C"}])

        rows = await _rows(db, adr.id)
        assert [(p, n, pos) for _, p, _, n, pos in rows] == [
            ("decision_maker", "C", 0),
            ("participant", "P", 0),
        ]
        # The first decision-maker row was reused in place, the second deleted.
        assert rows[0][0] == before[("decision_maker", "A")]
        assert rows[1][0] == before[("participant", "P")]

    async def test_an_empty_list_clears_a_part(self, db):
        adr = await _decision(db)
        await svc.replace_people(db, adr, participants=[{"name": "P"}])
        await svc.replace_people(db, adr, participants=[])
        assert await _rows(db, adr.id) == []

    async def test_nothing_given_changes_nothing(self, db):
        adr = await _decision(db)
        await svc.replace_people(db, adr, participants=[{"name": "P"}])
        await svc.replace_people(db, adr)
        assert [n for _, _, _, n, _ in await _rows(db, adr.id)] == ["P"]

    async def test_an_unknown_user_is_a_404_and_writes_nothing(self, db):
        adr = await _decision(db)
        ghost = uuid.uuid4()
        with pytest.raises(HTTPException) as err:
            await svc.replace_people(db, adr, participants=[{"user_id": str(ghost)}])
        assert err.value.status_code == 404
        assert err.value.detail == f"User not found: {ghost}"
        assert await _rows(db, adr.id) == []

    async def test_a_malformed_user_id_is_a_400(self, db):
        adr = await _decision(db)
        with pytest.raises(HTTPException) as err:
            await svc.replace_people(db, adr, decision_makers=[{"user_id": "nope"}])
        assert err.value.status_code == 400
        assert err.value.detail == "Invalid user id: 'nope'"


class TestPeoplePayload:
    async def test_every_decision_gets_an_entry_in_one_query(self, db):
        first = await _decision(db, "ADR-001")
        second = await _decision(db, "ADR-002")
        third = await _decision(db, "ADR-003")
        await svc.replace_people(db, first, decision_makers=[{"name": "One"}])
        await svc.replace_people(db, second, participants=[{"name": "Two"}])

        statements: list[str] = []
        bind = db.sync_session.get_bind()

        def _record(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        sa_event.listen(bind, "before_cursor_execute", _record)
        try:
            payload = await svc.people_payload(db, [first.id, second.id, third.id, first.id])
        finally:
            sa_event.remove(bind, "before_cursor_execute", _record)

        assert len(statements) == 1
        assert payload == {
            first.id: {
                "decision_makers": [{"user_id": None, "display_name": "One"}],
                "participants": [],
            },
            second.id: {
                "decision_makers": [],
                "participants": [{"user_id": None, "display_name": "Two"}],
            },
            third.id: {"decision_makers": [], "participants": []},
        }

    async def test_no_ids_runs_no_query(self, db):
        assert await svc.people_payload(db, []) == {}

    async def test_an_unknown_part_is_left_out(self, db):
        adr = await _decision(db)
        db.add(ArchitectureDecisionPerson(architecture_decision_id=adr.id, part="x", name="Z"))
        await db.flush()
        assert await svc.people_payload(db, [adr.id]) == {
            adr.id: {"decision_makers": [], "participants": []}
        }


class TestCopyPeople:
    async def test_copies_every_person_with_part_and_position(self, db):
        grace = await create_user(db, email="grace@test.com", role="admin")
        src = await _decision(db, "ADR-001")
        new = await _decision(db, "ADR-002")
        await svc.replace_people(
            db,
            src,
            decision_makers=[{"name": "Board"}, {"user_id": str(grace.id)}],
            participants=[{"name": "Ops"}],
        )

        assert await svc.copy_people(db, src.id, new.id) == 3

        assert [(p, u, n, pos) for _, p, u, n, pos in await _rows(db, new.id)] == [
            ("decision_maker", None, "Board", 0),
            ("decision_maker", grace.id, grace.display_name, 1),
            ("participant", None, "Ops", 0),
        ]
        assert len(await _rows(db, src.id)) == 3
