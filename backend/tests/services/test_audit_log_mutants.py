"""Exact-value tests for ``services/audit_log`` helpers, aimed at surviving mutants.

No database: ``build_entry`` and ``log_line`` are called directly, so every column and every
JSON key is pinned by equality instead of through ``record``. ``pytest.raises(match=...)`` is a
substring search, so a message mutated to ``"XX...XX"`` still matches it: every message here is
compared whole.
"""

from __future__ import annotations

import json
import re
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.core.request_context import request_client
from app.models.audit_log import AuditLogEntry
from app.services import audit_log
from app.services.event_bus import request_impersonation, request_origin


@contextmanager
def context(*, client=None, origin=None, impersonation=None):
    tokens = [
        (request_client, request_client.set(client)),
        (request_origin, request_origin.set(origin)),
        (request_impersonation, request_impersonation.set(impersonation)),
    ]
    try:
        yield
    finally:
        for var, token in reversed(tokens):
            var.reset(token)


def _message(call, *args, **kwargs) -> str:
    with pytest.raises(ValueError) as exc:
        call(*args, **kwargs)
    return str(exc.value)


# ── messages, compared whole ──────────────────────────────────────────────


@pytest.mark.parametrize(
    ("details", "message"),
    [
        (["reason"], "Audit details must be a mapping; got list"),
        (
            {"provider": 1},
            "Unknown audit details key 'provider'; expected a subset of "
            "['changes', 'context', 'items', 'reason']",
        ),
        ({"reason": ""}, "Audit details 'reason' must be a non-empty string; got ''"),
        ({"reason": "  "}, "Audit details 'reason' must be a non-empty string; got '  '"),
        ({"reason": 5}, "Audit details 'reason' must be a non-empty string; got 5"),
        (
            {"changes": []},
            "Audit details 'changes' must be a mapping of {field: {old, new}}",
        ),
        (
            {"changes": "x"},
            "Audit details 'changes' must be a mapping of {field: {old, new}}",
        ),
        (
            {"changes": {1: {"old": 1, "new": 2}}},
            "Audit details 'changes' has a non-string field 1",
        ),
        (
            {"changes": {"a": {"old": 1}}},
            "Audit details changes['a'] must be exactly {old, new}",
        ),
        (
            {"changes": {"a": {"old": 1, "new": 2, "x": 3}}},
            "Audit details changes['a'] must be exactly {old, new}",
        ),
        (
            {"changes": {"a": [1, 2]}},
            "Audit details changes['a'] must be exactly {old, new}",
        ),
        (
            {"changes": {"a": {"old": [{"k": 1}], "new": None}}},
            "Audit details changes['a'] must hold scalars or flat lists of scalars",
        ),
        (
            {"changes": {"a": {"old": None, "new": {"k": 1}}}},
            "Audit details changes['a'] must hold scalars or flat lists of scalars",
        ),
        ({"items": {"kind": "more"}}, "Audit details 'items' must be a list of change items"),
        ({"items": "more"}, "Audit details 'items' must be a list of change items"),
        ({"items": ["more"]}, "Audit details items[0] must be a mapping"),
        (
            {"items": [{"kind": "more", "count": 1}, "x"]},
            "Audit details items[1] must be a mapping",
        ),
        ({"items": [{"count": 1}]}, "Audit details items[0] has an unknown kind None"),
        (
            {"items": [{"kind": "more", "count": 1}, {"kind": "nope"}]},
            "Audit details items[1] has an unknown kind 'nope'",
        ),
        (
            {"items": [{"kind": "more", "count": {"n": 1}}]},
            "Audit details items[0]['count'] must be a scalar or a flat list of scalars",
        ),
        (
            {"items": [{"kind": "more", 3: 1}]},
            "Audit details 'items[0]' has a non-string key 3",
        ),
        ({"context": ["a"]}, "Audit details 'context' must be a mapping; got list"),
        ({"context": "a"}, "Audit details 'context' must be a mapping; got str"),
        ({"context": {1: "a"}}, "Audit details 'context' has a non-string key 1"),
        (
            {"context": {"stats": {"a": 1}}},
            "Audit details context['stats'] must be a scalar or a flat list of scalars",
        ),
        (
            {"context": {"stats": [{"a": 1}]}},
            "Audit details context['stats'] must be a scalar or a flat list of scalars",
        ),
    ],
)
def test_validate_details_messages_are_exact(details, message):
    assert _message(audit_log.validate_details, details) == message


def test_merge_details_message_is_exact():
    assert _message(audit_log.merge_details, "reason") == (
        "Audit details must be a mapping; got str"
    )


def test_validate_messages_are_exact():
    assert _message(audit_log.validate, "auth", "success", "  ") == (
        "An audit action is required; got '  '"
    )
    assert _message(audit_log.validate, "auth", "success", None) == (
        "An audit action is required; got None"
    )
    assert _message(audit_log.validate, "landscape", "success", "a.b") == (
        "Unknown audit category 'landscape'; expected one of ['access', 'admin', 'auth']"
    )
    assert _message(audit_log.validate, "auth", "maybe", "a.b") == (
        "Unknown audit outcome 'maybe'; expected one of ['failure', 'success']"
    )


def test_a_tuple_of_scalars_is_a_flat_list_and_a_list_with_a_mapping_is_not():
    assert audit_log._is_detail_value(("a", 1, None)) is True
    assert audit_log._is_detail_value([]) is True
    assert audit_log._is_detail_value([{"a": 1}]) is False
    assert audit_log._is_detail_value({"a": 1}) is False
    assert audit_log._is_detail_value(object()) is False


# ── _clip / _read ─────────────────────────────────────────────────────────


def test_clip_keeps_text_up_to_the_width_and_cuts_after_it():
    assert audit_log._clip("abc", 3) == "abc"
    assert audit_log._clip("abcd", 3) == "abc"
    assert audit_log._clip("abcdef", 1) == "a"


def test_clip_turns_none_and_empty_into_none_and_stringifies_the_rest():
    assert audit_log._clip(None, 5) is None
    assert audit_log._clip("", 5) is None
    assert audit_log._clip(0, 5) == "0"
    assert audit_log._clip(False, 5) == "False"
    assert audit_log._clip(uuid.UUID(int=1), 100) == str(uuid.UUID(int=1))


def test_read_distinguishes_a_missing_key_from_a_none_value():
    assert audit_log._read({"a": None}, "a") is None
    assert audit_log._read({}, "a") is audit_log._MISSING
    assert audit_log._read(SimpleNamespace(a=None), "a") is None
    assert audit_log._read(SimpleNamespace(), "a") is audit_log._MISSING


def test_diff_skips_a_requested_key_the_new_side_does_not_carry():
    assert audit_log.diff({"x": 1}, {"y": 2}, keys=("x",)) == {}
    assert audit_log.diff({"x": 1}, SimpleNamespace(y=2), keys=("x",)) == {}
    # A field the old side lacks reads as None, an explicit None is a real value.
    assert audit_log.diff({}, {"x": None}, keys=("x",)) == {}
    assert audit_log.diff(SimpleNamespace(), {"x": 5}, keys=("x",)) == {
        "x": {"old": None, "new": 5}
    }


# ── is_secret_key does not lean on the regex alone ────────────────────────


def test_leaf_and_extension_secret_keys_mask_even_without_the_pattern(monkeypatch):
    monkeypatch.setattr(audit_log, "_SECRET_KEY_PATTERN", re.compile(r"(?!x)x"))
    for leaf in ("client_secret", "apiKey", "smtp_password", "oauth_client_secret"):
        assert audit_log.is_secret_key(leaf) is True, leaf
    assert audit_log.is_secret_key("service_account_json") is True
    assert audit_log.is_secret_key("ext.acme.secret.webhook") is True
    for key in ("email", "token", "token_endpoint", "ext.acme.endpoint", "ext.secret.a.b"):
        assert audit_log.is_secret_key(key) is False, key
    assert audit_log.is_secret_key(7) is False
    assert audit_log.is_secret_key(None) is False


# ── build_entry ───────────────────────────────────────────────────────────


def test_build_entry_defaults_to_a_successful_entry_without_actor_or_details():
    with context():
        entry = audit_log.build_entry(action="auth.logout", category="auth")
    assert isinstance(entry, AuditLogEntry)
    assert isinstance(entry.id, uuid.UUID)
    assert entry.outcome == "success"
    assert (entry.category, entry.action) == ("auth", "auth.logout")
    assert entry.actor_user_id is None and entry.actor_email is None
    assert entry.subject_email is None
    assert (entry.target_type, entry.target_id, entry.target_label) == (None, None, None)
    assert entry.ip is None and entry.user_agent is None
    assert entry.origin == "system"
    assert entry.impersonator_user_id is None and entry.impersonated_role is None
    assert entry.details is None


def test_build_entry_gives_every_entry_its_own_id():
    with context():
        a = audit_log.build_entry(action="a.b", category="auth")
        b = audit_log.build_entry(action="a.b", category="auth")
    assert a.id != b.id


def test_build_entry_without_a_target_or_a_short_one_pads_with_none():
    with context():
        none = audit_log.build_entry(action="a.b", category="admin", target=None)
        empty = audit_log.build_entry(action="a.b", category="admin", target=())
        one = audit_log.build_entry(action="a.b", category="admin", target=("role",))
        three = audit_log.build_entry(action="a.b", category="admin", target=("r", 7, "L"))
        four = audit_log.build_entry(action="a.b", category="admin", target=("r", 7, "L", "x"))
    for entry in (none, empty):
        assert (entry.target_type, entry.target_id, entry.target_label) == (None, None, None)
    assert (one.target_type, one.target_id, one.target_label) == ("role", None, None)
    assert (three.target_type, three.target_id, three.target_label) == ("r", "7", "L")
    assert (four.target_type, four.target_id, four.target_label) == ("r", "7", "L")


_WIDTHS = {
    "action": 100,
    "actor_email": 255,
    "subject_email": 255,
    "target_type": 50,
    "target_id": 100,
    "target_label": 255,
    "ip": 45,
    "user_agent": 255,
    "origin": 20,
    "impersonated_role": 100,
}


@pytest.mark.parametrize("extra", [0, 1])
def test_every_string_column_is_cut_at_its_width_exactly(extra):
    """``width`` characters are kept whole, ``width + 1`` lose only the last."""

    def text(column: str, char: str) -> str:
        return char * (_WIDTHS[column] + extra)

    actor = SimpleNamespace(id=uuid.uuid4(), email=text("actor_email", "e"))
    with context(
        client=(text("ip", "1"), text("user_agent", "u")),
        origin=text("origin", "o"),
        impersonation=(str(uuid.uuid4()), text("impersonated_role", "r")),
    ):
        entry = audit_log.build_entry(
            action=text("action", "a"),
            category="admin",
            actor=actor,
            subject_email=text("subject_email", "s"),
            target=(
                text("target_type", "t"),
                text("target_id", "i"),
                text("target_label", "l"),
            ),
        )
    assert entry.action == "a" * 100
    assert entry.actor_email == "e" * 255
    assert entry.subject_email == "s" * 255
    assert entry.target_type == "t" * 50
    assert entry.target_id == "i" * 100
    assert entry.target_label == "l" * 255
    assert entry.ip == "1" * 45
    assert entry.user_agent == "u" * 255
    assert entry.origin == "o" * 20
    assert entry.impersonated_role == "r" * 100


def test_build_entry_stamps_the_whole_request_context():
    impersonator = uuid.uuid4()
    actor = SimpleNamespace(id=uuid.uuid4(), email="alice@example.com")
    with context(
        client=("203.0.113.7", "Mozilla/5.0"),
        origin="mcp",
        impersonation=(str(impersonator), "viewer"),
    ):
        entry = audit_log.build_entry(
            action="admin.role.updated",
            category="admin",
            outcome="failure",
            actor=actor,
            subject_email="bob@example.com",
            target=("role", "auditor", "Auditor"),
            reason="why_not",
            changes={"label": {"old": "A", "new": "B"}},
            items=[{"kind": "more", "count": 2}],
            context={"n": 1},
        )
    assert entry.category == "admin"
    assert entry.action == "admin.role.updated"
    assert entry.outcome == "failure"
    assert entry.actor_user_id == actor.id
    assert entry.actor_email == "alice@example.com"
    assert entry.subject_email == "bob@example.com"
    assert (entry.target_type, entry.target_id, entry.target_label) == (
        "role",
        "auditor",
        "Auditor",
    )
    assert (entry.ip, entry.user_agent, entry.origin) == ("203.0.113.7", "Mozilla/5.0", "mcp")
    assert entry.impersonator_user_id == impersonator
    assert entry.impersonated_role == "viewer"
    assert entry.details == {
        "reason": "why_not",
        "changes": {"label": {"old": "A", "new": "B"}},
        "items": [{"kind": "more", "count": 2}],
        "context": {"n": 1},
    }


def test_build_entry_origin_is_api_inside_a_request_and_system_outside_one():
    with context(client=("1.2.3.4", "ua")):
        assert audit_log.build_entry(action="a.b", category="auth").origin == "api"
    with context(client=("1.2.3.4", "ua"), origin="web"):
        assert audit_log.build_entry(action="a.b", category="auth").origin == "web"
    with context():
        assert audit_log.build_entry(action="a.b", category="auth").origin == "system"
    with context(origin="ext"):
        assert audit_log.build_entry(action="a.b", category="auth").origin == "ext"


def test_build_entry_without_impersonation_stamps_neither_field():
    with context(client=("1.2.3.4", "ua")):
        entry = audit_log.build_entry(action="a.b", category="auth")
    assert entry.impersonator_user_id is None and entry.impersonated_role is None


def test_build_entry_redacts_before_it_stores_and_validates_first():
    with context():
        entry = audit_log.build_entry(
            action="admin.settings.updated",
            category="admin",
            changes={"smtp_password": {"old": "a", "new": "b"}, "host": {"old": "x", "new": "y"}},
        )
        assert entry.details == {
            "changes": {
                "smtp_password": {"old": "***", "new": "***"},
                "host": {"old": "x", "new": "y"},
            }
        }
        with pytest.raises(ValueError, match="category"):
            audit_log.build_entry(action="a.b", category="landscape")
        with pytest.raises(ValueError, match="outcome"):
            audit_log.build_entry(action="a.b", category="auth", outcome="maybe")
        with pytest.raises(ValueError, match="action is required"):
            audit_log.build_entry(action=" ", category="auth")


def test_build_entry_details_argument_is_merged_and_a_keyword_wins():
    with context():
        entry = audit_log.build_entry(
            action="a.b",
            category="auth",
            reason="locked",
            details={"reason": "bad_password", "context": {"attempts": 3}},
        )
    assert entry.details == {"reason": "locked", "context": {"attempts": 3}}


# ── log_line ──────────────────────────────────────────────────────────────

_LOG_KEYS = [
    "audit_id",
    "created_at",
    "category",
    "action",
    "outcome",
    "actor_user_id",
    "actor_email",
    "subject_email",
    "target_type",
    "target_id",
    "target_label",
    "ip",
    "user_agent",
    "origin",
    "impersonator_user_id",
    "impersonated_role",
    "details",
]


def test_log_line_carries_every_column_under_its_own_name():
    impersonator = uuid.uuid4()
    actor = SimpleNamespace(id=uuid.uuid4(), email="alice@example.com")
    with context(
        client=("198.51.100.1", "curl/8"),
        origin="api",
        impersonation=(str(impersonator), "viewer"),
    ):
        entry = audit_log.build_entry(
            action="admin.user.updated",
            category="admin",
            outcome="failure",
            actor=actor,
            subject_email="bob@example.com",
            target=("user", "42", "Bob"),
            context={"n": 1},
        )
    entry.created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    line = json.loads(audit_log.log_line(entry))
    assert line == {
        "audit_id": str(entry.id),
        "created_at": "2026-01-02 03:04:05+00:00",
        "category": "admin",
        "action": "admin.user.updated",
        "outcome": "failure",
        "actor_user_id": str(actor.id),
        "actor_email": "alice@example.com",
        "subject_email": "bob@example.com",
        "target_type": "user",
        "target_id": "42",
        "target_label": "Bob",
        "ip": "198.51.100.1",
        "user_agent": "curl/8",
        "origin": "api",
        "impersonator_user_id": str(impersonator),
        "impersonated_role": "viewer",
        "details": {"context": {"n": 1}},
    }
    assert list(line) == _LOG_KEYS


def test_log_line_of_a_bare_entry_is_null_where_nothing_was_set():
    with context():
        entry = audit_log.build_entry(action="auth.logout", category="auth")
    raw = audit_log.log_line(entry)
    line = json.loads(raw)
    assert list(line) == _LOG_KEYS
    assert line["audit_id"] == str(entry.id)
    assert line["created_at"] is None
    assert (line["category"], line["action"], line["outcome"]) == ("auth", "auth.logout", "success")
    assert line["origin"] == "system"
    for key in (
        "actor_user_id",
        "actor_email",
        "subject_email",
        "target_type",
        "target_id",
        "target_label",
        "ip",
        "user_agent",
        "impersonator_user_id",
        "impersonated_role",
        "details",
    ):
        assert line[key] is None, key
    assert "\n" not in raw


# ── retention ─────────────────────────────────────────────────────────────


def test_retention_days_reads_only_its_own_key_and_the_boundaries_hold():
    assert audit_log.RETENTION_SETTING_KEY == "auditLogRetentionDays"
    assert audit_log.retention_days({"other": 30}) == audit_log.DEFAULT_RETENTION_DAYS
    assert audit_log.retention_days({"auditLogRetentionDays": 1}) == 1
    assert audit_log.retention_days({"auditLogRetentionDays": 3649}) == 3649
    assert audit_log.retention_days({"auditLogRetentionDays": 3.5}) == 365
    assert audit_log.retention_days({"auditLogRetentionDays": None}) == 365
