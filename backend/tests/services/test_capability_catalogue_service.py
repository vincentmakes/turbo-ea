"""Tests for the capability catalogue service.

The `turbo_ea_capabilities` package may not be installed in the test
environment yet (it's a new external dependency). We patch the service's
module-local `catalogue_pkg` attribute with a small in-memory fixture so
the service behaviour can be validated end-to-end without the real wheel —
and the patch wins regardless of when the service module was first imported.
"""

from __future__ import annotations

import types
from typing import Any

import pytest
from sqlalchemy import select

from app.models.card import Card
from tests.conftest import create_card, create_user

# ---------------------------------------------------------------------------
# Fake catalogue package
# ---------------------------------------------------------------------------

_FAKE_CATALOGUE: list[dict[str, Any]] = [
    {
        "id": "BC-1",
        "name": "Customer Management",
        "level": 1,
        "parent_id": None,
        "description": "Top-level customer capability",
        "aliases": [],
        "owner": None,
        "tags": [],
        "industry": None,
        "references": [],
        "in_scope": [],
        "out_of_scope": [],
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    },
    {
        "id": "BC-1.1",
        "name": "Customer Acquisition",
        "level": 2,
        "parent_id": "BC-1",
        "description": "Acquire new customers",
        "aliases": [],
        "owner": None,
        "tags": [],
        "industry": "Retail",
        "references": [],
        "in_scope": [],
        "out_of_scope": [],
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    },
    {
        "id": "BC-1.1.1",
        "name": "Lead Capture",
        "level": 3,
        "parent_id": "BC-1.1",
        "description": "Capture leads",
        "aliases": [],
        "owner": None,
        "tags": [],
        "industry": None,
        "references": [],
        "in_scope": [],
        "out_of_scope": [],
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    },
    {
        "id": "BC-2",
        "name": "Finance",
        "level": 1,
        "parent_id": None,
        "description": "Top-level finance capability",
        "aliases": [],
        "owner": None,
        "tags": [],
        "industry": None,
        "references": [],
        "in_scope": [],
        "out_of_scope": [],
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    },
]


class _FakeCap:
    def __init__(self, **kw: Any) -> None:
        for k, v in kw.items():
            setattr(self, k, v)


def _install_fake_pkg(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replace `catalogue_pkg` inside the service module with an in-memory fake.

    Patching the attribute directly on the already-imported service module
    bypasses any sys.modules / import-order issues — the swap takes effect
    immediately even if the service was loaded earlier (e.g. via the FastAPI
    app fixture).
    """
    fake = types.ModuleType("turbo_ea_capabilities")
    fake.VERSION = "1.2.3"
    fake.SCHEMA_VERSION = "1"
    fake.GENERATED_AT = "2026-04-25T12:00:00Z"
    fake.NODE_COUNT = len(_FAKE_CATALOGUE)
    fake.Capability = _FakeCap
    fake.load_all = lambda: [_FakeCap(**c) for c in _FAKE_CATALOGUE]
    fake.load_tree = lambda: [_FakeCap(**c) for c in _FAKE_CATALOGUE if c["parent_id"] is None]
    from app.services import capability_catalogue_service as svc

    monkeypatch.setattr(svc, "catalogue_pkg", fake)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_catalogue_payload_marks_existing_by_name(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    # Already-existing card whose name matches BC-1.1 (case + whitespace differ)
    existing = await create_card(
        db,
        card_type="BusinessCapability",
        name="  customer  ACQUISITION  ",
        user_id=user.id,
    )

    payload = await svc.get_catalogue_payload(db)

    by_id = {c["id"]: c for c in payload["capabilities"]}
    assert by_id["BC-1.1"]["existing_card_id"] == str(existing.id)
    assert by_id["BC-1"]["existing_card_id"] is None
    assert by_id["BC-1.1.1"]["existing_card_id"] is None
    assert payload["version"]["catalogue_version"] == "1.2.3"
    assert payload["version"]["source"] == "bundled"


@pytest.mark.asyncio
async def test_import_creates_hierarchy_and_skips_existing(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    # Pre-existing match for BC-1.1: child BC-1.1.1 should graft onto it.
    existing_parent = await create_card(
        db, card_type="BusinessCapability", name="Customer Acquisition", user_id=user.id
    )

    result = await svc.import_capabilities(
        db,
        user=user,
        catalogue_ids=["BC-1.1", "BC-1.1.1"],
    )

    assert len(result["created"]) == 1
    assert len(result["skipped"]) == 1
    assert result["skipped"][0]["catalogue_id"] == "BC-1.1"
    created_child_cat = result["created"][0]["catalogue_id"]
    assert created_child_cat == "BC-1.1.1"

    # The newly-created BC-1.1.1 card must point at the existing parent.
    rows = (
        (await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BC-1.1.1")))
        .scalars()
        .all()
    )
    assert len(rows) == 1
    new_child = rows[0]
    assert str(new_child.parent_id) == str(existing_parent.id)
    assert new_child.attributes["capabilityLevel"] == "L3"
    assert new_child.attributes["catalogueVersion"] == "1.2.3"


@pytest.mark.asyncio
async def test_import_is_idempotent_on_rerun(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    first = await svc.import_capabilities(db, user=user, catalogue_ids=["BC-1", "BC-1.1"])
    assert len(first["created"]) == 2

    second = await svc.import_capabilities(db, user=user, catalogue_ids=["BC-1", "BC-1.1"])
    assert len(second["created"]) == 0
    assert len(second["skipped"]) == 2


@pytest.mark.asyncio
async def test_import_wires_parent_to_just_created_sibling(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    result = await svc.import_capabilities(
        db, user=user, catalogue_ids=["BC-1", "BC-1.1", "BC-1.1.1"]
    )
    assert len(result["created"]) == 3

    rows = {
        r.attributes["catalogueId"]: r
        for r in (await db.execute(select(Card).where(Card.type == "BusinessCapability")))
        .scalars()
        .all()
    }
    assert rows["BC-1"].parent_id is None
    assert str(rows["BC-1.1"].parent_id) == str(rows["BC-1"].id)
    assert str(rows["BC-1.1.1"].parent_id) == str(rows["BC-1.1"].id)


@pytest.mark.asyncio
async def test_import_grafts_new_child_onto_existing_parent_not_in_selection(db, monkeypatch):
    """Selecting only a child while its catalogue parent already exists locally
    must wire the new child's parent_id to the existing parent card."""
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    existing_parent = await create_card(
        db, card_type="BusinessCapability", name="Customer Acquisition", user_id=user.id
    )

    result = await svc.import_capabilities(db, user=user, catalogue_ids=["BC-1.1.1"])

    assert len(result["created"]) == 1
    new_child = (
        (await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BC-1.1.1")))
        .scalars()
        .one()
    )
    assert str(new_child.parent_id) == str(existing_parent.id)
    assert result["relinked"] == []


@pytest.mark.asyncio
async def test_import_relinks_existing_children_to_new_parent(db, monkeypatch):
    """Selecting only a parent while its catalogue children already exist
    locally with parent_id=NULL must re-parent those children under the new
    card."""
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    existing_child = await create_card(
        db, card_type="BusinessCapability", name="Lead Capture", user_id=user.id
    )
    assert existing_child.parent_id is None

    result = await svc.import_capabilities(db, user=user, catalogue_ids=["BC-1.1"])

    assert len(result["created"]) == 1
    assert len(result["relinked"]) == 1
    assert result["relinked"][0]["catalogue_id"] == "BC-1.1.1"

    new_parent = (
        (await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BC-1.1")))
        .scalars()
        .one()
    )
    await db.refresh(existing_child)
    assert str(existing_child.parent_id) == str(new_parent.id)


@pytest.mark.asyncio
async def test_import_preserves_manual_nesting_when_creating_parent(db, monkeypatch):
    """Existing children that already have a non-null parent_id (a manual
    nesting) must NOT be re-parented when the catalogue parent is created."""
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    other_root = await create_card(
        db, card_type="BusinessCapability", name="Other Root", user_id=user.id
    )
    child = await create_card(
        db,
        card_type="BusinessCapability",
        name="Lead Capture",
        user_id=user.id,
        parent_id=other_root.id,
    )

    result = await svc.import_capabilities(db, user=user, catalogue_ids=["BC-1.1"])

    assert len(result["created"]) == 1
    assert result["relinked"] == []
    await db.refresh(child)
    assert str(child.parent_id) == str(other_root.id)


@pytest.mark.asyncio
async def test_import_relinks_via_catalogue_id_after_rename(db, monkeypatch):
    """A previously-imported child whose display name has since been edited
    by the user must still be matched on its `attributes.catalogueId` and
    re-parented under the newly-created catalogue parent."""
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    # Existing top-level card whose name no longer matches the catalogue
    # ("Lead Capture") but whose catalogueId still flags it as BC-1.1.1.
    renamed_child = await create_card(
        db,
        card_type="BusinessCapability",
        name="Inbound Lead Intake (renamed)",
        user_id=user.id,
        attributes={"catalogueId": "BC-1.1.1", "catalogueVersion": "0.1.0"},
    )
    assert renamed_child.parent_id is None

    result = await svc.import_capabilities(db, user=user, catalogue_ids=["BC-1.1"])

    assert len(result["created"]) == 1
    assert len(result["relinked"]) == 1
    assert result["relinked"][0]["catalogue_id"] == "BC-1.1.1"

    new_parent = (
        (await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BC-1.1")))
        .scalars()
        .one()
    )
    await db.refresh(renamed_child)
    assert str(renamed_child.parent_id) == str(new_parent.id)


@pytest.mark.asyncio
async def test_version_tuple_handles_double_digit(monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services.capability_catalogue_service import _version_tuple

    assert _version_tuple("1.10.0") > _version_tuple("1.9.0")
    assert _version_tuple("2.0.0") > _version_tuple("1.99.99")
    assert _version_tuple("0") == (0,)
