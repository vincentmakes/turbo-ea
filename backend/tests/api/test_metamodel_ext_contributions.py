"""A card-type save cannot delete or unstamp what an ACTIVE extension contributed.

`PATCH /metamodel/types/{key}` replaces `fields_schema`, `subtypes` and
`section_config` with the body. A body that left out an extension's section (a
stale editor copy, an API client) used to delete it, its fields with it, and
nothing re-applied the contribution afterwards. The route now runs the body
through `services/extensions/contribution_guard.py`: an active extension's
stamped sections, fields and subtypes come back, stamps stay as stored, and the
section order is re-addressed to the final schema. What an extension that is NOT
active stamped (a leftover after an uninstall) stays deletable. The pure guard
itself is covered in `tests/services/test_extension_contribution_guard.py`.
"""

from __future__ import annotations

import copy

import pytest
from sqlalchemy import select

from app.models.card_type import CardType
from app.models.extension import Extension
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
GONE = "gone-ext"  # stamps of an extension that is not installed here

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
SUBTYPES = [
    {"key": "own", "label": "Own"},
    {"key": "contrib", "label": "Contributed", "ext": EXT, "hidden_fields": ["s1"]},
]


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
async def active(db):
    """Both stamping extensions installed and enabled (no licence needed)."""
    for key in (EXT, OTHER):
        db.add(Extension(key=key, name=key, version="1.0.0", manifest={}, capabilities=[]))
    await db.flush()


@pytest.fixture
async def gadget(db, active):
    return await create_card_type(
        db,
        key="Gadget",
        label="Gadget",
        fields_schema=stored_schema(),
        subtypes=copy.deepcopy(SUBTYPES),
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

    async def test_label_type_and_section_name_stay_the_bodys(self, client, db, admin, gadget):
        body = stored_schema()
        body[2]["section"] = "Renamed"
        body[2]["fields"][0] = {"key": "s1", "label": "Score", "type": "text"}
        await _patch(client, admin, {"fields_schema": body})
        sample = (await _stored(db)).fields_schema[2]
        assert sample["section"] == "Renamed"
        assert sample["ext"] == EXT
        assert sample["fields"][0] == {"key": "s1", "label": "Score", "type": "text", "ext": EXT}

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

    async def test_transient_flags_are_never_stored(self, client, db, admin, gadget):
        body = stored_schema()
        body[2]["ext_protected"] = True
        body[2]["fields"][0]["ext_protected"] = True
        body[2]["fields"][1]["ext_locked"] = True
        subtypes = [{**s, "ext_protected": True} for s in copy.deepcopy(SUBTYPES)]
        await _patch(client, admin, {"fields_schema": body, "subtypes": subtypes})
        ct = await _stored(db)
        assert ct.fields_schema == stored_schema()
        assert ct.subtypes == SUBTYPES


class TestSectionOrder:
    async def test_a_stale_delete_keeps_its_order_pointing_at_the_same_sections(
        self, client, db, admin, gadget
    ):
        # The editor's copy predates the contributed section: customs Core 0,
        # Other 1, Notes 2. Deleting Notes there drops custom:2 from its
        # (shorter) order. Sample comes back after Core, its stored neighbour.
        body = [copy.deepcopy(DESCRIPTION), copy.deepcopy(CORE), copy.deepcopy(OTHER_SECTION)]
        order = ["description", "custom:0", "relations", "custom:1"]
        await _patch(
            client,
            admin,
            {"fields_schema": body, "section_config": {"__order": order, "tags": {"x": 1}}},
        )
        ct = await _stored(db)
        assert ct.fields_schema == [DESCRIPTION, CORE, CONTRIBUTED, OTHER_SECTION]
        # Core custom:0, Sample custom:1, Other custom:2; Sample gets back its
        # own stored setting.
        assert ct.section_config == {
            "__order": ["description", "custom:0", "custom:1", "relations", "custom:2"],
            "tags": {"x": 1},
            "custom:1": {"defaultExpanded": False},
        }

    async def test_no_stored_order_places_a_restored_section_before_relations(
        self, client, db, admin, active
    ):
        await create_card_type(
            db,
            key="Gadget",
            label="Gadget",
            fields_schema=[copy.deepcopy(CORE), copy.deepcopy(CONTRIBUTED), copy.deepcopy(NOTES)],
            section_config={},
        )
        await _patch(
            client,
            admin,
            {
                "fields_schema": [copy.deepcopy(CORE), copy.deepcopy(NOTES)],
                "section_config": {
                    "__order": ["description", "custom:0", "custom:1", "relations", "tags"]
                },
            },
        )
        ct = await _stored(db)
        assert [s["section"] for s in ct.fields_schema] == ["Core", "Sample", "Notes"]
        assert ct.section_config == {
            "__order": ["description", "custom:0", "custom:2", "custom:1", "relations", "tags"]
        }

    async def test_per_section_settings_follow_their_sections(self, client, db, admin, gadget):
        body = _without(stored_schema(), "Sample")  # customs: Core 0, Other 1, Notes 2
        config = {
            "__order": ["description", "custom:2", "custom:0", "relations", "custom:1"],
            "custom:1": {"hidden": True},  # Other
            "custom:2": {"defaultExpanded": True},  # Notes
        }
        await _patch(client, admin, {"fields_schema": body, "section_config": config})
        ct = await _stored(db)
        assert ct.fields_schema == stored_schema()
        assert ct.section_config == {
            "__order": STORED_ORDER,
            "custom:2": {"hidden": True},
            "custom:3": {"defaultExpanded": True},
            # Sample's own stored setting, not Other's.
            "custom:1": {"defaultExpanded": False},
        }

    async def test_a_section_config_only_patch_keeps_the_contributed_section_placed(
        self, client, db, admin, gadget
    ):
        # A stale editor that never saw Sample sends an order without it.
        order = ["description", "custom:3", "custom:0", "relations", "custom:2"]
        await _patch(client, admin, {"section_config": {"__order": order}})
        ct = await _stored(db)
        assert ct.fields_schema == stored_schema()
        assert ct.section_config == {"__order": STORED_ORDER}

    async def test_a_fields_only_save_that_restores_readdresses_the_stored_config(
        self, client, db, admin, gadget
    ):
        # Notes deleted, Sample left out: Sample comes back in place, the
        # stored keys follow their sections and Notes' key goes.
        body = _without(_without(stored_schema(), "Sample"), "Notes")
        await _patch(client, admin, {"fields_schema": body})
        ct = await _stored(db)
        assert ct.fields_schema == _without(stored_schema(), "Notes")
        assert ct.section_config == {
            "__order": ["description", "custom:0", "custom:1", "relations", "custom:2"],
            "custom:1": {"defaultExpanded": False},
        }


class TestInactiveStampsAreDeletable:
    """What an extension that is not active here stamped — a section kept for an
    admin field after an uninstall, stamps from another instance — may go."""

    @pytest.fixture
    async def leftover(self, db, active):
        db.add(
            Extension(
                key="off-ext", name="off", version="1", manifest={}, capabilities=[], enabled=False
            )
        )
        await db.flush()
        return await create_card_type(
            db,
            key="Gadget",
            label="Gadget",
            fields_schema=[
                copy.deepcopy(CORE),
                {
                    "section": "Leftover",
                    "ext": GONE,
                    "fields": [{"key": "note2", "label": "Note", "type": "text"}],
                },
                {
                    "section": "Disabled",
                    "ext": "off-ext",
                    "fields": [{"key": "d1", "label": "D1", "type": "text", "ext": "off-ext"}],
                },
            ],
            subtypes=[{"key": "gone", "label": "Gone", "ext": GONE}],
        )

    async def test_they_can_be_deleted(self, client, db, admin, leftover):
        await _patch(client, admin, {"fields_schema": [copy.deepcopy(CORE)], "subtypes": []})
        ct = await _stored(db)
        assert ct.fields_schema == [CORE]
        assert ct.subtypes == []

    async def test_what_the_body_keeps_keeps_its_stamp(self, client, db, admin, leftover):
        body = copy.deepcopy(leftover.fields_schema)
        body[1].pop("ext")
        body[2]["fields"][0].pop("ext")
        await _patch(client, admin, {"fields_schema": body})
        assert (await _stored(db)).fields_schema == leftover.fields_schema


class TestReadFlags:
    async def test_active_contributions_are_flagged_protected(self, client, db, admin, gadget):
        gadget.fields_schema = [
            *stored_schema(),
            {
                "section": "Leftover",
                "ext": GONE,
                "fields": [{"key": "g1", "label": "G1", "type": "text", "ext": GONE}],
            },
        ]
        gadget.subtypes = [*copy.deepcopy(SUBTYPES), {"key": "g", "label": "G", "ext": GONE}]
        await db.flush()
        # The read uses the live registry, loaded at startup in production.
        await extension_registry.refresh_from_db(db)
        resp = await client.get("/api/v1/metamodel/types/Gadget", headers=auth_headers(admin))
        out = resp.json()
        assert [
            (s["section"], s.get("ext_protected"), [f.get("ext_protected") for f in s["fields"]])
            for s in out["fields_schema"]
        ] == [
            ("__description", None, []),
            ("Core", None, [None]),
            ("Sample", True, [True, True, True]),
            ("Other", True, [True]),
            ("Notes", None, [None]),
            ("Leftover", None, [None]),
        ]
        assert [s.get("ext_protected") for s in out["subtypes"]] == [None, True, None]
        # Never written back.
        ct = await _stored(db)
        assert "ext_protected" not in ct.fields_schema[2]
        assert ct.subtypes[1] == SUBTYPES[1]

    async def test_the_flags_follow_a_disable_through_the_api(self, client, db, admin, gadget):
        mine = {"key": "mine", "label": "Mine", "type": "text"}
        schema = stored_schema()
        schema[2] = {**schema[2], "fields": [*schema[2]["fields"], mine]}
        gadget.fields_schema = schema
        await db.flush()
        await extension_registry.refresh_from_db(db)

        def flags(out):
            return [
                (
                    s["section"],
                    s.get("ext_protected"),
                    [f.get("ext_protected") for f in s["fields"]],
                )
                for s in out["fields_schema"]
            ]

        headers = auth_headers(admin)
        before = (await client.get("/api/v1/metamodel/types/Gadget", headers=headers)).json()
        assert flags(before)[2] == ("Sample", True, [True, True, True, None])
        resp = await client.put(
            f"/api/v1/admin/extensions/{EXT}/enabled", headers=headers, json={"enabled": False}
        )
        assert resp.status_code == 200, resp.text
        after = (await client.get("/api/v1/metamodel/types/Gadget", headers=headers)).json()
        # The disabled extension's fields are stripped; the section it stamped
        # survives for the admin field it holds, no longer protected. The
        # other (still active) extension's section keeps its flag.
        assert flags(after) == [
            ("__description", None, []),
            ("Core", None, [None]),
            ("Sample", None, [None]),
            ("Other", True, [True]),
            ("Notes", None, [None]),
        ]
        assert [s.get("ext_protected") for s in after["subtypes"]] == [None]


class TestAdminHolderSection:
    async def test_deleting_a_section_holding_a_moved_field_recreates_only_the_field(
        self, client, db, admin, active
    ):
        holder = {
            "section": "Mine",
            "fields": [
                {"key": "a", "label": "A", "type": "text"},
                {"key": "s1", "label": "S1", "type": "number", "ext": EXT},
            ],
        }
        await create_card_type(
            db,
            key="Gadget",
            label="Gadget",
            fields_schema=[copy.deepcopy(CORE), holder, copy.deepcopy(NOTES)],
            section_config={"__order": ["custom:2", "custom:1", "custom:0"]},
        )
        await _patch(
            client,
            admin,
            {
                "fields_schema": [copy.deepcopy(CORE), copy.deepcopy(NOTES)],
                "section_config": {"__order": ["custom:1", "custom:0"]},
            },
        )
        ct = await _stored(db)
        assert ct.fields_schema == [
            CORE,
            {"section": "Mine", "ext": EXT, "fields": [holder["fields"][1]]},
            NOTES,
        ]
        assert ct.section_config == {"__order": ["custom:2", "custom:1", "custom:0"]}


class TestSubtypes:
    async def test_a_dropped_subtype_comes_back(self, client, db, admin, gadget):
        await _patch(client, admin, {"subtypes": [{"key": "own", "label": "Renamed"}]})
        assert (await _stored(db)).subtypes == [{"key": "own", "label": "Renamed"}, SUBTYPES[1]]

    async def test_a_dropped_stamp_comes_back(self, client, db, admin, gadget):
        body = copy.deepcopy(SUBTYPES)
        body[1].pop("ext")
        body[1]["label"] = "Relabelled"
        await _patch(client, admin, {"subtypes": body})
        assert (await _stored(db)).subtypes == [SUBTYPES[0], {**SUBTYPES[1], "label": "Relabelled"}]

    async def test_a_stamp_cannot_be_minted(self, client, db, admin, gadget):
        body = copy.deepcopy(SUBTYPES)
        body[0]["ext"] = EXT
        body.append({"key": "new", "label": "New", "ext": OTHER})
        await _patch(client, admin, {"subtypes": body})
        assert (await _stored(db)).subtypes == [*SUBTYPES, {"key": "new", "label": "New"}]


class TestCreateTypeCannotStamp:
    async def test_stamps_in_a_create_body_are_dropped(self, client, db, admin, active):
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
                "subtypes": [{"key": "st", "label": "St", "ext": EXT, "ext_protected": True}],
            },
        )
        assert resp.status_code == 201
        ct = (await db.execute(select(CardType).where(CardType.key == "Widget"))).scalar_one()
        assert ct.fields_schema == [
            {"section": "Claimed", "fields": [{"key": "c", "label": "C", "type": "text"}]}
        ]
        assert ct.subtypes == [{"key": "st", "label": "St"}]


class TestPermission:
    async def test_a_non_admin_cannot_save(self, client, db, gadget):
        await create_role(db, key="viewer", label="Viewer", permissions={"inventory.view": True})
        viewer = await create_user(db, email="v@test.com", role="viewer")
        resp = await client.patch(
            "/api/v1/metamodel/types/Gadget",
            headers=auth_headers(viewer),
            json={"fields_schema": []},
        )
        assert resp.status_code == 403
        assert (await _stored(db)).fields_schema == stored_schema()
