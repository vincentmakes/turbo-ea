"""Directory-driven role assignment, shared by native SSO and reverse-proxy sign-in.

An identity provider can say which groups or app roles a user holds. Both sign-in
modes turn that answer into a Turbo EA role with the same rules, so the two cannot
drift apart:

- **First match in map order wins**, case-insensitively. A user can hold several
  directory values and the claim shapes do not agree on their order, so the
  administrator's own order is the only deterministic tie-break.
- A value that matches nothing gives the **default role** (decided by the caller,
  which can read the roles table); an **absent or empty claim** leaves the role
  alone — a mistyped claim name must not demote everyone in one pass.

Everything here is pure — no request, no database, no settings import — so the
mutation gate scores it; ``app/api/v1/auth.py`` validates the target role against
the ``roles`` table and applies it.

**Stored shape of the native map** (``general_settings["sso"]["role_map"]``): an
ordered list of ``{"value": str, "role": str}``, with ``value`` kept in the casing
the administrator typed (so the admin screen shows it back unchanged) and both
sides trimmed. Matching lower-cases ``value`` at read time (``role_map_pairs``), so
casing in storage never decides a match.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

MAX_ROLE_MAP_ROWS = 100
MAX_ROLE_MAP_VALUE_LENGTH = 256
MAX_EXTRA_SCOPES_LENGTH = 200

# Microsoft tenant segments that admit accounts from any tenant. With one of
# these, a foreign tenant's administrator could put their own users in a group
# or app role with the mapped value and so assign themselves this app's roles —
# the map needs a specific tenant ID.
MULTI_TENANT_TENANTS = frozenset({"organizations", "common", "consumers"})
DEFAULT_MICROSOFT_TENANT = "organizations"

# RFC 6749 §3.3: scope-token = 1*( %x21 / %x23-5B / %x5D-7E ) — printable ASCII
# without space, double quote or backslash.
_SCOPE_TOKEN = re.compile(r"[\x21\x23-\x5B\x5D-\x7E]+")

RoleMapRows = list[dict[str, str]]
RolePairs = list[tuple[str, str]]


def claim_values(claims: Mapping[str, Any] | None, key: str | None) -> tuple[str, ...]:
    """Every value of one claim, as a tuple of trimmed, non-empty strings.

    An identity provider sends a single value as a string and several as a list;
    both shapes come out the same. Non-string entries are dropped rather than
    coerced — a group or role name is a string or it is nothing. An empty tuple
    means "absent", which the callers treat as "leave the role alone".
    """
    if not key or not isinstance(claims, Mapping):
        return ()
    value = claims.get(key)
    if isinstance(value, str):
        return (value.strip(),) if value.strip() else ()
    if isinstance(value, list):
        return tuple(v.strip() for v in value if isinstance(v, str) and v.strip())
    return ()


def map_role(values: Iterable[str], role_map: Sequence[tuple[str, str]]) -> str | None:
    """The role key of the first ``role_map`` entry whose value the user holds.

    ``role_map`` is an ordered list of ``(directory value, role key)``; both sides
    of the comparison are lower-cased. None when nothing matches or there are no
    values — the caller decides what "no match" means.
    """
    held = {v.lower() for v in values}
    if not held:
        return None
    for source, target in role_map:
        if source.lower() in held:
            return target
    return None


def _row_fields(row: Any) -> tuple[str, str] | None:
    """``(value, role)`` of one stored row, trimmed, or None when malformed."""
    if not isinstance(row, Mapping):
        return None
    value, role = row.get("value"), row.get("role")
    if not isinstance(value, str) or not isinstance(role, str):
        return None
    return value.strip(), role.strip()


def normalise_role_map(raw: Any) -> RoleMapRows:
    """The stored map as a clean list of ``{"value", "role"}``, tolerantly.

    Read-time counterpart of ``validate_role_map``: a workspace import writes the
    settings blob without the route's validation, so a malformed row is dropped
    rather than raised on — a sign-in must never fail on a settings typo. Rows
    with an empty side are dropped, and a value repeated (case-insensitively)
    keeps only its first row, which is the row ``map_role`` would honour anyway.
    """
    if not isinstance(raw, list):
        return []
    rows: RoleMapRows = []
    seen: set[str] = set()
    for entry in raw:
        fields = _row_fields(entry)
        if fields is None:
            continue
        value, role = fields
        if not value or not role or value.lower() in seen:
            continue
        seen.add(value.lower())
        rows.append({"value": value, "role": role})
    return rows


def role_map_pairs(rows: Iterable[Mapping[str, str]]) -> RolePairs:
    """``(lower-cased value, role key)`` pairs for ``map_role``, in order."""
    return [(row["value"].lower(), row["role"]) for row in rows]


def validate_role_map(raw: Iterable[Any]) -> RoleMapRows:
    """The map an administrator saves, cleaned, or a ``ValueError`` saying why not.

    Strict counterpart of ``normalise_role_map``: every refusal names the row. Each
    row is trimmed; the value keeps its casing.
    """
    entries = list(raw)
    if len(entries) > MAX_ROLE_MAP_ROWS:
        raise ValueError(f"A role map holds at most {MAX_ROLE_MAP_ROWS} rows.")
    rows: RoleMapRows = []
    seen: set[str] = set()
    for entry in entries:
        fields = _row_fields(entry)
        if fields is None:
            raise ValueError("Each role mapping row needs a directory value and a role.")
        value, role = fields
        if not value:
            raise ValueError("A role mapping row has an empty directory value.")
        if len(value) > MAX_ROLE_MAP_VALUE_LENGTH:
            raise ValueError(
                f"The directory value '{value[:40]}…' is longer than "
                f"{MAX_ROLE_MAP_VALUE_LENGTH} characters."
            )
        if not role:
            raise ValueError(f"The role mapping row for '{value}' has no role.")
        if value.lower() in seen:
            raise ValueError(
                f"The directory value '{value}' appears more than once in the role map "
                "(values are compared without regard to case)."
            )
        seen.add(value.lower())
        rows.append({"value": value, "role": role})
    return rows


def roles_to_check(new_rows: Iterable[Mapping[str, str]], stored: Any) -> list[str]:
    """The role keys of the rows in ``new_rows`` that are new or changed.

    A row re-sent exactly as stored (same value, case-insensitively, and same role)
    is not re-validated, so a role archived since the map was saved does not block
    an unrelated SSO edit; any other row's role must exist and be live. Unique, in
    first-seen order.
    """
    kept = {(row["value"].lower(), row["role"]) for row in normalise_role_map(stored)}
    out: list[str] = []
    for row in new_rows:
        if (row["value"].lower(), row["role"]) in kept or row["role"] in out:
            continue
        out.append(row["role"])
    return out


def is_multi_tenant(tenant_id: Any) -> bool:
    """Whether a Microsoft tenant setting admits accounts from any tenant.

    A missing, blank or non-string value reads as the default ``organizations``.
    """
    tenant = tenant_id.strip().lower() if isinstance(tenant_id, str) else ""
    return (tenant or DEFAULT_MICROSOFT_TENANT) in MULTI_TENANT_TENANTS


def role_claim(sso: Mapping[str, Any]) -> str:
    """The configured claim name, trimmed; ``""`` when unset or not a string."""
    raw = sso.get("role_claim")
    return raw.strip() if isinstance(raw, str) else ""


def check_role_map_config(
    *, provider: str, tenant_id: Any, claim: str, rows: Sequence[Any]
) -> None:
    """Refuse (``ValueError``) a role map the sign-in could not safely honour.

    Judged on the settings as they will be after a save. An empty map is always
    fine. Google is not refused here — its ID token carries no group claim, so a
    map there is simply ignored (``native_role_map``).
    """
    if not rows:
        return
    if not claim:
        raise ValueError(
            "A role map needs a claim name: set the ID token claim that carries "
            "the user's groups or roles."
        )
    if provider == "microsoft" and is_multi_tenant(tenant_id):
        raise ValueError(
            "Role mapping with Microsoft needs a specific tenant ID. With a "
            "multi-tenant setting (organizations, common or consumers) another "
            "tenant could assign itself this app's roles."
        )


def role_mapping_changed(stored: Mapping[str, Any], updated: Mapping[str, Any]) -> bool:
    """Whether a save changes who the role map hands which role.

    Compares the claim name and the map rows (order, value casing and role) of the
    SSO block before (``stored``) and after (``updated``) the save. Handing out
    roles is user management, so the settings route asks for ``admin.users`` on top
    of ``admin.settings`` exactly when this is True. A form that re-sends the
    stored values unchanged — the admin screen always does — is not a change, and
    neither is an edit of the other SSO fields or of the extra scopes.
    """
    if role_claim(stored) != role_claim(updated):
        return True
    return normalise_role_map(stored.get("role_map")) != normalise_role_map(updated.get("role_map"))


def native_role_map(sso: Any) -> RolePairs:
    """The native SSO role map in force, as ``map_role`` pairs; empty when off.

    The one answer to "does a native role map apply?". Off when SSO is disabled,
    the provider is Google (no group claim in its ID token), no claim name is set,
    the map is empty, or the provider is Microsoft with a multi-tenant tenant
    (``is_multi_tenant``). Normalises the stored map, since a workspace import
    bypasses the route's validation.
    """
    if not isinstance(sso, Mapping) or not sso.get("enabled"):
        return []
    provider = sso.get("provider", "microsoft")
    if provider == "google":
        return []
    if provider == "microsoft" and is_multi_tenant(sso.get("tenant_id")):
        return []
    if not role_claim(sso):
        return []
    return role_map_pairs(normalise_role_map(sso.get("role_map")))


def validate_scopes(extra: str) -> str:
    """Extra OAuth scopes as one space-separated string, or a ``ValueError``.

    Whitespace of any kind separates scopes; each must be an RFC 6749 scope token
    and the result at most ``MAX_EXTRA_SCOPES_LENGTH`` characters. A scope repeated
    is kept once.
    """
    tokens: list[str] = []
    for token in extra.split():
        if not _SCOPE_TOKEN.fullmatch(token):
            raise ValueError(f"'{token}' is not a valid OAuth scope.")
        if token not in tokens:
            tokens.append(token)
    joined = " ".join(tokens)
    if len(joined) > MAX_EXTRA_SCOPES_LENGTH:
        raise ValueError(f"Extra scopes may be at most {MAX_EXTRA_SCOPES_LENGTH} characters.")
    return joined


def merge_scopes(base: str, extra: Any) -> str:
    """``base`` followed by every extra scope it does not already carry.

    The base scopes are always kept, in their order. An extra token that is not a
    valid scope token is skipped rather than passed on — the stored value can come
    from a workspace import, which the route's validation never saw.
    """
    tokens = base.split()
    if isinstance(extra, str):
        for token in extra.split():
            if _SCOPE_TOKEN.fullmatch(token) and token not in tokens:
                tokens.append(token)
    return " ".join(tokens)


def login_scopes(sso: Mapping[str, Any], base: str) -> str:
    """The scopes the app's own SSO sign-in asks for: ``base`` plus the extra scopes.

    The one answer for both the authorize step (``/auth/sso/config``) and the code
    exchange (``sso_service.exchange_code_for_claims(login=True)``), so the two
    never ask for different grants. **Google gets ``base`` only**: the admin screen
    hides the extra-scopes field for Google but keeps the stored value, and Google
    refuses a scope it does not know (``invalid_scope``) — a provider switch would
    otherwise break every sign-in. Portal and published-diagram visitors never use
    this; they keep ``base``.
    """
    if sso.get("provider") == "google":
        return base
    return merge_scopes(base, sso.get("extra_scopes"))


def role_is_directory_managed(
    auth_provider: str | None, *, native_active: bool, proxy_active: bool
) -> bool:
    """Whether a user's role is set by the identity provider at every sign-in.

    True for a federated account (``auth_provider == "sso"``) while a native or a
    reverse-proxy role map is in force. A hand edit of such a role would be
    reverted at the next sign-in, so the Users admin refuses it. Local-password
    accounts are never managed.
    """
    return auth_provider == "sso" and (native_active or proxy_active)
