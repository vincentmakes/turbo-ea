"""Trusted reverse-proxy authentication — resolve an identity a proxy already established.

Turbo EA can sit behind a proxy that has *already* authenticated the user (Azure
App Service EasyAuth, oauth2-proxy, Authelia, Cloudflare Access, AWS ALB, Traefik
forwardAuth). Running its own OIDC flow on top of that means registering an OIDC
client and storing a secret purely to re-authenticate someone the platform already
vouched for. This module reads the identity off the request instead
(`GET /auth/proxy/session`; see ``app/api/v1/auth.py``).

**The security model, because it is not the obvious one.**

Trusting a header is safe only when the header cannot come from the client, and on
the bundled stack it can: nginx's ``proxy_set_header`` only *overrides* the names
each block lists, it does not clear unknown ones, so a client-supplied
``X-MS-CLIENT-PRINCIPAL`` reaches the backend from the public internet. "Keep the
backend unreachable" does not help — it already is unreachable (``expose: "8000"``,
no ``ports:``), and the forgery arrives through the front door. Peer IP is no use
either: uvicorn runs without ``--proxy-headers`` and nginx sets no ``real_ip_header``,
so ``request.client.host`` is always the nginx container.

So the controls, in order:

1. **A pre-shared secret** the proxy injects, checked before any claim is parsed.
   This is the real control. It is operator-generated and registers with nobody, so
   the "no OIDC client secret" goal survives intact.
2. **Id-token verification**, when the proxy forwards one. Cryptographic and
   independent of network topology, but optional because not every proxy forwards a
   token. **Fail-closed**: enabling it and then finding no token is a refusal, never
   a silent downgrade to the claims header — otherwise an attacker just omits the
   token and the setting protects nobody.
3. **nginx header stripping**, defence in depth only. It cannot protect an operator
   fronting the stack with Traefik, an ingress, or Azure itself.

Azure App Service is the awkward case: it does not let you inject a custom header,
so it cannot use control 1 and must rely on the platform sanitising inbound
``X-MS-CLIENT-PRINCIPAL*`` headers. That is a real dependency on undocumented-to-us
behaviour, so it requires an explicit opt-in
(``PROXY_AUTH_TRUST_PLATFORM_HEADERS``) rather than being the silent default.

Everything here *resolves* an identity. It never creates a session and never
touches the database; the caller owns that.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import secrets as _secrets

from fastapi import HTTPException, Request

from app.config import settings
from app.services import sso_service

logger = logging.getLogger(__name__)

# Azure App Service EasyAuth injects these. The principal header is a base64
# JSON claim set; -NAME / -ID are convenience scalars.
AZURE_PRINCIPAL_HEADER = "x-ms-client-principal"
AZURE_NAME_HEADER = "x-ms-client-principal-name"
AZURE_ID_HEADER = "x-ms-client-principal-id"
AZURE_ID_TOKEN_HEADER = "x-ms-token-aad-id-token"

# Claim types that carry an email address, most specific first. Deliberately does
# NOT include the UPN: for an Entra guest the UPN is
# ``alice_gmail.com#EXT#@tenant.onmicrosoft.com`` while the email claim is
# ``alice@gmail.com``, so matching on UPN is an account-collision surface.
_EMAIL_CLAIM_TYPES = (
    "email",
    "emails",
    "preferred_username",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
)

_NAME_CLAIM_TYPES = (
    "name",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
)

# Stable subject identifiers, most stable first. Microsoft's ``oid`` is the
# object id and survives a rename; ``sub`` is pairwise per application.
_SUBJECT_CLAIM_TYPES = (
    "oid",
    "http://schemas.microsoft.com/identity/claims/objectidentifier",
    "sub",
    "nameidentifier",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier",
)


class ProxyIdentity:
    """A resolved identity, plus how much we trust it.

    ``verified`` is the load-bearing field: it is True only when the identity came
    from a signature-verified id token. An unverified identity may sign in a user
    that already exists, but must never create one — see ``app/api/v1/auth.py``.

    ``roles`` carries the raw directory role values, before any mapping. An empty
    tuple means the claim was **absent**, which is deliberately distinct from
    "present but matching nothing in the map": the first leaves the user's role
    alone, the second falls back to the default role.
    """

    __slots__ = ("email", "display_name", "subject_id", "verified", "email_verified", "roles")

    def __init__(
        self,
        *,
        email: str,
        display_name: str,
        subject_id: str,
        verified: bool,
        email_verified: bool | None,
        roles: tuple[str, ...] = (),
    ) -> None:
        self.email = email
        self.display_name = display_name
        self.subject_id = subject_id
        self.verified = verified
        self.email_verified = email_verified
        self.roles = roles

    def __repr__(self) -> str:  # pragma: no cover — debugging aid
        return (
            f"ProxyIdentity(email={self.email!r}, subject_id={self.subject_id!r}, "
            f"verified={self.verified})"
        )


def is_enabled() -> bool:
    """Whether trusted-proxy auth is switched on at all."""
    return bool(settings.PROXY_AUTH_ENABLED)


def check_shared_secret(request: Request) -> None:
    """Verify the proxy's pre-shared secret. Raises 401 on any mismatch.

    Called *before* any claim parsing so a forged principal header never reaches
    the decoder. In ``azure_easyauth`` mode the secret may be waived, because App
    Service cannot inject a custom header — but only via an explicit opt-in, and
    a configured secret is always enforced regardless of mode.
    """
    expected = settings.PROXY_AUTH_SHARED_SECRET
    if not expected:
        if settings.PROXY_AUTH_MODE == "azure_easyauth" and (
            settings.PROXY_AUTH_TRUST_PLATFORM_HEADERS
        ):
            return
        # Misconfiguration, not an authentication failure. Say so plainly rather
        # than leaving an operator to guess why every sign-in 401s.
        raise HTTPException(
            500,
            "Proxy authentication is enabled but not secured. Set "
            "TURBO_EA_PROXY_AUTH_SHARED_SECRET, or (Azure App Service only, where "
            "a custom header cannot be injected) set "
            "TURBO_EA_PROXY_AUTH_TRUST_PLATFORM_HEADERS=true to accept the "
            "platform's own header sanitisation as the control.",
        )

    presented = request.headers.get(settings.PROXY_AUTH_SECRET_HEADER.lower(), "")
    if not presented or not _secrets.compare_digest(presented, expected):
        raise HTTPException(401, "Proxy authentication failed.")


def _decode_azure_principal(raw: str) -> dict:
    """Decode App Service's base64 JSON principal into a flat claim dict.

    The payload shape is ``{"auth_typ": ..., "claims": [{"typ": ..., "val": ...}]}``.

    A repeated claim type is kept as a **list**, in document order. That matters
    for exactly one claim: App Service emits one entry per app role, so a user in
    two roles produces two ``{"typ": "roles"}`` entries, while the verified
    id-token path hands the same claim back as a list. Collapsing to the first
    occurrence here — which this did until #1006 — meant the same user could
    resolve differently depending on whether the token store was on. Single-valued
    lookups are unaffected: ``_first_claim`` already takes ``value[0]`` for a list.
    """
    try:
        padded = raw + "=" * (-len(raw) % 4)
        decoded = base64.b64decode(padded)
        payload = json.loads(decoded)
    except (binascii.Error, ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(401, "Malformed proxy identity header.") from exc

    if not isinstance(payload, dict):
        raise HTTPException(401, "Malformed proxy identity header.")

    claims: dict[str, str | list[str]] = {}
    for entry in payload.get("claims") or []:
        if not isinstance(entry, dict):
            continue
        typ, val = entry.get("typ"), entry.get("val")
        if not (isinstance(typ, str) and isinstance(val, str)):
            continue
        existing = claims.get(typ)
        if existing is None:
            claims[typ] = val
        elif isinstance(existing, list):
            existing.append(val)
        else:
            claims[typ] = [existing, val]
    return claims


def _first_claim(claims: dict, candidates: tuple[str, ...]) -> str:
    for key in candidates:
        value = claims.get(key)
        if isinstance(value, list):
            value = value[0] if value else None
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _claim_values(claims: dict, key: str) -> tuple[str, ...]:
    """Every value of one claim, normalising the two shapes into a tuple.

    The principal blob yields ``str`` (one value) or ``list[str]`` (several); a
    verified id token yields whatever the IdP put there. Non-string entries are
    dropped rather than coerced — a role name is a string or it is nothing.
    """
    if not key:
        return ()
    value = claims.get(key)
    if isinstance(value, str):
        return (value.strip(),) if value.strip() else ()
    if isinstance(value, list):
        return tuple(v.strip() for v in value if isinstance(v, str) and v.strip())
    return ()


def map_role(values: tuple[str, ...]) -> str | None:
    """Resolve directory role values to a Turbo EA role key, or None for no match.

    **First match in map order**, not in claim order. A user can hold several
    directory roles and the two claim shapes do not agree on their ordering, so
    the only deterministic tie-break is the operator's own configuration order.
    "Highest role" is not available: role keys are operator-defined and have no
    ranking.

    Pure — no request, no database. The caller validates the returned key against
    the ``roles`` table.
    """
    if not values:
        return None
    held = {v.lower() for v in values}
    for source, target in settings.PROXY_AUTH_ROLE_MAP:
        if source in held:
            return target
    return None


def role_mapping_trusted(identity: ProxyIdentity) -> bool:
    """Whether this identity is trustworthy enough to *grant* a role, not just a name.

    Mirrors the ``allow_create`` tiering in ``_provision_federated_user``: on the
    weakest tier (Azure + ``TRUST_PLATFORM_HEADERS`` with no token verification and
    no shared secret) a forged principal header can already impersonate an existing
    account, but it must not additionally hand out that account's *permissions*.
    A signature-verified token or a pre-shared secret both clear the bar.
    """
    return bool(identity.verified or settings.PROXY_AUTH_SHARED_SECRET)


def _verify_forwarded_id_token(token: str) -> dict:
    """Verify a proxy-forwarded id token against the proxy-auth OIDC settings.

    Deliberately does NOT reuse the SSO settings: in a proxy-auth deployment there
    is no SSO config by definition, so ``client_id`` would be ``""`` and PyJWT
    would reject every token on audience. Hence the dedicated issuer / audience /
    JWKS settings.
    """
    issuer = settings.PROXY_AUTH_ISSUER
    audience = settings.PROXY_AUTH_AUDIENCE
    jwks_uri = settings.PROXY_AUTH_JWKS_URI
    if not (issuer and audience and jwks_uri):
        raise HTTPException(
            500,
            "Proxy id-token verification is enabled but incomplete. Set "
            "TURBO_EA_PROXY_AUTH_ISSUER, TURBO_EA_PROXY_AUTH_AUDIENCE and "
            "TURBO_EA_PROXY_AUTH_JWKS_URI.",
        )
    try:
        return sso_service.verify_id_token(token, audience, jwks_uri, issuer)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Proxy id-token verification failed: %s", exc)
        raise HTTPException(401, "Proxy identity token could not be verified.") from exc


def _check_domain(email: str) -> None:
    """Enforce the email-domain allowlist.

    Mandatory unless explicitly waived. Unlike the portal allowlist (which grants
    an account-less read-only session) a match here can mint a real ``users`` row
    with write permissions, so the default has to be closed.
    """
    if settings.PROXY_AUTH_ALLOW_ANY_DOMAIN:
        return
    allowed = settings.PROXY_AUTH_ALLOWED_DOMAINS
    if not allowed:
        raise HTTPException(
            500,
            "Proxy authentication is enabled without an email-domain allowlist. Set "
            "TURBO_EA_PROXY_AUTH_ALLOWED_DOMAINS, or "
            "TURBO_EA_PROXY_AUTH_ALLOW_ANY_DOMAIN=true to accept any domain.",
        )
    domain = email.rsplit("@", 1)[-1].lower()
    if domain not in allowed:
        raise HTTPException(403, "Sign-in is restricted to approved email domains.")


def resolve_identity(request: Request) -> ProxyIdentity:
    """Resolve the proxy-asserted identity, or raise.

    Assumes ``check_shared_secret`` has already run.
    """
    verify = settings.PROXY_AUTH_VERIFY_ID_TOKEN
    claims: dict = {}
    verified = False

    if settings.PROXY_AUTH_MODE == "azure_easyauth":
        id_token = request.headers.get(AZURE_ID_TOKEN_HEADER, "")
        if verify:
            # Fail-closed. Falling back to the claims header here would mean an
            # attacker need only omit the token to reach the unverified path.
            if not id_token:
                raise HTTPException(
                    401,
                    "Proxy id-token verification is enabled but the proxy forwarded no "
                    "token. Enable the App Service token store, or turn off "
                    "TURBO_EA_PROXY_AUTH_VERIFY_ID_TOKEN.",
                )
            claims = _verify_forwarded_id_token(id_token)
            verified = True
        else:
            raw = request.headers.get(AZURE_PRINCIPAL_HEADER, "")
            if raw:
                claims = _decode_azure_principal(raw)

        email = _first_claim(claims, _EMAIL_CLAIM_TYPES)
        display_name = _first_claim(claims, _NAME_CLAIM_TYPES)
        subject_id = _first_claim(claims, _SUBJECT_CLAIM_TYPES)
        roles = _claim_values(claims, settings.PROXY_AUTH_ROLE_CLAIM)
        if not verified:
            # Scalar fallbacks, used only when the principal header carried no
            # usable claim. -NAME is the UPN, so it is a display/subject hint and
            # never an email.
            subject_id = subject_id or request.headers.get(AZURE_ID_HEADER, "").strip()
            display_name = display_name or request.headers.get(AZURE_NAME_HEADER, "").strip()
    else:
        if verify:
            raise HTTPException(
                500,
                "Proxy id-token verification is only supported in azure_easyauth mode. "
                "Turn off TURBO_EA_PROXY_AUTH_VERIFY_ID_TOKEN for header mode.",
            )
        email = request.headers.get(settings.PROXY_AUTH_EMAIL_HEADER.lower(), "").strip()
        display_name = request.headers.get(settings.PROXY_AUTH_NAME_HEADER.lower(), "").strip()
        subject_id = request.headers.get(settings.PROXY_AUTH_SUBJECT_HEADER.lower(), "").strip()
        # oauth2-proxy et al. carry group / role membership as one comma-separated
        # header rather than a claim set.
        raw_roles = request.headers.get(settings.PROXY_AUTH_ROLE_HEADER.lower(), "")
        roles = tuple(r.strip() for r in raw_roles.split(",") if r.strip())

    if not email:
        raise HTTPException(401, "The proxy asserted no email address for this user.")

    email = email.lower().strip()

    # An id token may say the address is unverified. The SSO callback does not
    # check this, but the portal gate does (public_access.resolve_sso_visitor_email)
    # and the stricter behaviour is the right one for a path that creates accounts.
    email_verified = claims.get("email_verified") if claims else None
    if email_verified is False:
        raise HTTPException(403, "Your email address is not verified with the identity provider.")

    _check_domain(email)

    # Without a stable subject the email is the only identifier available. That is
    # acceptable — the proxy is the authority for both — but it must be recorded
    # consistently so a later sign-in matches the same row.
    subject_id = subject_id or f"proxy:{email}"

    return ProxyIdentity(
        email=email,
        display_name=display_name or email.split("@")[0],
        subject_id=subject_id,
        verified=verified,
        email_verified=email_verified,
        roles=roles,
    )
