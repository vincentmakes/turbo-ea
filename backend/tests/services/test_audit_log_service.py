"""``services/audit_log`` — the one write path into the security audit log.

Everything here runs without a database: ``record`` is driven against a fake
session that records ``add`` / ``flush`` / ``commit``, which is exactly what
the "never commits" rule is about. The round trip through PostgreSQL (the
server-side ``created_at``, a row read back) is covered by
``tests/api/test_audit_log_api.py``.
"""

from __future__ import annotations

import json
import logging
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.core.encryption import encrypt_value
from app.core.request_context import request_client
from app.models.audit_log import AuditLogEntry
from app.services import audit_log
from app.services.event_bus import request_impersonation, request_origin


class FakeSession:
    """Just enough of ``AsyncSession`` for ``record``; counts what it is asked."""

    def __init__(self) -> None:
        self.added: list = []
        self.flushes = 0
        self.commits = 0
        self.rollbacks = 0

    def add(self, obj) -> None:
        self.added.append(obj)

    async def flush(self) -> None:
        self.flushes += 1

    async def commit(self) -> None:  # pragma: no cover - must never run
        self.commits += 1

    async def rollback(self) -> None:  # pragma: no cover - must never run
        self.rollbacks += 1


@contextmanager
def context(*, client=None, origin=None, impersonation=None):
    """Set the request contextvars ``record`` reads, and reset them after."""
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


def _actor(email="admin@example.com"):
    return SimpleNamespace(id=uuid.uuid4(), email=email)


# ── record ────────────────────────────────────────────────────────────────


async def test_record_flushes_and_never_commits():
    db = FakeSession()
    entry = await audit_log.record(db, action="auth.login.succeeded", category="auth")
    assert db.added == [entry]
    assert isinstance(entry, AuditLogEntry)
    assert db.flushes == 1
    assert db.commits == 0
    assert db.rollbacks == 0


async def test_record_snapshots_actor_email_and_request_context():
    impersonator = uuid.uuid4()
    actor = _actor("alice@example.com")
    with context(
        client=("203.0.113.7", "Mozilla/5.0"),
        origin="web",
        impersonation=(str(impersonator), "viewer"),
    ):
        entry = await audit_log.record(
            FakeSession(),
            action="admin.user.updated",
            category="admin",
            outcome="failure",
            actor=actor,
            subject_email="bob@example.com",
            target=("user", uuid.UUID(int=7), "bob@example.com"),
            details={"reason": "x"},
        )
    assert entry.actor_user_id == actor.id
    assert entry.actor_email == "alice@example.com"
    assert entry.subject_email == "bob@example.com"
    assert entry.category == "admin"
    assert entry.action == "admin.user.updated"
    assert entry.outcome == "failure"
    assert entry.target_type == "user"
    assert entry.target_id == str(uuid.UUID(int=7))
    assert entry.target_label == "bob@example.com"
    assert entry.ip == "203.0.113.7"
    assert entry.user_agent == "Mozilla/5.0"
    assert entry.origin == "web"
    assert entry.impersonator_user_id == impersonator
    assert entry.impersonated_role == "viewer"
    assert entry.details == {"reason": "x"}


async def test_record_without_actor_or_context_is_a_system_row():
    with context():
        entry = await audit_log.record(FakeSession(), action="auth.logout", category="auth")
    assert entry.actor_user_id is None and entry.actor_email is None
    assert entry.ip is None and entry.user_agent is None
    assert entry.origin == "system"
    assert entry.outcome == "success"
    assert entry.impersonator_user_id is None and entry.impersonated_role is None
    assert entry.target_type is None and entry.target_id is None and entry.target_label is None
    assert entry.details is None


async def test_a_request_without_an_origin_header_is_api():
    with context(client=(None, None)):
        entry = await audit_log.record(FakeSession(), action="auth.logout", category="auth")
    assert entry.origin == "api"


async def test_a_malformed_impersonator_id_is_dropped_but_the_role_kept():
    with context(impersonation=("not-a-uuid", "member")):
        entry = await audit_log.record(FakeSession(), action="auth.logout", category="auth")
    assert entry.impersonator_user_id is None
    assert entry.impersonated_role == "member"


async def test_a_short_target_pads_with_none():
    entry = await audit_log.record(
        FakeSession(), action="admin.role.created", category="admin", target=("role", "x")
    )
    assert (entry.target_type, entry.target_id, entry.target_label) == ("role", "x", None)


async def test_long_strings_are_clipped_to_their_columns():
    entry = await audit_log.record(
        FakeSession(),
        action="auth.login.failed",
        category="auth",
        subject_email="a" * 400,
        target=("t" * 80, "i" * 150, "l" * 300),
    )
    assert len(entry.subject_email) == 255
    assert len(entry.target_type) == 50
    assert len(entry.target_id) == 100
    assert len(entry.target_label) == 255


async def test_details_are_redacted_and_made_json_safe():
    marker = uuid.uuid4()
    when = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    entry = await audit_log.record(
        FakeSession(),
        action="admin.settings.updated",
        category="admin",
        changes={"smtp_password": {"old": None, "new": "hunter2"}},
        context={"reference": marker, "at": when, "day": date(2026, 1, 2)},
    )
    assert entry.details == {
        "changes": {"smtp_password": {"old": None, "new": "***"}},
        "context": {
            "reference": str(marker),
            "at": "2026-01-02T03:04:05+00:00",
            "day": "2026-01-02",
        },
    }


async def test_record_rejects_unknown_category():
    db = FakeSession()
    with pytest.raises(ValueError, match="category"):
        await audit_log.record(db, action="x.y", category="landscape")
    assert db.added == [] and db.flushes == 0


async def test_record_rejects_unknown_outcome():
    db = FakeSession()
    with pytest.raises(ValueError, match="outcome"):
        await audit_log.record(db, action="x.y", category="auth", outcome="maybe")
    assert db.added == [] and db.flushes == 0


@pytest.mark.parametrize("action", ["", "   ", "\t\n", None])
async def test_record_rejects_empty_action(action):
    db = FakeSession()
    with pytest.raises(ValueError, match="action"):
        await audit_log.record(db, action=action, category="auth")
    assert db.added == [] and db.flushes == 0


def test_validate_rejects_a_blank_action_with_a_valid_vocabulary():
    with pytest.raises(ValueError, match="action is required"):
        audit_log.validate("auth", "success", " ")
    # A padded but non-empty action is accepted as given.
    audit_log.validate("auth", "success", " auth.logout ")


@pytest.mark.parametrize("category", sorted(audit_log.CATEGORIES))
@pytest.mark.parametrize("outcome", sorted(audit_log.OUTCOMES))
def test_every_known_category_and_outcome_validates(category, outcome):
    audit_log.validate(category, outcome, "auth.login.succeeded")


def test_the_vocabularies_are_the_documented_ones():
    assert audit_log.CATEGORIES == {"auth", "admin", "access"}
    assert audit_log.OUTCOMES == {"success", "failure"}


async def test_record_emits_one_json_line(caplog):
    actor = _actor()
    with (
        context(client=("198.51.100.1", "curl/8"), origin="api"),
        caplog.at_level(logging.INFO, logger="turbo_ea.audit"),
    ):
        entry = await audit_log.record(
            FakeSession(),
            action="auth.login.failed",
            category="auth",
            outcome="failure",
            actor=actor,
            subject_email="who@example.com",
            reason="bad_password",
            context={"password": "nope"},
        )
    records = [r for r in caplog.records if r.name == "turbo_ea.audit"]
    assert len(records) == 1
    assert records[0].levelno == logging.INFO
    line = json.loads(records[0].getMessage())
    assert line["audit_id"] == str(entry.id)
    assert line["category"] == "auth"
    assert line["action"] == "auth.login.failed"
    assert line["outcome"] == "failure"
    assert line["actor_user_id"] == str(actor.id)
    assert line["actor_email"] == "admin@example.com"
    assert line["subject_email"] == "who@example.com"
    assert line["ip"] == "198.51.100.1"
    assert line["user_agent"] == "curl/8"
    assert line["origin"] == "api"
    assert line["details"] == {"reason": "bad_password", "context": {"password": "***"}}
    assert "\n" not in records[0].getMessage()


def test_the_logger_is_the_documented_one():
    assert audit_log.AUDIT_LOGGER.name == "turbo_ea.audit"


# ── the details contract ──────────────────────────────────────────────────


async def test_record_merges_keyword_parts_into_details():
    item = {"kind": "field.added", "section": "S", "field": "Cost", "type": "cost"}
    entry = await audit_log.record(
        FakeSession(),
        action="admin.card_type.updated",
        category="admin",
        reason="why_not",
        changes={"label": {"old": "A", "new": "B"}},
        items=[item],
        context={"count": 2, "types": ["a", "b"]},
    )
    assert entry.details == {
        "reason": "why_not",
        "changes": {"label": {"old": "A", "new": "B"}},
        "items": [item],
        "context": {"count": 2, "types": ["a", "b"]},
    }


async def test_a_keyword_wins_over_the_same_key_in_details():
    entry = await audit_log.record(
        FakeSession(),
        action="auth.login.failed",
        category="auth",
        reason="locked",
        context=None,
        details={"reason": "bad_password", "context": {"attempts": 3}},
    )
    assert entry.details == {"reason": "locked", "context": {"attempts": 3}}


@pytest.mark.parametrize("key", ["provider", "role", "smtp_password", "value"])
async def test_an_unknown_top_level_key_is_refused_by_name(key):
    db = FakeSession()
    with pytest.raises(ValueError, match=f"Unknown audit details key '{key}'"):
        await audit_log.record(db, action="x.y", category="admin", details={key: 1})
    assert db.added == [] and db.flushes == 0


async def test_a_nested_mapping_in_changes_is_refused():
    with pytest.raises(ValueError, match=r"changes\['permissions'\]"):
        await audit_log.record(
            FakeSession(),
            action="admin.role.updated",
            category="admin",
            changes={"permissions": {"old": {"a": True}, "new": {"a": False}}},
        )


async def test_an_unknown_item_kind_is_refused():
    with pytest.raises(ValueError, match=r"items\[1\] has an unknown kind 'field.exploded'"):
        await audit_log.record(
            FakeSession(),
            action="admin.card_type.updated",
            category="admin",
            items=[{"kind": "more", "count": 1}, {"kind": "field.exploded"}],
        )


async def test_nothing_left_stores_no_details():
    entry = await audit_log.record(
        FakeSession(),
        action="admin.card_type.updated",
        category="admin",
        changes={},
        items=[],
        context={},
        details={"reason": None, "changes": {}},
    )
    assert entry.details is None


async def test_redaction_still_masks_a_secret_change():
    entry = await audit_log.record(
        FakeSession(),
        action="admin.settings.updated",
        category="admin",
        target=("setting", "email", None),
        changes={
            "smtp_password": {"old": "old-secret", "new": "new-secret"},
            "smtp_host": {"old": "a", "new": "b"},
        },
    )
    assert entry.details == {
        "changes": {
            "smtp_password": {"old": "***", "new": "***"},
            "smtp_host": {"old": "a", "new": "b"},
        }
    }


def test_validate_details_accepts_none_and_drops_empty_parts():
    assert audit_log.validate_details(None) is None
    assert audit_log.validate_details({}) is None
    assert audit_log.validate_details({"items": (), "context": {"n": 0}}) == {"context": {"n": 0}}
    assert audit_log.validate_details({"items": ({"kind": "more", "count": 3},)}) == {
        "items": [{"kind": "more", "count": 3}]
    }


def test_validate_details_returns_a_new_dict():
    given = {"reason": "x"}
    out = audit_log.validate_details(given)
    assert out == given and out is not given


@pytest.mark.parametrize(
    ("details", "message"),
    [
        (["reason"], "must be a mapping; got list"),
        ({"reason": ""}, "'reason' must be a non-empty string"),
        ({"reason": "  "}, "'reason' must be a non-empty string"),
        ({"reason": 5}, "'reason' must be a non-empty string"),
        ({"changes": []}, "'changes' must be a mapping"),
        ({"changes": {1: {"old": 1, "new": 2}}}, "non-string field 1"),
        ({"changes": {"a": {"old": 1}}}, r"changes\['a'\] must be exactly"),
        ({"changes": {"a": {"old": 1, "new": 2, "x": 3}}}, r"changes\['a'\] must be exactly"),
        ({"changes": {"a": [1, 2]}}, r"changes\['a'\] must be exactly"),
        ({"changes": {"a": {"old": [{"k": 1}], "new": None}}}, r"changes\['a'\] must hold"),
        ({"changes": {"a": {"old": None, "new": [[1]]}}}, r"changes\['a'\] must hold"),
        ({"items": {"kind": "more"}}, "'items' must be a list"),
        ({"items": ["more"]}, r"items\[0\] must be a mapping"),
        ({"items": [{"count": 1}]}, r"items\[0\] has an unknown kind None"),
        ({"items": [{"kind": "more", "count": {"n": 1}}]}, r"items\[0\]\['count'\]"),
        ({"context": ["a"]}, "'context' must be a mapping; got list"),
        ({"context": {1: "a"}}, "'context' has a non-string key 1"),
        ({"context": {"stats": {"a": 1}}}, r"context\['stats'\] must be a scalar"),
    ],
)
def test_validate_details_refuses_a_broken_contract(details, message):
    with pytest.raises(ValueError, match=message):
        audit_log.validate_details(details)


def test_validate_details_accepts_every_scalar_kind():
    when = datetime(2026, 1, 1, tzinfo=timezone.utc)
    marker = uuid.uuid4()
    context = {
        "s": "x",
        "i": 1,
        "f": 1.5,
        "b": False,
        "n": None,
        "dt": when,
        "d": date(2026, 1, 1),
        "u": marker,
        "list": ["a", 1, None, True],
        "tuple": ("a", "b"),
    }
    assert audit_log.validate_details({"context": context}) == {"context": context}


def test_merge_details_refuses_a_non_mapping_details():
    with pytest.raises(ValueError, match="must be a mapping; got str"):
        audit_log.merge_details("reason")


def test_merge_details_does_not_mutate_its_input():
    given = {"reason": "a"}
    assert audit_log.merge_details(given, reason="b") == {"reason": "b"}
    assert given == {"reason": "a"}


def test_detail_keys_are_the_documented_four():
    assert audit_log.DETAIL_KEYS == {"reason", "changes", "items", "context"}


# ── redact ────────────────────────────────────────────────────────────────


def test_redact_masks_secret_keys_and_encrypted_values():
    cipher = encrypt_value("s3cr3t")
    value = {
        "password": "a",
        "newPassword": "b",
        "client_secret": "c",
        "API_KEY": "d",
        "apiKey": "e",
        "access_token": "f",
        "private_key": "g",
        "service_account_json": "h",
        "some_secret_value": "i",
        "harmless": cipher,
        "list": [cipher, "plain", {"token": "j"}],
        "name": "kept",
        "count": 3,
        "flag": True,
        "nothing": None,
    }
    out = audit_log.redact(value)
    for key in (
        "password",
        "newPassword",
        "client_secret",
        "API_KEY",
        "apiKey",
        "access_token",
        "private_key",
        "service_account_json",
        "some_secret_value",
        "harmless",
    ):
        assert out[key] == "***", key
    assert out["list"] == ["***", "plain", {"token": "***"}]
    assert out["name"] == "kept"
    assert out["count"] == 3
    assert out["flag"] is True
    assert out["nothing"] is None
    # The input is untouched.
    assert value["password"] == "a" and value["list"][2] == {"token": "j"}


def test_redact_keeps_the_shape_of_a_masked_diff():
    out = audit_log.redact({"password": {"old": None, "new": "x"}, "token": ["a", None]})
    assert out == {"password": {"old": None, "new": "***"}, "token": ["***", None]}


def test_redact_applies_workspace_secret_paths():
    from app.services.workspace_io.secrets import EMAIL_SECRET_PATHS, GENERAL_SECRET_PATHS

    for path in (*GENERAL_SECRET_PATHS, *EMAIL_SECRET_PATHS):
        leaf = path[-1]
        nested: dict = {leaf: "plaintext"}
        for parent in reversed(path[:-1]):
            nested = {parent: nested}
        out = audit_log.redact(nested)
        node = out
        for parent in path[:-1]:
            node = node[parent]
        assert node[leaf] == "***", path
        assert audit_log.is_secret_key(leaf)
    ext = audit_log.redact({"ext.acme.secret.webhook": "x", "ext.acme.endpoint": "kept"})
    assert ext == {"ext.acme.secret.webhook": "***", "ext.acme.endpoint": "kept"}


def test_redact_passes_scalars_and_lists_through():
    assert audit_log.redact("plain") == "plain"
    assert audit_log.redact(None) is None
    assert audit_log.redact(5) == 5
    assert audit_log.redact(("a", encrypt_value("x"))) == ["a", "***"]
    assert audit_log.redact(encrypt_value("x")) == "***"


def test_is_secret_key_ignores_non_strings_and_ordinary_names():
    assert not audit_log.is_secret_key(5)
    assert not audit_log.is_secret_key(None)
    for key in ("email", "role", "display_name", "smtp_host", "ext.acme.endpoint"):
        assert not audit_log.is_secret_key(key), key


# ── diff ──────────────────────────────────────────────────────────────────


def test_diff_reports_only_changed_fields():
    old = {"role": "member", "email": "a@x", "is_active": True}
    new = {"role": "admin", "email": "a@x", "is_active": False}
    assert audit_log.diff(old, new) == {
        "role": {"old": "member", "new": "admin"},
        "is_active": {"old": True, "new": False},
    }


def test_diff_shape_matches_history_tab():
    changes = audit_log.diff({"a": 1}, {"a": 2})
    assert list(changes) == ["a"]
    assert set(changes["a"]) == {"old", "new"}


def test_diff_skips_keys_new_does_not_carry_and_reads_missing_old_as_none():
    old = {"role": "member", "email": "a@x"}
    new = {"display_name": "Alice"}
    assert audit_log.diff(old, new) == {"display_name": {"old": None, "new": "Alice"}}


def test_diff_restricts_to_keys_and_reads_objects():
    before = SimpleNamespace(role="member", email="a@x", password_hash="h1")
    after = {"role": "admin", "email": "b@x", "password_hash": "h2"}
    assert audit_log.diff(before, after, keys=("role",)) == {
        "role": {"old": "member", "new": "admin"}
    }
    assert audit_log.diff(after, before, keys=("email", "missing")) == {
        "email": {"old": "b@x", "new": "a@x"}
    }


def test_diff_of_an_object_without_keys_is_empty():
    assert audit_log.diff({"a": 1}, SimpleNamespace(a=2)) == {}


def test_diff_of_equal_values_is_empty():
    assert audit_log.diff({"a": [1, 2]}, {"a": [1, 2]}) == {}


# ── retention ─────────────────────────────────────────────────────────────


def test_permission_changes_keeps_only_changed_keys():
    assert audit_log.permission_changes(
        {"a": True, "b": True, "c": False}, {"a": True, "b": False, "d": True}
    ) == {"old": {"b": True, "d": False}, "new": {"b": False, "d": True}}


def test_permission_changes_reads_an_absent_key_as_false():
    assert audit_log.permission_changes({}, {"a": False}) == {}
    assert audit_log.permission_changes(None, None) == {}
    assert audit_log.permission_changes({"a": True}, None) == {
        "old": {"a": True},
        "new": {"a": False},
    }


def test_permission_changes_sorts_the_changed_keys():
    result = audit_log.permission_changes({"z": True, "a": True}, {})
    assert list(result["old"]) == ["a", "z"]
    assert list(result["new"]) == ["a", "z"]


def test_permission_changes_with_absent_none_tells_inherit_from_deny():
    # A card type's override cells: absent inherits, False denies.
    assert audit_log.permission_changes({"inventory.view": False}, {}, absent=None) == {
        "old": {"inventory.view": False},
        "new": {"inventory.view": None},
    }
    assert audit_log.permission_changes({}, {"inventory.view": False}, absent=None) == {
        "old": {"inventory.view": None},
        "new": {"inventory.view": False},
    }
    assert audit_log.permission_changes(None, {}, absent=None) == {}


def test_the_size_summary_helpers_are_gone():
    # Replaced by the semantic change items in ``services/audit_changes``.
    for name in ("summarised_change", "fingerprint", "canonical_json", "_plural"):
        assert not hasattr(audit_log, name), name


def test_retention_defaults_and_bounds():
    assert audit_log.DEFAULT_RETENTION_DAYS == 365
    assert audit_log.MAX_RETENTION_DAYS == 3650
    assert audit_log.retention_days(None) == 365
    assert audit_log.retention_days({}) == 365
    assert audit_log.retention_days({"auditLogRetentionDays": 0}) == 0
    assert audit_log.retention_days({"auditLogRetentionDays": 30}) == 30
    assert audit_log.retention_days({"auditLogRetentionDays": 3650}) == 3650
    assert audit_log.retention_days({"auditLogRetentionDays": 3651}) == 365
    assert audit_log.retention_days({"auditLogRetentionDays": -1}) == 365
    assert audit_log.retention_days({"auditLogRetentionDays": "30"}) == 365
    assert audit_log.retention_days({"auditLogRetentionDays": True}) == 365


def test_retention_cutoff():
    now = datetime(2026, 10, 2, tzinfo=timezone.utc)
    assert audit_log.retention_cutoff(0, now) is None
    assert audit_log.retention_cutoff(-5, now) is None
    assert audit_log.retention_cutoff(1, now) == now - timedelta(days=1)
    assert audit_log.retention_cutoff(365, now) == now - timedelta(days=365)


def test_resolve_origin():
    assert audit_log.resolve_origin("mcp", True) == "mcp"
    assert audit_log.resolve_origin("ext", False) == "ext"
    assert audit_log.resolve_origin(None, True) == "api"
    assert audit_log.resolve_origin(None, False) == "system"
    assert audit_log.resolve_origin("", True) == "api"


def test_items_may_be_any_sequence():
    # ``cap_items`` and comprehensions hand over lists, callers may hold tuples.
    merged = audit_log.merge_details(None, items=({"kind": "user.deleted", "user": "a@x"},))
    assert audit_log.validate_details(merged) == {
        "items": [{"kind": "user.deleted", "user": "a@x"}]
    }


def test_is_secret_key_spares_names_that_say_where_a_credential_is_used():
    # The stem ``token`` is in ``token_endpoint``; an auditor needs the URL an
    # SSO change points at, so a location suffix wins over the stem.
    for name in ("token_endpoint", "oauth_token_endpoint", "jwks_uri", "issuer_url"):
        assert audit_log.is_secret_key(name) is False, name
    for name in ("token", "access_token", "smtp_password", "oauth_client_secret"):
        assert audit_log.is_secret_key(name) is True, name
    # A workspace-transfer secret path or an extension secret still masks,
    # whatever its suffix.
    assert audit_log.is_secret_key("ext.acme.secret.api_url") is True


def test_redact_keeps_an_endpoint_change_readable():
    changes = {
        "token_endpoint": {"old": "https://a/token", "new": "https://b/token"},
        "client_secret": {"old": "x", "new": "y"},
    }
    assert audit_log.redact(changes) == {
        "token_endpoint": {"old": "https://a/token", "new": "https://b/token"},
        "client_secret": {"old": "***", "new": "***"},
    }
