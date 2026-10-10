"""Tests for the business-process catalogue service.

The behavioural surface mirrors the capability catalogue (idempotent import,
parent-before-child ordering, hierarchy preservation through `cards.parent_id`).
The new piece is auto-creating `relProcessToBC` relations for every
`realizes_capability_ids` entry whose target BusinessCapability card already
exists locally — and skipping silently when the target is missing.

Tests patch `catalogue_pkg` on the service module with a small in-memory
fixture so the suite never needs the real wheel installed.
"""

from __future__ import annotations

import types
import uuid
from typing import Any

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.models.relation import Relation
from app.services import catalogue_common as common
from tests.conftest import create_card, create_user

# ---------------------------------------------------------------------------
# Fake catalogue
# ---------------------------------------------------------------------------

# Three-level slice: BP-100 (Category) → BP-100.10 (Group) → BP-100.10.10
# (Process). BP-100 realises BC-1; BP-100.10 realises BC-1 + BC-2 (so we can
# verify auto-relations land on multiple targets).
_FAKE_PROCESSES: list[dict[str, Any]] = [
    {
        "id": "BP-100",
        "name": "Acquire, Construct, and Manage Assets",
        "level": 1,
        "parent_id": None,
        "description": "Top-level asset category",
        "aliases": [],
        "industry": "Cross-Industry",
        "references": [],
        "framework_refs": [
            {"framework": "APQC-PCF", "external_id": "10.0", "version": "8.0", "url": None}
        ],
        "realizes_capability_ids": ["BC-1"],
        "in_scope": [],
        "out_of_scope": [],
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    },
    {
        "id": "BP-100.10",
        "name": "Plan and Acquire Assets",
        "level": 2,
        "parent_id": "BP-100",
        "description": "Plan + acquire facilities & equipment",
        "aliases": [],
        "industry": "Cross-Industry",
        "references": [],
        "framework_refs": [
            {"framework": "APQC-PCF", "external_id": "10.1", "version": "8.0", "url": None}
        ],
        "realizes_capability_ids": ["BC-1", "BC-2"],
        "in_scope": [],
        "out_of_scope": [],
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    },
    {
        "id": "BP-100.10.10",
        "name": "Develop Property Strategy",
        "level": 3,
        "parent_id": "BP-100.10",
        "description": "Long-term vision for managing properties",
        "aliases": [],
        "industry": "Cross-Industry",
        "references": [],
        "framework_refs": [],
        "realizes_capability_ids": [],
        "in_scope": [],
        "out_of_scope": [],
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    },
]


def _install_fake_pkg(monkeypatch: pytest.MonkeyPatch) -> None:
    """Patch the bundled-data readers + the catalogue_pkg constants.

    The JSON-bypass helpers were promoted from this service module to
    ``catalogue_common`` so all three catalogues share them. Tests now
    monkeypatch ``common.load_bundled_processes_raw`` /
    ``common.bundled_i18n_table`` rather than the per-service copies.
    """
    fake = types.ModuleType("turbo_ea_capabilities")
    fake.VERSION = "2.0.0"
    fake.SCHEMA_VERSION = "2"
    fake.GENERATED_AT = "2026-05-09T15:00:00Z"
    fake.NODE_COUNT = 4
    fake.PROCESS_COUNT = len(_FAKE_PROCESSES)
    fake.available_locales = lambda: ("en",)

    from app.services import process_catalogue_service as svc

    monkeypatch.setattr(svc, "catalogue_pkg", fake)
    monkeypatch.setattr(common, "load_bundled_processes_raw", lambda: list(_FAKE_PROCESSES))
    monkeypatch.setattr(common, "bundled_i18n_table", lambda locale: None)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_payload_returns_processes_with_existing_card_id(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import process_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    existing = await create_card(
        db,
        card_type="BusinessProcess",
        name="Plan and Acquire Assets",
        user_id=user.id,
    )

    payload = await svc.get_catalogue_payload(db)
    by_id = {p["id"]: p for p in payload["processes"]}

    assert by_id["BP-100.10"]["existing_card_id"] == str(existing.id)
    assert by_id["BP-100"]["existing_card_id"] is None
    assert payload["version"]["catalogue_version"] == "2.0.0"
    assert payload["version"]["source"] == "bundled"


@pytest.mark.asyncio
async def test_import_creates_subtype_per_level(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import process_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    result = await svc.import_processes(
        db,
        user=user,
        catalogue_ids=["BP-100", "BP-100.10", "BP-100.10.10"],
    )

    assert len(result["created"]) == 3
    rows = {
        r.attributes["catalogueId"]: r
        for r in (await db.execute(select(Card).where(Card.type == "BusinessProcess")))
        .scalars()
        .all()
    }
    assert rows["BP-100"].subtype == "category"
    assert rows["BP-100.10"].subtype == "group"
    assert rows["BP-100.10.10"].subtype == "process"

    # Hierarchy wired correctly.
    assert rows["BP-100"].parent_id is None
    assert str(rows["BP-100.10"].parent_id) == str(rows["BP-100"].id)
    assert str(rows["BP-100.10.10"].parent_id) == str(rows["BP-100.10"].id)


@pytest.mark.asyncio
async def test_import_creates_relations_to_existing_capabilities(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import process_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    # Pre-populate two capability cards that the fake processes reference.
    bc1 = await create_card(
        db,
        card_type="BusinessCapability",
        name="Customer Management",
        user_id=user.id,
        attributes={"catalogueId": "BC-1"},
    )
    bc2 = await create_card(
        db,
        card_type="BusinessCapability",
        name="Finance",
        user_id=user.id,
        attributes={"catalogueId": "BC-2"},
    )

    result = await svc.import_processes(db, user=user, catalogue_ids=["BP-100", "BP-100.10"])
    assert len(result["created"]) == 2
    # BP-100 realizes BC-1 (1 relation), BP-100.10 realizes BC-1 + BC-2 (2 relations).
    assert result["auto_relations_created"] == 3

    rels = (
        (await db.execute(select(Relation).where(Relation.type == "relProcessToBC")))
        .scalars()
        .all()
    )
    rel_pairs = {(str(r.source_id), str(r.target_id)) for r in rels}

    bp100 = (
        await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BP-100"))
    ).scalar_one()
    bp100_10 = (
        await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BP-100.10"))
    ).scalar_one()

    assert (str(bp100.id), str(bc1.id)) in rel_pairs
    assert (str(bp100_10.id), str(bc1.id)) in rel_pairs
    assert (str(bp100_10.id), str(bc2.id)) in rel_pairs


@pytest.mark.asyncio
async def test_import_skips_realizes_relation_when_target_missing(db, monkeypatch):
    """No matching BC card → no relation created (and no error)."""
    _install_fake_pkg(monkeypatch)
    from app.services import process_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    # No BC cards in the DB at all.
    result = await svc.import_processes(db, user=user, catalogue_ids=["BP-100"])
    assert len(result["created"]) == 1
    assert result["auto_relations_created"] == 0

    rels = (
        (await db.execute(select(Relation).where(Relation.type == "relProcessToBC")))
        .scalars()
        .all()
    )
    assert rels == []

    # The catalogue-supplied list is still preserved on the card so a future
    # import of BC-1 can find it for re-linking.
    row = (
        await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BP-100"))
    ).scalar_one()
    assert row.attributes["realizesCapabilityIds"] == ["BC-1"]


@pytest.mark.asyncio
async def test_import_auto_relations_idempotent_on_rerun(db, monkeypatch):
    """Re-importing the same processes mustn't double up the auto-relations."""
    _install_fake_pkg(monkeypatch)
    from app.services import process_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    await create_card(
        db,
        card_type="BusinessCapability",
        name="Customer Management",
        user_id=user.id,
        attributes={"catalogueId": "BC-1"},
    )

    first = await svc.import_processes(db, user=user, catalogue_ids=["BP-100"])
    assert first["auto_relations_created"] == 1

    second = await svc.import_processes(db, user=user, catalogue_ids=["BP-100"])
    # Card already exists → skipped, no new auto-relations.
    assert second["created"] == []
    assert second["auto_relations_created"] == 0

    rels = (
        (await db.execute(select(Relation).where(Relation.type == "relProcessToBC")))
        .scalars()
        .all()
    )
    assert len(rels) == 1


@pytest.mark.asyncio
async def test_import_persists_framework_refs_and_attributes(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import process_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    await svc.import_processes(db, user=user, catalogue_ids=["BP-100"])

    row = (
        await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BP-100"))
    ).scalar_one()
    assert row.attributes["processLevel"] == "L1"
    assert row.attributes["industry"] == "Cross-Industry"
    assert row.attributes["frameworkRefs"] == [
        {"framework": "APQC-PCF", "external_id": "10.0", "version": "8.0", "url": None}
    ]
    assert row.attributes["realizesCapabilityIds"] == ["BC-1"]


# ---------------------------------------------------------------------------
# A newer catalogue cached from the store
# ---------------------------------------------------------------------------


async def _cache_processes(db, svc, **extra):
    await common.set_cached_remote(
        db,
        {
            svc.SETTINGS_KEY: {
                "data": [dict(_FAKE_PROCESSES[0], name="Acquire Assets v9")],
                "catalogue_version": "9.0.0",
                "generated_at": "2026-10-01T00:00:00Z",
                "fetched_at": "2026-10-02T00:00:00Z",
                **extra,
            }
        },
    )


@pytest.mark.asyncio
async def test_a_newer_cached_catalogue_is_served_and_described(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import process_catalogue_service as svc

    await _cache_processes(db, svc, process_count=7)
    payload = await svc.get_catalogue_payload(db)
    assert [p["name"] for p in payload["processes"]] == ["Acquire Assets v9"]
    assert payload["version"] == {
        "catalogue_version": "9.0.0",
        "schema_version": "",  # the cache stored none
        "generated_at": "2026-10-01T00:00:00Z",
        "process_count": 7,
        "source": "remote",
        "fetched_at": "2026-10-02T00:00:00Z",
        "bundled_version": "2.0.0",
        "available_locales": ["en"],
        "active_locale": "en",
    }


@pytest.mark.asyncio
async def test_a_cached_catalogue_is_served_in_the_requested_language(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import process_catalogue_service as svc

    await _cache_processes(db, svc, i18n={"fr": {"BP-100": {"name": "Acquérir des actifs"}}})
    payload = await svc.get_catalogue_payload(db, locale="fr")
    assert [p["name"] for p in payload["processes"]] == ["Acquérir des actifs"]
    assert payload["version"]["active_locale"] == "fr"
    assert payload["version"]["available_locales"] == ["en", "fr"]


@pytest.mark.asyncio
async def test_a_cache_without_a_version_is_ignored(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import process_catalogue_service as svc

    await common.set_cached_remote(
        db, {svc.SETTINGS_KEY: {"data": [dict(_FAKE_PROCESSES[0], name="Unversioned")]}}
    )
    payload = await svc.get_catalogue_payload(db)
    assert payload["version"]["source"] == "bundled"
    assert "Unversioned" not in {p["name"] for p in payload["processes"]}


@pytest.mark.asyncio
async def test_imported_process_attributes_and_subtype(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import process_catalogue_service as svc

    procs = [
        {
            "id": "BP-9.1.1.1",
            "name": "Log the claim",
            "level": 4,
            "parent_id": None,
            "description": "An activity",
            "aliases": ["Claim intake"],
            "industry": "Insurance",
            "references": ["https://example.invalid/apqc"],
            "framework_refs": [{"framework": "APQC-PCF", "external_id": "9.1.1.1"}],
            "realizes_capability_ids": ["BC-404"],
            "in_scope": ["Phone"],
            "out_of_scope": ["Fraud"],
            "deprecated": True,
        }
    ]
    monkeypatch.setattr(common, "load_bundled_processes_raw", lambda: list(procs))
    user = await create_user(db, email="proc-attrs@x.com")
    result = await svc.import_processes(db, user=user, catalogue_ids=["BP-9.1.1.1"])
    # BC-404 has no card, so no relation is created for it
    assert result["auto_relations_created"] == 0
    card_id = result["created"][0]["card_id"]
    card = (await db.execute(select(Card).where(Card.id == uuid.UUID(card_id)))).scalar_one()
    attrs = dict(card.attributes)
    assert isinstance(attrs.pop("catalogueImportedAt"), str)
    assert attrs == {
        "catalogueId": "BP-9.1.1.1",
        "catalogueVersion": "2.0.0",
        "processLevel": "L4",
        "aliases": ["Claim intake"],
        "industry": "Insurance",
        "references": ["https://example.invalid/apqc"],
        "frameworkRefs": [{"framework": "APQC-PCF", "external_id": "9.1.1.1"}],
        "realizesCapabilityIds": ["BC-404"],
        "inScope": ["Phone"],
        "outOfScope": ["Fraud"],
        "deprecated": True,
    }
    # APQC L4 ("Activity") has no subtype of its own and lands as a process
    assert card.subtype == "process"
