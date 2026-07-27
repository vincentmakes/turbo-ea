"""Integration tests for the Risk Register API.

Focused on the spreadsheet importer (`POST /risks/bulk-import`):

* Dry-run preview persists nothing and emits no side effects.
* A real import creates rows with sequential `R-NNNNNN` references.
* Bad enum values fail the individual row, not the batch.
* Unresolved owner / card names produce non-blocking warnings but still import.
* The endpoint is gated on `risks.manage`.
"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.risk import Risk, RiskCard
from app.models.todo import Todo
from tests.conftest import auth_headers, create_card, create_role, create_user

BULK_IMPORT = "/api/v1/risks/bulk-import"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@example.com", role="admin")
    member = await create_user(
        db, email="member@example.com", role="member", display_name="Mona Member"
    )
    viewer = await create_user(db, email="viewer@example.com", role="viewer")
    return {"admin": admin, "member": member, "viewer": viewer}


async def _risk_count(db) -> int:
    res = await db.execute(select(func.count()).select_from(Risk))
    return int(res.scalar_one())


# ---------------------------------------------------------------------------
# Dry run
# ---------------------------------------------------------------------------


async def test_dry_run_previews_without_persisting(client, db, env):
    before = await _risk_count(db)
    resp = await client.post(
        BULK_IMPORT,
        json={
            "dry_run": True,
            "items": [
                {"row_index": 0, "title": "Data breach exposure"},
                {"row_index": 1, "title": "Vendor lock-in"},
            ],
        },
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["dry_run"] is True
    assert body["created"] == 2
    assert body["failed"] == 0
    assert all(r["status"] == "created" for r in body["results"])
    # Dry-run preview allocates references but rolls everything back.
    assert all(r["reference"] for r in body["results"])
    assert await _risk_count(db) == before


# ---------------------------------------------------------------------------
# Real import
# ---------------------------------------------------------------------------


async def test_import_creates_rows_with_sequential_references(client, db, env):
    resp = await client.post(
        BULK_IMPORT,
        json={
            "items": [
                {
                    "row_index": 0,
                    "title": "Critical outage",
                    "category": "operational",
                    "initial_probability": "high",
                    "initial_impact": "critical",
                    "status": "analysed",
                },
                {"row_index": 1, "title": "Budget overrun", "category": "financial"},
            ],
        },
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 2
    assert body["failed"] == 0

    refs = [r["reference"] for r in body["results"]]
    nums = sorted(int(r.split("-")[1]) for r in refs)
    assert nums[1] == nums[0] + 1  # sequential

    res = await db.execute(select(Risk).where(Risk.title == "Critical outage"))
    risk = res.scalar_one()
    assert risk.category == "operational"
    assert risk.initial_probability == "high"
    assert risk.initial_impact == "critical"
    # derive_level(high, critical) == critical
    assert risk.initial_level == "critical"
    assert risk.status == "analysed"
    assert risk.source_type == "manual"


async def test_import_case_insensitive_enums(client, db, env):
    resp = await client.post(
        BULK_IMPORT,
        json={
            "items": [
                {
                    "row_index": 0,
                    "title": "Mixed case",
                    "category": "Security",
                    "initial_probability": "HIGH",
                    "initial_impact": "Low",
                }
            ]
        },
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    assert resp.json()["created"] == 1
    res = await db.execute(select(Risk).where(Risk.title == "Mixed case"))
    risk = res.scalar_one()
    assert risk.category == "security"
    assert risk.initial_probability == "high"
    assert risk.initial_impact == "low"


# ---------------------------------------------------------------------------
# Per-row failures
# ---------------------------------------------------------------------------


async def test_bad_enum_fails_only_that_row(client, db, env):
    resp = await client.post(
        BULK_IMPORT,
        json={
            "items": [
                {"row_index": 0, "title": "Good row"},
                {"row_index": 1, "title": "Bad category", "category": "nonsense"},
                {"row_index": 2, "title": "Bad probability", "initial_probability": "maybe"},
            ]
        },
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 1
    assert body["failed"] == 2
    by_row = {r["row_index"]: r for r in body["results"]}
    assert by_row[0]["status"] == "created"
    assert by_row[1]["status"] == "failed"
    assert "category" in by_row[1]["error"].lower()
    assert by_row[2]["status"] == "failed"

    # The one good row still persisted.
    res = await db.execute(select(Risk).where(Risk.title == "Good row"))
    assert res.scalar_one_or_none() is not None


async def test_all_rows_fail_persists_nothing(client, db, env):
    before = await _risk_count(db)
    resp = await client.post(
        BULK_IMPORT,
        json={"items": [{"row_index": 0, "title": "Bad", "status": "frozen"}]},
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    assert resp.json()["created"] == 0
    assert resp.json()["failed"] == 1
    assert await _risk_count(db) == before


# ---------------------------------------------------------------------------
# Skip rows whose reference already exists
# ---------------------------------------------------------------------------


async def test_existing_reference_is_skipped(client, db, env):
    # Seed a risk, then import a file that references it plus a new row.
    existing = Risk(
        reference="R-000001",
        title="Pre-existing risk",
        description="",
        category="operational",
        source_type="manual",
        initial_probability="medium",
        initial_impact="medium",
        initial_level="medium",
        status="identified",
    )
    db.add(existing)
    await db.flush()

    before = await _risk_count(db)
    resp = await client.post(
        BULK_IMPORT,
        json={
            "items": [
                {"row_index": 0, "title": "Pre-existing risk", "reference": "R-000001"},
                {"row_index": 1, "title": "Genuinely new"},
            ]
        },
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 1
    assert body["skipped"] == 1
    assert body["failed"] == 0
    by_row = {r["row_index"]: r for r in body["results"]}
    assert by_row[0]["status"] == "skipped"
    assert by_row[0]["reference"] == "R-000001"
    assert by_row[1]["status"] == "created"
    # Only the new row was persisted; the duplicate did not create a second copy.
    assert await _risk_count(db) == before + 1


async def test_reference_match_is_case_insensitive(client, db, env):
    db.add(
        Risk(
            reference="R-000042",
            title="Existing",
            description="",
            category="operational",
            source_type="manual",
            initial_probability="medium",
            initial_impact="medium",
            initial_level="medium",
            status="identified",
        )
    )
    await db.flush()
    resp = await client.post(
        BULK_IMPORT,
        json={"items": [{"row_index": 0, "title": "Dup", "reference": " r-000042 "}]},
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["skipped"] == 1
    assert body["created"] == 0


async def test_blank_reference_always_creates(client, db, env):
    resp = await client.post(
        BULK_IMPORT,
        json={
            "items": [
                {"row_index": 0, "title": "No ref", "reference": ""},
                {"row_index": 1, "title": "Null ref", "reference": None},
            ]
        },
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 2
    assert body["skipped"] == 0


# ---------------------------------------------------------------------------
# Best-effort owner + card resolution
# ---------------------------------------------------------------------------


async def test_owner_resolved_by_email(client, db, env):
    resp = await client.post(
        BULK_IMPORT,
        json={
            "items": [
                {
                    "row_index": 0,
                    "title": "Owned risk",
                    "owner_email": "Member@Example.com",
                }
            ]
        },
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 1
    assert body["results"][0]["warnings"] == []
    res = await db.execute(select(Risk).where(Risk.title == "Owned risk"))
    risk = res.scalar_one()
    assert risk.owner_id == env["member"].id
    # Owner assignment spawns a system Todo on the owner.
    todo_res = await db.execute(
        select(Todo).where(Todo.assigned_to == env["member"].id, Todo.is_system.is_(True))
    )
    assert todo_res.scalar_one_or_none() is not None


async def test_unknown_owner_warns_but_imports(client, db, env):
    resp = await client.post(
        BULK_IMPORT,
        json={"items": [{"row_index": 0, "title": "Orphan", "owner_email": "ghost@example.com"}]},
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 1
    assert body["results"][0]["status"] == "created"
    assert any("ghost@example.com" in w for w in body["results"][0]["warnings"])
    res = await db.execute(select(Risk).where(Risk.title == "Orphan"))
    assert res.scalar_one().owner_id is None


async def test_card_linked_by_name_and_unknown_warns(client, db, env):
    card = await create_card(db, name="NexaCore ERP", user_id=env["admin"].id)
    resp = await client.post(
        BULK_IMPORT,
        json={
            "items": [
                {
                    "row_index": 0,
                    "title": "Linked risk",
                    "card_names": ["NexaCore ERP", "Does Not Exist"],
                }
            ]
        },
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 1
    assert any("Does Not Exist" in w for w in body["results"][0]["warnings"])

    res = await db.execute(select(Risk).where(Risk.title == "Linked risk"))
    risk = res.scalar_one()
    link_res = await db.execute(select(RiskCard).where(RiskCard.risk_id == risk.id))
    links = link_res.scalars().all()
    assert len(links) == 1
    assert links[0].card_id == card.id


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


async def test_viewer_cannot_import(client, db, env):
    resp = await client.post(
        BULK_IMPORT,
        json={"items": [{"row_index": 0, "title": "Nope"}]},
        headers=auth_headers(env["viewer"]),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Affected-card filtering on GET /risks (+ /metrics, + task export).
#
# Semantics under test (discussion #876): repeated `card_id` values OR
# together, repeated `card_type` values OR together, and the two dimensions
# AND with each other — exactly like the status / category / level filters.
# ---------------------------------------------------------------------------


@pytest.fixture
async def linked_risks(client, db, env):
    """Three risks over three cards of two different types.

    * app_a  -> "Alpha risk"
    * app_b  -> "Beta risk"
    * comp_c -> "Gamma risk"
    * app_a + comp_c -> "Delta risk" (the cross-type one)
    """
    app_a = await create_card(db, name="App A", card_type="Application", user_id=env["admin"].id)
    app_b = await create_card(db, name="App B", card_type="Application", user_id=env["admin"].id)
    comp_c = await create_card(db, name="Comp C", card_type="ITComponent", user_id=env["admin"].id)

    async def mk(title: str, cards: list) -> str:
        resp = await client.post(
            "/api/v1/risks",
            json={"title": title, "card_ids": [str(c.id) for c in cards]},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200, resp.text
        return resp.json()["id"]

    await mk("Alpha risk", [app_a])
    await mk("Beta risk", [app_b])
    await mk("Gamma risk", [comp_c])
    await mk("Delta risk", [app_a, comp_c])
    return {"app_a": app_a, "app_b": app_b, "comp_c": comp_c}


async def _titles(client, env, query: str) -> set[str]:
    resp = await client.get(f"/api/v1/risks?{query}", headers=auth_headers(env["admin"]))
    assert resp.status_code == 200, resp.text
    return {r["title"] for r in resp.json()["items"]}


async def test_single_card_id_still_filters(client, db, env, linked_risks):
    """Backwards compatibility: the pre-existing single-value form is unchanged."""
    titles = await _titles(client, env, f"card_id={linked_risks['app_a'].id}")
    assert titles == {"Alpha risk", "Delta risk"}


async def test_repeated_card_id_unions_rather_than_intersects(client, db, env, linked_risks):
    titles = await _titles(
        client, env, f"card_id={linked_risks['app_a'].id}&card_id={linked_risks['app_b'].id}"
    )
    assert titles == {"Alpha risk", "Beta risk", "Delta risk"}


async def test_card_type_filters_to_risks_touching_that_type(client, db, env, linked_risks):
    assert await _titles(client, env, "card_type=Application") == {
        "Alpha risk",
        "Beta risk",
        "Delta risk",
    }
    assert await _titles(client, env, "card_type=ITComponent") == {"Gamma risk", "Delta risk"}


async def test_repeated_card_type_unions(client, db, env, linked_risks):
    titles = await _titles(client, env, "card_type=Application&card_type=ITComponent")
    assert titles == {"Alpha risk", "Beta risk", "Gamma risk", "Delta risk"}


async def test_card_id_and_card_type_intersect(client, db, env, linked_risks):
    """AND across dimensions: "affects App A *and* touches an ITComponent"."""
    titles = await _titles(client, env, f"card_id={linked_risks['app_a'].id}&card_type=ITComponent")
    assert titles == {"Delta risk"}


async def test_unknown_card_type_matches_nothing(client, db, env, linked_risks):
    assert await _titles(client, env, "card_type=NoSuchType") == set()


async def test_malformed_card_id_is_rejected(client, db, env, linked_risks):
    resp = await client.get(
        f"/api/v1/risks?card_id={linked_risks['app_a'].id}&card_id=not-a-uuid",
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 400


async def test_metrics_honours_the_card_filters(client, db, env, linked_risks):
    """The KPI tiles and matrix ride the same pipeline as the list."""
    resp = await client.get(
        "/api/v1/risks/metrics?card_type=ITComponent", headers=auth_headers(env["admin"])
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 2

    resp = await client.get(
        f"/api/v1/risks/metrics?card_id={linked_risks['app_b'].id}",
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 1


async def test_mitigation_task_export_honours_the_card_filters(client, db, env, linked_risks):
    """Sheet 2 of the register export must match sheet 1's filter set."""
    beta_id = None
    listing = await client.get("/api/v1/risks", headers=auth_headers(env["admin"]))
    for row in listing.json()["items"]:
        if row["title"] == "Beta risk":
            beta_id = row["id"]
    assert beta_id

    resp = await client.post(
        f"/api/v1/risks/{beta_id}/mitigation-tasks",
        json={"title": "Patch App B"},
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200, resp.text

    resp = await client.get(
        f"/api/v1/risks/mitigation-tasks/export?card_id={linked_risks['app_b'].id}",
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    assert [t["title"] for t in resp.json()] == ["Patch App B"]

    # A filter that excludes Beta risk must drop its task too.
    resp = await client.get(
        f"/api/v1/risks/mitigation-tasks/export?card_id={linked_risks['comp_c'].id}",
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_legacy_source_type_never_blanks_the_register(client, db, env):
    """A row carrying a retired source_type (the pre-release 'ppm' value)
    must not fail response validation and 500 the whole list — the
    register looked empty to users even though every row was intact.
    Migration 127 rewrites such rows; risk_to_dict coerces stragglers."""
    from app.services.risk_service import next_reference

    good = Risk(
        reference=await next_reference(db),
        title="Normal risk",
        description="",
        category="operational",
        source_type="manual",
        initial_probability="medium",
        initial_impact="medium",
        initial_level="medium",
        status="identified",
    )
    db.add(good)
    await db.flush()
    legacy = Risk(
        reference=await next_reference(db),
        title="Promoted long ago",
        description="",
        category="operational",
        source_type="ppm",
        initial_probability="medium",
        initial_impact="medium",
        initial_level="medium",
        status="identified",
    )
    db.add(legacy)
    await db.flush()

    resp = await client.get("/api/v1/risks", headers=auth_headers(env["admin"]))
    assert resp.status_code == 200, resp.text
    rows = {r["title"]: r for r in resp.json()["items"]}
    assert "Normal risk" in rows and "Promoted long ago" in rows
    assert rows["Promoted long ago"]["source_type"] == "manual"
