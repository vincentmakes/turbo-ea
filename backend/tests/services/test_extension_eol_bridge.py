"""SDK 1.10 ``ctx.data.get_eol_status``: core's own EOL resolver behind the
inventory read grant — the endoflife.date cycle for a linked card, the
manual date otherwise, nothing for a card with neither, the batch-read
exclusions and refusals, and no session held across the outbound fetch."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest

from app.services import eol_service
from app.services.extensions import data_service as bridge_mod
from app.services.extensions.data_service import ExtensionData
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.registry import ExtensionInfo, extension_registry
from app.services.extensions.sdk import ExtensionDataError, ExtensionPermissionError
from tests.conftest import create_card, create_card_type

NOW = datetime.now(timezone.utc)
TODAY = NOW.date()
KEY = "sample-rules"


def load_registry(*, grants: list[str]) -> None:
    extension_registry.clear()
    extension_registry.load_installed(
        [
            ExtensionInfo(
                key=KEY,
                name="Sample Rules",
                version="1.0.0",
                status="installed",
                enabled=True,
                manifest={"grants": grants},
            )
        ]
    )
    extension_registry.set_license(
        LicenseDocument(
            licensee="ACME",
            customer_id="cus_1",
            issued_at=NOW - timedelta(days=1),
            grace_days=30,
            entitlements=[Entitlement(extension_key=KEY, expires_at=None)],
        )
    )


@pytest.fixture(autouse=True)
def _registry_cleanup():
    extension_registry.clear()
    bridge_mod.reset_rate_limiter()
    yield
    extension_registry.clear()


@pytest.fixture(autouse=True)
def _patch_session(monkeypatch, db):
    @asynccontextmanager
    async def fake_session():
        yield db

    monkeypatch.setattr(bridge_mod, "async_session", fake_session)


@pytest.fixture(autouse=True)
def _canned_cycles(monkeypatch):
    """endoflife.date answered from memory: one product, two cycles."""
    soon = (TODAY + timedelta(days=90)).isoformat()
    past = (TODAY - timedelta(days=400)).isoformat()
    cycles = {
        "postgresql": [
            {"cycle": "13", "eol": soon, "support": None, "latest": "13.22"},
            {"cycle": "11", "eol": past, "support": past, "latest": "11.22"},
        ]
    }
    calls: list[set[str]] = []

    async def fake_fetch(products: set[str]) -> dict[str, list[dict]]:
        calls.append(set(products))
        return {p: cycles.get(p, []) for p in products}

    monkeypatch.setattr(eol_service, "fetch_cycles_for_products", fake_fetch)
    return calls


@pytest.fixture
async def env(db):
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_card_type(db, key="Hidden", label="Hidden", is_hidden=True)
    linked = await create_card(
        db,
        card_type="ITComponent",
        name="Postgres 13",
        attributes={"eol_product": "postgresql", "eol_cycle": "13"},
    )
    gone = await create_card(
        db,
        card_type="ITComponent",
        name="Postgres 11",
        attributes={"eol_product": "postgresql", "eol_cycle": "11"},
    )
    manual = await create_card(
        db,
        card_type="ITComponent",
        name="Mainframe",
        lifecycle={"endOfLife": (TODAY + timedelta(days=30)).isoformat()},
    )
    bare = await create_card(db, card_type="ITComponent", name="Nothing recorded")
    archived = await create_card(
        db,
        card_type="ITComponent",
        name="Retired",
        status="ARCHIVED",
        lifecycle={"endOfLife": (TODAY - timedelta(days=10)).isoformat()},
    )
    hidden = await create_card(
        db,
        card_type="Hidden",
        name="Ghost",
        lifecycle={"endOfLife": (TODAY - timedelta(days=10)).isoformat()},
    )
    return {
        "linked": linked,
        "gone": gone,
        "manual": manual,
        "bare": bare,
        "archived": archived,
        "hidden": hidden,
    }


async def test_resolves_linked_and_manual_cards_and_omits_the_rest(env, _canned_cycles):
    load_registry(grants=["core.cards.read"])
    data = ExtensionData(KEY)
    ids = [str(env[k].id) for k in ("linked", "gone", "manual", "bare", "archived", "hidden")]

    out = await data.get_eol_status(ids)

    assert set(out) == {str(env["linked"].id), str(env["gone"].id), str(env["manual"].id)}
    linked = out[str(env["linked"].id)]
    assert linked.source == "api"
    assert linked.status == "approaching"
    assert linked.eol_product == "postgresql"
    assert linked.eol_cycle == "13"
    assert linked.eol_date == (TODAY + timedelta(days=90)).isoformat()
    assert linked.latest == "13.22"
    assert out[str(env["gone"].id)].status == "eol"
    manual = out[str(env["manual"].id)]
    assert manual.source == "manual"
    assert manual.status == "approaching"
    assert manual.eol_product is None
    assert manual.eol_date == (TODAY + timedelta(days=30)).isoformat()
    # One upstream round-trip for the product, however many cards link it.
    assert _canned_cycles == [{"postgresql"}]


async def test_requires_the_inventory_read_grant(env):
    load_registry(grants=["core.todos.read"])
    data = ExtensionData(KEY)
    with pytest.raises(ExtensionPermissionError):
        await data.get_eol_status([str(env["linked"].id)])


async def test_refuses_malformed_ids_and_answers_empty_for_none(env):
    load_registry(grants=["core.cards.read"])
    data = ExtensionData(KEY)
    assert await data.get_eol_status([]) == {}
    with pytest.raises(ExtensionDataError):
        await data.get_eol_status(["not-a-uuid"])
    with pytest.raises(ExtensionDataError):
        await data.get_eol_status([str(env["linked"].id)] * (bridge_mod.MAX_IDS_PER_CALL + 1))


async def test_fetches_outside_the_session(env, db, monkeypatch):
    """The endoflife.date call must run with the lookup session already
    closed: a slow upstream must never pin a pool connection."""
    load_registry(grants=["core.cards.read"])
    data = ExtensionData(KEY)
    state = {"open": 0, "open_during_fetch": None}

    @asynccontextmanager
    async def counting_session():
        state["open"] += 1
        try:
            yield db
        finally:
            state["open"] -= 1

    async def fake_resolve(cards):
        state["open_during_fetch"] = state["open"]
        return {}

    monkeypatch.setattr(bridge_mod, "async_session", counting_session)
    monkeypatch.setattr(bridge_mod, "resolve_eol_statuses", fake_resolve)
    await data.get_eol_status([str(env["linked"].id)])
    assert state["open_during_fetch"] == 0
