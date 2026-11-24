"""Timeline mapping configuration on an existing Initiative metamodel."""

from __future__ import annotations

import pytest

from tests.conftest import auth_headers, create_card_type, create_role, create_user

PATH = "/api/v1/settings/pml/timeline"


@pytest.fixture
async def timeline_env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="settings_only", permissions={"admin.settings": True})
    await create_role(db, key="viewer", permissions={"inventory.view": True})
    admin = await create_user(db, role="admin")
    settings_only = await create_user(db, role="settings_only")
    viewer = await create_user(db, role="viewer")
    schema = [
        {
            "section": "Cost & Timeline",
            "fields": [
                {"key": "startDate", "type": "date", "label": "Start Date"},
                {"key": "endDate", "type": "date", "label": "End Date"},
                {"key": "actualStart", "type": "date", "label": "Real start"},
                {"key": "ActualEnd", "type": "date", "label": "Real end"},
            ],
        }
    ]
    initiative = await create_card_type(
        db, key="Initiative", label="Initiative", fields_schema=schema
    )
    await db.commit()
    return admin, settings_only, viewer, initiative


async def test_map_existing_aruba_fields_without_new_fields(client, db, timeline_env):
    admin, _, _, initiative = timeline_env
    before = list(initiative.fields_schema)
    response = await client.put(
        PATH,
        headers=auth_headers(admin),
        json={"actual_start_key": "actualStart", "actual_end_key": "ActualEnd"},
    )
    assert response.status_code == 200
    assert response.json()["actual_start_key"] == "actualStart"
    assert response.json()["actual_end_key"] == "ActualEnd"
    await db.refresh(initiative)
    assert initiative.fields_schema == before
    fetched = await client.get(PATH, headers=auth_headers(admin))
    assert fetched.status_code == 200
    assert fetched.json()["actual_end_key"] == "ActualEnd"


async def test_rejects_plan_keys_duplicate_and_unknown_fields(client, timeline_env):
    admin = timeline_env[0]
    for payload in (
        {"actual_start_key": "startDate"},
        {"actual_start_key": "actualStart", "actual_end_key": "actualStart"},
        {"actual_end_key": "actualEnd"},
    ):
        response = await client.put(PATH, headers=auth_headers(admin), json=payload)
        assert response.status_code == 422
    current = await client.get(PATH, headers=auth_headers(admin))
    assert current.json()["actual_start_key"] == "actualStart"
    assert current.json()["actual_end_key"] == "actualEnd"


async def test_provision_one_missing_field_needs_metamodel_access(client, db, timeline_env):
    admin, settings_only, _, initiative = timeline_env
    request = {"actual_start_key": "actualStart", "create_defaults": ["end"]}
    denied = await client.put(PATH, headers=auth_headers(settings_only), json=request)
    assert denied.status_code == 403
    response = await client.put(PATH, headers=auth_headers(admin), json=request)
    assert response.status_code == 200
    assert response.json()["actual_start_key"] == "actualStart"
    assert response.json()["actual_end_key"] == "actualEnd"
    await db.refresh(initiative)
    keys = [field["key"] for section in initiative.fields_schema for field in section["fields"]]
    assert keys.count("actualStart") == 1
    assert keys.count("actualEnd") == 1
    assert keys.count("actualStart") == 1


async def test_read_and_write_require_settings_permission(client, timeline_env):
    _, _, viewer, _ = timeline_env
    assert (await client.get(PATH, headers=auth_headers(viewer))).status_code == 403
    assert (
        await client.put(
            PATH, headers=auth_headers(viewer), json={"actual_start_key": "actualStart"}
        )
    ).status_code == 403


async def test_cannot_remove_mapped_field_from_metamodel(client, timeline_env):
    admin, _, _, initiative = timeline_env
    mapped = await client.put(
        PATH,
        headers=auth_headers(admin),
        json={"actual_start_key": "actualStart", "actual_end_key": "ActualEnd"},
    )
    assert mapped.status_code == 200
    replacement = [
        {
            "section": "Cost & Timeline",
            "fields": [
                field
                for field in initiative.fields_schema[0]["fields"]
                if field["key"] != "ActualEnd"
            ],
        }
    ]
    response = await client.patch(
        "/api/v1/metamodel/types/Initiative",
        headers=auth_headers(admin),
        json={"fields_schema": replacement},
    )
    assert response.status_code == 409
    assert (await client.get(PATH, headers=auth_headers(admin))).json()[
        "actual_end_key"
    ] == "ActualEnd"


def test_visible_dates_respect_direct_section_config_before_legacy():
    from app.models.card import Card
    from app.models.card_type import CardType
    from app.services.ppm_timeline import visible_date_fields

    card = Card(type="Initiative", name="Test", attributes={"actualStart": "2026-01-02"})
    card_type = CardType(
        key="Initiative",
        label="Initiative",
        fields_schema=[
            {
                "section": "Cost & Timeline",
                "fields": [{"key": "actualStart", "type": "date"}],
            }
        ],
        section_config={"custom:0": {}, "Cost & Timeline": {"hidden": True}},
    )
    assert (
        visible_date_fields(card, card_type, ["actualStart"])["actualStart"].isoformat()
        == "2026-01-02"
    )
    card_type.section_config = {"custom:0": {"hidden": True}, "Cost & Timeline": {}}
    assert "actualStart" not in visible_date_fields(card, card_type, ["actualStart"])


async def test_incompatible_and_readonly_date_fields_are_rejected(client, db, timeline_env):
    admin, _, _, initiative = timeline_env
    schema = [
        {
            "section": "Existing",
            "fields": [
                {"key": "actualStart", "type": "text", "label": "Text"},
                {"key": "ActualEnd", "type": "date", "label": "End", "readonly": True},
            ],
        }
    ]
    initiative.fields_schema = schema
    await db.commit()
    for payload in ({"actual_start_key": "actualStart"}, {"actual_end_key": "ActualEnd"}):
        response = await client.put(PATH, headers=auth_headers(admin), json=payload)
        assert response.status_code == 422


async def test_provision_occupied_key_keeps_original_schema(client, db, timeline_env):
    admin, _, _, initiative = timeline_env
    schema = [
        {
            "section": "Existing",
            "fields": [{"key": "actualEnd", "type": "text", "label": "Keep text"}],
        }
    ]
    initiative.fields_schema = schema
    await db.commit()
    response = await client.put(
        PATH, headers=auth_headers(admin), json={"create_defaults": ["end"]}
    )
    assert response.status_code == 409
    await db.refresh(initiative)
    assert initiative.fields_schema == schema


async def test_provision_preserves_unknown_and_empty_sections(client, db, timeline_env):
    admin, _, _, initiative = timeline_env
    initiative.fields_schema = [None, {"section": "Cost & Timeline", "fields": None}]
    await db.commit()
    response = await client.put(
        PATH, headers=auth_headers(admin), json={"create_defaults": ["start"]}
    )
    assert response.status_code == 200
    await db.refresh(initiative)
    assert initiative.fields_schema[0] is None
    assert initiative.fields_schema[1]["fields"][0]["key"] == "actualStart"


async def test_mapping_rejects_date_locked_by_extension(client, db, timeline_env):
    admin, _, _, initiative = timeline_env
    section = initiative.fields_schema[0]
    initiative.fields_schema = [
        {
            **section,
            "fields": [
                {**field, "ext": "unavailable-timeline-extension"}
                if field["key"] == "actualStart"
                else field
                for field in section["fields"]
            ],
        }
    ]
    await db.commit()
    response = await client.put(
        PATH, headers=auth_headers(admin), json={"actual_start_key": "actualStart"}
    )
    assert response.status_code == 422, response.text


async def test_calculation_cannot_target_a_mapped_actual_date(client, timeline_env):
    headers = auth_headers(timeline_env[0])
    mapping = await client.put(PATH, headers=headers, json={"actual_end_key": "ActualEnd"})
    assert mapping.status_code == 200, mapping.text
    calculations = "/api/v1/calculations"
    body = {
        "name": "Date calculation",
        "target_type_key": "Initiative",
        "target_field_key": "startDate",
        "formula": "1",
    }
    allowed = await client.post(calculations, headers=headers, json=body)
    assert allowed.status_code == 201, allowed.text

    rejected = await client.post(
        calculations, headers=headers, json={**body, "target_field_key": "ActualEnd"}
    )
    assert rejected.status_code == 409, rejected.text
    redirected = await client.patch(
        f"{calculations}/{allowed.json()['id']}",
        headers=headers,
        json={"target_field_key": "ActualEnd"},
    )
    assert redirected.status_code == 409, redirected.text
    for key in ("actualStart", "actualEnd"):
        built_in = await client.post(
            calculations, headers=headers, json={**body, "target_field_key": key}
        )
        assert built_in.status_code == 409, built_in.text


def test_extra_description_dates_follow_the_description_section_visibility():
    from datetime import date

    from app.models.card import Card
    from app.models.card_type import CardType
    from app.services.ppm_timeline import visible_date_fields

    schema = [
        {
            "section": "__description",
            "fields": [{"key": "ActualEnd", "type": "date", "label": "Actual End"}],
        },
        {
            "section": "Timeline",
            "fields": [{"key": "actualStart", "type": "date", "label": "Actual Start"}],
        },
    ]
    card_type = CardType(key="Initiative", label="Initiative", fields_schema=schema)
    card = Card(
        type="Initiative",
        name="Initiative",
        attributes={"ActualEnd": "2027-03-31", "actualStart": "2027-01-01"},
    )
    keys = ["actualStart", "ActualEnd"]
    assert visible_date_fields(card, card_type, keys)["ActualEnd"] == date(2027, 3, 31)
    card_type.section_config = {"description": {"hidden": True}, "custom:0": {}}
    assert visible_date_fields(card, card_type, keys) == {"actualStart": date(2027, 1, 1)}


def test_initiative_seed_has_editable_builtin_actual_dates_next_to_planned_dates():
    from app.services.seed import TYPES

    initiative = next(item for item in TYPES if item["key"] == "Initiative")
    section = next(
        s for s in initiative["fields_schema"] if any(f["key"] == "startDate" for f in s["fields"])
    )
    fields = {field["key"]: field for field in section["fields"]}
    for key, label in (("actualStart", "Actual Start"), ("actualEnd", "Actual End")):
        assert fields[key]["type"] == "date"
        assert fields[key]["label"] == label
        assert fields[key]["built_in"] is True
        assert not fields[key].get("readonly", False)


async def test_fresh_mapping_uses_builtin_fields(client, timeline_env):
    response = await client.get(
        "/api/v1/settings/pml/timeline", headers=auth_headers(timeline_env[0])
    )
    assert response.status_code == 200
    assert response.json()["actual_start_key"] == "actualStart"
    assert response.json()["actual_end_key"] == "actualEnd"


@pytest.mark.parametrize(
    "key,change",
    [
        ("actualStart", "delete"),
        ("actualStart", "type"),
        ("actualEnd", "delete"),
        ("actualEnd", "type"),
    ],
)
async def test_builtin_dates_are_protected_even_with_other_mapping(
    client, db, timeline_env, key, change
):
    admin, _, _, initiative = timeline_env
    import copy

    schema = copy.deepcopy(initiative.fields_schema)
    schema[0]["fields"].append({"key": "actualEnd", "type": "date", "built_in": True})
    initiative.fields_schema = schema
    await db.commit()
    mapped = await client.put(
        "/api/v1/settings/pml/timeline",
        headers=auth_headers(admin),
        json={"actual_start_key": None, "actual_end_key": "ActualEnd"},
    )
    assert mapped.status_code == 200
    new_schema = copy.deepcopy(schema)
    fields = new_schema[0]["fields"]
    if change == "delete":
        new_schema[0]["fields"] = [field for field in fields if field["key"] != key]
    else:
        next(field for field in fields if field["key"] == key)["type"] = "text"
    response = await client.patch(
        "/api/v1/metamodel/types/Initiative",
        headers=auth_headers(admin),
        json={"fields_schema": new_schema},
    )
    assert response.status_code in (400, 409)


async def test_provision_reuses_existing_builtin_date(client, db, timeline_env):
    admin, _, _, initiative = timeline_env
    schema = list(initiative.fields_schema)
    response = await client.put(
        PATH, headers=auth_headers(admin), json={"create_defaults": ["start"]}
    )
    assert response.status_code == 200
    assert response.json()["actual_start_key"] == "actualStart"
    await db.refresh(initiative)
    assert initiative.fields_schema == schema
