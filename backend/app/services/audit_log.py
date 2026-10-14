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
                             details={"reason": "bad_password"})
      await db.commit()
      raise HTTPException(401, "Invalid credentials")

- **Secrets are masked at write time.** ``details`` always passes through
  ``redact`` before it is stored or logged, so a caller cannot leak a password
  by passing a raw settings diff. Mask in the caller too when in doubt.
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
from collections.abc import Iterable, Mapping
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import is_encrypted
from app.core.request_context import request_client
from app.models.audit_log import AuditLogEntry
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


def is_secret_key(key: Any) -> bool:
    """True when a mapping key names a credential."""
    if not isinstance(key, str):
        return False
    return (
        key in _SECRET_LEAF_KEYS
        or is_extension_secret_key(key)
        or bool(_SECRET_KEY_PATTERN.search(key))
    )


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


def _clip(value: Any, width: int) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text[:width] if text else None


def _jsonable(value: Any) -> Any:
    """Round-trip through JSON so UUIDs / datetimes in ``details`` store as strings."""
    if value is None:
        return None
    return json.loads(json.dumps(value, default=str))


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
    details: Mapping[str, Any] | None = None,
) -> AuditLogEntry:
    """Build (but do not add) the row ``record`` writes, stamped with the
    current request context. Pure apart from reading the contextvars."""
    validate(category, outcome, action)
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
        details=_jsonable(redact(details)) if details is not None else None,
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
    details: Mapping[str, Any] | None = None,
) -> AuditLogEntry:
    """Write one audit row and emit it on ``turbo_ea.audit``. Never commits.

    ``actor`` is the ``User`` who acted (its id and email are snapshotted);
    ``subject_email`` the account acted upon; ``target`` a
    ``(type, id, label)`` tuple (shorter tuples pad with ``None``); ``details``
    a JSON-able mapping, redacted before it is stored. Raises ``ValueError`` on
    an unknown ``category`` or ``outcome`` or an empty ``action``.
    """
    entry = build_entry(
        action=action,
        category=category,
        outcome=outcome,
        actor=actor,
        subject_email=subject_email,
        target=target,
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
