"""Secret-exclusion authority for workspace export.

This module is the SINGLE source of truth for what never leaves an instance in
a workspace bundle. Stripping happens in the exporter, server-side, before any
value is written into the workbook — the secret never enters the bundle buffer.

Two independent reasons a secret must be excluded:

1. It is a credential (SMTP password, SSO client secret, AI API key, ServiceNow
   credentials). These are sensitive on their own.
2. Even if it leaked, every encrypted (``enc:``-prefixed) value is a Fernet
   token derived from the *source* instance's ``SECRET_KEY``. The target
   instance has a different key, so ``decrypt_value()`` would raise
   ``InvalidToken`` — encrypted values are non-portable by construction. The
   admin must re-enter SMTP/SSO/AI secrets on the target regardless, and the
   importer must never write a secret field back (it would persist
   undecryptable garbage).
"""

from __future__ import annotations

import copy
from typing import Any

from app.core.encryption import is_encrypted

# Dotted paths (relative to the named settings blob) that are always dropped.
GENERAL_SECRET_PATHS: tuple[tuple[str, ...], ...] = (
    ("sso", "client_secret"),
    ("ai", "apiKey"),
)
EMAIL_SECRET_PATHS: tuple[tuple[str, ...], ...] = (
    ("smtp_password",),
    ("oauth_client_secret",),
    ("service_account_json",),
)

# User-FK columns that are instance-local and meaningless on the target. They
# are dropped on export and re-resolved on import via the email→user map.
INSTANCE_LOCAL_FK_COLUMNS: frozenset[str] = frozenset(
    {"owner_id", "created_by", "updated_by", "archived_by", "user_id", "created_by_id"}
)


def _drop_path(blob: dict[str, Any], path: tuple[str, ...]) -> None:
    """Delete a nested key by dotted path, tolerating missing intermediates."""
    node: Any = blob
    for key in path[:-1]:
        if not isinstance(node, dict) or key not in node:
            return
        node = node[key]
    if isinstance(node, dict):
        node.pop(path[-1], None)


def _scrub_encrypted(node: Any) -> Any:
    """Recursively remove any ``enc:``-prefixed value anywhere in a JSON blob.

    Defensive catch-all so a future nested secret key is excluded without a
    code change here. Returns a cleaned deep copy.
    """
    if isinstance(node, dict):
        return {
            k: _scrub_encrypted(v)
            for k, v in node.items()
            if not (isinstance(v, str) and is_encrypted(v))
        }
    if isinstance(node, list):
        return [_scrub_encrypted(v) for v in node]
    return node


def strip_secrets(
    general_settings: dict[str, Any] | None,
    email_settings: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return export-safe copies of the two settings blobs.

    Drops the known credential paths, then defensively scrubs any remaining
    ``enc:`` value. Never mutates the inputs.
    """
    general = copy.deepcopy(general_settings or {})
    email = copy.deepcopy(email_settings or {})

    for path in GENERAL_SECRET_PATHS:
        _drop_path(general, path)
    for path in EMAIL_SECRET_PATHS:
        _drop_path(email, path)

    general = _scrub_encrypted(general)
    email = _scrub_encrypted(email)
    return general, email


def is_secret_settings_key(blob_name: str, dotted: tuple[str, ...]) -> bool:
    """True when a settings path is a known credential (used by the importer to
    skip writing it back)."""
    paths = GENERAL_SECRET_PATHS if blob_name == "general" else EMAIL_SECRET_PATHS
    return dotted in paths
