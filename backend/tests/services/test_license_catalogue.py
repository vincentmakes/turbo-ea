from __future__ import annotations

import pytest

from app.services import license_metrics, license_types
from app.services.license_catalogue import load_catalogue
from tests.conftest import create_license_metric, create_license_type


async def test_load_catalogue_orders_and_nests(db):
    await create_license_metric(db, "installations", "Installations", sort_order=1)
    await create_license_metric(db, "users", "Users", sort_order=0)
    await create_license_type(db, "b", "Beta", metric_key="users", sort_order=1)
    await create_license_type(db, "a", "Alpha", metric_key="users", sort_order=1)
    await create_license_type(db, "z", "Zed", metric_key="users", sort_order=0, archived=True)
    await create_license_type(db, "dev", "Dev", metric_key="installations")

    cat = await load_catalogue(db)

    assert cat.metric_order() == ["users", "installations"]
    # sort_order, then label; archived types are included.
    assert cat.type_order("users") == ["z", "a", "b"]
    assert cat.type_order("installations") == ["dev"]
    assert cat.type_order("nope") == []
    assert cat.metric("users").label == "Users"
    assert cat.metric("nope") is None
    assert cat.type("users", "z").archived is True


async def test_same_type_key_in_two_metrics_is_two_types(db):
    await create_license_type(db, "admin", "Admin users", metric_key="users")
    await create_license_type(db, "admin", "Admin hosts", metric_key="installations")

    cat = await load_catalogue(db)

    assert cat.type("users", "admin").label == "Admin users"
    assert cat.type("installations", "admin").label == "Admin hosts"
    assert cat.type("users", "admin").metric_key == "users"
    assert cat.type("users", "nope") is None
    assert cat.type("nope", "admin") is None


async def test_scoped_create_refuses_a_duplicate_inside_one_metric_only(db):
    await create_license_metric(db, "users", "Users")
    await create_license_metric(db, "installations", "Installations")
    await license_types.create_item(db, "users", "prod", "Prod")
    await license_types.create_item(db, "installations", "prod", "Prod")
    with pytest.raises(license_types.CatalogueError) as exc:
        await license_types.create_item(db, "users", "prod", "Again")
    assert exc.value.code == "duplicate_key"
    with pytest.raises(license_types.CatalogueError) as exc:
        await license_types.create_item(db, "nope", "prod", "Prod")
    assert exc.value.code == "unknown_metric"


async def test_metric_create_update_archive(db):
    row = await license_metrics.create_item(db, "seats", "Seats")
    assert (row.key, row.sort_order, row.archived) == ("seats", 0, False)
    second = await license_metrics.create_item(db, "cores", "Cores")
    assert second.sort_order == 1
    with pytest.raises(license_metrics.CatalogueError) as exc:
        await license_metrics.create_item(db, "seats", "Again")
    assert exc.value.code == "duplicate_key"

    await license_metrics.update_item(db, "seats", archived=True, label="Seats 2")
    again = await license_metrics.get_item(db, "seats")
    assert (again.archived, again.label) == (True, "Seats 2")
    await license_metrics.update_item(db, "seats", archived=False)
    assert (await license_metrics.get_item(db, "seats")).archived is False
    with pytest.raises(license_metrics.CatalogueError) as exc:
        await license_metrics.update_item(db, "nope", label="x")
    assert exc.value.code == "not_found"


async def test_serialize_nests_types(db):
    await create_license_type(db, "a", "A", metric_key="users")
    metric = await license_metrics.get_item(db, "users")
    out = license_metrics.serialize(metric, await license_types.list_items(db, "users"))
    assert out["key"] == "users"
    assert [t["key"] for t in out["types"]] == ["a"]
    assert out["types"][0]["metric_key"] == "users"
