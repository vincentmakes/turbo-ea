"""Tests for the value-stream catalogue service.

Value Streams are flattened to a 2-level tree (stream parent + stage
children) before reaching the browser, and during import each stage card is
auto-linked to existing capability and process cards via `relBizCtxToBC`
(stage → capability) and `relProcessToBizCtx` (process → stage) relations.
"""

from __future__ import annotations

import types
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

_FAKE_VALUE_STREAMS: list[dict[str, Any]] = [
    {
        "id": "VS-10",
        "name": "Acquire-to-Retire",
        "description": "Asset lifecycle stream",
        "industries": ["Cross-Industry"],
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
        "stages": [
            {
                "id": "VS-10.10",
                "stage_order": 1,
                "stage_name": "Asset Need & Justification",
                "capability_ids": ["BC-1"],
                "process_ids": ["BP-100"],
                "industries": [],
                "industry_variant": None,
                "description": None,
                "notes": "Strategy + business case",
            },
            {
                "id": "VS-10.20",
                "stage_order": 2,
                "stage_name": "Asset Construction",
                "capability_ids": ["BC-2"],
                "process_ids": [],
                "industries": [],
                "industry_variant": "Manufacturing",
                "description": None,
                "notes": None,
            },
        ],
    }
]


def _install_fake_pkg(monkeypatch: pytest.MonkeyPatch) -> None:
    """Patch the bundled-data readers + the catalogue_pkg constants.

    The service no longer goes through the upstream Pydantic loader
    (data drift on any artefact type used to be able to break us — see
    catalogue_common's rationale). It reads the wheel's
    ``data/value-streams.json`` directly via
    ``common.load_bundled_value_streams_raw``. Tests have to swap out
    that helper plus the i18n table reader.
    """
    fake = types.ModuleType("turbo_ea_capabilities")
    fake.VERSION = "2.0.0"
    fake.SCHEMA_VERSION = "2"
    fake.GENERATED_AT = "2026-05-09T15:00:00Z"
    fake.NODE_COUNT = 5
    fake.PROCESS_COUNT = 1
    fake.available_locales = lambda: ("en",)

    from app.services import value_stream_catalogue_service as svc

    monkeypatch.setattr(svc, "catalogue_pkg", fake)
    monkeypatch.setattr(common, "load_bundled_value_streams_raw", lambda: list(_FAKE_VALUE_STREAMS))
    monkeypatch.setattr(common, "bundled_i18n_table", lambda locale: None)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_payload_flattens_streams_and_stages(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import value_stream_catalogue_service as svc

    payload = await svc.get_catalogue_payload(db)
    nodes = payload["value_streams"]
    by_id = {n["id"]: n for n in nodes}

    # Stream first, then both stages.
    assert by_id["VS-10"]["level"] == 1
    assert by_id["VS-10"]["parent_id"] is None
    assert by_id["VS-10.10"]["level"] == 2
    assert by_id["VS-10.10"]["parent_id"] == "VS-10"
    assert by_id["VS-10.20"]["parent_id"] == "VS-10"

    # Stage data round-tripped.
    assert by_id["VS-10.10"]["stage_order"] == 1
    assert by_id["VS-10.10"]["capability_ids"] == ["BC-1"]
    assert by_id["VS-10.10"]["process_ids"] == ["BP-100"]
    assert by_id["VS-10.20"]["industry_variant"] == "Manufacturing"


@pytest.mark.asyncio
async def test_import_creates_stream_then_stage_with_parent(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import value_stream_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    result = await svc.import_value_streams(
        db, user=user, catalogue_ids=["VS-10", "VS-10.10", "VS-10.20"]
    )
    assert len(result["created"]) == 3

    rows = {
        r.attributes["catalogueId"]: r
        for r in (
            await db.execute(
                select(Card).where(Card.type == "BusinessContext", Card.subtype == "valueStream")
            )
        )
        .scalars()
        .all()
    }
    assert rows["VS-10"].parent_id is None
    assert str(rows["VS-10.10"].parent_id) == str(rows["VS-10"].id)
    assert str(rows["VS-10.20"].parent_id) == str(rows["VS-10"].id)
    assert rows["VS-10"].attributes["valueStreamLevel"] == "Stream"
    assert rows["VS-10.10"].attributes["valueStreamLevel"] == "Stage"
    assert rows["VS-10.10"].attributes["stageOrder"] == 1
    assert rows["VS-10.20"].attributes["industryVariant"] == "Manufacturing"


@pytest.mark.asyncio
async def test_import_stage_alone_pulls_in_parent_stream(db, monkeypatch):
    """Selecting only a stage must auto-include the parent stream so the
    stage's parent_id is wired correctly."""
    _install_fake_pkg(monkeypatch)
    from app.services import value_stream_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    result = await svc.import_value_streams(db, user=user, catalogue_ids=["VS-10.10"])

    assert len(result["created"]) == 2  # stream + stage
    rows = {
        r.attributes["catalogueId"]: r
        for r in (
            await db.execute(
                select(Card).where(Card.type == "BusinessContext", Card.subtype == "valueStream")
            )
        )
        .scalars()
        .all()
    }
    assert "VS-10" in rows
    assert "VS-10.10" in rows
    assert str(rows["VS-10.10"].parent_id) == str(rows["VS-10"].id)


@pytest.mark.asyncio
async def test_import_creates_relations_to_existing_capabilities_and_processes(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import value_stream_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    bc1 = await create_card(
        db,
        card_type="BusinessCapability",
        name="Customer Management",
        user_id=user.id,
        attributes={"catalogueId": "BC-1"},
    )
    bp100 = await create_card(
        db,
        card_type="BusinessProcess",
        name="Acquire, Construct, and Manage Assets",
        user_id=user.id,
        attributes={"catalogueId": "BP-100"},
    )

    result = await svc.import_value_streams(db, user=user, catalogue_ids=["VS-10", "VS-10.10"])
    # Stage links: VS-10.10 → BC-1 (relBizCtxToBC) + BP-100 → VS-10.10 (relProcessToBizCtx).
    assert result["auto_relations_created"] == 2

    stage = (
        await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "VS-10.10"))
    ).scalar_one()

    bc_rels = (
        (
            await db.execute(
                select(Relation).where(
                    Relation.type == "relBizCtxToBC",
                    Relation.source_id == stage.id,
                    Relation.target_id == bc1.id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(bc_rels) == 1

    proc_rels = (
        (
            await db.execute(
                select(Relation).where(
                    Relation.type == "relProcessToBizCtx",
                    Relation.source_id == bp100.id,
                    Relation.target_id == stage.id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(proc_rels) == 1


@pytest.mark.asyncio
async def test_import_skips_relations_when_targets_missing(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import value_stream_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    result = await svc.import_value_streams(db, user=user, catalogue_ids=["VS-10", "VS-10.10"])
    assert result["auto_relations_created"] == 0

    stage = (
        await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "VS-10.10"))
    ).scalar_one()
    # Source ids preserved on attributes for future re-link.
    assert stage.attributes["capabilityIds"] == ["BC-1"]
    assert stage.attributes["processIds"] == ["BP-100"]


@pytest.mark.asyncio
async def test_import_idempotent_on_rerun(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import value_stream_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    first = await svc.import_value_streams(db, user=user, catalogue_ids=["VS-10", "VS-10.10"])
    assert len(first["created"]) == 2

    second = await svc.import_value_streams(db, user=user, catalogue_ids=["VS-10", "VS-10.10"])
    assert second["created"] == []
    assert len(second["skipped"]) == 2


async def _cache_remote(db, svc, **extra):
    await common.set_cached_remote(
        db,
        {
            svc.SETTINGS_KEY: {
                "data": [dict(_FAKE_VALUE_STREAMS[0], name="Acquire-to-Retire v3")],
                "catalogue_version": "9.0.0",  # newer than the fake bundled 2.0.0
                "schema_version": "2",
                "generated_at": "2026-10-01T00:00:00Z",
                "fetched_at": "2026-10-02T00:00:00Z",
                **extra,
            }
        },
    )


@pytest.mark.asyncio
async def test_a_newer_cached_catalogue_is_flattened_and_described(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import value_stream_catalogue_service as svc

    await _cache_remote(db, svc)
    payload = await svc.get_catalogue_payload(db)
    by_id = {n["id"]: n for n in payload["value_streams"]}
    assert by_id["VS-10"]["name"] == "Acquire-to-Retire v3"
    assert by_id["VS-10.20"]["parent_id"] == "VS-10"
    version = payload["version"]
    assert (version["source"], version["catalogue_version"], version["bundled_version"]) == (
        "remote",
        "9.0.0",
        "2.0.0",
    )
    assert version["value_stream_count"] == 1  # counted from the data when not stored


@pytest.mark.asyncio
async def test_a_cached_catalogue_without_tables_takes_the_bundled_translations(db, monkeypatch):
    # A cache stored before i18n tables were cached translates like the
    # capability and process catalogues: from the bundled package's table.
    _install_fake_pkg(monkeypatch)
    from app.services import value_stream_catalogue_service as svc

    svc.catalogue_pkg.available_locales = lambda: ("en", "fr")
    tables = {"fr": {"VS-10": {"name": "Acquérir-à-retirer"}}}
    monkeypatch.setattr(common, "bundled_i18n_table", lambda locale: tables.get(locale))
    await _cache_remote(db, svc)
    payload = await svc.get_catalogue_payload(db, locale="fr")
    by_id = {n["id"]: n for n in payload["value_streams"]}
    assert by_id["VS-10"]["name"] == "Acquérir-à-retirer"
    assert payload["version"]["active_locale"] == "fr"


@pytest.mark.asyncio
async def test_a_cached_table_wins_over_the_bundled_one(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import value_stream_catalogue_service as svc

    monkeypatch.setattr(
        common, "bundled_i18n_table", lambda locale: {"VS-10": {"name": "from the wheel"}}
    )
    await _cache_remote(db, svc, i18n={"de": {"VS-10": {"name": "Anschaffen bis Ausmustern"}}})
    payload = await svc.get_catalogue_payload(db, locale="de-CH")
    by_id = {n["id"]: n for n in payload["value_streams"]}
    assert by_id["VS-10"]["name"] == "Anschaffen bis Ausmustern"
    assert payload["version"]["active_locale"] == "de"
    english = await svc.get_catalogue_payload(db, locale="en")
    assert {n["id"]: n for n in english["value_streams"]}["VS-10"]["name"] == (
        "Acquire-to-Retire v3"
    )
