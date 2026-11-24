"""Date-pair validation through inventory card write entry points."""

import pytest

from app.models.app_settings import AppSettings
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user


@pytest.fixture
async def timeline_cards(db):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, role="admin", email="timeline-admin@test.com")
    await create_card_type(
        db,
        key="Initiative",
        fields_schema=[
            {
                "section": "Timeline",
                "fields": [
                    {"key": "actualStart", "label": "Actual Start", "type": "date"},
                    {"key": "ActualEnd", "label": "Actual End", "type": "date"},
                ],
            }
        ],
    )
    db.add(
        AppSettings(
            id="default",
            general_settings={
                "pml.timeline": {"actual_start_key": "actualStart", "actual_end_key": "ActualEnd"}
            },
        )
    )
    card = await create_card(
        db,
        card_type="Initiative",
        name="Initiative",
        attributes={"actualStart": "2026-04-10", "ActualEnd": "2026-05-01"},
    )
    await db.flush()
    return auth_headers(admin), card


async def test_partial_card_patch_preserves_and_validates_mapped_dates(client, timeline_cards):
    headers, card = timeline_cards
    path = f"/api/v1/cards/{card.id}"
    invalid = await client.patch(
        path, json={"attributes": {"actualStart": "2026-06-01"}}, headers=headers
    )
    assert invalid.status_code == 422, invalid.text
    unchanged = await client.get(path, headers=headers)
    assert unchanged.json()["attributes"]["actualStart"] == "2026-04-10"
    updated = await client.patch(
        path, json={"attributes": {"actualStart": "2026-04-20"}}, headers=headers
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["attributes"]["ActualEnd"] == "2026-05-01"
    cleared = await client.patch(path, json={"attributes": {"ActualEnd": None}}, headers=headers)
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["attributes"]["actualStart"] == "2026-04-20"
    assert cleared.json()["attributes"]["ActualEnd"] is None


async def test_bulk_card_patch_rejects_invalid_merged_dates(client, timeline_cards):
    headers, card = timeline_cards
    response = await client.patch(
        "/api/v1/cards/bulk",
        json={"ids": [str(card.id)], "updates": {"attributes": {"actualStart": "2026-06-01"}}},
        headers=headers,
    )
    assert response.status_code == 422, response.text


async def test_card_create_rejects_inverted_dates(client, timeline_cards):
    headers, _card = timeline_cards
    response = await client.post(
        "/api/v1/cards",
        json={
            "type": "Initiative",
            "name": "Invalid",
            "attributes": {"actualStart": "2026-06-01", "ActualEnd": "2026-05-01"},
        },
        headers=headers,
    )
    assert response.status_code == 422, response.text


async def test_spreadsheet_bulk_create_reports_invalid_initiative_dates(client, timeline_cards):
    headers, _card = timeline_cards
    response = await client.post(
        "/api/v1/cards/bulk-create",
        json={
            "cards": [
                {
                    "row_index": 1,
                    "type": "Initiative",
                    "name": "Invalid import",
                    "attributes": {"actualStart": "2026-06-01", "ActualEnd": "2026-05-01"},
                },
                {
                    "row_index": 2,
                    "type": "Initiative",
                    "name": "Valid import",
                    "attributes": {"actualStart": "2026-04-01", "ActualEnd": "2026-05-01"},
                },
            ]
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["failed"] == 1
    assert result["created"] == 1
    assert [row["status"] for row in result["results"]] == ["failed", "created"]
    assert "Actual" in result["results"][0]["error"]
