"""The security & admin audit log — the one write path into ``audit_log``.

``record`` writes one row per security-relevant action (a sign-in, a failed
attempt, a sign-out, an admin changing a role or a setting, an export) and
emits the same fields as one JSON line on the ``turbo_ea.audit`` logger, so
``docker logs`` / Kubernetes log shipping / a SIEM receive the stream with no
extra configuration.

It deliberately does **not** go through ``event_bus.publish``: a card-less
event auto-creates a mutation batch, is delivered on the SSE stream and used to
surface in the dashboard's Recent Activity, none of which a failed login may
reach.

**The ``details`` contract.** A row's ``details`` holds at most four keys,
each passed as its own keyword to ``record`` and checked by
``validate_details`` (a breach is a ``ValueError`` at the caller, never a row
the Security log cannot render):

- ``reason`` — a short snake_case code saying why an attempt failed
  (``bad_password``, ``locked``, ``hd_mismatch``). Auth, SSO, proxy and
  password failures only.
- ``changes`` — ``{field: {"old": v, "new": v}}`` for plain fields that moved
  (``diff`` builds it). Field names are snake_case; the frontend labels them.
- ``items`` — a list of semantic change items ``{"kind": "<noun>.<verb>",
  …}`` for the big JSON columns (a card type's ``fields_schema``, a portal's
  ``card_config``, a role's permission matrix), built by
  ``app.services.audit_changes``; ``kind`` must be one of its
  ``AUDIT_ITEM_KINDS``, each rendered from an i18n sentence template.
- ``context`` — ``{key: v}`` plain facts that are not a change (a count, a
  file size, a version, a foreign id under ``reference``).

Every ``v`` is a scalar (``str`` / ``int`` / ``float`` / ``bool`` / ``None``;
a ``datetime`` / ``date`` / ``UUID`` is stored as its ISO / string form) or a
flat list of scalars — never a nested mapping, which is what made rows
unreadable before. Values are labels, not keys, for anything an admin defines
(roles, card types, fields, options, tags, portals); system enumerations stay
codes. ``details=`` still accepts a mapping of the same four keys; a keyword
wins over its key there. Empty parts are dropped, and a row with nothing left
stores ``details = NULL``. ``tests/services/test_audit_log_guard.py`` scans
every writer under ``app/api/v1`` for a ``details=`` that breaks the contract.

Rules for callers:

- **``record`` never commits.** It adds and flushes, like every helper handed a
  session (CLAUDE.md: a helper must never commit or roll back a session it was
  given). The caller's own commit persists the row with the rest of its work.
- **Commit before you raise.** ``get_db`` never commits, so a row recorded on a
  path that then raises ``HTTPException`` is rolled back with the request and
  the failure leaves no trace — which is exactly the record a failed-login
  audit exists to keep. A handler that records a failure and then raises must
  ``await db.commit()`` in between::

      await audit_log.record(db, action="auth.login.failed", category="auth",
                             outcome="failure", subject_email=email,
                             reason="bad_password")
      await db.commit()
      raise HTTPException(401, "Invalid credentials")

- **Secrets are masked at write time.** ``details`` always passes through
  ``redact`` after validation and before it is stored or logged, so a caller
  cannot leak a password by passing a raw settings diff. Mask in the caller
  too when in doubt.
- **Rows are immutable.** Nothing updates or deletes one except the retention
  purge in ``app.main`` (``general_settings.auditLogRetentionDays``).
- **The table is the record; the stream is the live feed.** The JSON line is
  emitted when the entry is *recorded* (added and flushed), not when it is
  committed — the logger cannot know whether the caller's transaction will
  commit. A request whose transaction later fails or rolls back therefore
  leaves a ``turbo_ea.audit`` line with no matching row. Reconcile against the
  ``audit_log`` table, never the other way round.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from collections.abc import Iterable, Mapping, Sequence
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import is_encrypted
from app.core.request_context import request_client
from app.models.audit_log import AuditLogEntry
from app.services.audit_changes import AUDIT_ITEM_KINDS
from app.services.event_bus import request_impersonation, request_origin
from app.services.workspace_io.secrets import (
    EMAIL_SECRET_PATHS,
    GENERAL_SECRET_PATHS,
    is_extension_secret_key,
)

AUDIT_LOGGER = logging.getLogger("turbo_ea.audit")

CATEGORIES: frozenset[str] = frozenset({"auth", "admin", "access"})
OUTCOMES: frozenset[str] = frozenset({"success", "failure"})

# Retention of the ``audit_log`` table, in days, stored in
# ``app_settings.general_settings[RETENTION_SETTING_KEY]``. ``0`` keeps rows
# forever. Read by the daily purge (``app.main``) and the settings routes.
RETENTION_SETTING_KEY = "auditLogRetentionDays"
DEFAULT_RETENTION_DAYS = 365
MAX_RETENTION_DAYS = 3650

MASK = "***"

# A key whose name says it holds a credential. Searched, not matched, so
# ``smtp_password`` and ``oauth_client_secret`` are caught by their stem.
_SECRET_KEY_PATTERN = re.compile(
    r"(password|secret|token|api_key|apikey|client_secret|service_account|private_key)",
    re.IGNORECASE,
)

# The leaf names of the paths workspace transfer never lets leave an instance
# (``workspace_io/secrets.py`` is the authority). The pattern above already
# matches each of them; naming them here keeps a future edit to the pattern
# from silently un-masking a credential the export side knows about.
_SECRET_LEAF_KEYS: frozenset[str] = frozenset(
    path[-1] for path in (*GENERAL_SECRET_PATHS, *EMAIL_SECRET_PATHS)
)

# Column widths of ``audit_log`` (migration 154), applied to every string the
# caller passes so a long user-supplied email can never fail the INSERT.
_WIDTHS = {
    "action": 100,
    "email": 255,
    "target_type": 50,
    "target_id": 100,
    "target_label": 255,
    "ip": 45,
    "user_agent": 255,
    "origin": 20,
    "impersonated_role": 100,
}


# The keys that name WHERE a credential is used rather than the credential —
# the SSO ``token_endpoint`` and the e-mail ``oauth_token_endpoint`` — yet carry
# the ``token`` stem the pattern above masks. An auditor reading an SSO change
# needs the endpoint it now points at, so exactly these two stay readable. An
# allowlist, not a suffix rule: a future ``webhook_token_url`` could carry
# ``https://user:pass@host/…`` and must stay masked. The other endpoint keys
# (``jwks_uri``, ``authorization_endpoint``, ``issuer_url``, ``instance_url``,
# ``provider_url``, ``search_url``, ``app_base_url``) match no stem and need no
# exemption. A workspace-transfer secret path or an extension secret
# (``ext.<key>.secret.*``) is checked first and masks whatever its name.
_READABLE_LOCATION_KEYS: frozenset[str] = frozenset({"token_endpoint", "oauth_token_endpoint"})


def is_secret_key(key: Any) -> bool:
    """True when a mapping key names a credential."""
    if not isinstance(key, str):
        return False
    if key in _SECRET_LEAF_KEYS or is_extension_secret_key(key):
        return True
    if key in _READABLE_LOCATION_KEYS:
        return False
    return bool(_SECRET_KEY_PATTERN.search(key))


def _mask_all(value: Any) -> Any:
    """Mask every leaf of ``value`` while keeping its shape.

    ``None`` stays ``None``: "no secret was set" is not itself a secret, and it
    is what tells an auditor a credential was configured for the first time. A
    ``{"old", "new"}`` diff of a password therefore reads
    ``{"old": None, "new": "***"}``.
    """
    if value is None:
        return None
    if isinstance(value, Mapping):
        return {k: _mask_all(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_mask_all(v) for v in value]
    return MASK


def redact(value: Any) -> Any:
    """Return a copy of ``value`` with every secret masked as ``"***"``.

    Recursive over mappings and lists. Masks the value of any key that names a
    credential (``is_secret_key``: the password / secret / token / API-key
    pattern, the workspace-transfer secret paths, ``ext.<key>.secret.*``) and
    any string that is a Fernet ciphertext (``enc:``-prefixed), wherever it
    sits. Never mutates its input.
    """
    if isinstance(value, Mapping):
        return {k: (_mask_all(v) if is_secret_key(k) else redact(v)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    if isinstance(value, str) and is_encrypted(value):
        return MASK
    return value


_MISSING = object()


def _read(source: Any, key: str) -> Any:
    if isinstance(source, Mapping):
        return source.get(key, _MISSING)
    return getattr(source, key, _MISSING)


def diff(old: Any, new: Any, *, keys: Iterable[str] | None = None) -> dict[str, dict[str, Any]]:
    """``{field: {"old": …, "new": …}}`` for every field whose value changed.

    The shape the card History tab's ``parseChanges`` renders, so the Security
    log drawer can show both the same way. ``old`` and ``new`` are mappings or
    objects (read with ``getattr``). ``new`` is what was *written*: a field it
    does not carry was not touched and is not reported, which is what makes a
    partial PATCH body (``model_dump(exclude_unset=True)``) a valid ``new``. A
    field missing from ``old`` reads as ``None``. ``keys`` restricts the
    comparison (default: every key of a mapping ``new``). Values are not
    redacted here — ``record`` redacts ``details`` on the way in.
    """
    if keys is None:
        keys = list(new.keys()) if isinstance(new, Mapping) else []
    changes: dict[str, dict[str, Any]] = {}
    for key in keys:
        after = _read(new, key)
        if after is _MISSING:
            continue
        before = _read(old, key)
        if before is _MISSING:
            before = None
        if before != after:
            changes[key] = {"old": before, "new": after}
    return changes


def permission_changes(
    old: Mapping[str, Any] | None,
    new: Mapping[str, Any] | None,
    *,
    absent: bool | None = False,
) -> dict[str, dict[str, bool | None]]:
    """``{"old": {...}, "new": {...}}`` restricted to the permission keys that changed.

    A role's matrix has ~70 keys; an audit row that copied it whole on every
    save would bury the one flag that moved. By default an absent key reads as
    ``False`` (that is how ``PermissionService`` evaluates a role), so adding a
    key as ``False`` is not a change. A map where absence means something else
    passes ``absent=None``: a card type's per-role override cells, where an
    absent cell *inherits* the role's grant and an explicit ``False`` denies, so
    Deny → inherit must read ``False → None``, never ``False → False``. Empty
    when nothing changed.
    """
    old = old or {}
    new = new or {}

    def read(source: Mapping[str, Any], key: str) -> bool | None:
        return bool(source[key]) if key in source else absent

    changed = sorted(k for k in set(old) | set(new) if read(old, k) != read(new, k))
    if not changed:
        return {}
    return {
        "old": {k: read(old, k) for k in changed},
        "new": {k: read(new, k) for k in changed},
    }


def validate(category: str, outcome: str, action: str) -> None:
    """Raise ``ValueError`` for a category or outcome the log does not know, or
    for an empty ``action``.

    ``action`` is ``NOT NULL`` in ``audit_log`` and ``_clip`` turns an empty
    string into ``None``, so an empty action would otherwise reach the INSERT
    and fail the request with a 500 instead of failing here, at the caller.
    """
    if not isinstance(action, str) or not action.strip():
        raise ValueError(f"An audit action is required; got {action!r}")
    if category not in CATEGORIES:
        raise ValueError(
            f"Unknown audit category {category!r}; expected one of {sorted(CATEGORIES)}"
        )
    if outcome not in OUTCOMES:
        raise ValueError(f"Unknown audit outcome {outcome!r}; expected one of {sorted(OUTCOMES)}")


DETAIL_KEYS: frozenset[str] = frozenset({"reason", "changes", "items", "context"})

# What a value inside ``details`` may be. ISO datetimes, dates and UUIDs are
# accepted and stored as their string form (``_jsonable``).
_DETAIL_SCALARS = (str, int, float, bool, datetime, date, uuid.UUID)


def _is_detail_value(value: Any) -> bool:
    """A scalar, or a flat list of scalars."""
    if value is None or isinstance(value, _DETAIL_SCALARS):
        return True
    return isinstance(value, (list, tuple)) and all(
        v is None or isinstance(v, _DETAIL_SCALARS) for v in value
    )


def _check_flat_map(name: str, value: Any) -> None:
    if not isinstance(value, Mapping):
        raise ValueError(f"Audit details {name!r} must be a mapping; got {type(value).__name__}")
    for key, v in value.items():
        if not isinstance(key, str):
            raise ValueError(f"Audit details {name!r} has a non-string key {key!r}")
        if not _is_detail_value(v):
            raise ValueError(
                f"Audit details {name}[{key!r}] must be a scalar or a flat list of scalars"
            )


def _check_changes(changes: Any) -> None:
    if not isinstance(changes, Mapping):
        raise ValueError("Audit details 'changes' must be a mapping of {field: {old, new}}")
    for field, change in changes.items():
        if not isinstance(field, str):
            raise ValueError(f"Audit details 'changes' has a non-string field {field!r}")
        if not isinstance(change, Mapping) or set(change) != {"old", "new"}:
            raise ValueError(f"Audit details changes[{field!r}] must be exactly {{old, new}}")
        if not (_is_detail_value(change["old"]) and _is_detail_value(change["new"])):
            raise ValueError(
                f"Audit details changes[{field!r}] must hold scalars or flat lists of scalars"
            )


def _check_items(items: Any) -> None:
    if not isinstance(items, (list, tuple)):
        raise ValueError("Audit details 'items' must be a list of change items")
    for index, entry in enumerate(items):
        if not isinstance(entry, Mapping):
            raise ValueError(f"Audit details items[{index}] must be a mapping")
        kind = entry.get("kind")
        if kind not in AUDIT_ITEM_KINDS:
            raise ValueError(f"Audit details items[{index}] has an unknown kind {kind!r}")
        _check_flat_map(f"items[{index}]", entry)


def validate_details(details: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """Enforce the ``details`` contract and return what to store.

    Top-level keys must be a subset of ``DETAIL_KEYS``: ``reason`` a non-empty
    string; ``changes`` ``{field: {"old": v, "new": v}}``; ``items`` a list of
    change items whose ``kind`` is in ``audit_changes.AUDIT_ITEM_KINDS``;
    ``context`` ``{key: v}``. Every ``v`` is a scalar or a flat list of scalars
    — a nested mapping is a ``ValueError`` naming where it sits. An empty
    ``changes`` / ``items`` / ``context`` (and a ``None`` anywhere at the top)
    is dropped; ``None`` when nothing is left.
    """
    if details is None:
        return None
    if not isinstance(details, Mapping):
        raise ValueError(f"Audit details must be a mapping; got {type(details).__name__}")
    for key in details:
        if key not in DETAIL_KEYS:
            raise ValueError(
                f"Unknown audit details key {key!r}; expected a subset of {sorted(DETAIL_KEYS)}"
            )
    out: dict[str, Any] = {}
    reason = details.get("reason")
    if reason is not None:
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError(f"Audit details 'reason' must be a non-empty string; got {reason!r}")
        out["reason"] = reason
    checks = (("changes", _check_changes), ("items", _check_items), ("context", None))
    for key, check in checks:
        value = details.get(key)
        if value is None:
            continue
        if check is None:
            _check_flat_map(key, value)
        else:
            check(value)
        if len(value):
            out[key] = list(value) if isinstance(value, tuple) else value
    return out or None


def merge_details(
    details: Mapping[str, Any] | None,
    *,
    reason: str | None = None,
    changes: Mapping[str, Any] | None = None,
    items: Sequence[Mapping[str, Any]] | None = None,
    context: Mapping[str, Any] | None = None,
) -> dict[str, Any] | None:
    """``details`` with each keyword that is not ``None`` set over it (a keyword
    wins over the same key in ``details``), validated by ``validate_details``."""
    if details is not None and not isinstance(details, Mapping):
        raise ValueError(f"Audit details must be a mapping; got {type(details).__name__}")
    merged: dict[str, Any] = dict(details or {})
    keywords = {"reason": reason, "changes": changes, "items": items, "context": context}
    for key, value in keywords.items():
        if value is not None:
            merged[key] = value
    return validate_details(merged)


def _clip(value: Any, width: int) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text[:width] if text else None


def _json_default(value: Any) -> str:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def _jsonable(value: Any) -> Any:
    """Round-trip through JSON so UUIDs store as strings and datetimes / dates
    as ISO 8601."""
    if value is None:
        return None
    return json.loads(json.dumps(value, default=_json_default))


def _impersonator_id(raw: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(raw)
    except (TypeError, ValueError):
        return None


def resolve_origin(origin: str | None, in_request: bool) -> str:
    """The origin to stamp: the request's ``X-Turbo-EA-Origin`` (or an
    extension's ``ext``) when set, else ``api`` for a request that sent none
    and ``system`` for work outside any request (a background job)."""
    if origin:
        return origin
    return "api" if in_request else "system"


def build_entry(
    *,
    action: str,
    category: str,
    outcome: str = "success",
    actor: Any = None,
    subject_email: str | None = None,
    target: tuple[Any, ...] | None = None,
    reason: str | None = None,
    changes: Mapping[str, Any] | None = None,
    items: Sequence[Mapping[str, Any]] | None = None,
    context: Mapping[str, Any] | None = None,
    details: Mapping[str, Any] | None = None,
) -> AuditLogEntry:
    """Build (but do not add) the row ``record`` writes, stamped with the
    current request context. Pure apart from reading the contextvars."""
    validate(category, outcome, action)
    stored = merge_details(details, reason=reason, changes=changes, items=items, context=context)
    client = request_client.get()
    ip, agent = client if client else (None, None)
    impersonation = request_impersonation.get()
    target_type, target_id, target_label = (tuple(target or ()) + (None, None, None))[:3]
    return AuditLogEntry(
        id=uuid.uuid4(),
        category=category,
        action=_clip(action, _WIDTHS["action"]),
        outcome=outcome,
        actor_user_id=getattr(actor, "id", None),
        actor_email=_clip(getattr(actor, "email", None), _WIDTHS["email"]),
        subject_email=_clip(subject_email, _WIDTHS["email"]),
        target_type=_clip(target_type, _WIDTHS["target_type"]),
        target_id=_clip(target_id, _WIDTHS["target_id"]),
        target_label=_clip(target_label, _WIDTHS["target_label"]),
        ip=_clip(ip, _WIDTHS["ip"]),
        user_agent=_clip(agent, _WIDTHS["user_agent"]),
        origin=_clip(resolve_origin(request_origin.get(), client is not None), _WIDTHS["origin"]),
        impersonator_user_id=_impersonator_id(impersonation[0]) if impersonation else None,
        impersonated_role=(
            _clip(impersonation[1], _WIDTHS["impersonated_role"]) if impersonation else None
        ),
        details=_jsonable(redact(stored)) if stored is not None else None,
    )


def log_line(entry: AuditLogEntry) -> str:
    """The JSON line ``record`` emits on ``turbo_ea.audit`` for ``entry``."""
    return json.dumps(
        {
            "audit_id": entry.id,
            "created_at": entry.__dict__.get("created_at"),
            "category": entry.category,
            "action": entry.action,
            "outcome": entry.outcome,
            "actor_user_id": entry.actor_user_id,
            "actor_email": entry.actor_email,
            "subject_email": entry.subject_email,
            "target_type": entry.target_type,
            "target_id": entry.target_id,
            "target_label": entry.target_label,
            "ip": entry.ip,
            "user_agent": entry.user_agent,
            "origin": entry.origin,
            "impersonator_user_id": entry.impersonator_user_id,
            "impersonated_role": entry.impersonated_role,
            "details": entry.details,
        },
        default=str,
    )


async def record(
    db: AsyncSession,
    *,
    action: str,
    category: str,
    outcome: str = "success",
    actor: Any = None,
    subject_email: str | None = None,
    target: tuple[Any, ...] | None = None,
    reason: str | None = None,
    changes: Mapping[str, Any] | None = None,
    items: Sequence[Mapping[str, Any]] | None = None,
    context: Mapping[str, Any] | None = None,
    details: Mapping[str, Any] | None = None,
) -> AuditLogEntry:
    """Write one audit row and emit it on ``turbo_ea.audit``. Never commits.

    ``actor`` is the ``User`` who acted (its id and email are snapshotted);
    ``subject_email`` the account acted upon; ``target`` a
    ``(type, id, label)`` tuple (shorter tuples pad with ``None``).
    ``reason`` / ``changes`` / ``items`` / ``context`` are the four parts of
    ``details`` (see the module docstring); ``details`` is the legacy way to
    pass the same four keys at once, and a keyword wins over its key there.
    Redacted before it is stored. Raises ``ValueError`` on an unknown
    ``category`` or ``outcome``, an empty ``action``, or ``details`` that break
    the contract (``validate_details``).
    """
    entry = build_entry(
        action=action,
        category=category,
        outcome=outcome,
        actor=actor,
        subject_email=subject_email,
        target=target,
        reason=reason,
        changes=changes,
        items=items,
        context=context,
        details=details,
    )
    db.add(entry)
    await db.flush()
    AUDIT_LOGGER.info(log_line(entry))
    return entry


def retention_days(general_settings: Mapping[str, Any] | None) -> int:
    """The configured retention in days, falling back to the default for a
    missing or malformed value (a bool or a number outside 0..MAX)."""
    raw = (general_settings or {}).get(RETENTION_SETTING_KEY, DEFAULT_RETENTION_DAYS)
    if isinstance(raw, bool) or not isinstance(raw, int):
        return DEFAULT_RETENTION_DAYS
    if raw < 0 or raw > MAX_RETENTION_DAYS:
        return DEFAULT_RETENTION_DAYS
    return raw


def retention_cutoff(days: int, now: datetime) -> datetime | None:
    """Rows created on or before the returned instant are past retention;
    ``None`` (for ``0``) means keep everything."""
    if days <= 0:
        return None
    return now - timedelta(days=days)
