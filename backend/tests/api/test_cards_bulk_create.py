"""Integration tests for `POST /cards/bulk-create` and `POST /cards/resolve-refs`."""

from __future__ import annotations

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation_type,
    create_role,
    create_user,
)


@pytest.fixture
async def bulk_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_card_type(db, key="Organization", label="Organization", has_hierarchy=True)
    await create_card_type(db, key="Application", label="Application", has_hierarchy=True)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "viewer": viewer}


async def test_bulk_create_simple_rows(client, db, bulk_env):
    """Two unrelated cards: both should land as `created`."""
    admin = bulk_env["admin"]
    payload = {
        "cards": [
            {"row_index": 1, "type": "Application", "name": "App A"},
            {"row_index": 2, "type": "Application", "name": "App B"},
        ]
    }
    resp = await client.post("/api/v1/cards/bulk-create", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 2
    assert body["failed"] == 0
    assert [r["status"] for r in body["results"]] == ["created", "created"]


async def test_bulk_create_rejects_duplicate_row_index(client, db, bulk_env):
    """Duplicate `row_index` values (the multi-sheet importer bug in #767)
    must be rejected loudly rather than silently collapsing rows — the
    handler keys parent-resolution / result maps by `row_index`, so a
    duplicate would drop a card while reporting success for both."""
    admin = bulk_env["admin"]
    payload = {
        "cards": [
            {"row_index": 2, "type": "Application", "name": "App from sheet 1"},
            {"row_index": 2, "type": "Organization", "name": "Org from sheet 2"},
        ]
    }
    resp = await client.post("/api/v1/cards/bulk-create", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 422
    assert "row_index" in resp.json()["detail"]
    # Nothing should have been created.
    listing = await client.get("/api/v1/cards", headers=auth_headers(admin))
    names = {c["name"] for c in listing.json()["items"]}
    assert "App from sheet 1" not in names
    assert "Org from sheet 2" not in names


async def test_bulk_create_resolves_same_batch_parent_by_name(client, db, bulk_env):
    """A child row whose parent is created in the same batch must resolve
    against that newly-created parent — this is the whole point of the
    server-side topological sort."""
    admin = bulk_env["admin"]
    payload = {
        "cards": [
            # Intentionally out-of-order: child listed first so the topo
            # sort is doing real work.
            {
                "row_index": 1,
                "type": "Organization",
                "name": "Sales",
                "parent_path": [],
                "parent_name": "NexaTech",
            },
            {"row_index": 2, "type": "Organization", "name": "NexaTech"},
        ]
    }
    resp = await client.post("/api/v1/cards/bulk-create", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 2, body
    # The Sales row should reference NexaTech as parent.
    sales_id = next(r["id"] for r in body["results"] if r["row_index"] == 1)
    nexa_id = next(r["id"] for r in body["results"] if r["row_index"] == 2)
    list_resp = await client.get(f"/api/v1/cards/{sales_id}", headers=auth_headers(admin))
    assert list_resp.json()["parent_id"] == nexa_id


async def test_bulk_create_unknown_parent_fails_that_row(client, db, bulk_env):
    """A row pointing at a non-existent parent should fail that row only —
    other rows in the same batch must still succeed."""
    admin = bulk_env["admin"]
    payload = {
        "cards": [
            {"row_index": 1, "type": "Application", "name": "Standalone"},
            {
                "row_index": 2,
                "type": "Application",
                "name": "Orphan",
                "parent_name": "Ghost",
            },
        ]
    }
    resp = await client.post("/api/v1/cards/bulk-create", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 1
    assert body["failed"] == 1
    failed = next(r for r in body["results"] if r["row_index"] == 2)
    assert "Parent not found" in (failed["error"] or "")


async def test_bulk_create_viewer_forbidden(client, db, bulk_env):
    viewer = bulk_env["viewer"]
    payload = {"cards": [{"row_index": 1, "type": "Application", "name": "X"}]}
    resp = await client.post(
        "/api/v1/cards/bulk-create", json=payload, headers=auth_headers(viewer)
    )
    assert resp.status_code == 403


async def test_bulk_create_dry_run_validates_without_persisting(client, db, bulk_env):
    """Used by the MCP `create_cards_bulk` tool to preview before commit:
    every validator and resolver runs, but the transaction is rolled back
    so the inventory stays untouched."""
    admin = bulk_env["admin"]
    payload = {
        "cards": [
            {"row_index": 1, "type": "Application", "name": "PreviewApp"},
            {
                "row_index": 2,
                "type": "Application",
                "name": "PreviewChild",
                "parent_name": "PreviewApp",
            },
        ],
        "dry_run": True,
    }
    resp = await client.post("/api/v1/cards/bulk-create", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["dry_run"] is True
    assert body["created"] == 2  # would-be-created
    assert body["failed"] == 0
    # No rows persisted — listing Application cards returns nothing of ours.
    list_resp = await client.get(
        "/api/v1/cards", params={"type": "Application"}, headers=auth_headers(admin)
    )
    names = [c["name"] for c in list_resp.json().get("items", [])]
    assert "PreviewApp" not in names
    assert "PreviewChild" not in names


async def test_bulk_create_tags_mcp_origin_on_events(client, db, bulk_env):
    """The `X-Turbo-EA-Origin: mcp` header from the MCP server flows
    through to the audit log: `card.created` events carry `origin: "mcp"`
    in their data payload so admins can filter the timeline."""
    from sqlalchemy import select

    from app.models.event import Event

    admin = bulk_env["admin"]
    payload = {"cards": [{"row_index": 1, "type": "Application", "name": "OriginApp"}]}
    headers = {**auth_headers(admin), "X-Turbo-EA-Origin": "mcp"}
    resp = await client.post("/api/v1/cards/bulk-create", json=payload, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["created"] == 1
    rows = (
        (
            await db.execute(
                select(Event).where(Event.event_type == "card.created").order_by(Event.id.desc())
            )
        )
        .scalars()
        .all()
    )
    assert rows, "no card.created event recorded"
    assert rows[0].data.get("origin") == "mcp"


async def test_bulk_create_no_origin_when_header_absent(client, db, bulk_env):
    """The audit log stays clean of origin tags for plain UI / API calls
    so pre-existing rows are not retroactively rewritten."""
    from sqlalchemy import select

    from app.models.event import Event

    admin = bulk_env["admin"]
    payload = {"cards": [{"row_index": 1, "type": "Application", "name": "WebApp"}]}
    resp = await client.post("/api/v1/cards/bulk-create", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200
    rows = (
        (
            await db.execute(
                select(Event).where(Event.event_type == "card.created").order_by(Event.id.desc())
            )
        )
        .scalars()
        .all()
    )
    assert rows
    assert "origin" not in rows[0].data


async def test_bulk_create_dry_run_then_commit(client, db, bulk_env):
    """Same payload, dry-run first then commit: rows only appear after commit."""
    admin = bulk_env["admin"]
    payload_rows = [
        {"row_index": 1, "type": "Application", "name": "TwoPhaseApp"},
    ]
    # 1. Dry-run.
    preview = await client.post(
        "/api/v1/cards/bulk-create",
        json={"cards": payload_rows, "dry_run": True},
        headers=auth_headers(admin),
    )
    assert preview.json()["dry_run"] is True
    list_resp = await client.get(
        "/api/v1/cards", params={"type": "Application"}, headers=auth_headers(admin)
    )
    assert "TwoPhaseApp" not in [c["name"] for c in list_resp.json().get("items", [])]
    # 2. Commit.
    commit = await client.post(
        "/api/v1/cards/bulk-create",
        json={"cards": payload_rows, "dry_run": False},
        headers=auth_headers(admin),
    )
    assert commit.json()["created"] == 1
    list_resp = await client.get(
        "/api/v1/cards", params={"type": "Application"}, headers=auth_headers(admin)
    )
    assert "TwoPhaseApp" in [c["name"] for c in list_resp.json().get("items", [])]


async def test_resolve_refs_resolved_and_ambiguous_and_missing(client, db, bulk_env):
    admin = bulk_env["admin"]
    nexa = await create_card(db, card_type="Organization", name="NexaTech", user_id=admin.id)
    sales = await create_card(
        db, card_type="Organization", name="Sales", parent_id=nexa.id, user_id=admin.id
    )
    eng = await create_card(
        db, card_type="Organization", name="Engineering", parent_id=nexa.id, user_id=admin.id
    )
    await create_card(db, card_type="Application", name="CRM", parent_id=sales.id, user_id=admin.id)
    await create_card(db, card_type="Application", name="CRM", parent_id=eng.id, user_id=admin.id)
    erp = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    await db.commit()

    payload = {
        "refs": [
            {"row": 1, "column": "rel:supports", "type": "Application", "ref": "ERP"},
            {"row": 2, "column": "rel:supports", "type": "Application", "ref": "CRM"},
            {
                "row": 3,
                "column": "rel:supports",
                "type": "Application",
                "ref": "NexaTech / Sales / CRM",
            },
            {
                "row": 4,
                "column": "rel:supports",
                "type": "Application",
                "ref": "DoesNotExist",
            },
        ]
    }
    resp = await client.post(
        "/api/v1/cards/resolve-refs", json=payload, headers=auth_headers(admin)
    )
    assert resp.status_code == 200, resp.text
    results = {r["row"]: r for r in resp.json()["results"]}
    assert results[1]["status"] == "resolved"
    assert results[1]["id"] == str(erp.id)
    assert results[2]["status"] == "ambiguous"
    assert len(results[2]["candidates"]) == 2
    assert results[3]["status"] == "resolved"
    assert results[4]["status"] == "missing"


# ---------------------------------------------------------------------------
# Combined cards + relations in one transaction (empty-instance / new-card
# import). Relations are applied AFTER cards in the same transaction, so the
# resolver sees same-batch cards — including hierarchical ones referenced by
# bare name, which the old two-request flow could not resolve.
# ---------------------------------------------------------------------------


async def test_bulk_create_combined_resolves_same_batch_hierarchical_target(client, db, bulk_env):
    """Create hierarchical cards + a relation whose target is a same-batch
    CHILD card referenced by BARE name. The post-create resolver must resolve
    it — the exact case that failed when importing a full export into an empty
    instance."""
    admin = bulk_env["admin"]
    await create_relation_type(
        db,
        key="app_to_org",
        label="App to Org",
        source_type_key="Application",
        target_type_key="Organization",
    )
    await db.commit()

    payload = {
        "cards": [
            {"row_index": 1, "type": "Organization", "name": "Corp"},
            {
                "row_index": 2,
                "type": "Organization",
                "name": "Sales",
                "parent_path": [],
                "parent_name": "Corp",
            },
            {"row_index": 3, "type": "Application", "name": "CRM"},
        ],
        "relations": [
            {
                "row_index": 1,
                "action": "upsert",
                "type": "app_to_org",
                "source": {"type": "Application", "name": "CRM"},
                # Bare name for a hierarchical (child) target — resolves only
                # because the resolver is (re)loaded after the cards exist.
                "target": {"type": "Organization", "name": "Sales"},
            }
        ],
    }
    resp = await client.post("/api/v1/cards/bulk-create", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["created"] == 3, body
    assert body["relations_upserted"] == 1, body
    assert body["relations_failed"] == 0, body
    assert body["relation_results"][0]["status"] == "upserted"

    # Persisted: the relation between CRM and Sales exists.
    rels = await client.get("/api/v1/relations", headers=auth_headers(admin))
    assert any(r["type"] == "app_to_org" for r in rels.json()), rels.json()


async def test_bulk_create_combined_dry_run_persists_nothing(client, db, bulk_env):
    """Combined dry-run reports both card and relation outcomes but rolls the
    whole transaction back — nothing is persisted."""
    admin = bulk_env["admin"]
    await create_relation_type(
        db,
        key="app_to_org",
        label="App to Org",
        source_type_key="Application",
        target_type_key="Organization",
    )
    await db.commit()

    payload = {
        "dry_run": True,
        "cards": [
            {"row_index": 1, "type": "Organization", "name": "Corp"},
            {"row_index": 2, "type": "Application", "name": "CRM"},
        ],
        "relations": [
            {
                "row_index": 1,
                "action": "upsert",
                "type": "app_to_org",
                "source": {"type": "Application", "name": "CRM"},
                "target": {"type": "Organization", "name": "Corp"},
            }
        ],
    }
    resp = await client.post("/api/v1/cards/bulk-create", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["dry_run"] is True
    assert body["created"] == 2
    assert body["relations_upserted"] == 1

    # Nothing persisted by the preview.
    listing = await client.get("/api/v1/cards", headers=auth_headers(admin))
    assert listing.json()["total"] == 0, listing.json()
    rels = await client.get("/api/v1/relations", headers=auth_headers(admin))
    assert rels.json() == []


async def test_bulk_create_combined_reports_unresolved_relation(client, db, bulk_env):
    """Cards still create; a relation to a non-existent target is reported as
    failed rather than blocking the card creation."""
    admin = bulk_env["admin"]
    await create_relation_type(
        db,
        key="app_to_org",
        label="App to Org",
        source_type_key="Application",
        target_type_key="Organization",
    )
    await db.commit()

    payload = {
        "cards": [
            {"row_index": 1, "type": "Application", "name": "CRM"},
        ],
        "relations": [
            {
                "row_index": 1,
                "action": "upsert",
                "type": "app_to_org",
                "source": {"type": "Application", "name": "CRM"},
                "target": {"type": "Organization", "name": "Ghost"},
            }
        ],
    }
    resp = await client.post("/api/v1/cards/bulk-create", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["created"] == 1
    assert body["relations_upserted"] == 0
    assert body["relations_failed"] == 1
    assert body["relation_results"][0]["status"] == "failed"


async def test_bulk_create_combined_requires_relations_permission(client, db):
    """A role with inventory.create but not relations.manage is rejected when
    the request carries relations."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="creator",
        label="Creator",
        permissions={"inventory.create": True, "inventory.view": True},
    )
    await create_card_type(db, key="Organization", label="Organization", has_hierarchy=True)
    await create_card_type(db, key="Application", label="Application", has_hierarchy=True)
    await create_relation_type(
        db,
        key="app_to_org",
        label="App to Org",
        source_type_key="Application",
        target_type_key="Organization",
    )
    creator = await create_user(db, email="creator@test.com", role="creator")
    await db.commit()

    payload = {
        "cards": [{"row_index": 1, "type": "Application", "name": "CRM"}],
        "relations": [
            {
                "row_index": 1,
                "action": "upsert",
                "type": "app_to_org",
                "source": {"type": "Application", "name": "CRM"},
                "target": {"type": "Organization", "name": "Corp"},
            }
        ],
    }
    resp = await client.post(
        "/api/v1/cards/bulk-create", json=payload, headers=auth_headers(creator)
    )
    assert resp.status_code == 403, resp.text
