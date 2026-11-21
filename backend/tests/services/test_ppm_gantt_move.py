"""Unit tests for placing a dragged Gantt row among its siblings (no database)."""

from __future__ import annotations

import uuid

from app.models.ppm_task import PpmTask
from app.services.ppm_gantt_move import place_in_order


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
