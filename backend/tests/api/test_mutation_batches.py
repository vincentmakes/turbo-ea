"""Tests for the mutation-batch CRUD + change-history endpoints."""

from __future__ import annotations

import pytest

from tests.conftest import auth_headers, create_user


@pytest.mark.asyncio
async def test_open_dry_run_batch_below_threshold_no_token(client, admin_user):
    resp = await client.post(
        "/api/v1/mutation-batches?row_count=5",
        json={"tool_name": "create_cards_bulk", "dry_run": True},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 201, resp.text
    payload = resp.json()
    assert payload["tool_name"] == "create_cards_bulk"
    assert payload["dry_run"] is True
    assert payload["committed_at"] is None
    # 5 rows < default threshold (20) → no token issued
    assert payload["confirm_token"] is None


@pytest.mark.asyncio
async def test_open_dry_run_batch_above_threshold_issues_token(client, admin_user):
    resp = await client.post(
        "/api/v1/mutation-batches?row_count=25",
        json={"tool_name": "create_cards_bulk", "dry_run": True},
        headers=auth_headers(admin_user),
    )
    payload = resp.json()
    assert payload["confirm_token"] is not None
    assert len(payload["confirm_token"]) >= 16


@pytest.mark.asyncio
async def test_commit_requires_matching_token_when_issued(client, admin_user):
    open_resp = await client.post(
        "/api/v1/mutation-batches?row_count=30",
        json={"tool_name": "create_cards_bulk", "dry_run": True},
        headers=auth_headers(admin_user),
    )
    batch_id = open_resp.json()["id"]
    token = open_resp.json()["confirm_token"]

    # Commit without the token → 400
    resp_no_token = await client.post(
        f"/api/v1/mutation-batches/{batch_id}/commit",
        json={"summary": {"rows": 30, "status": "ok"}},
        headers=auth_headers(admin_user),
    )
    assert resp_no_token.status_code == 400

    # Commit with bogus token → 400
    resp_bad = await client.post(
        f"/api/v1/mutation-batches/{batch_id}/commit",
        json={"confirm_token": "not-the-right-token", "summary": {}},
        headers=auth_headers(admin_user),
    )
    assert resp_bad.status_code == 400

    # Commit with the real token → 200, committed_at set
    resp_ok = await client.post(
        f"/api/v1/mutation-batches/{batch_id}/commit",
        json={"confirm_token": token, "summary": {"rows": 30, "status": "ok"}},
        headers=auth_headers(admin_user),
    )
    assert resp_ok.status_code == 200, resp_ok.text
    assert resp_ok.json()["committed_at"] is not None
    assert resp_ok.json()["summary"] == {"rows": 30, "status": "ok"}


@pytest.mark.asyncio
async def test_commit_idempotent_rejection(client, admin_user):
    open_resp = await client.post(
        "/api/v1/mutation-batches?row_count=1",
        json={"tool_name": "update_cards_bulk", "dry_run": False},
        headers=auth_headers(admin_user),
    )
    batch_id = open_resp.json()["id"]
    first = await client.post(
        f"/api/v1/mutation-batches/{batch_id}/commit",
        json={},
        headers=auth_headers(admin_user),
    )
    assert first.status_code == 200
    second = await client.post(
        f"/api/v1/mutation-batches/{batch_id}/commit",
        json={},
        headers=auth_headers(admin_user),
    )
    assert second.status_code == 409


@pytest.mark.asyncio
async def test_cross_actor_commit_forbidden(client, admin_user, db, member_role):
    open_resp = await client.post(
        "/api/v1/mutation-batches?row_count=1",
        json={"tool_name": "update_cards_bulk", "dry_run": False},
        headers=auth_headers(admin_user),
    )
    batch_id = open_resp.json()["id"]
    other = await create_user(db, email="other-actor@test.com", role="member")
    resp = await client.post(
        f"/api/v1/mutation-batches/{batch_id}/commit",
        json={},
        headers=auth_headers(other),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_batches_requires_admin_events(client, admin_user, db, member_role):
    # Open one batch as admin so the list is non-empty
    await client.post(
        "/api/v1/mutation-batches?row_count=1",
        json={"tool_name": "create_cards_bulk", "dry_run": False},
        headers=auth_headers(admin_user),
    )

    # Member without admin.events → 403
    member = await create_user(db, email="non-auditor@test.com", role="member")
    resp = await client.get("/api/v1/mutation-batches", headers=auth_headers(member))
    assert resp.status_code == 403

    # Admin → 200 with at least the batch we opened. The list endpoint
    # returns a `{items, total, page, page_size}` envelope so the audit-
    # log UI can paginate; assert against `items`.
    resp = await client.get("/api/v1/mutation-batches", headers=auth_headers(admin_user))
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["page"] == 1
    assert payload["page_size"] == 50
    assert payload["total"] >= 1
    assert len(payload["items"]) >= 1


@pytest.mark.asyncio
async def test_events_stamped_with_batch_id_via_header(client, admin_user, app_card_type):
    """End-to-end: open a batch, perform a write while echoing the
    ``X-Turbo-EA-Batch`` header, and confirm the resulting event row
    carries the batch id."""
    open_resp = await client.post(
        "/api/v1/mutation-batches?row_count=1",
        json={"tool_name": "create_cards_bulk", "dry_run": False},
        headers={**auth_headers(admin_user), "X-Turbo-EA-Origin": "mcp"},
    )
    batch_id = open_resp.json()["id"]

    create_resp = await client.post(
        "/api/v1/cards",
        json={
            "type": "Application",
            "name": "Batched App",
        },
        headers={
            **auth_headers(admin_user),
            "X-Turbo-EA-Origin": "mcp",
            "X-Turbo-EA-Batch": batch_id,
        },
    )
    assert create_resp.status_code in (200, 201), create_resp.text

    history = await client.get(
        f"/api/v1/mutation-batches/{batch_id}/events",
        headers=auth_headers(admin_user),
    )
    assert history.status_code == 200, history.text
    events = history.json()["events"]
    assert any(e["event_type"].startswith("card.") for e in events), events
