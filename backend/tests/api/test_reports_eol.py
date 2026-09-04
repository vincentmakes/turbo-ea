"""GET /reports/eol — the End-of-Life risk & impact report.

The report used to list only cards that carry EOL data, which made the one
question it is best placed to answer — "which of my hundreds of IT Components
has nobody recorded an end of life for?" — the one it could not
([#1065](https://github.com/vincentmakes/turbo-ea/discussions/1065)).

Integration tests requiring a PostgreSQL test database. The upstream
endoflife.date fetch is mocked; no real network requests are made.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

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

NGINX_CYCLES = [{"cycle": "1.25", "eol": "2020-01-01", "support": "2019-06-01"}]


def _cycles(_client, product):
    return NGINX_CYCLES if product == "nginx" else None


@pytest.fixture
async def eol_env(db):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_card_type(db, key="BusinessCapability", label="Business Capability")
    return {"admin": admin}


async def _report(client, admin):
    with patch(
        "app.services.eol_service.fetch_product_cycles",
        new=AsyncMock(side_effect=_cycles),
    ):
        resp = await client.get("/api/v1/reports/eol", headers=auth_headers(admin))
    assert resp.status_code == 200
    return resp.json()


class TestEolReportCoverage:
    async def test_lists_cards_with_no_eol_information(self, client, db, eol_env):
        admin = eol_env["admin"]
        await create_card(
            db,
            card_type="ITComponent",
            name="Nginx LB",
            attributes={"eol_product": "nginx", "eol_cycle": "1.25"},
            user_id=admin.id,
        )
        await create_card(db, card_type="ITComponent", name="Unknown Box", user_id=admin.id)

        data = await _report(client, admin)

        missing = next(i for i in data["items"] if i["name"] == "Unknown Box")
        assert missing["status"] == "missing"
        assert missing["source"] == "none"
        assert missing["cycle_data"] is None
        assert data["summary"]["missing"] == 1

    async def test_a_manual_end_of_life_date_is_not_missing(self, client, db, eol_env):
        admin = eol_env["admin"]
        await create_card(
            db,
            card_type="ITComponent",
            name="In-house Broker",
            lifecycle={"endOfLife": "2024-11-14"},
            user_id=admin.id,
        )

        data = await _report(client, admin)

        item = next(i for i in data["items"] if i["name"] == "In-house Broker")
        assert item["source"] == "manual"
        assert data["summary"]["missing"] == 0

    async def test_types_without_an_end_of_life_are_not_listed(self, client, db, eol_env):
        admin = eol_env["admin"]
        await create_card(db, card_type="BusinessCapability", name="Payments", user_id=admin.id)

        data = await _report(client, admin)

        assert [i["name"] for i in data["items"]] == []
        assert data["summary"]["missing"] == 0

    async def test_missing_rows_sort_last(self, client, db, eol_env):
        """A backlog to work through, not a risk to act on today — putting it
        above `supported` would bury the cards someone has actually checked."""
        admin = eol_env["admin"]
        await create_card(db, card_type="ITComponent", name="Unknown Box", user_id=admin.id)
        await create_card(
            db,
            card_type="ITComponent",
            name="Nginx LB",
            attributes={"eol_product": "nginx", "eol_cycle": "1.25"},
            user_id=admin.id,
        )

        data = await _report(client, admin)

        assert [i["name"] for i in data["items"]] == ["Nginx LB", "Unknown Box"]

    async def test_missing_rows_carry_their_impact(self, client, db, eol_env):
        """ "What would this hit if it went end of life" is exactly the
        argument for going and finding the date."""
        admin = eol_env["admin"]
        await create_relation_type(
            db,
            key="relITCToApp",
            label="supports",
            reverse_label="supported by",
            source_type_key="ITComponent",
            target_type_key="Application",
        )
        itc = await create_card(db, card_type="ITComponent", name="Unknown Box", user_id=admin.id)
        app = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        await create_relation(db, type_key="relITCToApp", source_id=itc.id, target_id=app.id)

        data = await _report(client, admin)

        item = next(i for i in data["items"] if i["name"] == "Unknown Box")
        assert [a["name"] for a in item["affected_apps"]] == ["CRM"]

    async def test_empty_landscape_still_answers(self, client, db, eol_env):
        data = await _report(client, eol_env["admin"])
        assert data["items"] == []
        assert data["summary"]["missing"] == 0

    async def test_linked_card_resolves_upstream(self, client, db, eol_env):
        admin = eol_env["admin"]
        await create_card(
            db,
            card_type="ITComponent",
            name="Nginx LB",
            attributes={"eol_product": "nginx", "eol_cycle": "1.25"},
            user_id=admin.id,
        )

        data = await _report(client, admin)

        item = next(i for i in data["items"] if i["name"] == "Nginx LB")
        assert item["status"] == "eol"
        assert item["source"] == "api"
        assert item["cycle_data"]["eol"] == "2020-01-01"
        assert data["summary"]["eol"] == 1
