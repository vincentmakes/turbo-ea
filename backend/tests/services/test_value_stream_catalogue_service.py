"""Tests for the value-stream catalogue service.

Value Streams are flattened to a 2-level tree (stream parent + stage
children) before reaching the browser, and during import each stage card is
auto-linked to existing capability and process cards via `relBizCtxToBC`
(stage → capability) and `relProcessToBizCtx` (process → stage) relations.
"""

from __future__ import annotations

import types
import uuid
from typing import Any

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.models.event import Event
from app.models.relation import Relation
from app.services import catalogue_common as common
from tests.conftest import create_card, create_card_type, create_user

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
    assert {k: version[k] for k in ("schema_version", "generated_at", "fetched_at")} == {
        "schema_version": "2",
        "generated_at": "2026-10-01T00:00:00Z",
        "fetched_at": "2026-10-02T00:00:00Z",
    }
    assert version["available_locales"] == ["en"]
    assert version["active_locale"] == "en"


@pytest.mark.asyncio
@pytest.mark.parametrize("cached_version", ["2.0.0", "1.9.9"])
async def test_a_cache_no_newer_than_the_wheel_is_ignored(db, monkeypatch, cached_version):
    _install_fake_pkg(monkeypatch)
    from app.services import value_stream_catalogue_service as svc

    await _cache_remote(db, svc, catalogue_version=cached_version)
    payload = await svc.get_catalogue_payload(db)
    names = {n["name"] for n in payload["value_streams"]}
    assert "Acquire-to-Retire v3" not in names
    assert (payload["version"]["source"], payload["version"]["bundled_version"]) == (
        "bundled",
        "2.0.0",
    )


@pytest.mark.asyncio
async def test_a_stored_count_is_reported_as_stored(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import value_stream_catalogue_service as svc

    await _cache_remote(db, svc, value_stream_count=42)
    payload = await svc.get_catalogue_payload(db)
    assert payload["version"]["value_stream_count"] == 42


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


# ---------------------------------------------------------------------------
# A stage name two streams share (the 2026.9 wheel has 7 such names)
# ---------------------------------------------------------------------------


def _two_streams_sharing_a_stage_name() -> list[dict[str, Any]]:
    return [
        {
            "id": "VS-30",
            "name": "Hire to Retire",
            "stages": [{"id": "VS-30.20", "stage_order": 20, "stage_name": "Application Intake"}],
        },
        {
            "id": "VS-50",
            "name": "Quote to Bind",
            "stages": [{"id": "VS-50.10", "stage_order": 10, "stage_name": "Application Intake"}],
        },
    ]


@pytest.mark.asyncio
async def test_a_stage_name_another_stream_shares_is_not_that_streams_card(db, monkeypatch):
    """Importing one stream's "Application Intake" used to mark the other
    stream's stage of the same name as already imported; importing that stream
    then skipped its stage and moved the first stream's stage card under it."""
    _install_fake_pkg(monkeypatch)
    from app.services import value_stream_catalogue_service as svc

    monkeypatch.setattr(common, "load_bundled_value_streams_raw", _two_streams_sharing_a_stage_name)
    user = await create_user(db, email="vs-dup@x.com")
    first = await svc.import_value_streams(db, user=user, catalogue_ids=["VS-30.20"])
    ids = {c["catalogue_id"]: c["card_id"] for c in first["created"]}
    assert list(ids) == ["VS-30", "VS-30.20"]

    payload = await svc.get_catalogue_payload(db)
    existing = {n["id"]: n["existing_card_id"] for n in payload["value_streams"]}
    assert existing == {
        "VS-30": ids["VS-30"],
        "VS-30.20": ids["VS-30.20"],
        "VS-50": None,
        "VS-50.10": None,
    }

    second = await svc.import_value_streams(db, user=user, catalogue_ids=["VS-50.10"])
    assert [c["catalogue_id"] for c in second["created"]] == ["VS-50", "VS-50.10"]
    assert second["skipped"] == []
    assert second["relinked"] == []
    first_stage = await db.get(Card, uuid.UUID(ids["VS-30.20"]))
    await db.refresh(first_stage)
    assert str(first_stage.parent_id) == ids["VS-30"]


@pytest.mark.asyncio
async def test_imported_stream_and_stage_attributes(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import value_stream_catalogue_service as svc

    user = await create_user(db, email="vs-attrs@x.com")
    result = await svc.import_value_streams(db, user=user, catalogue_ids=["VS-10.20"])
    ids = {c["catalogue_id"]: c["card_id"] for c in result["created"]}
    assert list(ids) == ["VS-10", "VS-10.20"]
    stream = await db.get(Card, uuid.UUID(ids["VS-10"]))
    stage = await db.get(Card, uuid.UUID(ids["VS-10.20"]))
    stream_attrs = dict(stream.attributes)
    stage_attrs = dict(stage.attributes)
    imported_at = stream_attrs.pop("catalogueImportedAt")
    assert isinstance(imported_at, str) and imported_at.startswith("20")
    assert stage_attrs.pop("catalogueImportedAt") == imported_at
    assert stream_attrs == {
        "catalogueId": "VS-10",
        "catalogueVersion": "2.0.0",
        "valueStreamLevel": "Stream",
        "industries": ["Cross-Industry"],
        "stageCount": 2,
    }
    # The stage inherits the stream's industries and carries its variant.
    assert stage_attrs == {
        "catalogueId": "VS-10.20",
        "catalogueVersion": "2.0.0",
        "valueStreamLevel": "Stage",
        "stageOrder": 2,
        "stageName": "Asset Construction",
        "industries": ["Cross-Industry"],
        "industryVariant": "Manufacturing",
        "capabilityIds": ["BC-2"],
    }
    assert (stream.type, stream.subtype, stream.name) == (
        "BusinessContext",
        "valueStream",
        "Acquire-to-Retire",
    )
    assert stage.name == "Asset Construction (Manufacturing)"
    assert stream.description == "Asset lifecycle stream"
    assert stage.created_by == user.id


@pytest.mark.asyncio
async def test_a_stage_order_of_zero_is_kept(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import value_stream_catalogue_service as svc

    streams = [
        {"id": "VS-1", "name": "S", "stages": [{"id": "VS-1.0", "stage_order": 0}]},
    ]
    monkeypatch.setattr(common, "load_bundled_value_streams_raw", lambda: streams)
    user = await create_user(db, email="vs-zero@x.com")
    result = await svc.import_value_streams(db, user=user, catalogue_ids=["VS-1.0"])
    ids = {c["catalogue_id"]: c["card_id"] for c in result["created"]}
    stage = await db.get(Card, uuid.UUID(ids["VS-1.0"]))
    assert stage.attributes["stageOrder"] == 0
    # a stage with no name of its own falls back to its catalogue id
    assert stage.name == "VS-1.0"


@pytest.mark.asyncio
async def test_an_existing_stage_moves_under_its_new_stream_and_says_so(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import value_stream_catalogue_service as svc

    user = await create_user(db, email="vs-relink@x.com")
    stage = await create_card(
        db,
        card_type="BusinessContext",
        subtype="valueStream",
        name="Renamed stage",
        user_id=user.id,
        attributes={"catalogueId": "VS-10.10"},
    )
    result = await svc.import_value_streams(db, user=user, catalogue_ids=["VS-10"])
    stream_id = {c["catalogue_id"]: c["card_id"] for c in result["created"]}["VS-10"]
    assert result["relinked"] == [
        {"catalogue_id": "VS-10.10", "card_id": str(stage.id), "new_parent_card_id": stream_id}
    ]
    await db.refresh(stage)
    assert str(stage.parent_id) == stream_id
    events = (await db.execute(select(Event).where(Event.card_id == stage.id))).scalars().all()
    assert [(e.event_type, e.data["changes"]) for e in events] == [
        ("card.updated", {"parent_id": {"old": None, "new": stream_id}})
    ]


@pytest.mark.asyncio
async def test_imported_streams_and_stages_record_their_creation_and_level(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.models.event import Event
    from app.services import value_stream_catalogue_service as svc

    await create_card_type(db, key="BusinessContext", label="Business Context", has_hierarchy=True)
    user = await create_user(db, email="vs-path@x.com")
    # A stage alone pulls its stream in first, so two cards land: stream, stage.
    result = await svc.import_value_streams(db, user=user, catalogue_ids=["VS-10.10"])

    assert [c["catalogue_id"] for c in result["created"]] == ["VS-10", "VS-10.10"]
    assert result["failed"] == []
    stream, stage = [
        (await db.execute(select(Card).where(Card.id == uuid.UUID(c["card_id"])))).scalar_one()
        for c in result["created"]
    ]
    assert stage.parent_id == stream.id
    assert (stream.attributes["hierarchyLevel"], stage.attributes["hierarchyLevel"]) == (1, 2)
    for card in (stream, stage):
        events = (await db.execute(select(Event).where(Event.card_id == card.id))).scalars().all()
        assert [(e.event_type, e.user_id) for e in events] == [("card.created", user.id)]
