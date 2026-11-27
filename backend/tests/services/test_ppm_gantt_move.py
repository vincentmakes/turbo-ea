"""Unit tests for placing a dragged Gantt row among its siblings (no database)."""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.models.ppm_task import PpmTask
from app.models.ppm_wbs import PpmWbs
from app.services.ppm_gantt_move import (
    _check_new_parent,
    parse_uuid,
    place_in_order,
    wbs_of_initiative,
)


def _rows(*titles: str) -> list[PpmTask]:
    return [PpmTask(id=uuid.uuid4(), title=t, sort_order=0) for t in titles]


def _titles(rows: list[PpmTask]) -> list[str]:
    return [r.title for r in rows]


class TestPlaceInOrder:
    def test_inserts_a_newcomer_at_the_position(self):
        siblings = _rows("A", "B", "C")
        [new] = _rows("New")
        ordered = place_in_order(siblings, new, 1)
        assert _titles(ordered) == ["A", "New", "B", "C"]

    def test_renumbers_every_row_from_zero(self):
        siblings = _rows("A", "B")
        [new] = _rows("New")
        ordered = place_in_order(siblings, new, 0)
        assert [r.sort_order for r in ordered] == [0, 1, 2]
        assert new.sort_order == 0
        assert siblings[1].sort_order == 2

    def test_takes_the_item_out_of_its_old_place_first(self):
        a, b, c = _rows("A", "B", "C")
        ordered = place_in_order([a, b, c], a, 2)
        assert _titles(ordered) == ["B", "C", "A"]
        assert [a.sort_order, b.sort_order, c.sort_order] == [2, 0, 1]

    def test_moves_up(self):
        a, b, c = _rows("A", "B", "C")
        assert _titles(place_in_order([a, b, c], c, 0)) == ["C", "A", "B"]

    def test_a_position_past_the_end_appends(self):
        a, b = _rows("A", "B")
        ordered = place_in_order([a, b], a, 5)
        assert _titles(ordered) == ["B", "A"]
        assert a.sort_order == 1

    def test_the_last_position_is_the_end(self):
        a, b, c = _rows("A", "B", "C")
        assert _titles(place_in_order([a, b, c], a, 2)) == ["B", "C", "A"]

    def test_into_an_empty_group(self):
        [new] = _rows("New")
        new.sort_order = 4
        assert _titles(place_in_order([], new, 3)) == ["New"]
        assert new.sort_order == 0


class TestParseUuid:
    def test_a_uuid_is_returned_as_is(self):
        value = uuid.uuid4()
        assert parse_uuid(value) is value

    def test_a_uuid_string_is_parsed(self):
        value = uuid.uuid4()
        assert parse_uuid(str(value)) == value
        assert parse_uuid(str(value).upper()) == value

    @pytest.mark.parametrize("value", ["", "not-a-uuid", "1234"])
    def test_anything_else_is_none(self, value):
        assert parse_uuid(value) is None


class _FakeSession:
    """``db.get`` over a dict, recording what was asked for."""

    def __init__(self, rows):
        self.rows = rows
        self.asked: list = []

    async def get(self, model, ident):
        self.asked.append((model, ident))
        return self.rows.get(ident)


class TestWbsOfInitiative:
    INIT = uuid.UUID("00000000-0000-0000-0000-00000000a001")
    OTHER = uuid.UUID("00000000-0000-0000-0000-00000000a002")
    WBS = uuid.UUID("00000000-0000-0000-0000-00000000b001")

    def _db(self, initiative_id):
        return _FakeSession({self.WBS: PpmWbs(id=self.WBS, initiative_id=initiative_id)})

    async def test_returns_the_work_package_of_this_initiative(self):
        db = self._db(self.INIT)
        found = await wbs_of_initiative(db, str(self.INIT), str(self.WBS), detail="nope")
        assert found.id == self.WBS
        assert db.asked == [(PpmWbs, self.WBS)]

    async def test_another_initiatives_work_package_is_400(self):
        with pytest.raises(HTTPException) as exc:
            await wbs_of_initiative(self._db(self.OTHER), self.INIT, self.WBS, detail="nope")
        assert (exc.value.status_code, exc.value.detail) == (400, "nope")

    async def test_an_unknown_work_package_is_400(self):
        with pytest.raises(HTTPException) as exc:
            await wbs_of_initiative(self._db(self.INIT), self.INIT, uuid.uuid4(), detail="gone")
        assert (exc.value.status_code, exc.value.detail) == (400, "gone")

    async def test_a_malformed_id_is_400_without_a_lookup(self):
        db = self._db(self.INIT)
        with pytest.raises(HTTPException) as exc:
            await wbs_of_initiative(db, self.INIT, "not-a-uuid", detail="bad")
        assert (exc.value.status_code, exc.value.detail) == (400, "bad")
        assert db.asked == []


class TestCheckNewParent:
    INIT = uuid.UUID("00000000-0000-0000-0000-00000000a001")
    OTHER = uuid.UUID("00000000-0000-0000-0000-00000000a002")
    WBS = uuid.UUID("00000000-0000-0000-0000-00000000b001")
    NOT_FOUND = "Parent WBS item not found in this initiative"

    def _db(self, initiative_id, *, is_milestone=False):
        row = PpmWbs(id=self.WBS, initiative_id=initiative_id, is_milestone=is_milestone)
        return _FakeSession({self.WBS: row})

    async def test_an_unknown_parent_is_400_with_its_message(self):
        with pytest.raises(HTTPException) as exc:
            await _check_new_parent(self._db(self.INIT), self.INIT, uuid.uuid4())
        assert (exc.value.status_code, exc.value.detail) == (400, self.NOT_FOUND)

    async def test_another_initiatives_parent_is_400_with_its_message(self):
        with pytest.raises(HTTPException) as exc:
            await _check_new_parent(self._db(self.OTHER), self.INIT, self.WBS)
        assert (exc.value.status_code, exc.value.detail) == (400, self.NOT_FOUND)

    async def test_a_milestone_parent_is_400(self):
        with pytest.raises(HTTPException) as exc:
            await _check_new_parent(self._db(self.INIT, is_milestone=True), self.INIT, self.WBS)
        assert (exc.value.status_code, exc.value.detail) == (
            400,
            "A milestone cannot contain items",
        )

    async def test_a_work_package_of_this_initiative_is_accepted(self):
        db = self._db(self.INIT)
        assert await _check_new_parent(db, self.INIT, self.WBS) is None
        assert db.asked == [(PpmWbs, self.WBS)]
