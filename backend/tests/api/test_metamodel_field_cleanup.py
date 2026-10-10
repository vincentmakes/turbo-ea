"""``_cleanup_removed_fields_and_options``: what a fields_schema edit does to
the values cards already hold.

Called directly, the way ``PATCH /metamodel/types/{key}`` calls it, so every
branch is visible: a removed field, a removed single- or multiple-select
option, an extension-owned field, and the fields the cleanup must leave alone.
"""

from __future__ import annotations

import logging

import pytest

from app.api.v1.metamodel import _cleanup_removed_fields_and_options as cleanup
from tests.conftest import create_card, create_card_type

LOGGER = "turboea.metamodel"


def _schema(*fields):
    return [{"section": "Main", "fields": list(fields)}]


def _select(key, *options, multiple=False, **extra):
    return {
        "key": key,
        "type": "multiple_select" if multiple else "single_select",
        "options": [{"key": o, "label": o} for o in options],
        **extra,
    }


@pytest.fixture
async def types(db):
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="ITComponent", label="IT Component")


async def _attrs(db, card):
    await db.refresh(card)
    return card.attributes


class TestRemovedField:
    async def test_the_key_goes_from_every_card_of_the_type(self, db, types, caplog):
        a = await create_card(db, name="A", attributes={"cost": 1, "keep": "x"})
        b = await create_card(db, name="B", attributes={"cost": 2})
        bare = await create_card(db, name="Bare", attributes={"keep": "y"})
        other = await create_card(db, card_type="ITComponent", name="I", attributes={"cost": 3})
        caplog.set_level(logging.INFO, logger=LOGGER)

        await cleanup(
            db,
            "Application",
            _schema({"key": "cost", "type": "number"}, {"key": "keep", "type": "text"}),
            _schema({"key": "keep", "type": "text"}),
        )

        assert await _attrs(db, a) == {"keep": "x"}
        assert await _attrs(db, b) == {}
        assert await _attrs(db, bare) == {"keep": "y"}
        assert await _attrs(db, other) == {"cost": 3}  # another type keeps it
        assert [r.getMessage() for r in caplog.records if r.name == LOGGER] == [
            "Cleaned up removed field 'cost' from 2 card(s) of type 'Application'"
        ]

    async def test_nothing_is_logged_when_no_card_held_it(self, db, types, caplog):
        await create_card(db, name="A", attributes={"keep": "x"})
        caplog.set_level(logging.INFO, logger=LOGGER)
        await cleanup(db, "Application", _schema({"key": "cost", "type": "number"}), _schema())
        assert [r for r in caplog.records if r.name == LOGGER] == []

    async def test_an_extension_field_keeps_its_values(self, db, types, caplog):
        card = await create_card(db, name="A", attributes={"esgRating": 4})
        caplog.set_level(logging.INFO, logger=LOGGER)
        await cleanup(
            db,
            "Application",
            _schema({"key": "esgRating", "type": "number", "ext": "esg-pack"}),
            _schema(),
        )
        assert await _attrs(db, card) == {"esgRating": 4}
        assert [r.getMessage() for r in caplog.records if r.name == LOGGER] == [
            "Skipping data cleanup for extension-owned field 'esgRating' on type "
            "'Application' (values preserved for re-enable)"
        ]

    async def test_an_extension_field_does_not_stop_the_next_one(self, db, types):
        card = await create_card(db, name="A", attributes={"esgRating": 4, "cost": 1})
        await cleanup(
            db,
            "Application",
            _schema(
                {"key": "esgRating", "type": "number", "ext": "esg-pack"},
                {"key": "cost", "type": "number"},
            ),
            _schema(),
        )
        assert await _attrs(db, card) == {"esgRating": 4}

    async def test_a_field_in_another_section_is_not_removed(self, db, types):
        card = await create_card(db, name="A", attributes={"cost": 1})
        old = [
            {"section": "Main", "fields": [{"key": "cost", "type": "number"}]},
        ]
        moved = [
            {"section": "Main", "fields": []},
            {"section": "Finance", "fields": [{"key": "cost", "type": "number"}]},
        ]
        await cleanup(db, "Application", old, moved)
        assert await _attrs(db, card) == {"cost": 1}


class TestRemovedSingleSelectOption:
    async def test_only_cards_holding_the_option_lose_the_value(self, db, types, caplog):
        low = await create_card(db, name="Low", attributes={"risk": "low", "keep": 1})
        high = await create_card(db, name="High", attributes={"risk": "high"})
        other = await create_card(db, card_type="ITComponent", name="I", attributes={"risk": "low"})
        caplog.set_level(logging.INFO, logger=LOGGER)

        await cleanup(
            db,
            "Application",
            _schema(_select("risk", "low", "high")),
            _schema(_select("risk", "high")),
        )

        assert await _attrs(db, low) == {"keep": 1}
        assert await _attrs(db, high) == {"risk": "high"}
        assert await _attrs(db, other) == {"risk": "low"}
        assert [r.getMessage() for r in caplog.records if r.name == LOGGER] == [
            "Cleaned up removed option 'low' from field 'risk' on 1 card(s) of type 'Application'"
        ]

    async def test_a_field_without_options_left_loses_every_value(self, db, types):
        card = await create_card(db, name="A", attributes={"risk": "high"})
        no_options = {"key": "risk", "type": "single_select"}
        await cleanup(db, "Application", _schema(_select("risk", "high")), _schema(no_options))
        assert await _attrs(db, card) == {}


class TestRemovedMultipleSelectOption:
    async def test_the_option_is_filtered_out_of_each_array(self, db, types, caplog):
        both = await create_card(db, name="Both", attributes={"tags": ["a", "b"]})
        only = await create_card(db, name="Only", attributes={"tags": ["a"]})
        rest = await create_card(db, name="Rest", attributes={"tags": ["b"]})
        other = await create_card(db, card_type="ITComponent", name="I", attributes={"tags": ["a"]})
        caplog.set_level(logging.INFO, logger=LOGGER)

        await cleanup(
            db,
            "Application",
            _schema(_select("tags", "a", "b", multiple=True)),
            _schema(_select("tags", "b", multiple=True)),
        )

        assert await _attrs(db, both) == {"tags": ["b"]}
        assert await _attrs(db, only) == {"tags": []}
        assert await _attrs(db, rest) == {"tags": ["b"]}
        assert await _attrs(db, other) == {"tags": ["a"]}
        assert [r.getMessage() for r in caplog.records if r.name == LOGGER] == [
            "Cleaned up removed option 'a' from field 'tags' on 2 card(s) of type 'Application'"
        ]

    async def test_two_removed_options_go_together(self, db, types):
        card = await create_card(db, name="A", attributes={"tags": ["a", "b", "c"]})
        await cleanup(
            db,
            "Application",
            _schema(_select("tags", "a", "b", "c", multiple=True)),
            _schema(_select("tags", "c", multiple=True)),
        )
        assert await _attrs(db, card) == {"tags": ["c"]}


class TestFieldsLeftAlone:
    """Each skip must move on to the next field, never stop the walk."""

    async def test_a_new_field_is_skipped(self, db, types):
        card = await create_card(db, name="A", attributes={"risk": "low"})
        await cleanup(
            db,
            "Application",
            _schema(_select("risk", "low", "high")),
            _schema(_select("fresh", "x"), _select("risk", "high")),
        )
        assert await _attrs(db, card) == {}

    async def test_a_field_that_is_not_a_select_is_skipped(self, db, types):
        card = await create_card(db, name="A", attributes={"note": "low", "risk": "low"})
        note = {"key": "note", "type": "text", "options": [{"key": "low"}]}
        await cleanup(
            db,
            "Application",
            _schema(note, _select("risk", "low", "high")),
            _schema({"key": "note", "type": "text", "options": []}, _select("risk", "high")),
        )
        assert await _attrs(db, card) == {"note": "low"}

    async def test_a_field_without_a_type_is_text(self, db, types):
        card = await create_card(db, name="A", attributes={"note": "low"})
        untyped = {"key": "note", "options": [{"key": "low"}]}
        await cleanup(db, "Application", _schema(untyped), _schema({"key": "note", "options": []}))
        assert await _attrs(db, card) == {"note": "low"}

    async def test_a_select_with_its_options_intact_is_skipped(self, db, types):
        card = await create_card(db, name="A", attributes={"keep": "x", "risk": "low"})
        await cleanup(
            db,
            "Application",
            _schema(_select("keep", "x"), _select("risk", "low", "high")),
            _schema(_select("keep", "x"), _select("risk", "high")),
        )
        assert await _attrs(db, card) == {"keep": "x"}

    async def test_a_section_without_fields_is_read_as_empty(self, db, types):
        card = await create_card(db, name="A", attributes={"cost": 1})
        await cleanup(
            db,
            "Application",
            [{"section": "Empty"}, *_schema({"key": "cost", "type": "number"})],
            [{"section": "Empty"}],
        )
        assert await _attrs(db, card) == {}
