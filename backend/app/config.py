from __future__ import annotations

import os
from pathlib import Path

_DEFAULT_SECRET_KEYS = ("change-me-in-production", "dev-secret-key-change-in-production")

# Placeholder From address used when the admin never configured one. The Graph
# backend treats it as "unset" and lets the sender mailbox supply the From.
DEFAULT_SMTP_FROM = "noreply@turboea.local"


def _read_version() -> str:
    """Read version from the project-root VERSION file."""
    here = Path(__file__).resolve().parent
    # Local dev: backend/app/config.py -> ../../VERSION
    # Docker:    /app/app/config.py    -> /app/VERSION
    for candidate in [here.parent.parent / "VERSION", here.parent / "VERSION"]:
        if candidate.is_file():
            return candidate.read_text().strip()
    return "0.0.0-dev"


APP_VERSION = _read_version()

# The vendor's extension catalogue — a hard constant, deliberately NOT an
# environment variable. The Store tab on Admin → Extensions is part of the
# product on every install; there is no opt-in/opt-out configuration
# (repointing it means forking, exactly like the trusted vendor keys in
# app/core/extension_signing.py). Air-gapped instances need nothing: an
# unreachable catalogue degrades to a friendly offline hint and the
# file-based install flow is always fully functional.
EXTENSION_STORE_URL = "https://store.turbo-ea.org"


class Settings:
    PROJECT_NAME: str = "Turbo EA"
    API_V1_PREFIX: str = "/api/v1"

    POSTGRES_HOST: str = os.getenv("POSTGRES_HOST", "localhost")
    POSTGRES_PORT: str = os.getenv("POSTGRES_PORT", "5432")
    POSTGRES_DB: str = os.getenv("POSTGRES_DB", "turboea")
    POSTGRES_USER: str = os.getenv("POSTGRES_USER", "turboea")
    POSTGRES_PASSWORD: str = os.getenv("POSTGRES_PASSWORD", "turboea")

    # Connection-pool sizing for the single async engine (app/database.py).
    # The backend runs one uvicorn process, so its total connection budget is
    # ``DB_POOL_SIZE + DB_MAX_OVERFLOW`` — 30 by default. The bundled Postgres
    # allows 100, but a managed instance on a low-cost plan often caps the
    # database far below 30 (``ALTER DATABASE … CONNECTION LIMIT``), which
    # surfaces as ``too many connections for database "turboea"``. Lower these
    # to fit under such a cap; see docs/admin/operations.md.
    DB_POOL_SIZE: int = int(os.getenv("DB_POOL_SIZE", "20"))
    DB_MAX_OVERFLOW: int = int(os.getenv("DB_MAX_OVERFLOW", "10"))
    DB_POOL_TIMEOUT: int = int(os.getenv("DB_POOL_TIMEOUT", "30"))

    # Audit-log (mutation_batches) retention. The hourly purge loop
    # deletes batches whose ``created_at`` is older than this; events
    # under those batches keep their rows but lose the ``batch_id``
    # link (FK is ON DELETE SET NULL on the events table). Tune via
    # the ``MUTATION_BATCH_RETENTION_DAYS`` env var.
    MUTATION_BATCH_RETENTION_DAYS: int = int(os.getenv("MUTATION_BATCH_RETENTION_DAYS", "15"))

    RESET_DB: bool = os.getenv("RESET_DB", "").lower() in ("1", "true", "yes")
    SEED_DEMO: bool = os.getenv("SEED_DEMO", "").lower() in ("1", "true", "yes")
    SEED_BPM: bool = os.getenv("SEED_BPM", "").lower() in ("1", "true", "yes")
    SEED_PPM: bool = os.getenv("SEED_PPM", "").lower() in ("1", "true", "yes")
    SEED_SECURITY: bool = os.getenv("SEED_SECURITY", "").lower() in ("1", "true", "yes")

    SECRET_KEY: str = os.getenv("SECRET_KEY", "change-me-in-production")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

    # Lifetime of an SSO-gated web-portal visitor session (account-less). Kept
    # shorter than a user session: portal tokens are stateless, so the TTL is
    # the revocation granularity for a de-provisioned visitor (unpublishing the
    # portal is the instant kill switch). Default 8h.
    PORTAL_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("PORTAL_TOKEN_EXPIRE_MINUTES", "480"))

    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")

    ALLOWED_ORIGINS: list[str] = [
        o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:8920").split(",")
    ]

    # ------------------------------------------------------------------
    # Trusted reverse-proxy authentication (optional — #1006)
    #
    # Lets Turbo EA accept an identity an authenticating proxy has already
    # established (Azure App Service EasyAuth, oauth2-proxy, Authelia,
    # Cloudflare Access, AWS ALB, Traefik forwardAuth) instead of running its
    # own OIDC flow. No OIDC client and no app registration are required.
    #
    # OFF by default: when PROXY_AUTH_ENABLED is false the endpoint answers
    # 404, exactly like the ops API with OPS_PUBLIC_KEY unset. Identity
    # headers are only as trustworthy as the guarantee that nothing can reach
    # the backend except through the proxy, so this must be opted into.
    # ------------------------------------------------------------------
    PROXY_AUTH_ENABLED: bool = os.getenv("TURBO_EA_PROXY_AUTH_ENABLED", "").lower() in (
        "1",
        "true",
        "yes",
    )
    # "azure_easyauth" reads the App Service principal headers; "header" reads
    # the generic header names configured below.
    PROXY_AUTH_MODE: str = os.getenv("TURBO_EA_PROXY_AUTH_MODE", "azure_easyauth")

    # The primary control. The proxy injects this value in PROXY_AUTH_SECRET_HEADER
    # and the backend compares it with secrets.compare_digest before parsing any
    # claim. It is an operator-generated value, NOT an IdP credential — nothing
    # registers it. Required in "header" mode; see PROXY_AUTH_TRUST_PLATFORM_HEADERS
    # for why Azure cannot use it.
    PROXY_AUTH_SHARED_SECRET: str = os.getenv("TURBO_EA_PROXY_AUTH_SHARED_SECRET", "")
    PROXY_AUTH_SECRET_HEADER: str = os.getenv(
        "TURBO_EA_PROXY_AUTH_SECRET_HEADER", "X-Turbo-EA-Proxy-Secret"
    )
    # Azure App Service does not let you add a custom header, so azure_easyauth
    # mode cannot use the shared secret and must instead rely on App Service
    # sanitising inbound X-MS-CLIENT-PRINCIPAL* headers itself. That is an
    # explicit, acknowledged risk rather than a silent default.
    PROXY_AUTH_TRUST_PLATFORM_HEADERS: bool = os.getenv(
        "TURBO_EA_PROXY_AUTH_TRUST_PLATFORM_HEADERS", ""
    ).lower() in ("1", "true", "yes")

    # Generic "header" mode header names.
    PROXY_AUTH_EMAIL_HEADER: str = os.getenv(
        "TURBO_EA_PROXY_AUTH_EMAIL_HEADER", "X-Forwarded-Email"
    )
    PROXY_AUTH_NAME_HEADER: str = os.getenv("TURBO_EA_PROXY_AUTH_NAME_HEADER", "X-Forwarded-User")
    PROXY_AUTH_SUBJECT_HEADER: str = os.getenv(
        "TURBO_EA_PROXY_AUTH_SUBJECT_HEADER", "X-Forwarded-Subject"
    )

    # Id-token verification. FAIL-CLOSED: when enabled and the proxy forwards no
    # token, the request is refused rather than downgraded to the claims header
    # (a downgrade would let an attacker simply omit the token). Verification
    # cannot reuse the SSO settings — they are empty by definition here — so it
    # takes its own issuer / audience / JWKS.
    PROXY_AUTH_VERIFY_ID_TOKEN: bool = os.getenv(
        "TURBO_EA_PROXY_AUTH_VERIFY_ID_TOKEN", ""
    ).lower() in ("1", "true", "yes")
    PROXY_AUTH_ISSUER: str = os.getenv("TURBO_EA_PROXY_AUTH_ISSUER", "")
    PROXY_AUTH_AUDIENCE: str = os.getenv("TURBO_EA_PROXY_AUTH_AUDIENCE", "")
    PROXY_AUTH_JWKS_URI: str = os.getenv("TURBO_EA_PROXY_AUTH_JWKS_URI", "")

    # Mandatory unless PROXY_AUTH_ALLOW_ANY_DOMAIN is set: an Entra guest / B2B
    # identity would otherwise mint an account on your instance.
    PROXY_AUTH_ALLOWED_DOMAINS: list[str] = [
        d.strip().lower().lstrip("@")
        for d in os.getenv("TURBO_EA_PROXY_AUTH_ALLOWED_DOMAINS", "").split(",")
        if d.strip()
    ]
    PROXY_AUTH_ALLOW_ANY_DOMAIN: bool = os.getenv(
        "TURBO_EA_PROXY_AUTH_ALLOW_ANY_DOMAIN", ""
    ).lower() in ("1", "true", "yes")

    # A proxy-auth-only install has no other path to a first admin: only the
    # first-user branch of /auth/register mints one, and that route is closed
    # when proxy auth is on. This email is granted admin on first sign-in.
    PROXY_AUTH_BOOTSTRAP_ADMIN_EMAIL: str = os.getenv(
        "TURBO_EA_PROXY_AUTH_BOOTSTRAP_ADMIN_EMAIL", ""
    )

    # Where to send the browser on logout so the proxy session ends too
    # (/.auth/logout for EasyAuth, /oauth2/sign_out for oauth2-proxy). Without
    # it, signing out of Turbo EA leaves the upstream session live.
    PROXY_AUTH_LOGOUT_URL: str = os.getenv("TURBO_EA_PROXY_AUTH_LOGOUT_URL", "")

    # Email / SMTP (optional — if not configured, email notifications are skipped)
    SMTP_HOST: str = os.getenv("SMTP_HOST", "")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM: str = os.getenv("SMTP_FROM", DEFAULT_SMTP_FROM)
    SMTP_TLS: bool = os.getenv("SMTP_TLS", "true").lower() in ("1", "true", "yes")

    # Email transport method: smtp_basic (default) | smtp_oauth | graph_api.
    # OAuth fields are a *dedicated* email app registration (not the SSO one) —
    # used by the Microsoft Graph backend and SMTP XOAUTH2. Secrets may be
    # sourced from the environment / a secret store instead of the database.
    EMAIL_METHOD: str = os.getenv("EMAIL_METHOD", "smtp_basic")
    EMAIL_OAUTH_PROVIDER: str = os.getenv("EMAIL_OAUTH_PROVIDER", "microsoft")
    EMAIL_OAUTH_TENANT_ID: str = os.getenv("EMAIL_OAUTH_TENANT_ID", "")
    EMAIL_OAUTH_CLIENT_ID: str = os.getenv("EMAIL_OAUTH_CLIENT_ID", "")
    EMAIL_OAUTH_CLIENT_SECRET: str = os.getenv("EMAIL_OAUTH_CLIENT_SECRET", "")
    EMAIL_OAUTH_SCOPE: str = os.getenv("EMAIL_OAUTH_SCOPE", "")
    EMAIL_OAUTH_TOKEN_ENDPOINT: str = os.getenv("EMAIL_OAUTH_TOKEN_ENDPOINT", "")
    EMAIL_GRAPH_SENDER: str = os.getenv("EMAIL_GRAPH_SENDER", "")
    EMAIL_SERVICE_ACCOUNT_JSON: str = os.getenv("EMAIL_SERVICE_ACCOUNT_JSON", "")

    # Display name shown in the navbar, browser tab, and outgoing emails.
    # Seeded from the DB on startup and updated when the admin changes it.
    APP_TITLE: str = "Turbo EA"

    # Public base URL used in email links — seeded from the stored email
    # settings (app_base_url) at startup / on save; empty means localhost.
    _app_base_url: str = ""

    # Control-plane ops API (optional — the /api/v1/ops router only accepts
    # requests when this Ed25519 public key (base64 raw 32 bytes) is set.
    # Managed Turbo EA Cloud deployments inject it; self-hosted installs
    # leave it empty and the ops API answers 404.
    OPS_PUBLIC_KEY: str = os.getenv("OPS_PUBLIC_KEY", "")

    # Base URL of the vendor's extension catalogue (static hosting serving
    # catalog.json + the public .teax bundles). Powers the in-product Store
    # tab: the backend proxies the catalogue and downloads bundles from
    # here — read-only, no account, no token, and every download goes
    # through the same signature verification as a manual upload. A code
    # constant by design (see the module-level comment) — no env override.
    EXTENSION_STORE_URL: str = EXTENSION_STORE_URL

    # Extension write-bridge guardrails (SDK 1.5). Mirrors the MCP_* write
    # guardrails: a kill switch that pauses all extension writes without a
    # restart (reads keep working), a per-batch write cap, and an in-process
    # per-extension rate cap on batches.
    EXTENSION_WRITES_ENABLED: bool = os.getenv("EXTENSION_WRITES_ENABLED", "true").lower() in (
        "1",
        "true",
        "yes",
    )
    EXTENSION_MAX_WRITES_PER_BATCH: int = int(os.getenv("EXTENSION_MAX_WRITES_PER_BATCH", "500"))
    EXTENSION_MAX_BATCHES_PER_MINUTE: int = int(os.getenv("EXTENSION_MAX_BATCHES_PER_MINUTE", "60"))

    # AI / LLM (optional — disabled by default)
    AI_PROVIDER_URL: str = os.getenv("AI_PROVIDER_URL", "")
    AI_MODEL: str = os.getenv("AI_MODEL", "")
    AI_SEARCH_PROVIDER: str = os.getenv("AI_SEARCH_PROVIDER", "")
    AI_SEARCH_URL: str = os.getenv("AI_SEARCH_URL", "")
    AI_AUTO_CONFIGURE: bool = os.getenv("AI_AUTO_CONFIGURE", "").lower() in ("1", "true", "yes")

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )


settings = Settings()
