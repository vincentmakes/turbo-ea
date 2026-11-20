"""A card-type save cannot drop or unstamp what an extension contributed.

`PATCH /metamodel/types/{key}` replaces `fields_schema` with the body. A body
that left out an extension's section (a stale editor copy, an API client) used
to delete it, its fields with it, and nothing re-applied the contribution
afterwards. The route now puts every contributed section and field back where
it was, keeps their `ext` stamps, and re-addresses a `__order` the same body
sends; admin sections and fields stay exactly as sent.
"""

from __future__ import annotations

import copy

import pytest
from sqlalchemy import select

from app.api.v1.metamodel import (
    _match_contributed_sections,
    _order_with_restored_sections,
    _preserve_ext_contributions,
    _readdress_body_order,
    _restore_missing_fields,
)
from app.models.card_type import CardType
from app.services.extensions.registry import extension_registry
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)

EXT = "sample-ext"
OTHER = "other-ext"

DESCRIPTION = {"section": "__description", "fields": []}
CORE = {"section": "Core", "fields": [{"key": "hosting", "label": "Hosting", "type": "text"}]}
CONTRIBUTED = {
    "section": "Sample",
    "ext": EXT,
    "columns": 1,
    "fields": [
        {"key": "s1", "label": "S1", "type": "number", "ext": EXT},
        {"key": "s2", "label": "S2", "type": "text", "ext": EXT},
        {"key": "s3", "label": "S3", "type": "boolean", "ext": EXT},
    ],
}
OTHER_SECTION = {
    "section": "Other",
    "ext": OTHER,
    "fields": [{"key": "o1", "label": "O1", "type": "text", "ext": OTHER}],
}
NOTES = {"section": "Notes", "fields": [{"key": "note", "label": "Note", "type": "text"}]}

# custom:0 Core, custom:1 Sample, custom:2 Other, custom:3 Notes
STORED_ORDER = ["description", "custom:3", "custom:0", "custom:1", "relations", "custom:2"]


def stored_schema() -> list:
    return copy.deepcopy([DESCRIPTION, CORE, CONTRIBUTED, OTHER_SECTION, NOTES])


@pytest.fixture
async def admin(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    return await create_user(db, email="admin@test.com", role="admin")


@pytest.fixture(autouse=True)
def _clear_registry():
    extension_registry.clear()
    yield
    extension_registry.clear()


@pytest.fixture
async def gadget(db):
    return await create_card_type(
        db,
        key="Gadget",
        label="Gadget",
        fields_schema=stored_schema(),
        section_config={"__order": list(STORED_ORDER), "custom:1": {"defaultExpanded": False}},
    )


async def _patch(client, admin, body: dict):
    resp = await client.patch(
        "/api/v1/metamodel/types/Gadget", headers=auth_headers(admin), json=body
    )
    assert resp.status_code == 200, resp.text
    return resp


async def _stored(db) -> CardType:
    ct = (await db.execute(select(CardType).where(CardType.key == "Gadget"))).scalar_one()
    await db.refresh(ct)
    return ct


def _without(schema: list, name: str) -> list:
    return [s for s in schema if s.get("section") != name]


class TestUpdateTypeKeepsContributions:
    async def test_a_body_without_the_contributed_section_changes_nothing(
        self, client, db, admin, gadget
    ):
        card = await create_card(db, card_type="Gadget", name="G1", attributes={"s2": "kept"})
        await _patch(client, admin, {"fields_schema": _without(stored_schema(), "Sample")})
        ct = await _stored(db)
        assert ct.fields_schema == stored_schema()
        assert ct.section_config == {
            "__order": STORED_ORDER,
            "custom:1": {"defaultExpanded": False},
        }
        # The cleanup of removed fields never saw the contributed ones go.
        await db.refresh(card)
        assert card.attributes == {"s2": "kept"}

    async def test_a_dropped_contributed_field_comes_back_in_place(self, client, db, admin, gadget):
        body = stored_schema()
        del body[2]["fields"][1]
        await _patch(client, admin, {"fields_schema": body})
        assert (await _stored(db)).fields_schema == stored_schema()

    async def test_dropped_stamps_are_put_back(self, client, db, admin, gadget):
        body = stored_schema()
        body[2].pop("ext")
        for f in body[2]["fields"]:
            f.pop("ext")
        body[3].pop("ext")
        await _patch(client, admin, {"fields_schema": body})
        assert (await _stored(db)).fields_schema == stored_schema()

    async def test_an_admin_field_added_inside_the_contributed_section_stays(
        self, client, db, admin, gadget
    ):
        body = stored_schema()
        body[2]["fields"].insert(1, {"key": "mine", "label": "Mine", "type": "text"})
        await _patch(client, admin, {"fields_schema": body})
        sample = (await _stored(db)).fields_schema[2]
        assert sample == {
            **CONTRIBUTED,
            "fields": [
                CONTRIBUTED["fields"][0],
                {"key": "mine", "label": "Mine", "type": "text"},
                CONTRIBUTED["fields"][1],
                CONTRIBUTED["fields"][2],
            ],
        }

    async def test_a_body_cannot_mint_a_stamp(self, client, db, admin, gadget):
        body = stored_schema()
        body[1]["ext"] = EXT
        body[1]["fields"][0]["ext"] = EXT
        body[4]["ext"] = OTHER
        await _patch(client, admin, {"fields_schema": body})
        assert (await _stored(db)).fields_schema == stored_schema()

    async def test_an_admin_section_can_still_be_deleted(self, client, db, admin, gadget):
        await _patch(client, admin, {"fields_schema": _without(stored_schema(), "Notes")})
        assert (await _stored(db)).fields_schema == _without(stored_schema(), "Notes")

    async def test_two_extensions_are_restored_independently(self, client, db, admin, gadget):
        body = _without(_without(stored_schema(), "Sample"), "Other")
        await _patch(client, admin, {"fields_schema": body})
        assert (await _stored(db)).fields_schema == stored_schema()

        body = _without(stored_schema(), "Other")
        del body[2]["fields"][0]
        await _patch(client, admin, {"fields_schema": body})
        assert (await _stored(db)).fields_schema == stored_schema()

    async def test_a_stale_delete_keeps_its_order_pointing_at_the_same_sections(
        self, client, db, admin, gadget
    ):
        # The editor's copy predates the contributed section: customs Core 0,
        # Other 1, Notes 2. Deleting Notes there drops custom:2 from its order.
        body = [copy.deepcopy(DESCRIPTION), copy.deepcopy(CORE), copy.deepcopy(OTHER_SECTION)]
        order = ["description", "custom:0", "relations", "custom:1"]
        await _patch(
            client,
            admin,
            {"fields_schema": body, "section_config": {"__order": order, "tags": {"x": 1}}},
        )
        ct = await _stored(db)
        assert ct.fields_schema == [DESCRIPTION, CORE, CONTRIBUTED, OTHER_SECTION]
        # Core is custom:0, Sample custom:1 (back at its stored order slot),
        # Other custom:2.
        assert ct.section_config == {
            "__order": ["description", "custom:0", "relations", "custom:1", "custom:2"],
            "tags": {"x": 1},
        }


class TestCreateTypeCannotStamp:
    async def test_stamps_in_a_create_body_are_dropped(self, client, db, admin):
        resp = await client.post(
            "/api/v1/metamodel/types",
            headers=auth_headers(admin),
            json={
                "key": "Widget",
                "label": "Widget",
                "fields_schema": [
                    {
                        "section": "Claimed",
                        "ext": EXT,
                        "fields": [{"key": "c", "label": "C", "type": "text", "ext": EXT}],
                    }
                ],
            },
        )
        assert resp.status_code == 201
        ct = (await db.execute(select(CardType).where(CardType.key == "Widget"))).scalar_one()
        assert ct.fields_schema == [
            {"section": "Claimed", "fields": [{"key": "c", "label": "C", "type": "text"}]}
        ]


class TestPreserveHelpers:
    """The pure helpers behind the route, on the shapes the route never sends."""

    def test_old_schema_is_never_mutated_and_junk_passes(self):
        old = ["junk", *stored_schema()]
        before = copy.deepcopy(old)
        schema, inserted = _preserve_ext_contributions(["junk", {"section": "Core"}], old)
        assert old == before
        assert schema == [
            "junk",
            {"section": "Core"},
            CONTRIBUTED,
            OTHER_SECTION,
        ]
        # junk counts as a custom section (positional), __description does not.
        assert inserted == [(2, 2), (3, 3)]

    def test_none_schemas(self):
        assert _preserve_ext_contributions(None, None) == ([], [])

    def test_a_restored_section_leaves_out_fields_the_body_has_elsewhere(self):
        old = stored_schema()
        body = _without(stored_schema(), "Sample")
        body[1]["fields"].append({"key": "s2", "label": "S2", "type": "text"})
        schema, inserted = _preserve_ext_contributions(body, old)
        assert schema[1]["fields"][-1] == {"key": "s2", "label": "S2", "type": "text", "ext": EXT}
        assert schema[2] == {
            **CONTRIBUTED,
            "fields": [CONTRIBUTED["fields"][0], CONTRIBUTED["fields"][2]],
        }
        assert inserted == [(1, 1)]

    def test_a_renamed_section_keeps_its_stamp(self):
        body = stored_schema()
        body[2]["section"] = "Renamed"
        body[2].pop("ext")
        schema, inserted = _preserve_ext_contributions(body, stored_schema())
        assert schema[2] == {**CONTRIBUTED, "section": "Renamed"}
        assert inserted == []

    def test_an_admin_section_holding_a_moved_field_is_not_taken_for_it(self):
        old = stored_schema()
        body = _without(stored_schema(), "Sample")
        body[3]["fields"].append(copy.deepcopy(CONTRIBUTED["fields"][0]))  # into Notes
        schema, _ = _preserve_ext_contributions(body, old)
        assert "ext" not in schema[4]
        assert schema[4]["section"] == "Notes"
        assert schema[2] == {**CONTRIBUTED, "fields": CONTRIBUTED["fields"][1:]}

    def test_section_matching_pairs_by_name_then_by_fields(self):
        stored = stored_schema()
        contributing = [stored[2], stored[3]]
        body = [{"section": "Elsewhere", "fields": [{"key": "o1"}]}, {"section": "Sample"}]
        paired = _match_contributed_sections(["junk", *body], contributing, ["junk", *stored])
        # "Sample" without its stamp does not match by name; it holds no field.
        assert paired == {id(stored[3]): body[0]}

    def test_section_matching_takes_a_body_section_once(self):
        a = {"section": "A", "ext": EXT, "fields": [{"key": "x", "ext": EXT}]}
        b = {"section": "B", "ext": EXT, "fields": [{"key": "y", "ext": EXT}]}
        body = [{"section": "A", "ext": EXT, "fields": [{"key": "x"}, {"key": "y"}]}]
        assert _match_contributed_sections(body, [a, b], [a, b]) == {id(a): body[0]}

    def test_a_restored_field_follows_its_stored_neighbours(self):
        stored = {
            "section": "S",
            "fields": [
                {"key": "a", "ext": EXT},
                {"key": "m"},
                {"key": "b", "ext": EXT},
                {"key": "c", "ext": EXT},
                "junk",
            ],
        }
        target = {"section": "S", "fields": [{"key": "m"}, {"key": "c"}, {"key": "z"}]}
        _restore_missing_fields(target, stored, {"m", "c", "z"})
        # a has no earlier neighbour: before m; b after m.
        assert [f["key"] for f in target["fields"]] == ["a", "m", "b", "c", "z"]

    def test_a_restored_field_without_neighbours_goes_last(self):
        stored = {"section": "S", "fields": [{"key": "a", "ext": EXT}, {"key": "b"}]}
        target = {"section": "S"}
        present = {"other"}
        _restore_missing_fields(target, stored, present)
        assert target == {"section": "S", "fields": [{"key": "a", "ext": EXT}]}
        assert present == {"other", "a"}
        target = {"section": "S", "fields": [{"key": "q"}]}
        _restore_missing_fields(target, stored, set())
        assert target["fields"] == [{"key": "q"}, {"key": "a", "ext": EXT}]

    def test_order_remap(self):
        stored_order = ["custom:1", "relations", "custom:0", "custom:3"]
        # Body customs 0,1,2 → final 0,2,4; restored final 1 (stored 3), 3 (stored 9).
        out = _order_with_restored_sections(
            ["custom:2", "custom:0", "tags", "custom:x", "custom:3", 7, "custom:1"],
            [(3, 9), (1, 3)],
            stored_order,
            5,
        )
        assert out == ["custom:4", "custom:0", "tags", "custom:1", 7, "custom:2"]

    def test_order_remap_without_inserts_is_the_body_order(self):
        order = ["custom:5", "x"]
        assert _order_with_restored_sections(order, [], ["custom:0"], 1) is order

    def test_readdress_only_with_an_order_list(self):
        body = {"fields_schema": [{"section": "A"}, {"section": "B"}], "section_config": None}
        _readdress_body_order(body, [(0, 0)], {"__order": ["custom:0"]})
        assert body["section_config"] is None
        body["section_config"] = {"__order": "nope"}
        _readdress_body_order(body, [(0, 0)], {"__order": ["custom:0"]})
        assert body["section_config"] == {"__order": "nope"}
        body["section_config"] = {"__order": ["custom:0"], "k": 1}
        _readdress_body_order(body, [], {"__order": ["custom:0"]})
        assert body["section_config"] == {"__order": ["custom:0"], "k": 1}
        _readdress_body_order(body, [(0, 0)], {"__order": ["x", "custom:0"]})
        assert body["section_config"] == {"__order": ["custom:1", "custom:0"], "k": 1}
        body["section_config"] = {"__order": ["custom:0"]}
        _readdress_body_order(body, [(0, 0)], None)
        assert body["section_config"] == {"__order": ["custom:1"]}
