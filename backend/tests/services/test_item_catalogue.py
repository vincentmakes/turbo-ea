"""The catalogue logic shared by cost items and license types."""

from __future__ import annotations

import pytest

from app.models.cost_item_type import CostItemType
from app.models.license_metric import LicenseMetric
from app.models.license_type import LicenseType
from app.services import item_catalogue, license_types
from app.services.item_catalogue import CatalogueError
from tests.conftest import create_license_metric


@pytest.fixture(autouse=True)
async def _users_metric(db):
    await create_license_metric(db)


async def test_create_appends_sort_order_and_refuses_duplicate(db):
    a = await license_types.create_item(db, "users", "a", "A")
    b = await license_types.create_item(db, "users", "b", "B")
    assert (a.sort_order, b.sort_order) == (0, 1)
    with pytest.raises(CatalogueError) as exc:
        await license_types.create_item(db, "users", "a", "Again")
    assert exc.value.code == "duplicate_key"
    assert str(exc.value) == "License type 'a' already exists"


async def test_license_type_has_no_reserved_keys(db):
    row = await license_types.create_item(db, "users", "name", "Name")
    assert row.key == "name"


async def test_reserved_callback_refuses_key(db):
    async def reserved(_db):
        return {"taken"}

    with pytest.raises(CatalogueError) as exc:
        await item_catalogue.create_item(
            db, LicenseType, "taken", "T", noun="License type", reserved=reserved
        )
    assert exc.value.code == "reserved_key"


async def test_invalid_key_message_uses_the_noun(db):
    with pytest.raises(CatalogueError) as exc:
        await license_types.create_item(db, "users", "1abc", "X")
    assert (exc.value.code, str(exc.value)) == ("invalid_key", "Invalid license type key '1abc'")


async def test_license_and_cost_catalogues_are_independent(db):
    await license_types.create_item(db, "users", "admin", "Admin")
    db.add(CostItemType(key="admin", label="Admin", sort_order=0, archived=False, translations={}))
    await db.flush()
    assert [r.key for r in await item_catalogue.list_items(db, LicenseType)] == ["admin"]
    assert [r.key for r in await item_catalogue.list_items(db, CostItemType)] == ["admin"]


async def test_archived_keys_maps_key_to_flag(db):
    for key, archived in (("a", False), ("b", True)):
        db.add(CostItemType(key=key, label=key, sort_order=0, archived=archived, translations={}))
    await db.flush()
    assert await item_catalogue.archived_keys(db, CostItemType) == {"a": False, "b": True}
    live = await item_catalogue.list_items(db, CostItemType, include_archived=False)
    assert [r.key for r in live] == ["a"]


async def test_update_unknown_uses_the_noun(db):
    with pytest.raises(CatalogueError) as exc:
        await license_types.update_item(db, "users", "nope", label="x")
    assert (exc.value.code, str(exc.value)) == ("not_found", "License type 'nope' not found")


async def test_update_changes_only_given_fields(db):
    await license_types.create_item(db, "users", "a", "A", {"it": "Aa"})
    row = await license_types.update_item(db, "users", "a", label="B", sort_order=5)
    assert (row.label, row.sort_order, row.archived, row.translations) == (
        "B",
        5,
        False,
        {"it": "Aa"},
    )


async def test_a_key_is_unique_per_metric_and_sort_order_counts_per_metric(db):
    await create_license_metric(db, "installations", "Installations")
    a = await license_types.create_item(db, "users", "prod", "Prod")
    b = await license_types.create_item(db, "installations", "prod", "Prod")
    assert (a.metric_key, b.metric_key, a.sort_order, b.sort_order) == (
        "users",
        "installations",
        0,
        0,
    )
    with pytest.raises(CatalogueError) as exc:
        await license_types.create_item(db, "installations", "prod", "Again")
    assert exc.value.code == "duplicate_key"
    assert len(await license_types.list_items(db)) == 2
    assert [r.metric_key for r in await license_types.list_items(db, "users")] == ["users"]
    archived = await license_types.update_item(db, "installations", "prod", archived=True)
    assert archived.archived is True
    assert (await license_types.get_item(db, "users", "prod")).archived is False


async def test_a_type_needs_an_existing_metric(db):
    with pytest.raises(CatalogueError) as exc:
        await license_types.create_item(db, "nope", "a", "A")
    assert exc.value.code == "unknown_metric"


async def test_seed_default_metrics_is_insert_only(db):
    await license_types.seed_default_metrics(db)
    users = await item_catalogue.update_item(
        db, LicenseMetric, "users", label="Seats", archived=True, noun="License metric"
    )
    await license_types.seed_default_metrics(db)
    rows = {m.key: m for m in await item_catalogue.list_items(db, LicenseMetric)}
    assert set(rows) == {"users", "installations"}
    assert (users.label, users.archived) == ("Seats", True)
    assert (await license_types.list_items(db)) == []
