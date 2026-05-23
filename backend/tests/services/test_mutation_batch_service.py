"""Unit tests for mutation-batch helpers that need no database."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services.mutation_batch_service import (
    CONFIRM_TOKEN_TTL,
    issue_confirm_token,
    verify_confirm_token,
)


def _fake_batch(token: str | None, age: timedelta = timedelta(seconds=0)):
    return SimpleNamespace(
        confirm_token=token,
        created_at=datetime.now(timezone.utc) - age,
    )


def test_issue_confirm_token_is_random_and_long_enough():
    a = issue_confirm_token()
    b = issue_confirm_token()
    assert a != b
    assert len(a) >= 16


def test_verify_rejects_missing_token():
    batch = _fake_batch(token="x" * 24)
    assert verify_confirm_token(batch, "") is False


def test_verify_rejects_when_batch_has_no_token():
    batch = _fake_batch(token=None)
    assert verify_confirm_token(batch, "anything") is False


def test_verify_rejects_mismatched_token():
    batch = _fake_batch(token="real-token")
    assert verify_confirm_token(batch, "wrong-token") is False


def test_verify_accepts_matching_fresh_token():
    token = issue_confirm_token()
    batch = _fake_batch(token=token)
    assert verify_confirm_token(batch, token) is True


def test_verify_rejects_expired_token():
    token = issue_confirm_token()
    # 1 second past the TTL → reject
    batch = _fake_batch(token=token, age=CONFIRM_TOKEN_TTL + timedelta(seconds=1))
    assert verify_confirm_token(batch, token) is False


# ── Auto-batch skiplist ──────────────────────────────────────────────────


def test_auto_batch_skiplist_contains_notifications():
    """Notifications publish on every write that mentions a stake-held
    card — high volume, low signal. The underlying card / relation /
    ADR write is already audited under its own event, so the
    notification's own batch would be a noisy duplicate."""
    from app.services.event_bus import _NO_AUTO_BATCH_PREFIXES

    assert "notification." in _NO_AUTO_BATCH_PREFIXES


def test_auto_batch_skiplist_keeps_audit_relevant_writes():
    """High-signal write event types must NOT be in the skiplist so
    they still create auto-batches when published from web/api."""
    from app.services.event_bus import _NO_AUTO_BATCH_PREFIXES

    high_signal_types = [
        "card.created",
        "card.updated",
        "card.archived",
        "card.restored",
        "relation.created",
        "relation.upserted",
        "relation.deleted",
        "adr.signed",
        "adr.rejected",
        "soaw.signed",
        "risk.added",
        "comment.created",
        "document.added",
        "stakeholder.added",
        "process_diagram.saved",
        "process_flow.approved",
        # Rollback events must stay captured — they're the inverse-op
        # records admins specifically want to see.
        "rollback.delete_card",
    ]
    for et in high_signal_types:
        assert not any(et.startswith(p) for p in _NO_AUTO_BATCH_PREFIXES), (
            f"{et} should NOT be skipped — it's audit-relevant"
        )
