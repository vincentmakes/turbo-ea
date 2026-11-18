"""``licensingModel`` is no longer protected: license metrics replaced it, so an admin edits the
Application / IT Component schema freely (no ``license_field_required``)."""

import copy

import pytest

from app.services.licensing_migration import LICENSING_MODEL_FIELD, licensing_section
from tests.conftest import auth_headers, create_card_type, create_role, create_user

URL = "/api/v1/metamodel/types/"
OTHER = {"section": "Application Information", "fields": [{"key": "hostingType", "type": "text"}]}


@pytest.fixture
async def headers(db):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="a@license-section.com", role="admin")
    for key in ("Application", "ITComponent"):
        await create_card_type(db, key=key, fields_schema=[OTHER, licensing_section()])
    return auth_headers(admin)


@pytest.mark.parametrize("key", ["Application", "ITComponent"])
async def test_removing_the_old_licensing_section_is_allowed(client, headers, key):
    r = await client.patch(URL + key, json={"fields_schema": [OTHER]}, headers=headers)
    assert r.status_code == 200, r.text
    sections = [s["section"] for s in r.json()["fields_schema"]]
    assert sections == ["Application Information"]


async def test_moving_or_retyping_the_old_field_is_allowed(client, headers):
    field = {**copy.deepcopy(LICENSING_MODEL_FIELD), "type": "text", "options": []}
    moved = {"section": "Application Information", "fields": [field]}
    r = await client.patch(URL + "Application", json={"fields_schema": [moved]}, headers=headers)
    assert r.status_code == 200, r.text


async def test_a_member_still_cannot_edit_the_schema(client, db, headers):
    await create_role(db, key="member", permissions={"inventory.view": True})
    member = await create_user(db, email="m@license-section.com", role="member")
    r = await client.patch(
        URL + "Application", json={"fields_schema": [OTHER]}, headers=auth_headers(member)
    )
    assert r.status_code == 403
