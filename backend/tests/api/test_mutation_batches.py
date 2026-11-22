"""Tests for the mutation-batch CRUD + change-history endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.services.mutation_batch_service import CONFIRM_TOKEN_TTL
from tests.conftest import auth_headers, create_user


async def test_ownerless_batch_close_requires_an_owner(monkeypatch):
    from app.api.v1 import mutation_batches as routes
    from app.schemas.mutation_batch import MutationBatchCommit

    batch = SimpleNamespace(actor_user_id=None, committed_at=None)
    monkeypatch.setattr(routes, "get_batch", AsyncMock(return_value=batch))
    commit = AsyncMock()
    monkeypatch.setattr(routes, "commit_batch", commit)

    with pytest.raises(HTTPException) as exc:
        await routes.close_batch(
            uuid.uuid4(), MutationBatchCommit(), db=object(), user=SimpleNamespace(id=uuid.uuid4())
        )
    assert exc.value.status_code == 403
    commit.assert_not_awaited()


@pytest.mark.parametrize("dry_run", [True, False])
async def test_ownerless_rollback_requires_audit_permission(monkeypatch, dry_run):
    from app.api.v1 import mutation_batches as routes

    batch = SimpleNamespace(actor_user_id=None)
    monkeypatch.setattr(routes, "get_batch", AsyncMock(return_value=batch))
    permission = AsyncMock(side_effect=HTTPException(status_code=403))
    monkeypatch.setattr(routes.PermissionService, "require_permission", permission)

    with pytest.raises(HTTPException) as exc:
        await routes.rollback(
            uuid.uuid4(),
            routes.RollbackBody(dry_run=dry_run),
            db=object(),
            user=SimpleNamespace(id=uuid.uuid4()),
        )
    assert exc.value.status_code == 403
    assert permission.await_args.args[2] == "admin.events"


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


@pytest.mark.asyncio
async def test_batch_history_exposes_extension_entity_reference(
    client,
    admin_user,
    db,
):
    open_resp = await client.post(
        "/api/v1/mutation-batches?row_count=1",
        json={"tool_name": "extension_swot_update", "dry_run": False},
        headers=auth_headers(admin_user),
    )
    batch_id = uuid.UUID(open_resp.json()["id"])
    entity_id = uuid.uuid4()
    db.add(
        Event(
            batch_id=batch_id,
            user_id=admin_user.id,
            event_type="ext.swot-analysis.analysis.updated",
            entity_type="ext.swot-analysis.analysis",
            entity_id=entity_id,
            data={"changed": ["summary"]},
        )
    )
    await db.flush()

    history = await client.get(
        f"/api/v1/mutation-batches/{batch_id}/events",
        headers=auth_headers(admin_user),
    )

    assert history.status_code == 200
    event = next(
        item
        for item in history.json()["events"]
        if item["event_type"] == "ext.swot-analysis.analysis.updated"
    )
    assert event["entity_type"] == "ext.swot-analysis.analysis"
    assert event["entity_id"] == str(entity_id)


async def test_rollback_requires_parent_read_access(monkeypatch):
    from app.api.v1 import mutation_batches as routes

    card_id, parent_id = uuid.uuid4(), uuid.uuid4()
    db = SimpleNamespace(get=AsyncMock(return_value=SimpleNamespace(parent_id=None)))
    user = SimpleNamespace(id=uuid.uuid4())
    readable = AsyncMock(side_effect=[None, HTTPException(status_code=404)])
    monkeypatch.setattr(routes, "require_card_readable", readable)
    monkeypatch.setattr(routes.PermissionService, "require_permission", AsyncMock())
    monkeypatch.setattr(routes.PermissionService, "can_view_costs", AsyncMock(return_value=True))
    with pytest.raises(HTTPException) as exc:
        await routes._require_rollback_permissions(
            db,
            user,
            [
                {
                    "op": "restore_card_fields",
                    "card_id": str(card_id),
                    "fields": {"parent_id": str(parent_id)},
                }
            ],
        )
    assert exc.value.status_code == 404
    assert readable.await_args.args == (db, user, parent_id)


@pytest.mark.parametrize("operation", ["add_card_tag", "remove_card_tag"])
async def test_rollback_tag_operations_use_tag_permission(monkeypatch, operation):
    from app.api.v1 import mutation_batches as routes
    from app.services import tag_service

    db, user, card_id = object(), SimpleNamespace(id=uuid.uuid4()), uuid.uuid4()
    monkeypatch.setattr(routes, "require_card_readable", AsyncMock())
    permission = AsyncMock(return_value=True)
    monkeypatch.setattr(tag_service, "can_tag_card", permission)
    monkeypatch.setattr(
        routes.PermissionService,
        "require_permission",
        AsyncMock(side_effect=HTTPException(status_code=403)),
    )
    await routes._require_rollback_permissions(
        db, user, [{"op": operation, "card_id": str(card_id)}]
    )
    permission.assert_awaited_once_with(db, user, card_id)


async def test_rollback_requires_current_card_edit_permission(monkeypatch):
    from app.api.v1 import mutation_batches as routes

    db = object()
    user = SimpleNamespace(id=uuid.uuid4())
    card_id = uuid.uuid4()
    check = AsyncMock(side_effect=HTTPException(status_code=403))
    monkeypatch.setattr(routes.PermissionService, "require_permission", check)
    monkeypatch.setattr(routes, "require_card_readable", AsyncMock())

    with pytest.raises(HTTPException) as exc:
        await routes._require_rollback_permissions(
            db, user, [{"op": "restore_card_fields", "card_id": str(card_id)}]
        )
    assert exc.value.status_code == 403
    assert check.await_args.args == (db, user, "inventory.edit", card_id, "card.edit")


async def test_rollback_refuses_unknown_inverse_before_writes(monkeypatch):
    from app.api.v1 import mutation_batches as routes

    check = AsyncMock()
    monkeypatch.setattr(routes.PermissionService, "require_permission", check)
    with pytest.raises(HTTPException) as exc:
        await routes._require_rollback_permissions(
            object(), SimpleNamespace(id=uuid.uuid4()), [{"op": "new_unknown_inverse"}]
        )
    assert exc.value.status_code == 403
    check.assert_not_awaited()


async def test_batch_history_filters_hidden_cards_and_preview_refuses_hidden_events(
    client, admin_user, app_card_type, db, monkeypatch
):
    from app.api.v1 import mutation_batches as routes
    from app.services.card_read_scope import CardReadScope
    from tests.conftest import create_card, create_card_type

    await create_card_type(db, key="Hidden", label="Hidden")
    visible = await create_card(db, name="Visible")
    hidden = await create_card(db, card_type="Hidden", name="Hidden")
    opened = await _open(client, admin_user, rows=1, dry_run=False)
    batch_id = uuid.UUID(opened.json()["id"])
    for card in (visible, hidden):
        db.add(
            Event(
                batch_id=batch_id,
                user_id=admin_user.id,
                card_id=card.id,
                event_type="card.updated",
                data={"changes": {"name": {"old": "Earlier", "new": card.name}}},
            )
        )
    await db.flush()
    read_scope = CardReadScope(
        role_key="restricted",
        wildcard=False,
        base_view=True,
        denied_types=frozenset({"Hidden"}),
        allowed_types=frozenset(),
        stakeholder_card_ids=frozenset(),
    )
    monkeypatch.setattr(routes.CardReadScope, "load", AsyncMock(return_value=read_scope))

    response = await client.get(
        f"/api/v1/mutation-batches/{batch_id}/events", headers=auth_headers(admin_user)
    )
    assert response.status_code == 200
    assert [event["card_id"] for event in response.json()["events"]] == [str(visible.id)]
    assert str(hidden.id) not in response.text

    preview = await client.post(
        f"/api/v1/mutation-batches/{batch_id}/rollback",
        json={"dry_run": True},
        headers=auth_headers(admin_user),
    )
    assert preview.status_code == 404
    assert str(hidden.id) not in preview.text


async def test_batch_history_filters_rollback_subjects_and_document_details(
    client, admin_user, app_card_type, db, monkeypatch
):
    from app.api.v1 import mutation_batches as routes
    from app.services.card_read_scope import CardReadScope
    from tests.conftest import create_card, create_card_type

    await create_card_type(db, key="Hidden", label="Hidden")
    visible = await create_card(db, name="Visible")
    hidden = await create_card(db, card_type="Hidden", name="Hidden")
    opened = await _open(client, admin_user, rows=3, dry_run=False)
    batch_id = uuid.UUID(opened.json()["id"])
    for card in (visible, hidden):
        db.add(
            Event(
                batch_id=batch_id,
                user_id=admin_user.id,
                event_type="rollback.restore_card_fields",
                data={"card_id": str(card.id), "fields": {"name": card.name}},
            )
        )
    db.add(
        Event(
            batch_id=batch_id,
            user_id=admin_user.id,
            event_type="rollback.delete_adr",
            data={"adr_id": str(uuid.uuid4()), "detail": "Private decision"},
        )
    )
    await db.flush()
    read_scope = CardReadScope(
        role_key="restricted",
        wildcard=False,
        base_view=True,
        denied_types=frozenset({"Hidden"}),
        allowed_types=frozenset(),
        stakeholder_card_ids=frozenset(),
    )
    monkeypatch.setattr(routes.CardReadScope, "load", AsyncMock(return_value=read_scope))
    original = routes.PermissionService.has_app_permission

    async def document_permission(db_arg, user_arg, permission, *args, **kwargs):
        if permission == "adr.view":
            return False
        return await original(db_arg, user_arg, permission, *args, **kwargs)

    monkeypatch.setattr(routes.PermissionService, "has_app_permission", document_permission)
    response = await client.get(
        f"/api/v1/mutation-batches/{batch_id}/events", headers=auth_headers(admin_user)
    )
    assert response.status_code == 200
    assert [item["data"]["card_id"] for item in response.json()["events"]] == [str(visible.id)]
    assert str(hidden.id) not in response.text
    assert "Private decision" not in response.text
    preview = await client.post(
        f"/api/v1/mutation-batches/{batch_id}/rollback",
        json={"dry_run": True},
        headers=auth_headers(admin_user),
    )
    assert preview.status_code == 404
    assert "Private decision" not in preview.text


async def test_batch_summary_is_hidden_without_document_permissions(monkeypatch):
    from app.api.v1 import mutation_batches as routes
    from app.services.card_read_scope import CardReadScope

    scope = CardReadScope(
        role_key="reader",
        wildcard=True,
        base_view=True,
        denied_types=frozenset(),
        allowed_types=frozenset(),
        stakeholder_card_ids=frozenset(),
    )
    monkeypatch.setattr(routes.CardReadScope, "load", AsyncMock(return_value=scope))
    monkeypatch.setattr(routes, "document_event_read_filters", AsyncMock(return_value=(True,)))
    summary = {"results": [{"op": "restore_card_fields", "detail": "Private decision"}]}
    batch = SimpleNamespace(id=uuid.uuid4(), tool_name="rollback_batch", summary=summary)
    db = SimpleNamespace(scalars=AsyncMock(return_value=[]))
    monkeypatch.setattr(routes, "batch_to_dict", lambda *args, **kwargs: {"summary": summary})
    redact = AsyncMock()
    monkeypatch.setattr(routes, "scrub_summary_costs", redact)
    result = await routes._batch_out(db, object(), batch, None)
    db.scalars.assert_awaited_once()
    assert result["summary"] is None
    redact.assert_not_awaited()


def test_document_safe_summary_preserves_non_document_results():
    from app.api.v1.mutation_batches import _document_safe_summary

    summary = {
        "reverses_batch_id": "batch-id",
        "forced": False,
        "results": [
            {"op": "restore_card_fields", "fields": {"name": "visible"}},
            {"op": "delete_adr", "detail": "private decision"},
        ],
    }
    assert _document_safe_summary(summary, include_adr=False) == {
        "reverses_batch_id": "batch-id",
        "forced": False,
        "results": [{"op": "restore_card_fields", "fields": {"name": "visible"}}],
    }
    assert _document_safe_summary(summary, include_adr=True) == summary


@pytest.mark.parametrize("hidden, expected", [(True, 404), (False, 409)])
async def test_rollback_delete_card_protects_hidden_child(monkeypatch, hidden, expected):
    from app.api.v1 import mutation_batches as routes

    db = SimpleNamespace(
        scalar=AsyncMock(side_effect=[uuid.uuid4()] if hidden else [None, uuid.uuid4()])
    )
    user = SimpleNamespace(id=uuid.uuid4())
    scope = SimpleNamespace(clause=lambda card, mode: card.type != "Hidden")
    monkeypatch.setattr(routes.CardReadScope, "load", AsyncMock(return_value=scope))
    monkeypatch.setattr(routes, "require_card_readable", AsyncMock())
    monkeypatch.setattr(routes.PermissionService, "require_permission", AsyncMock())
    with pytest.raises(HTTPException) as exc:
        await routes._require_rollback_permissions(
            db, user, [{"op": "delete_card", "card_id": str(uuid.uuid4())}]
        )
    assert exc.value.status_code == expected


async def test_rollback_route_checks_current_permission_before_dispatch(
    client, admin_user, app_card_type, db, monkeypatch
):
    from app.api.v1 import mutation_batches as routes
    from tests.conftest import create_card

    card = await create_card(db, name="Current card")
    opened = await _open(client, admin_user, rows=1, dry_run=False)
    batch_id = uuid.UUID(opened.json()["id"])
    db.add(
        Event(
            batch_id=batch_id,
            user_id=admin_user.id,
            card_id=card.id,
            event_type="card.updated",
            data={"changes": {"name": {"old": "Previous", "new": card.name}}},
        )
    )
    await db.flush()
    closed = await client.post(
        f"/api/v1/mutation-batches/{batch_id}/commit",
        json={"summary": {}},
        headers=auth_headers(admin_user),
    )
    assert closed.status_code == 200
    original = routes.PermissionService.require_permission

    async def deny_edit(db_arg, user_arg, permission, *args, **kwargs):
        if permission == "inventory.edit":
            raise HTTPException(403, "Insufficient permissions")
        return await original(db_arg, user_arg, permission, *args, **kwargs)

    monkeypatch.setattr(routes.PermissionService, "require_permission", deny_edit)
    from app.services import rollback_service

    dispatch = AsyncMock()
    monkeypatch.setattr(rollback_service, "_apply_inverse", dispatch)
    response = await client.post(
        f"/api/v1/mutation-batches/{batch_id}/rollback",
        json={"dry_run": False},
        headers=auth_headers(admin_user),
    )
    assert response.status_code == 403
    dispatch.assert_not_awaited()
