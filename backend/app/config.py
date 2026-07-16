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
