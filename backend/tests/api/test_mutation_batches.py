"""Tests for the mutation-batch CRUD + change-history endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.mutation_batch import MutationBatch
from app.services.mutation_batch_service import CONFIRM_TOKEN_TTL
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


async def _open(client, user, *, rows, dry_run, tool="update_cards_bulk", token=None):
    body: dict = {"tool_name": tool, "dry_run": dry_run}
    if token is not None:
        body["confirm_token"] = token
    return await client.post(
        f"/api/v1/mutation-batches?row_count={rows}",
        json=body,
        headers=auth_headers(user),
    )


async def _preview(client, user, *, rows=52, tool="update_cards_bulk") -> tuple[str, str]:
    """Open and close a dry-run the way the MCP wrapper does; return
    ``(batch_id, confirm_token)``."""
    resp = await _open(client, user, rows=rows, dry_run=True, tool=tool)
    assert resp.status_code == 201, resp.text
    batch_id, token = resp.json()["id"], resp.json()["confirm_token"]
    assert token
    closed = await client.post(
        f"/api/v1/mutation-batches/{batch_id}/commit",
        json={"summary": {"rows": rows, "would_update": rows}},
        headers=auth_headers(user),
    )
    assert closed.status_code == 200, closed.text
    return batch_id, token


async def _load(db, batch_id) -> MutationBatch:
    res = await db.execute(
        select(MutationBatch)
        .where(MutationBatch.id == uuid.UUID(str(batch_id)))
        .execution_options(populate_existing=True)
    )
    return res.scalar_one()


@pytest.mark.asyncio
async def test_a_dry_run_above_the_threshold_closes_without_a_token(client, admin_user):
    """#1302: the preview was refused at close, so every dry-run above 20
    rows failed with "Missing or invalid confirm_token"."""
    open_resp = await _open(client, admin_user, rows=52, dry_run=True)
    batch_id = open_resp.json()["id"]
    assert open_resp.json()["confirm_token"]

    resp = await client.post(
        f"/api/v1/mutation-batches/{batch_id}/commit",
        json={"summary": {"rows": 52, "would_update": 52}},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["committed_at"] is not None
    assert resp.json()["summary"] == {"rows": 52, "would_update": 52}


@pytest.mark.asyncio
async def test_closing_ignores_a_wrong_token_in_the_body(client, admin_user):
    # An MCP server older than 2.175.1 still sends one; closing no longer
    # checks it.
    open_resp = await _open(client, admin_user, rows=30, dry_run=True)
    batch_id = open_resp.json()["id"]
    resp = await client.post(
        f"/api/v1/mutation-batches/{batch_id}/commit",
        json={"confirm_token": "not-the-right-token", "summary": {}},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_a_commit_above_the_threshold_needs_a_token(client, admin_user):
    resp = await _open(client, admin_user, rows=21, dry_run=False)
    assert resp.status_code == 400
    # The MCP client surfaces this text verbatim to the agent, so it is
    # pinned whole: it tells the agent exactly what to do next.
    assert resp.json()["detail"] == (
        "confirm_token_required: a commit above 20 rows needs the confirm_token "
        "returned by a dry-run of the same tool. Re-run with dry_run=True, show "
        "the preview, then pass its confirm_token."
    )


@pytest.mark.asyncio
async def test_a_commit_at_the_threshold_needs_nothing(client, admin_user):
    resp = await _open(client, admin_user, rows=20, dry_run=False)
    assert resp.status_code == 201, resp.text
    assert resp.json()["confirm_token"] is None


@pytest.mark.asyncio
async def test_a_made_up_token_is_refused(client, admin_user):
    resp = await _open(client, admin_user, rows=52, dry_run=False, token="made-up-token")
    assert resp.status_code == 400
    assert resp.json()["detail"] == (
        "confirm_token_invalid: unknown (no dry-run issued this token). Re-run the "
        "dry-run to obtain a fresh token (tokens are single-use and expire 15 minutes "
        "after issue)."
    )


@pytest.mark.asyncio
async def test_closing_a_spent_preview_keeps_its_stamp(client, admin_user, db):
    """The wrapper closes the preview after the commit's batch opened when the
    agent's own close call arrives late; replacing the summary then would
    make the token reusable."""
    opened = await _open(client, admin_user, rows=52, dry_run=True)
    preview_id, token = opened.json()["id"], opened.json()["confirm_token"]
    real = await _open(client, admin_user, rows=52, dry_run=False, token=token)
    assert real.status_code == 201, real.text

    closed = await client.post(
        f"/api/v1/mutation-batches/{preview_id}/commit",
        json={"summary": {"rows": 52, "would_update": 52}},
        headers=auth_headers(admin_user),
    )
    assert closed.status_code == 200, closed.text
    assert closed.json()["summary"] == {
        "rows": 52,
        "would_update": 52,
        "confirmed_batch_id": real.json()["id"],
    }

    again = await _open(client, admin_user, rows=52, dry_run=False, token=token)
    assert again.status_code == 400
    assert again.json()["detail"].startswith("confirm_token_invalid: already_used")


@pytest.mark.asyncio
async def test_the_preview_token_authorises_one_commit(client, admin_user, db):
    preview_id, token = await _preview(client, admin_user)

    resp = await _open(client, admin_user, rows=52, dry_run=False, token=token)
    assert resp.status_code == 201, resp.text
    real_id = resp.json()["id"]
    assert resp.json()["dry_run"] is False

    real = await _load(db, real_id)
    assert real.confirm_token == token
    preview = await _load(db, preview_id)
    # The preview keeps the summary its close recorded, plus the stamp.
    assert preview.summary == {
        "rows": 52,
        "would_update": 52,
        "confirmed_batch_id": real_id,
    }

    again = await _open(client, admin_user, rows=52, dry_run=False, token=token)
    assert again.status_code == 400
    assert again.json()["detail"].startswith("confirm_token_invalid: already_used")
    assert "has already authorised a commit" in again.json()["detail"]


@pytest.mark.asyncio
async def test_a_token_a_real_batch_carries_is_not_an_issuer(client, admin_user):
    # The real batch stores the token as an audit cross-reference; it must
    # never count as a preview in its own right.
    _preview_id, token = await _preview(client, admin_user)
    assert (await _open(client, admin_user, rows=52, dry_run=False, token=token)).status_code == 201
    resp = await _open(client, admin_user, rows=52, dry_run=False, token=token)
    assert resp.json()["detail"].startswith("confirm_token_invalid: already_used")


@pytest.mark.asyncio
async def test_another_users_token_is_refused(client, admin_user, db, member_role):
    _preview_id, token = await _preview(client, admin_user)
    other = await create_user(db, email="token-thief@test.com", role="member")
    resp = await _open(client, other, rows=52, dry_run=False, token=token)
    assert resp.status_code == 400
    assert resp.json()["detail"].startswith("confirm_token_invalid: wrong_actor")
    assert "issued to another user" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_another_tools_token_is_refused(client, admin_user):
    _preview_id, token = await _preview(client, admin_user, tool="update_cards_bulk")
    resp = await _open(
        client, admin_user, rows=52, dry_run=False, tool="archive_cards", token=token
    )
    assert resp.status_code == 400
    assert resp.json()["detail"].startswith("confirm_token_invalid: wrong_tool")
    assert "a dry-run of another tool" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_an_expired_token_is_refused(client, admin_user, db):
    preview_id, token = await _preview(client, admin_user)
    preview = await _load(db, preview_id)
    preview.created_at = datetime.now(timezone.utc) - CONFIRM_TOKEN_TTL - timedelta(minutes=1)
    await db.flush()

    resp = await _open(client, admin_user, rows=52, dry_run=False, token=token)
    assert resp.status_code == 400
    assert resp.json()["detail"].startswith("confirm_token_invalid: expired")
    assert "older than 15 minutes" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_a_refused_open_creates_no_batch(client, admin_user, db):
    from sqlalchemy import func

    before = (await db.execute(select(func.count()).select_from(MutationBatch))).scalar_one()
    resp = await _open(client, admin_user, rows=52, dry_run=False, token="made-up-token")
    assert resp.status_code == 400
    after = (await db.execute(select(func.count()).select_from(MutationBatch))).scalar_one()
    assert after == before


@pytest.mark.asyncio
async def test_a_too_long_token_is_a_validation_error(client, admin_user):
    resp = await _open(client, admin_user, rows=52, dry_run=False, token="x" * 65)
    assert resp.status_code == 422


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
