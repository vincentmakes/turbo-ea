"""Costs stored as text: refused on write, tolerated on read.

``cost`` and ``number`` fields carried no numeric check, so an import or an
older client could store ``"n/a"`` — and the cost report, the treemap and the
capability heatmap each failed with a 500 on the next load (``int + str``,
``float("n/a")``). The write path now refuses what is not a number and stores
numeric text as the number; the readers count through ``cost_value`` so an
install that already holds such a value still gets its reports.
"""

from __future__ import annotations

import pytest

from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)

FIELDS = [
    {
        "section": "Cost",
        "fields": [
            {"key": "costTotalAnnual", "label": "Annual Cost", "type": "cost", "weight": 0},
            {"key": "seats", "label": "Seats", "type": "number", "weight": 0},
            {"key": "notes", "label": "Notes", "type": "text", "weight": 0},
        ],
    }
]


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="costs-admin@example.com", role="admin")
    await create_card_type(db, key="Application", fields_schema=FIELDS)
    await create_card_type(db, key="BusinessCapability", fields_schema=[])
    await create_relation_type(
        db,
        key="relAppToCapability",
        source_type_key="Application",
        target_type_key="BusinessCapability",
    )
    return {"admin": admin}


def _post(client, env, attributes, name="Priced"):
    return client.post(
        "/api/v1/cards",
        json={"type": "Application", "name": name, "attributes": attributes},
        headers=auth_headers(env["admin"]),
    )


class TestWriteRefusesWhatIsNotANumber:
    @pytest.mark.parametrize("value", ["n/a", "1,200", "1_000", "nan", True, [100]])
    async def test_a_non_number_in_a_cost_field_is_a_422(self, client, env, value):
        resp = await _post(client, env, {"costTotalAnnual": value})
        assert resp.status_code == 422, resp.text
        assert "costTotalAnnual" in resp.json()["detail"]

    async def test_a_non_number_in_a_number_field_is_a_422(self, client, env):
        resp = await _post(client, env, {"seats": "many"})
        assert resp.status_code == 422, resp.text
        assert "seats" in resp.json()["detail"]

    async def test_numeric_text_is_stored_as_the_number(self, client, env):
        resp = await _post(client, env, {"costTotalAnnual": "1200", "seats": " 12.5 "})
        assert resp.status_code == 201, resp.text
        attrs = resp.json()["attributes"]
        assert attrs["costTotalAnnual"] == 1200
        assert attrs["seats"] == 12.5

    async def test_numbers_empty_and_text_fields_pass(self, client, env):
        resp = await _post(client, env, {"costTotalAnnual": 99.5, "seats": "", "notes": "n/a"})
        assert resp.status_code == 201, resp.text
        assert resp.json()["attributes"]["costTotalAnnual"] == 99.5

    async def test_an_edit_is_checked_too(self, client, env):
        created = await _post(client, env, {"costTotalAnnual": 10})
        card_id = created.json()["id"]
        resp = await client.patch(
            f"/api/v1/cards/{card_id}",
            json={"attributes": {"costTotalAnnual": "free"}},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 422, resp.text
        resp = await client.patch(
            f"/api/v1/cards/{card_id}",
            json={"attributes": {"costTotalAnnual": "250"}},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["attributes"]["costTotalAnnual"] == 250


class TestReadersTolerateStoredText:
    """Rows written before the check — through the factory, not the API."""

    async def _seed(self, db):
        cap = await create_card(db, card_type="BusinessCapability", name="Billing")
        for name, cost in [("Text", "n/a"), ("Numeric text", "250"), ("Number", 100)]:
            app = await create_card(
                db, card_type="Application", name=name, attributes={"costTotalAnnual": cost}
            )
            await create_relation(
                db, type_key="relAppToCapability", source_id=app.id, target_id=cap.id
            )

    async def test_cost_report(self, client, db, env):
        await self._seed(db)
        resp = await client.get(
            "/api/v1/reports/cost",
            params={"type": "Application"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["total"] == 350
        assert sorted(i["name"] for i in data["items"]) == ["Number", "Numeric text"]

    async def test_cost_treemap(self, client, db, env):
        await self._seed(db)
        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={"type": "Application"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["total"] == 350

    async def test_capability_heatmap(self, client, db, env):
        await self._seed(db)
        resp = await client.get(
            "/api/v1/reports/capability-heatmap",
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200, resp.text
        (billing,) = [i for i in resp.json()["items"] if i["name"] == "Billing"]
        assert billing["app_count"] == 3
        assert billing["total_cost"] == 350
