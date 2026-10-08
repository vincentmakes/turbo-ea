"""A card's ``parent_id`` is validated as a card id on every route that takes one.

Before 2.157.3 the create, edit and bulk-edit bodies typed it as a bare string
and the list filter as a bare query parameter, and each handler fed it straight
to ``uuid.UUID``: a malformed id, or an empty one on an edit, answered 500. An
empty value now means "no parent" everywhere (an edit clears it) and anything
else must be a UUID, or the request is a 422.
"""

from __future__ import annotations

import uuid

import pytest

from tests.conftest import auth_headers, create_card, create_card_type

MALFORMED = ["nope", "123", " " + "1" * 32]


@pytest.fixture
async def env(db, admin_user):
    await create_card_type(db, key="Application", label="Application", has_hierarchy=True)
    parent = await create_card(db, name="Parent")
    child = await create_card(db, name="Child", parent_id=parent.id)
    child.parent_label = "part of"
    await db.flush()
    return parent, child


def refused_on_parent_id(resp, *loc) -> bool:
    detail = resp.json()["detail"]
    return resp.status_code == 422 and any(
        e["loc"] == ["body", *loc, "parent_id"] and e["msg"].endswith("parent_id must be a UUID")
        for e in detail
    )


@pytest.mark.parametrize("raw", MALFORMED)
async def test_create_refuses_a_malformed_parent(client, admin_user, env, raw):
    resp = await client.post(
        "/api/v1/cards",
        json={"type": "Application", "name": "New", "parent_id": raw},
        headers=auth_headers(admin_user),
    )
    assert refused_on_parent_id(resp)


async def test_create_reads_an_empty_parent_as_none(client, admin_user, env):
    resp = await client.post(
        "/api/v1/cards",
        json={"type": "Application", "name": "New", "parent_id": ""},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 201
    assert resp.json()["parent_id"] is None


async def test_create_accepts_any_uuid_spelling(client, admin_user, env):
    parent, _ = env
    resp = await client.post(
        "/api/v1/cards",
        json={"type": "Application", "name": "New", "parent_id": str(parent.id).upper()},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 201
    assert resp.json()["parent_id"] == str(parent.id)


@pytest.mark.parametrize("raw", MALFORMED)
async def test_edit_refuses_a_malformed_parent(client, admin_user, env, raw):
    _, child = env
    resp = await client.patch(
        f"/api/v1/cards/{child.id}", json={"parent_id": raw}, headers=auth_headers(admin_user)
    )
    assert refused_on_parent_id(resp)


async def test_edit_with_an_empty_parent_clears_it_and_its_label(client, admin_user, env):
    _, child = env
    resp = await client.patch(
        f"/api/v1/cards/{child.id}", json={"parent_id": ""}, headers=auth_headers(admin_user)
    )
    assert resp.status_code == 200
    assert (resp.json()["parent_id"], resp.json()["parent_label"]) == (None, None)


async def test_edit_without_a_parent_leaves_it_alone(client, admin_user, env):
    parent, child = env
    resp = await client.patch(
        f"/api/v1/cards/{child.id}", json={"name": "Renamed"}, headers=auth_headers(admin_user)
    )
    assert resp.status_code == 200
    assert resp.json()["parent_id"] == str(parent.id)


async def test_edit_still_needs_the_edit_permission(client, viewer_user, env):
    parent, child = env
    resp = await client.patch(
        f"/api/v1/cards/{child.id}",
        json={"parent_id": str(parent.id)},
        headers=auth_headers(viewer_user),
    )
    assert resp.status_code == 403


@pytest.mark.parametrize("raw", MALFORMED)
async def test_bulk_edit_refuses_a_malformed_parent(client, admin_user, env, raw):
    _, child = env
    resp = await client.patch(
        "/api/v1/cards/bulk",
        json={"ids": [str(child.id)], "updates": {"parent_id": raw}},
        headers=auth_headers(admin_user),
    )
    assert refused_on_parent_id(resp, "updates")


async def test_bulk_edit_with_an_empty_parent_clears_it(client, admin_user, env):
    _, child = env
    resp = await client.patch(
        "/api/v1/cards/bulk",
        json={"ids": [str(child.id)], "updates": {"parent_id": ""}},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 200
    assert [(c["id"], c["parent_id"]) for c in resp.json()] == [(str(child.id), None)]


@pytest.mark.parametrize("raw", MALFORMED)
async def test_the_list_filter_refuses_a_malformed_parent(client, admin_user, env, raw):
    resp = await client.get(
        "/api/v1/cards", params={"parent_id": raw}, headers=auth_headers(admin_user)
    )
    assert (resp.status_code, resp.json()["detail"]) == (422, "parent_id must be a UUID")


async def test_the_list_filter_still_filters_and_ignores_an_empty_parent(client, admin_user, env):
    parent, child = env
    headers = auth_headers(admin_user)
    filtered = await client.get(
        "/api/v1/cards", params={"parent_id": str(parent.id)}, headers=headers
    )
    assert [c["id"] for c in filtered.json()["items"]] == [str(child.id)]
    unfiltered = await client.get("/api/v1/cards", params={"parent_id": ""}, headers=headers)
    assert unfiltered.json()["total"] == 2
    unknown = await client.get(
        "/api/v1/cards", params={"parent_id": str(uuid.uuid4())}, headers=headers
    )
    assert unknown.json()["items"] == []
