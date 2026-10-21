"""Unit tests for mutation-batch helpers that need no database."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.services.mutation_batch_service import (
    CONFIRM_TOKEN_THRESHOLD,
    CONFIRM_TOKEN_TTL,
    CONFIRMED_BATCH_KEY,
    close_summary,
    commit_batch,
    issue_confirm_token,
    issues_token,
    mark_token_used,
    needs_confirmation,
    resolve_confirm_token,
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


_ISSUED = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)


def test_verify_measures_age_from_the_given_now():
    batch = SimpleNamespace(confirm_token="tok", created_at=_ISSUED)
    assert verify_confirm_token(batch, "tok", now=_ISSUED + CONFIRM_TOKEN_TTL) is True
    later = _ISSUED + CONFIRM_TOKEN_TTL + timedelta(microseconds=1)
    assert verify_confirm_token(batch, "tok", now=later) is False


# ── Threshold ────────────────────────────────────────────────────────────


def test_the_backend_threshold_is_twenty():
    assert CONFIRM_TOKEN_THRESHOLD == 20


@pytest.mark.parametrize(
    ("dry_run", "rows", "needs", "issues"),
    [
        (False, 20, False, False),
        (False, 21, True, False),
        (True, 20, False, False),
        (True, 21, False, True),
        (True, 999, False, True),
        (False, 0, False, False),
    ],
)
def test_needs_confirmation_and_issues_token(dry_run, rows, needs, issues):
    assert needs_confirmation(dry_run, rows) is needs
    assert issues_token(dry_run, rows) is issues


# ── resolve_confirm_token ────────────────────────────────────────────────

_ME = uuid.uuid4()
_OTHER = uuid.uuid4()


def _batch(
    *,
    dry_run: bool = True,
    actor=_ME,
    tool: str = "update_cards_bulk",
    token: str = "tok",
    created_at: datetime = _ISSUED,
    summary: dict | None = None,
):
    return SimpleNamespace(
        dry_run=dry_run,
        actor_user_id=actor,
        tool_name=tool,
        confirm_token=token,
        created_at=created_at,
        summary=summary,
    )


def _resolve(candidates, token="tok", *, actor=_ME, tool="update_cards_bulk", now=None):
    return resolve_confirm_token(
        candidates,
        token,
        actor_id=actor,
        tool_name=tool,
        now=now or _ISSUED + timedelta(minutes=1),
    )


def test_resolve_returns_the_issuing_dry_run():
    issuing = _batch()
    assert _resolve([issuing]) == (issuing, None)


def test_resolve_picks_the_dry_run_among_the_candidates():
    # A real batch an older code path stamped with the token must not be
    # mistaken for the issuer.
    real = _batch(dry_run=False)
    issuing = _batch()
    assert _resolve([real, issuing]) == (issuing, None)


def test_resolve_missing_token():
    assert _resolve([_batch()], token="") == (None, "missing")


def test_resolve_unknown_without_candidates():
    assert _resolve([]) == (None, "unknown")


def test_resolve_unknown_when_only_real_batches_carry_it():
    assert _resolve([_batch(dry_run=False)]) == (None, "unknown")


def test_resolve_already_used():
    used = _batch(summary={"rows": 52, CONFIRMED_BATCH_KEY: str(uuid.uuid4())})
    assert _resolve([used]) == (None, "already_used")


def test_resolve_an_unstamped_summary_is_not_used():
    issuing = _batch(summary={"rows": 52})
    assert _resolve([issuing]) == (issuing, None)


def test_resolve_wrong_actor():
    assert _resolve([_batch(actor=_OTHER)]) == (None, "wrong_actor")


def test_resolve_an_anonymous_preview_does_not_authorise_a_user():
    assert _resolve([_batch(actor=None)]) == (None, "wrong_actor")


def test_resolve_wrong_tool():
    assert _resolve([_batch(tool="archive_cards")]) == (None, "wrong_tool")


def test_resolve_expired():
    late = _ISSUED + CONFIRM_TOKEN_TTL + timedelta(seconds=1)
    assert _resolve([_batch()], now=late) == (None, "expired")


def test_resolve_at_the_ttl_is_still_valid():
    issuing = _batch()
    assert _resolve([issuing], now=_ISSUED + CONFIRM_TOKEN_TTL) == (issuing, None)


def test_resolve_without_now_uses_the_clock():
    fresh = _batch(created_at=datetime.now(timezone.utc))
    stale = _batch(created_at=datetime.now(timezone.utc) - timedelta(hours=1))
    assert resolve_confirm_token([fresh], "tok", actor_id=_ME, tool_name=fresh.tool_name) == (
        fresh,
        None,
    )
    assert resolve_confirm_token([stale], "tok", actor_id=_ME, tool_name=stale.tool_name) == (
        None,
        "expired",
    )


def test_resolve_checks_used_before_actor_before_tool_before_age():
    late = _ISSUED + CONFIRM_TOKEN_TTL + timedelta(hours=1)
    everything_wrong = _batch(
        actor=_OTHER, tool="archive_cards", summary={CONFIRMED_BATCH_KEY: "x"}
    )
    assert _resolve([everything_wrong], now=late) == (None, "already_used")
    assert _resolve([_batch(actor=_OTHER, tool="archive_cards")], now=late) == (
        None,
        "wrong_actor",
    )
    assert _resolve([_batch(tool="archive_cards")], now=late) == (None, "wrong_tool")
    # And a missing token is reported before any candidate is looked at.
    assert _resolve([], token="") == (None, "missing")


# ── Single use ───────────────────────────────────────────────────────────


def test_mark_token_used_stamps_a_new_dict():
    original = {"rows": 52}
    issuing = _batch(summary=original)
    new_id = uuid.uuid4()
    mark_token_used(issuing, new_id)
    assert issuing.summary == {"rows": 52, CONFIRMED_BATCH_KEY: str(new_id)}
    # A new object, so SQLAlchemy sees the JSONB column change.
    assert issuing.summary is not original
    assert original == {"rows": 52}
    assert _resolve([issuing]) == (None, "already_used")


def test_mark_token_used_on_an_empty_summary():
    issuing = _batch(summary=None)
    new_id = uuid.uuid4()
    mark_token_used(issuing, new_id)
    assert issuing.summary == {CONFIRMED_BATCH_KEY: str(new_id)}


def test_close_summary_replaces_the_stored_summary():
    assert close_summary({"a": 1}, {"b": 2}) == {"b": 2}


def test_close_summary_keeps_the_stored_one_when_none_is_sent():
    assert close_summary({"a": 1}, None) == {"a": 1}
    assert close_summary(None, None) is None


def test_close_summary_keeps_the_single_use_stamp():
    stored = {"rows": 52, CONFIRMED_BATCH_KEY: "B-2"}
    assert close_summary(stored, {"status": "ok"}) == {
        "status": "ok",
        CONFIRMED_BATCH_KEY: "B-2",
    }
    assert close_summary(None, {"status": "ok"}) == {"status": "ok"}


async def test_commit_batch_closes_over_the_stored_summary():
    """``commit_batch`` must hand the batch's *stored* summary to
    ``close_summary``: a preview closed after its token was spent keeps the
    stamp, and one closed with no summary keeps what it had."""
    flushed: list[bool] = []

    class _Db:
        async def flush(self):
            flushed.append(True)

    stamped = _batch(summary={"rows": 52, CONFIRMED_BATCH_KEY: "B-2"})
    await commit_batch(_Db(), stamped, summary={"rows": 52, "would_update": 52})
    assert stamped.summary == {"rows": 52, "would_update": 52, CONFIRMED_BATCH_KEY: "B-2"}
    assert stamped.committed_at is not None

    untouched = _batch(summary={"rows": 3})
    await commit_batch(_Db(), untouched, summary=None)
    assert untouched.summary == {"rows": 3}
    assert flushed == [True, True]


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
        "risk.updated",
        "adr.created",
        "comment.created",
        "document.added",
        "stakeholder.added",
        "stakeholder.removed",
        "stakeholder.role_changed",
        "tag.added",
        "tag.removed",
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
